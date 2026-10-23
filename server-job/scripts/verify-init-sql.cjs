/**
 * 一次性验证：把 sql/init/sms_perm.sql 导入到一个临时库，检查权限树是否完整。
 * 验证完自动删库。用法：node scripts/_verify-init.cjs
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SQL = path.join(ROOT, 'sql/init/sms_perm.sql');
const TMP = 'sms_perm_verify_tmp';

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
const pass = env.DB_PASSWORD || '';

const mysqlBin = ['mysql', 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe'].find((c) => {
  const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
  return r.status === 0;
});
if (!mysqlBin) {
  console.error('✗ 找不到 mysql 客户端');
  process.exit(1);
}

function run(sql, db) {
  const args = ['--host', host, '--port', port, '--user', user, '--default-character-set', 'utf8mb4'];
  if (db) args.push(db);
  args.push('-N', '-B', '-e', sql);
  const r = spawnSync(mysqlBin, args, {
    encoding: 'utf8',
    env: { ...process.env, MYSQL_PWD: pass },
    maxBuffer: 50 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(r.stderr || 'mysql 执行失败');
  return r.stdout.trim();
}

// 1. 把 SQL 里的真实库名换成临时库名
let sql = fs.readFileSync(SQL, 'utf8');
sql = sql.replace(/`sms_perm`/g, '`' + TMP + '`').replace(/^USE sms_perm;/m, 'USE `' + TMP + '`;');
const tmpFile = path.join(require('os').tmpdir(), 'verify_perm_init.sql');
fs.writeFileSync(tmpFile, sql, 'utf8');

try {
  run(`DROP DATABASE IF EXISTS \`${TMP}\``);
  // 2. 导入
  const r = spawnSync(mysqlBin, ['--host', host, '--port', port, '--user', user, '--default-character-set', 'utf8mb4'], {
    input: sql,
    encoding: 'utf8',
    env: { ...process.env, MYSQL_PWD: pass },
    maxBuffer: 200 * 1024 * 1024,
  });
  if (r.status !== 0) {
    console.error('✗ 导入失败：', (r.stderr || '').slice(0, 600));
    process.exit(1);
  }
  console.log('✓ 导入成功');

  // 3. 检查
  const checks = [];
  const q = (s) => run(s, TMP);

  const menuTotal = q('select count(*) from t_perm_menu where is_deleted=0');
  checks.push(['t_perm_menu 生效条数', menuTotal, menuTotal === '32' ? '应 32（=页面数）' : '✗ 应 32']);

  const boards = q(
    "select group_concat(concat(module_key,':',n) order by module_key) from (select module_key,count(*) n from t_perm_menu where is_deleted=0 group by module_key) t",
  );
  checks.push(['生效板块分布', boards, '应 workbench:1,consult:5,finance:6,perm:7,teach:13']);

  const actions = q('select count(*) from t_perm_menu_action where is_deleted=0');
  checks.push(['t_perm_menu_action', actions, '应 146']);

  const perms = q('select count(*) from t_perm_role_perm where is_deleted=0');
  checks.push(['t_perm_role_perm 授权行', perms, '应 789 左右']);

  const pages = q('select count(*) from t_perm_page where is_deleted=0');
  checks.push(['t_perm_page 台账', pages, '应 32']);

  const logRows = q('select count(*) from t_perm_log');
  checks.push(['t_perm_log 数据行', logRows, '应 0（脱敏）']);

  const logCols = q("select group_concat(column_name order by ordinal_position) from information_schema.columns where table_schema='" + TMP + "' and table_name='t_perm_log'");
  const hasNewCols = ['api_path', 'http_method', 'status_code', 'duration_ms', 'user_agent'].every((c) => logCols.includes(c));
  checks.push(['t_perm_log 新列', hasNewCols ? '齐全' : '缺失', '应含 api_path/http_method/status_code/duration_ms/user_agent']);

  const consultCols = q("select count(*) from information_schema.columns where table_schema='" + TMP + "' and table_name='t_perm_menu'");
  checks.push(['t_perm_menu 列数', consultCols, '信息项']);

  console.log('\n--- 验证结果 ---');
  let bad = 0;
  for (const [name, val, expect] of checks) {
    const okMark = /×|✗|缺失/.test(String(val)) ? '✗' : '·';
    console.log(`  ${okMark} ${name.padEnd(24)} = ${String(val).slice(0, 90)}   ${expect}`);
    if (String(val).includes('✗') || val === '缺失') bad++;
  }

  // 4. 清库
  run(`DROP DATABASE IF EXISTS \`${TMP}\``);
  console.log('\n临时库已删除' + (bad ? '，但有 ' + bad + ' 项异常' : '，全部通过'));
} catch (e) {
  console.error('✗', e.message);
  try {
    run(`DROP DATABASE IF EXISTS \`${TMP}\``);
  } catch (_) {}
  process.exit(1);
}
