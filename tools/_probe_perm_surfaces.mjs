/** 权限三界面口径对照：页面管理 / 职位权限分配 / 账号详情 */
const BASE = process.env.BASE || 'http://127.0.0.1:8004';
const pwdMap = { wanghanyi: 'Wanghanyi123', qitiantian: 'Qtt123456', chenxf: 'qtt123456' };

const login = async (acc) => {
  const r = await fetch(`${BASE}/api/portal/account/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: acc, password: pwdMap[acc] || '123456' }),
  });
  const j = await r.json();
  if (j.code !== 200) throw new Error(`${acc} 登录失败: ${j.message}`);
  return j.data.token;
};

const token = await login(process.argv[2] || 'linx');
const get = async (path) => {
  const r = await fetch(BASE + path, { headers: { Authorization: `Bearer ${token}` } });
  return r.json();
};

const roleId = process.argv[3] || 'R02';

console.log('=== 职位列表（权限数）===');
const list = await get('/api/perm/role/list?page=1&size=100');
console.log(
  (list.data?.list || []).map((r) => `${r.id} ${r.roleName}=${r.permCount}`).join('  '),
);

console.log('\n=== 页面管理：R02 已启用页面 ===');
const pages = await get(`/api/perm/page/role-pages?roleId=${roleId}`);
if (pages.code !== 200) console.log(pages.code, pages.message);
else {
  const d = pages.data;
  const rows = d.pages || d.rows || d;
  if (Array.isArray(rows)) {
    rows.filter((p) => p.enabled).forEach((p) => console.log(`  ${p.moduleKey || p.module_key} ${p.pagePath || p.page_path}`));
  } else {
    const keys = Object.keys(d);
    console.log('字段：', keys.join(', '));
    console.log(JSON.stringify(d).slice(0, 900));
  }
}

console.log('\n=== 职位权限分配：R02 ===');
const assign = await get(`/api/perm/assign/tree?roleId=${roleId}`);
if (assign.code !== 200) console.log(assign.code, assign.message);
else {
  const d = assign.data;
  console.log('scope:', JSON.stringify(d.scope), 'selected:', JSON.stringify(d.selected));
  (d.modules || []).forEach((m) => {
    const vis = (m.items || []).filter((i) => i.assignable);
    console.log(
      `  ${m.moduleKey} 可分配 ${vis.length}/${m.items.length} 页，勾选动作 ${m.checkedCount}`,
    );
  });
}

console.log('\n=== 职位详情：R02 ===');
const rd = await get(`/api/perm/role/detail?id=${roleId}`);
if (rd.code !== 200) console.log(rd.code, rd.message);
else {
  const perms = rd.data.perms || {};
  console.log('permCount:', rd.data.permCount);
  const byMod = {};
  Object.keys(perms).forEach((k) => {
    const m = k.split('||')[0];
    byMod[m] = (byMod[m] || 0) + perms[k].length;
  });
  console.log('按模块动作数:', JSON.stringify(byMod));
  console.log('财务相关:', Object.keys(perms).filter((k) => k.startsWith('finance')).join(', ') || '(无)');
}
