/** 登录探针：打印某个账号真正下发的模块 / 侧栏可见项 */
const BASE = process.env.BASE || 'http://127.0.0.1:8004';

const accounts = process.argv.slice(2);
const pwdMap = {
  wanghanyi: 'Wanghanyi123',
  qitiantian: 'Qtt123456',
  chenxf: 'qtt123456',
};

for (const acc of accounts.length ? accounts : ['wanghanyi']) {
  const res = await fetch(`${BASE}/api/portal/account/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: acc, password: pwdMap[acc] || '123456' }),
  });
  const j = await res.json();
  if (j.code !== 200) {
    console.log(`${acc}: 登录失败 ${j.code} ${j.message}`);
    continue;
  }
  const d = j.data;
  console.log(`\n== ${acc} / ${d.account.userName} ==`);
  console.log('title       :', d.account.title);
  console.log('visibleMods :', d.visibleModules.map((m) => m.key).join(', '));
  console.log('token mods  :', JSON.stringify(JSON.parse(Buffer.from(d.token.split('.')[1], 'base64').toString()).modules));
}
