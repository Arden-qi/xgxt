/**
 * 排查 4：验证「取消某页 → 登录就看不到」这条链是否生效
 *   A 取消「缴费管理」→ 咨询老师 my-paths 应只剩 /finance/overview
 *   B 恢复 → 两页都回来
 * 临时用，跑完删除。
 */
const BASE = 'http://127.0.0.1:8004';
const PWD = '123456';

async function login(account) {
  const r = await fetch(`${BASE}/api/portal/account/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password: PWD }),
  }).then((x) => x.json());
  return r?.data;
}
async function get(path, token) {
  const r = await fetch(BASE + path, { headers: { Authorization: `Bearer ${token}` } });
  return r.json();
}
async function put(path, token, body) {
  const r = await fetch(BASE + path, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

function buildItems(boards, force) {
  const items = [];
  boards.forEach((b) =>
    b.pages.forEach((p) => {
      const k = `${b.moduleKey}||${p.pagePath}`;
      items.push({
        moduleKey: b.moduleKey,
        pagePath: p.pagePath,
        enabled: k in force ? force[k] : !!p.enabled,
      });
    }),
  );
  return items;
}

async function finState(linx) {
  const rp = await get('/api/perm/page/role-pages?roleId=R01', linx);
  const fin = rp.data.boards.find((b) => b.moduleKey === 'finance');
  return { rp: rp.data, fin };
}

async function lilxPaths() {
  const d = await login('lilx');
  const mp = await get('/api/perm/page/my-paths', d.token);
  const p = mp.data.paths || [];
  const mods = (d.visibleModules || []).map((m) => m.key);
  return { mods, paths: p.filter((x) => x.startsWith('/finance')) };
}

(async () => {
  const linx = (await login('linx')).token;

  // 现状
  let { rp, fin } = await finState(linx);
  console.log('[0] 现状 finance:', fin.pages.map((p) => `${p.pagePath}=${p.enabled}`).join(' '));
  console.log('    lilx:', JSON.stringify(await lilxPaths()));

  // A) 取消「缴费管理」
  let items = buildItems(rp.boards, { 'finance||/finance/fee': false });
  let r = await put('/api/perm/page/role-save', linx, { roleId: 'R01', items });
  console.log('\n[A] 取消 /finance/fee →', r.message);
  ({ fin } = await finState(linx));
  console.log('    库内 finance:', fin.pages.map((p) => `${p.pagePath}=${p.enabled}${p.overridden ? '(ov)' : ''}`).join(' '));
  console.log('    lilx:', JSON.stringify(await lilxPaths()));

  // B) 恢复
  const rp2 = await get('/api/perm/page/role-pages?roleId=R01', linx);
  items = buildItems(rp2.data.boards, { 'finance||/finance/fee': true, 'finance||/finance/overview': true });
  r = await put('/api/perm/page/role-save', linx, { roleId: 'R01', items });
  console.log('\n[B] 恢复两页 →', r.message);
  ({ fin } = await finState(linx));
  console.log('    库内 finance:', fin.pages.map((p) => `${p.pagePath}=${p.enabled}${p.overridden ? '(ov)' : ''}`).join(' '));
  console.log('    lilx:', JSON.stringify(await lilxPaths()));

  // C) 两页一起取消 → 财务模块应当整个从 visibleModules 消失
  const rp3 = await get('/api/perm/page/role-pages?roleId=R01', linx);
  items = buildItems(rp3.data.boards, {
    'finance||/finance/fee': false,
    'finance||/finance/overview': false,
  });
  r = await put('/api/perm/page/role-save', linx, { roleId: 'R01', items });
  console.log('\n[C] 两页都取消 →', r.message);
  ({ fin } = await finState(linx));
  console.log('    库内 finance:', fin.pages.map((p) => `${p.pagePath}=${p.enabled}${p.overridden ? '(ov)' : ''}`).join(' '));
  console.log('    lilx:', JSON.stringify(await lilxPaths()), '← mods 里应无 finance');

  // D) 恢复
  const rp4 = await get('/api/perm/page/role-pages?roleId=R01', linx);
  items = buildItems(rp4.data.boards, {
    'finance||/finance/fee': true,
    'finance||/finance/overview': true,
  });
  r = await put('/api/perm/page/role-save', linx, { roleId: 'R01', items });
  console.log('\n[D] 恢复 →', r.message);
  ({ fin } = await finState(linx));
  console.log('    库内 finance:', fin.pages.map((p) => `${p.pagePath}=${p.enabled}${p.overridden ? '(ov)' : ''}`).join(' '));
  console.log('    lilx:', JSON.stringify(await lilxPaths()));
})();
