/**
 * 全账号体检：登录下发的「可见模块」（新口径）vs 账号级 modules（旧口径）
 *
 * 新逻辑 resolveVisibleModules 把非 legacy 模块改成「以职位页面台账为准」，
 * 风险是某些账号台账没配全 → 登录后反而**少掉**原本能看的模块。
 * 本脚本把每个账号都登一遍，逐一列出 old / new 差异，重点标出 ❌丢失。
 *
 * 跑法：cd xgxt && node tools/_probe_allmods.mjs
 */
import { execFileSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:8004';
const MYSQL = 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe';

/** 密码：库里有几个账号不是默认的 123456 */
const PWD = {
  chenxf: 'qtt123456',
  qitiantian: 'Qtt123456',
  wanghanyi: 'Wanghanyi123',
};
const DEFAULT_PWD = '123456';

/** 旧口径：账号级 modules，直接从库里读 */
const sql = execFileSync(
  MYSQL,
  ['-uroot', '-pxueguan123', '-P3306', '-N', '-e',
   'select account, modules from sms_portal.t_sys_account where is_deleted=0 and active=1 order by account;'],
  { encoding: 'latin1' },
);

const OLD = new Map();
for (const line of String(sql).split('\n')) {
  const t = line.trim();
  if (!t) continue;
  const tab = t.indexOf('\t');
  if (tab < 0) continue;
  const acc = t.slice(0, tab).trim();
  const raw = t.slice(tab + 1).trim();
  let mods = [];
  try {
    const a = JSON.parse(raw);
    mods = Array.isArray(a) ? a.map(String) : [];
  } catch {
    mods = raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  OLD.set(acc, mods);
}

async function login(account) {
  const r = await fetch(`${BASE}/api/portal/account/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password: PWD[account] || DEFAULT_PWD }),
  }).then((x) => x.json());
  return r?.data || null;
}

console.log('账号          旧(账号级 modules)         → 新(登录后下发)              差异');
console.log('-'.repeat(96));

const rows = [];
for (const acc of OLD.keys()) {
  const d = await login(acc);
  if (!d) {
    rows.push({ acc, old: OLD.get(acc) || [], now: [], err: 'LOGIN FAIL' });
    continue;
  }
  const now = (d.visibleModules || []).map((m) => String(m.key));
  const old = OLD.get(acc) || [];
  rows.push({
    acc, old, now,
    lost: old.filter((k) => !now.includes(k)),
    extra: now.filter((k) => !old.includes(k)),
  });
}

let bad = 0;
for (const r of rows) {
  if (r.err) {
    bad += 1;
    console.log(`${r.acc.padEnd(13)} ${r.old.join(',').padEnd(24)} → ${r.err}`);
    continue;
  }
  const mark = r.lost.length
    ? `❌丢失 ${r.lost.join(',')}`
    : r.extra.length ? `➕新增 ${r.extra.join(',')}` : '✅一致';
  if (r.lost.length) bad += 1;
  console.log(
    `${r.acc.padEnd(13)} ${r.old.join(',').padEnd(24)} → ${r.now.join(',').padEnd(26)} ${mark}`,
  );
}
console.log('-'.repeat(96));
console.log(`账号总数 ${rows.length}，其中有模块丢失的：${bad}`);
