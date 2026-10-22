/**
 * 一次性工具：把本机 sms_perm 库重新导出成 sql/init/sms_perm.sql
 *
 * 背景：2026-10-22 权限树从「8 板块 55 功能点」重建为「5 板块 32 页面 146 动作」，
 *   但 sql/init/sms_perm.sql 一直是 10-21 导出的旧树。别人 clone 后导入这份旧 SQL，
 *   新代码用新页面名去旧权限树里找 → 匹配不上 → 除工作台外全部页面不可见
 *   → 用户看到的就是「丢了好多个板块」。
 *
 * 脱敏约定：t_perm_log（操作日志）只导结构不导数据 —— 里面是真实操作痕迹。
 *   其余表是权限配置 + 演示账号，属于仓库本来就分发的演示数据。
 *
 * 用法：node scripts/_regen-init-perm.cjs
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'sql/init/sms_perm.sql');

// ---- 读 .env ----
const env = {};
fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
  .split(/\r?\n/)
  .forEach((l) => {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !l.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });

const host = env.DB_HOST || '127.0.0.1';
const port = String(env.DB_PORT || 3306);
const user = env.DB_USER || 'root';

// ---- 定位 mysqldump ----
const candidates = [
  'mysqldump',
  'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysqldump.exe',
  'C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqldump.exe',
];
let dumpBin = null;
for (const c of candidates) {
  const r = spawnSync(c, ['--version'], { encoding: 'utf8', shell: false });
  if (r.status === 0) {
    dumpBin = c;
    break;
  }
}
if (!dumpBin) {
  console.error('✗ 找不到 mysqldump，请把 MySQL bin 目录加入 PATH 后重试');
  process.exit(1);
}
console.log('使用', dumpBin);

// ---- 导出（密码走环境变量，不出现在命令行里）----
const args = [
  '--databases', 'sms_perm',
  '--host', host,
  '--port', port,
  '--user', user,
  '--default-character-set', 'utf8mb4',
  '--add-drop-table',
  '--skip-triggers',
  '--no-tablespaces',
  '--set-gtid-purged=OFF',
  '--skip-comments',
  '--compact',
];
const r = spawnSync(dumpBin, args, {
  encoding: 'utf8',
  maxBuffer: 200 * 1024 * 1024,
  env: { ...process.env, MYSQL_PWD: env.DB_PASSWORD || '' },
});
if (r.status !== 0) {
  console.error('✗ 导出失败:', (r.stderr || '').slice(0, 500));
  process.exit(1);
}

let sql = r.stdout;

// ---- 剔除 t_perm_log 的数据段（保留建表）----
const before = sql.length;
sql = sql.replace(
  /LOCK TABLES `t_perm_log` WRITE;[\s\S]*?UNLOCK TABLES;/,
  '/* t_perm_log：操作日志只建表不灌数据（脱敏）*/',
);
console.log(
  `t_perm_log 数据段已剔除：${before} → ${sql.length} 字节`,
);

// ---- 补一段文件头说明（跳过 --skip-comments 后没有）----
const header = `-- sms_perm 权限库初始化脚本
-- ★ 2026-10-22 重新导出：权限树已从「8 板块 55 功能点」重建为「5 板块 32 页面 146 动作」
--   若这份文件还是旧的，别人导入后登录会「丢很多板块」（除工作台外全部不可见）。
-- 内容：表结构 + 权限树 + 各职位初始授权 + 演示账号
-- 脱敏：t_perm_log 只有表结构，没有任何操作日志数据
`;

fs.writeFileSync(OUT, header + sql, 'utf8');
console.log('✓ 已写入', OUT, `(${(header + sql).length} 字节)`);
