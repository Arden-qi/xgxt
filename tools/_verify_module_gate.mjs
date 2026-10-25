/**
 * 模块级护栏实测：账号「有没有某板块」= 登录下发 modules + 各板块接口 403
 * 用两个代表性账号对比：wanghanyi（咨询经理，无 finance/perm） vs liukj（财务，有 finance 无 perm）
 */
const BASE = 'http://127.0.0.1:8004';
const PWD = { wanghanyi: 'Wanghanyi123', liukj: '123456' };

const login = async (acc) => {
  const r = await fetch(`${BASE}/api/portal/account/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: acc, password: PWD[acc] }),
  });
  return (await r.json()).data;
};
const payloadOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));

const probes = [
  ['财务-概览', '/api/finance/overview?page=1&size=1'],
  ['财务-缴费', '/api/finance/fee?page=1&size=1'],
  ['权限-账号列表', '/api/perm/user/list?page=1&size=1'],
  ['权限-职位列表', '/api/perm/role/list'],
];

for (const acc of Object.keys(PWD)) {
  const d = await login(acc);
  if (!d) { console.log(`${acc}: 登录失败`); continue; }
  const pl = payloadOf(d.token);
  console.log(`\n=== ${acc} ${d.account.userName}（${d.account.title}） ===`);
  console.log('  登录下发板块:', (d.visibleModules || []).map((m) => m.key).join(',') || '(空)');
  console.log('  token.modules:', JSON.stringify(pl.modules));
  for (const [name, url] of probes) {
    const r = await fetch(BASE + url, { headers: { Authorization: `Bearer ${d.token}` } });
    console.log(`  ${name.padEnd(12)} → HTTP ${r.status}`);
  }
}
