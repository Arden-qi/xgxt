/**
 * 回归守卫：门户「可见模块」必须跟着「职位 → 页面」台账走
 *
 * 背景（2026-10-23 用户报的 bug）：
 *   在「页面管理」给咨询老师、咨询经理勾上财务管理的「财务概览 / 缴费管理」，
 *   「职位权限分配」里也勾了对应动作，保存成功；
 *   但两个账号登录后左侧**根本没有「财务管理」一级模块**。
 *
 * 根因：两层授权没打通
 *   · 左侧一级模块只认 `t_sys_account.modules`（账号级，登录时写死）
 *   · 页面 / 动作走 `t_perm_role_page` + `t_perm_role_perm`（职位级）
 *   职位级放开了财务页面，账号级没有 finance → 分组不渲染，页面配了也白配。
 *
 * 修法：登录 / 刷新身份时用 `resolveVisibleModules()` 合成 ——
 *   门户模块（非 legacy）以职位页面台账为准；legacy 模块仍按账号级 modules。
 *
 * 本脚本锁死这几条不变量（需要后端 8004 在跑）：
 *   ① 咨询老师 / 咨询经理：visibleModules 含 finance，token.modules 含 finance，
 *      且 my-paths 里真有 /finance/overview 与 /finance/fee
 *   ② 系统管理员：不被台账带偏（仍只有 perm）
 *   ③ 纯财务账号：仍只有 finance（不能被反向加出 consult）
 *   ④ 教务 / 班主任：legacy 模块不受影响
 *
 * 退出码 0 = 全通过。
 */

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:8004';
const PWD = process.env.PROBE_PWD || '123456';

async function login(account) {
  const r = await fetch(`${BASE}/api/portal/account/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password: PWD }),
  }).then((x) => x.json());
  return r?.data;
}

function decodePayload(token) {
  try {
    const part = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(part, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

let pass = 0;
let fail = 0;
const rows = [];
function check(cond, label, extra = '') {
  if (cond) {
    pass += 1;
    rows.push(`  ✅ ${label}${extra ? '  —— ' + extra : ''}`);
  } else {
    fail += 1;
    rows.push(`  ❌ ${label}${extra ? '  —— ' + extra : ''}`);
  }
}

async function main() {
  console.log('\n===== 门户可见模块 ↔ 职位页面台账 一致性 =====\n');

  /* ---------- ① 咨询老师 / 咨询经理 ---------- */
  for (const [acc, who] of [
    ['lilx', '咨询老师'],
    ['wangjl', '咨询经理'],
  ]) {
    const d = await login(acc);
    if (!d) {
      check(false, `${who}（${acc}）能登录`, '登录失败，脚本无法继续判这一项');
      continue;
    }
    const mods = (d.visibleModules || []).map((m) => String(m.key));
    check(mods.includes('finance'), `${who}：visibleModules 含财务管理`, `实测 [${mods.join(',')}]`);
    check(mods.includes('consult'), `${who}：市场咨询仍在（没被连带关掉）`, `实测 [${mods.join(',')}]`);

    const p = decodePayload(d.token) || {};
    check(
      Array.isArray(p.modules) && p.modules.includes('finance'),
      `${who}：token.modules 含 finance（否则财务接口 403）`,
      `实测 ${JSON.stringify(p.modules)}`,
    );

    const r = await fetch(`${BASE}/api/perm/page/my-paths`, {
      headers: { Authorization: `Bearer ${d.token}` },
    }).then((x) => x.json());
    const paths = r?.data?.paths || [];
    check(paths.includes('/finance/overview'), `${who}：my-paths 含财务概览`);
    check(paths.includes('/finance/fee'), `${who}：my-paths 含缴费管理`);
    check(!paths.includes('/finance/bill'), `${who}：未授权的账单明细没被放出来`);
  }

  /* ---------- ② 系统管理员不被台账带偏 ---------- */
  const linx = await login('linx');
  if (linx) {
    const mods = (linx.visibleModules || []).map((m) => String(m.key));
    check(
      mods.length === 1 && mods[0] === 'perm',
      '系统管理员：仍只有权限管理（不因 SYS_ADMIN 职位在权限树里勾了别的板块而多出来）',
      `实测 [${mods.join(',')}]`,
    );
  } else {
    check(false, '系统管理员 linx 能登录');
  }

  /* ---------- ③ 纯财务账号不被反向加模块 ---------- */
  for (const acc of ['liukj', 'zhoum']) {
    const d = await login(acc);
    if (!d) {
      check(false, `财务账号 ${acc} 能登录`);
      continue;
    }
    const mods = (d.visibleModules || []).map((m) => String(m.key));
    check(
      mods.length === 1 && mods[0] === 'finance',
      `财务账号 ${acc}：仍只有财务管理（没被加出市场咨询）`,
      `实测 [${mods.join(',')}]`,
    );
  }

  /* ---------- ④ legacy 账号不受影响 ---------- */
  const sunmin = await login('sunmin');
  if (sunmin) {
    const mods = (sunmin.visibleModules || []).map((m) => String(m.key));
    check(
      mods.includes('class-jh') && !mods.includes('consult') && !mods.includes('finance'),
      '班主任：legacy 模块（class-jh）照旧，没多出咨询/财务',
      `实测 [${mods.join(',')}]`,
    );
  } else {
    check(false, '班主任 sunmin 能登录');
  }

  console.log(rows.join('\n'));
  console.log(`\n===== 结果：${pass}/${pass + fail} 通过 =====`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('脚本异常：', e && e.message);
  process.exit(1);
});
