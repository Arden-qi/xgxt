/**
 * 全系统权限一致性审计（只读）
 *
 * 覆盖：每一个职位、每一个账号、每一个页面。
 * 判定不变量（全部来自同一份事实来源 assignScope）：
 *   ① 职位：动作行 ⊆ 已授权页面；perm_count == 有效动作数
 *   ② 账号：下发的板块 == 职位页面推导出的板块（门户三板块）
 *   ③ 账号：头衔不能是「模块负责人」（账号类型冒充职位）
 *   ④ 账号：my-paths 里的页面 ⊆ 其职位有效页面
 *   ⑤ 账号详情：有效权限动作数 == 其职位有效动作并集
 */
import mysql from '../server-job/node_modules/mysql2/promise.js';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:8004';
const PWD = { wanghanyi: 'Wanghanyi123', qitiantian: 'Qtt123456', chenxf: 'qtt123456' };

const env = fs.readFileSync(new URL('../server-job/.env', import.meta.url), 'utf8');
const getEnv = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const db = await mysql.createConnection({
  host: '127.0.0.1',
  port: Number(getEnv('DB_PORT') || 3306),
  user: getEnv('DB_USER'),
  password: getEnv('DB_PASSWORD'),
});
const q = async (sql, args = []) => (await db.query(sql, args))[0];

const PORTAL_KEYS = new Set(['consult', 'finance', 'perm']);
const fails = [];
const check = (ok, msg) => {
  console.log(`  ${ok ? '✔' : '✘'} ${msg}`);
  if (!ok) fails.push(msg);
};

/* ============ 职位 ============ */
console.log('\n===== ① 职位：动作 ↔ 页面 =====');
const roles = await q(`select id, role_name, role_code, perm_count from sms_perm.t_perm_role where is_deleted=0 order by sort_no`);
const ledger = await q(`select role_id, module_key, page_path, enabled from sms_perm.t_perm_role_page where is_deleted=0`);
const actions = await q(
  `select role_id, module_key, item_name, action_code from sms_perm.t_perm_role_perm where is_deleted=0`,
);

// 页面名 ↔ path 映射（用于把动作换算成"页面是否被授权"）
const pageRows = await q(`select module_key, page_title, page_path, enabled from sms_perm.t_perm_page where is_deleted=0`);
const titleByKey = new Map(pageRows.map((p) => [`${p.module_key}||${p.page_path}`, p.page_title]));

/** 简单口径：某职位某页面「被授权」= 台账没关 且 该页面对应的板块在台账里没有任何关掉记录 */
for (const role of roles) {
  const own = actions.filter((a) => a.role_id === role.id);
  const off = new Set(ledger.filter((l) => l.role_id === role.id && !l.enabled).map((l) => l.page_path));
  // 动作页 → path 需要反查：用页面标题在 page 表里找
  const pathByTitle = new Map();
  pageRows.forEach((p) => {
    pathByTitle.set(`${p.module_key}||${p.page_title}`, p.page_path);
  });
  const violations = [];
  for (const a of own) {
    const path = pathByTitle.get(`${a.module_key}||${a.item_name}`);
    if (path && off.has(path)) violations.push(`${a.module_key}/${a.item_name}`);
  }
  const effCount = own.length - violations.length;
  check(violations.length === 0, `${role.id} ${role.role_name}：动作 ${own.length}，越权动作 ${violations.length}${violations.length ? ' → ' + [...new Set(violations)].join('、') : ''}`);
  check(Number(role.perm_count) === Number(effCount), `${role.id} ${role.role_name}：perm_count=${role.perm_count}，应为 ${effCount}`);

  /* ★ ⑥ 2026-10-24 联动完整性：页面管理勾了的页面（台账 enabled=1），
   *   该职位必须有至少一条动作行（页面授权会自动补「查看」）。
   *   缺了就是「页面管理已配置、职位权限分配显示未授权」的矛盾再现。 */
  const enabledKeys = ledger
    .filter((l) => l.role_id === role.id && l.enabled)
    .map((l) => `${l.module_key}||${titleByKey.get(`${l.module_key}||${l.page_path}`) || l.page_path}`);
  const ownPages = new Set(own.map((a) => `${a.module_key}||${a.item_name}`));
  const missingView = enabledKeys.filter((k) => !ownPages.has(k));
  check(
    missingView.length === 0,
    `${role.id} ${role.role_name}：台账启用页面缺动作 ${missingView.length}${missingView.length ? ' → ' + missingView.join('、') : ''}`,
  );
}

/* ============ 账号 ============ */
console.log('\n===== ②③④ 账号：板块 / 头衔 / 页面 =====');
const accounts = await q(`select account, user_name, title, modules from sms_portal.t_sys_account where is_deleted=0 order by account`);

const login = async (acc) => {
  const r = await fetch(`${BASE}/api/portal/account/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: acc, password: PWD[acc] || '123456' }),
  });
  return (await r.json()).data;
};

let adminToken = null;
for (const acc of accounts) {
  const data = await login(acc.account);
  if (!data) {
    check(false, `${acc.account} ${acc.user_name}：登录失败`);
    continue;
  }
  const mods = (data.visibleModules || []).map((m) => String(m.key));

  /* ★ ⑤ 段要用一个「真的能进权限管理」的 token。
   *   原先取第一个登录成功的账号（chenxf / 班主任），它没有 perm 模块，
   *   /api/perm/user/list 一律 403 → ⑤ 段一行都没跑，等于没检查。
   *   改成优先取带 perm 板块的账号（林晓）。 */
  if (!adminToken && mods.includes('perm')) adminToken = data.token;

  check(
    String(data.account.title || '') !== '模块负责人' && !!String(data.account.title || '').trim(),
    `${acc.account} ${acc.user_name}：头衔=${data.account.title || '(空)'}`,
  );

  // 门户三板块：下发的 must ⊆ 模块清单（财务/权限不能凭空出现）
  const extra = mods.filter((m) => PORTAL_KEYS.has(m));
  const rows = await q(
    `select r.role_code from sms_perm.t_perm_user u
       join sms_perm.t_perm_user_role ur on ur.user_id=u.id and ur.is_deleted=0
       join sms_perm.t_perm_role r on r.id=ur.role_id and r.is_deleted=0
      where u.account=? and u.is_deleted=0`,
    [acc.account],
  );
  const codes = rows.map((r) => r.role_code);
  if (!codes.length) {
    check(true, `${acc.account} ${acc.user_name}：未绑职位（legacy 账号），板块=${mods.join(',') || '无'}`);
    continue;
  }

  // 用页面台账核对：把该账号的页面清单换算成板块
  const pr = await fetch(`${BASE}/api/perm/page/my-paths`, {
    headers: { Authorization: `Bearer ${data.token}` },
  });
  const pj = await pr.json();
  const paths = pj.data?.paths || [];
  const pathMods = new Set(paths.map((p) => (p === '/' ? 'workbench' : p.split('/')[1])));
  const badMods = [...pathMods].filter(
    (m) => PORTAL_KEYS.has(m) && !mods.includes(m),
  );
  check(
    badMods.length === 0,
    `${acc.account} ${acc.user_name}：页面所属板块 ${[...pathMods].filter((m) => PORTAL_KEYS.has(m)).join(',') || '无'} ⊂ 下发板块 ${extra.join(',') || '无'}`,
  );

  // 财务/权限：页面上没有任何相关页面时，绝不能出现对应板块
  const financePaths = paths.filter((p) => p.startsWith('/finance/'));
  const permPaths = paths.filter((p) => p.startsWith('/perm/'));
  check(
    (financePaths.length === 0) === !mods.includes('finance'),
    `${acc.account} 财务管理板块=${mods.includes('finance') ? '显示' : '不显示'}，财务页面 ${financePaths.length} 个`,
  );
  /* ★ 2026-10-24：SYS_ADMIN 的 my-paths 已按账号级 modules 收窄，
   *   perm 检查对管理员同样成立，不再跳过。 */
  check(
    (permPaths.length === 0) === !mods.includes('perm'),
    `${acc.account} 权限管理板块=${mods.includes('perm') ? '显示' : '不显示'}，权限页面 ${permPaths.length} 个`,
  );}

/* ============ 账号详情 ============ */
console.log('\n===== ⑤ 账号详情：有效权限数 =====');
if (!adminToken) {
  check(false, '⑤ 未执行：没有任何带 perm 板块的账号能登录（无法调用 /api/perm/user/list）');
}
const users = adminToken
  ? await (async () => {
      const r = await fetch(`${BASE}/api/perm/user/list?page=1&size=100`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const j = await r.json();
      if (!j.data) console.log(`  （user/list 返回失败：${j.message || j.msg || j.code}）`);
      return j.data?.list || [];
    })()
  : [];
if (adminToken && !users.length) check(false, '⑤ 未执行：user/list 返回空列表');
for (const u of users) {
  const detail = await fetch(`${BASE}/api/perm/user/detail?id=${u.id}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const dj = (await detail.json()).data;
  check(
    Number(dj.effectivePermCount) === Number(u.effectivePermCount),
    `${u.userName}：列表=${u.effectivePermCount}，详情=${dj.effectivePermCount}`,
  );
  let union = 0;
  const set = new Set();
  for (const rid of u.roleIds || []) {
    const rd = await fetch(`${BASE}/api/perm/role/detail?id=${rid}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const rj = (await rd.json()).data;
    Object.keys(rj.perms || {}).forEach((k) => (rj.perms[k] || []).forEach((a) => set.add(`${k}||${a}`)));
  }
  union = set.size;
  check(union === Number(dj.effectivePermCount), `${u.userName}：详情=${dj.effectivePermCount}，职位详情并集=${union}`);
}

console.log(`\n===== 结论：${fails.length ? fails.length + ' 项不一致' : '全部一致'} =====`);
if (fails.length) fails.forEach((f) => console.log('  ✘ ' + f));
await db.end();
process.exit(fails.length ? 1 : 0);
