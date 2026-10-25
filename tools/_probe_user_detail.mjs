/** 账号详情口径对照（账号管理 → 查看） */
const BASE = process.env.BASE || 'http://127.0.0.1:8004';
const r = await fetch(`${BASE}/api/portal/account/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: 'linx', password: '123456' }),
});
const j = await r.json();
const token = j.data.token;
const get = async (p) => (await fetch(BASE + p, { headers: { Authorization: `Bearer ${token}` } })).json();

const users = await get('/api/perm/user/list?page=1&size=100');
const target = (users.data?.list || []).find((u) => u.account === (process.argv[2] || 'wanghanyi'));
console.log('账号：', target.userName, target.account, '角色：', target.roleNames?.join('、'));
console.log('列表 effectivePermCount：', target.effectivePermCount);

const detail = await get(`/api/perm/user/detail?id=${target.id}`);
console.log('详情 effectivePermCount：', detail.data?.effectivePermCount);

// 逐个职位取详情，模拟弹窗的并集
const union = new Set();
for (const rid of target.roleIds || []) {
  const rd = await get(`/api/perm/role/detail?id=${rid}`);
  Object.keys(rd.data.perms || {}).forEach((k) => {
    (rd.data.perms[k] || []).forEach((a) => union.add(`${k}||${a}`));
  });
  const fin = Object.keys(rd.data.perms || {}).filter((k) => k.startsWith('finance'));
  console.log(`  职位 ${rid} permCount=${rd.data.permCount} 财务页=${fin.length ? fin.join(',') : '无'}`);
}
console.log('弹窗并集动作数：', union.size);
console.log('并集里财务：', [...union].filter((k) => k.startsWith('finance')).length ? '有' : '无');
