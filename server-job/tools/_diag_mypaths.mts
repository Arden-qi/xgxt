/**
 * 临时诊断：孙敏（sunmin / 项目经理）登录后「看不到任何页面」问题
 *
 * 复现服务端 my-paths 的完整计算链：
 *   ① getAccountPermProfile → 账号的业务角色 + moduleItems
 *   ② effectivePathsForRoles → 职位级最终可见页面
 *   ③ loadPathFlags → 全局板块台账
 *   ④ 两者相交 = my-paths 实际下发
 * 并顺手签一个与登录同构的 token，直接打线上接口对照。
 *
 * 用法：cd server-job && node node_modules/tsx/dist/cli.mjs tools/_diag_mypaths.mts
 */
import { getAccountPermProfile } from '../src/perm/services/perm.service';
import { effectivePathsForRoles, effectiveKeysOfRole } from '../src/utils/rolePageEffective';
import { loadPathFlags } from '../src/perm/services/page.service';
import { loadRolePageRows } from '../src/perm/services/rolePage.service';
import { signToken } from '../src/portal/utils/jwt';
import { db } from '../src/perm/utils/db';

async function main() {
  const arg = process.argv[2] || '';

  const portalDb = (await import('../src/portal/utils/db')).db;
  const ACCOUNT_TABLE = 't_sys_account';
  const { resolveVisibleModules, toAccountView } = await import(
    '../src/portal/services/account.service'
  );

  /* ===== 全账号普查模式：--all ===== */
  if (arg === '--all') {
    const { toAccountView } = await import('../src/portal/services/account.service');
    const rows = await portalDb(ACCOUNT_TABLE).where({ is_deleted: false }).select();
    console.log('账号数:', rows.length);
    for (const row of rows) {
      const name = String(row.account);
      const view = toAccountView(row, false);
      let mods: string[] = [];
      let roles: string[] = [];
      try {
        const vm = await resolveVisibleModules(view);
        mods = vm.map((m: any) => String(m.key));
      } catch (e: any) {
        console.log(`  [${name}] visibleModules 失败: ${e?.message}`);
      }
      try {
        const prof = await getAccountPermProfile(name);
        roles = prof.roles;
      } catch { /* 忽略 */ }
      // 签真实形态 token 打线上接口
      const token = signToken({
        userId: row.id,
        roles: [row.kind === 'sys_admin' ? 'SYS_ADMIN' : 'SYS_STAFF'],
        permissions: row.kind === 'sys_admin' ? ['*'] : [`module:${mods.join(',')}`],
        dataScope: row.kind === 'sys_admin' ? 4 : 3,
        modules: mods,
        kind: row.kind,
        userName: row.user_name,
        accountId: row.id,
        account: name,
      } as any);
      const H = { Authorization: `Bearer ${token}` };
      const [r1, r2] = await Promise.all([
        fetch('http://127.0.0.1:8004/api/perm/page/my-paths', { headers: H }),
        fetch('http://127.0.0.1:8004/api/job/auth/my-pages', { headers: H }),
      ]);
      const j1: any = await r1.json().catch(() => null);
      const j2: any = await r2.json().catch(() => null);
      const paths: string[] = j1?.data?.paths || [];
      const pages: any[] = j2?.data?.pages || [];
      const perms: string[] = j2?.data?.permissions || [];
      const nonWorkbench = paths.filter((p) => p !== '/');
      // 异常标记：有职位但页面/权限全空；或 my-paths 只有工作台
      const flags: string[] = [];
      if (roles.length && !row.kind.includes('admin')) {
        if (nonWorkbench.length === 0 && pages.length === 0) flags.push('⚠️页面全空');
        else if (pages.length === 0 && nonWorkbench.length > 0) flags.push('（仅teaching页，旧码0——正常走pageGranted）');
      }
      console.log(
        `${name}(${row.user_name}) kind=${row.kind} 职位=[${roles.join(',')}] modules=[${mods.join(',')}] `
          + `my-paths=${paths.length} 旧页面=${pages.length} 旧权限码=${perms.length} ${flags.join(' ')}`
          + (nonWorkbench.length ? ` | paths: ${nonWorkbench.slice(0, 12).join(' ')}` : ''),
      );
    }
    await db.destroy();
    return;
  }

  const ACCOUNT = arg === '--token' ? process.argv[3] || 'sunmin' : arg || 'sunmin';
  const TOKEN_ONLY = arg === '--token';
  if (TOKEN_ONLY) {
    // 只签 token 落盘（供无头浏览器取证），不做其余诊断
    const accRow2 = await portalDb(ACCOUNT_TABLE).where({ account: ACCOUNT, is_deleted: false }).first();
    if (!accRow2) {
      console.error('账号不存在:', ACCOUNT);
      await db.destroy();
      process.exit(1);
    }
    const vm = await resolveVisibleModules(toAccountView(accRow2, false));
    const mods = vm.map((m: any) => String(m.key));
    const t = signToken({
      userId: accRow2.id,
      roles: [accRow2.kind === 'sys_admin' ? 'SYS_ADMIN' : 'SYS_STAFF'],
      permissions: accRow2.kind === 'sys_admin' ? ['*'] : [`module:${mods.join(',')}`],
      dataScope: accRow2.kind === 'sys_admin' ? 4 : 3,
      modules: mods,
      kind: accRow2.kind,
      userName: accRow2.user_name,
      accountId: accRow2.id,
      account: ACCOUNT,
    } as any);
    const { writeFileSync } = await import('fs');
    writeFileSync('tools/_diag_token.txt', t, 'utf8');
    console.log(`token 已生成: ${ACCOUNT} modules=[${mods.join(',')}]`);
    await db.destroy();
    return;
  }

  // ① 账号档案
  const prof = await getAccountPermProfile(ACCOUNT);
  console.log('=== ① account-profile ===');
  console.log('found:', prof.found, '| roles:', prof.roles, '| roleNames:', prof.roleNames);
  console.log('moduleItems keys:', Object.keys(prof.moduleItems || {}));
  for (const [k, v] of Object.entries(prof.moduleItems || {})) {
    console.log('  ', k, '→', (v as string[]).length, '项:', (v as string[]).slice(0, 8).join('、'), '...');
  }

  // ② 职位级最终可见
  console.log('=== ② effectivePathsForRoles ===');
  const rp = await effectivePathsForRoles(prof.roles);
  if (!rp) {
    console.log('null（不过滤）');
  } else {
    console.log('size:', rp.size);
    console.log([...rp].sort().join('\n'));
  }

  // ③ 全局台账
  console.log('=== ③ loadPathFlags ===');
  const flags = await loadPathFlags();
  console.log('flags.paths:', flags.paths.length, '| allPaths:', flags.allPaths.length);

  // ④ 相交
  if (rp) {
    const final = flags.paths.filter((p) => rp.has(p));
    console.log('=== ④ my-paths 实际下发 ===');
    console.log('size:', final.length, '→', final.join(' , '));
  }

  // ⑤ 台账原始行（该账号的职位）
  console.log('=== ⑤ t_perm_role_page 台账行 ===');
  const rows = await loadRolePageRows();
  for (const code of prof.roles) {
    const roleRow = await db('t_perm_role').where({ role_code: code, is_deleted: false }).first();
    if (!roleRow) {
      console.log(`  [${code}] 职位不存在!`);
      continue;
    }
    const mine = rows.filter((r) => r.roleId === roleRow.id);
    console.log(`  [${code}] ${roleRow.role_name} 台账行数: ${mine.length}`);
    for (const r of mine.slice(0, 30)) {
      console.log(`    ${r.moduleKey}||${r.pagePath} enabled=${r.enabled}`);
    }
  }

  // ⑥ 单独再算一次 effectiveKeysOfRole（排查缓存/默认值问题）
  for (const code of prof.roles) {
    const keys = await effectiveKeysOfRole(code);
    console.log(`=== ⑥ effectiveKeysOfRole(${code}) size=${keys.size} ===`);
    console.log([...keys].sort().slice(0, 30).join('\n'));
  }

  // ⑦ 签 token 打线上接口 —— ★ 改为完全复刻真实登录 token：
  //    roles=['SYS_STAFF']（门户级），靠线上 authMiddleware 现查业务角色
  let realModules: string[] = [];
  let accRow: any = null;
  try {
    accRow = await portalDb(ACCOUNT_TABLE).where({ account: ACCOUNT, is_deleted: false }).first();
    console.log('=== ⓪ t_sys_account 行 ===');
    console.log('modules:', accRow?.modules, '| active:', accRow?.active, '| kind:', accRow?.kind);
  } catch (e: any) {
    console.log('读账号行失败（可忽略）:', e?.message);
  }
  let accView: any = accRow;
  try {
    const { toAccountView } = await import('../src/portal/services/account.service');
    accView = accRow ? toAccountView(accRow, false) : null;
  } catch { /* 保持原始行 */ }
  const visMods = accView ? await resolveVisibleModules(accView) : [];
  realModules = visMods.map((m: any) => String(m.key));
  console.log('=== ⑦a resolveVisibleModules →', JSON.stringify(realModules), '===');

  const token = signToken({
    userId: accRow?.id || prof.permUserId || 'diag',
    roles: [accRow?.kind === 'sys_admin' ? 'SYS_ADMIN' : 'SYS_STAFF'],
    permissions: accRow?.kind === 'sys_admin' ? ['*'] : [`module:${realModules.join(',')}`],
    dataScope: accRow?.kind === 'sys_admin' ? 4 : 3,
    modules: realModules,
    kind: accRow?.kind || 'module_owner',
    userName: prof.userName || ACCOUNT,
    accountId: accRow?.id,
    account: ACCOUNT,
  } as any);
  console.log('=== ⑦ 线上接口实测（token 已签） ===');
  const H = { Authorization: `Bearer ${token}` };
  /* ★ 把真实形态 token 落盘，供无头浏览器取证页使用 */
  try {
    const { writeFileSync } = await import('fs');
    writeFileSync('tools/_diag_token.txt', token, 'utf8');
  } catch { /* 忽略 */ }
  const r1 = await fetch('http://127.0.0.1:8004/api/perm/page/my-paths', { headers: H });
  const j1: any = await r1.json().catch(() => null);
  console.log('my-paths:', r1.status, 'paths:', j1?.data?.paths?.length, 'roleFiltered:', j1?.data?.roleFiltered);
  if (j1?.data?.paths?.length) console.log('  paths:', j1.data.paths.join(' , '));
  const r2 = await fetch('http://127.0.0.1:8004/api/job/auth/my-pages', { headers: H });
  const j2: any = await r2.json().catch(() => null);
  console.log(
    'my-pages:',
    r2.status,
    'roles:',
    JSON.stringify(j2?.data?.roles),
    'pages:',
    j2?.data?.pages?.length,
    'perms:',
    j2?.data?.permissions?.length,
  );
  if (j2?.data?.pages?.length) {
    console.log('  pages:', j2.data.pages.map((p: any) => p.path).join(' , '));
  }

  await db.destroy();
}

main().catch((e) => {
  console.error('诊断失败:', e?.message || e);
  process.exit(1);
});
