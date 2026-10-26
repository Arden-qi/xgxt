/** 探针：登录 → 调 my-paths / 账号详情，看三处口径是否一致 */
const BASE = process.env.BASE || 'http://127.0.0.1:8004';
const pwdMap = { wanghanyi: 'Wanghanyi123', qitiantian: 'Qtt123456', chenxf: 'qtt123456' };

const acc = process.argv[2] || 'wanghanyi';
const res = await fetch(`${BASE}/api/portal/account/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: acc, password: pwdMap[acc] || '123456' }),
});
const j = await res.json();
if (j.code !== 200) {
  console.log('login fail', j.code, j.message);
  process.exit(1);
}
const token = j.data.token;

const r2 = await fetch(`${BASE}/api/perm/page/my-paths`, {
  headers: { Authorization: `Bearer ${token}` },
});
console.log('my-paths status:', r2.status);
const b2 = await r2.json();
console.log('code:', b2.code, 'msg:', b2.message);
if (b2.data) {
  console.log('paths:', b2.data.paths);
  console.log('allPaths:', b2.data.allPaths);
  console.log('roleFiltered:', b2.data.roleFiltered);
}
