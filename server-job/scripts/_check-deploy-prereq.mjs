/**
 * 部署/环境自检 —— 「拉代码后某功能在别人机器上不生效」时先跑这个
 * ============================================================
 *
 * 跑法：在 server-job 目录下
 *     node scripts/_check-deploy-prereq.mjs
 *     node scripts/_check-deploy-prereq.mjs --account qiansy   （默认就是校长）
 *
 * 【为什么需要它】
 *   本仓库有 4 类东西**不随 git 走**，协作者 pull 后不补就表现为「功能没了」，
 *   而且报错往往指向别处（或干脆静默空表格）：
 *
 *     ① 新表列   —— 只有迁移文件，必须手动 `npm run migrate`（一键启动也会跑）
 *     ② shared-types —— 是独立包，改了 src 必须 `npm run build` 才会进 dist，
 *                        而 dist 被 gitignore → 别人 pull 到的是改前的旧枚举
 *     ③ .env     —— 被 gitignore（TEACHING_UNI_TABLE 这类开关只在各人本机）
 *     ④ 演示数据 —— 种子脚本要自己跑，空库里「页面没数据」不是 bug
 *
 *   本脚本把上面这些都查一遍，缺什么直接打印**该执行哪条命令**。
 *
 * 【检查项】
 *   A. 迁移：三张催费表 + 统一表的必需列（逐列报缺）
 *   B. 迁移记录：knex_migrations 里有没有 20261021_* / 20261022_*
 *   C. shared-types：dist 里有没有 DeptCode.EMPLOYMENT（就业部=3）
 *   D. 数据：每个部门「已登记缴费」的行数（= 批量上传到财务的候选来源）
 *   E. 接口：/api/teaching/fee/transfer/candidates 是否活着、各部门取到几条
 *
 * 【退出码】0 = 全部就绪；1 = 有缺口（详情见输出）
 */

import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const ACCOUNT = (() => {
  const i = process.argv.indexOf('--account');
  return i > -1 ? process.argv[i + 1] : 'qiansy';
})();
const BASE = process.env.SEED_BASE || 'http://127.0.0.1:8004';

/* ---------------- .env ---------------- */
function loadEnv() {
  const env = {};
  const p = resolve(ROOT, '.env');
  if (!existsSync(p)) return env;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
const ENV = loadEnv();

const knex = require('knex');
function conn(database) {
  return knex({
    client: 'mysql2',
    connection: {
      host: ENV.DB_HOST || 'localhost',
      port: Number(ENV.DB_PORT) || 3306,
      user: ENV.DB_USER || 'root',
      password: ENV.DB_PASSWORD || '',
      database,
      charset: 'utf8mb4',
      timezone: '+08:00',
      dateStrings: true,
    },
    pool: { min: 0, max: 2 },
  });
}

const DB = {
  jh: conn(ENV.DB_NAME_CLASS_JH || 'sms_class_jh'),
  class: conn(ENV.DB_NAME_CLASS || 'sms_class'),
  job: conn(ENV.DB_NAME || 'sms_job'),
  common: conn(ENV.DB_NAME_COMMON || 'sms_common'),
  finance: conn(ENV.DB_NAME_FINANCE || 'sms_finance'),
  perm: conn(ENV.DB_NAME_PERM || 'sms_perm'),
};

let problems = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m, how) => {
  problems += 1;
  console.log(`  ❌ ${m}`);
  if (how) console.log(`     → 处理：${how}`);
};
const warn = (m) => console.log(`  ⚠️  ${m}`);
const title = (m) => console.log(`\n=== ${m} ===`);

/* ---------------- A. 必需列 ---------------- */
/**
 * 每张表的必需列 → 由哪条迁移补。
 * ⚠️ 新增依赖列时**必须同步加到这里**，否则「别人拉代码后功能不对」还会重演。
 */
const REQUIRED = [
  {
    db: 'jh',
    schema: (ENV.DB_NAME_CLASS_JH || 'sms_class_jh'),
    table: 't_class_fee',
    cols: ['pay_method', 'paid_amount', 'pay_date', 'voucher_url', 'pay_remark'],
    migrate: 'migrations-class-jh/20261020_001_add_fee_payment_info.js',
  },
  {
    db: 'jh',
    schema: (ENV.DB_NAME_CLASS_JH || 'sms_class_jh'),
    table: 't_class_fee',
    cols: ['finance_fee_id', 'finance_transfer_time'],
    migrate: 'migrations-class-jh/20261022_001_add_finance_fee_id.js',
  },
  {
    db: 'common',
    schema: (ENV.DB_NAME_COMMON || 'sms_common'),
    table: 't_class_urge_sync',
    cols: ['pay_method', 'paid_amount', 'pay_date', 'voucher_url', 'pay_remark'],
    migrate: 'migrations-class-common/20261021_001_add_fee_payment_columns.js',
  },
  {
    db: 'common',
    schema: (ENV.DB_NAME_COMMON || 'sms_common'),
    table: 't_class_urge_sync',
    cols: ['finance_fee_id', 'finance_transfer_time'],
    migrate: 'migrations-class-common/20261022_001_add_finance_fee_id.js',
  },
  {
    db: 'job',
    schema: (ENV.DB_NAME || 'sms_job'),
    table: 't_job_fee_call',
    cols: ['pay_method', 'paid_amount', 'pay_date', 'voucher_url', 'pay_remark'],
    migrate: 'migrations/20261021_001_add_fee_payment_columns.js',
  },
  {
    db: 'job',
    schema: (ENV.DB_NAME || 'sms_job'),
    table: 't_job_fee_call',
    cols: ['finance_fee_id', 'finance_transfer_time'],
    migrate: 'migrations/20261022_001_add_finance_fee_id.js',
  },
];

async function checkColumns() {
  title('A. 表结构（催费「登记缴费」与「批量上传到财务」依赖的列）');
  for (const r of REQUIRED) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await DB[r.db].select(DB[r.db].raw('COLUMN_NAME AS name'))
      .from(DB[r.db].raw('information_schema.COLUMNS'))
      .whereRaw('TABLE_SCHEMA = ? AND TABLE_NAME = ?', [r.schema, r.table]);
    const have = new Set(rows.map((x) => x.name));
    if (!have.size) {
      bad(`${r.schema}.${r.table} **表不存在**`, `确认库里已建表；缺列时跑 npm run migrate`);
      continue;
    }
    const missing = r.cols.filter((c) => !have.has(c));
    if (missing.length) {
      bad(`${r.schema}.${r.table} 缺列：${missing.join(', ')}`, `npm run migrate（对应 ${r.migrate}）`);
    } else {
      ok(`${r.schema}.${r.table} 列齐全（${r.cols.length} 个）`);
    }
  }
}

/* ---------------- B. 迁移记录 ---------------- */
async function checkMigrationRecord() {
  title('B. 迁移执行记录（knex_migrations）');
  const want = [
    ['common', '20261021_001', '大学催费五列'],
    ['common', '20261021_002', '统一表五列'],
    ['common', '20261022_001', '大学转交标记'],
    ['job', '20261021_001', '就业催费五列'],
    ['job', '20261022_001', '就业转交标记'],
    ['jh', '20261020_001', '初高登记缴费'],
    ['jh', '20261022_001', '初高转交标记'],
  ];
  for (const [db, prefix, label] of want) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await DB[db]('knex_migrations').where('name', 'like', `${prefix}%`).select('name');
    if (rows.length) ok(`${db} 库已执行 ${prefix}（${label}）`);
    else bad(`${db} 库**没跑** ${prefix}（${label}）`, 'npm run migrate');
  }
}

/* ---------------- C. shared-types 构建产物 ---------------- */
/**
 * 判定「就业部枚举有没有编译进 dist」
 *
 * ⚠️ 不能写成 `/EMPLOYMENT\s*=\s*3/` —— tsc 把 `enum DeptCode { EMPLOYMENT = 3 }`
 *    编译成 IIFE 反查表：
 *      `DeptCode[DeptCode["EMPLOYMENT"] = 3] = "EMPLOYMENT";`
 *    中间隔着 `"] = `，直接 `\s*=\s*3` 永远匹配不到（这个自检第一版就栽在这儿，
 *    本地明明 build 过却报「dist 是旧的」）。
 */
function hasEmploymentEnum(src) {
  return /DeptCode\["EMPLOYMENT"\]\s*=\s*3/.test(src) || /["']EMPLOYMENT["']\]\s*=\s*3/.test(src);
}

function checkSharedTypes() {
  title('C. shared-types 构建产物（改了 src 必须重新 build，dist 不进 git）');
  const distFile = resolve(ROOT, 'node_modules', 'shared-types', 'dist', 'cjs', 'finance', 'enums.js');
  if (!existsSync(distFile)) {
    bad('dist/cjs/finance/enums.js 不存在（shared-types 没 build 过）', 'cd ../shared-types && npm run build');
    return;
  }
  const src = readFileSync(distFile, 'utf8');
  if (hasEmploymentEnum(src)) ok('dist 里有 DeptCode.EMPLOYMENT = 3（就业部）');
  else bad('dist 里**没有** DeptCode.EMPLOYMENT（dist 是旧的）', 'cd ../shared-types && npm run build');

  // 主包那个（job/初高在用）
  const mainDist = resolve(ROOT, 'node_modules', 'shared-types', 'dist', 'cjs', 'enums.js');
  if (existsSync(mainDist)) {
    const m = readFileSync(mainDist, 'utf8');
    if (hasEmploymentEnum(m)) ok('dist 主包里 DeptCode.EMPLOYMENT = 3');
    else bad('dist 主包缺 DeptCode.EMPLOYMENT', 'cd ../shared-types && npm run build');
  }
}

/* ---------------- D. 候选数据源 ---------------- */
async function checkCandidatesData() {
  title('D. 「批量上传到财务」的候选来源（本地按「已登记缴费」筛）');
  const jh = await DB.jh('t_class_fee')
    .where('is_deleted', 0)
    .andWhere((b) => b.whereNotNull('pay_method').orWhereNotNull('paid_amount'))
    .count({ c: '*' });
  const cls = await DB.common('t_class_urge_sync')
    .where('is_deleted', 0)
    .andWhere((b) => b.whereNotNull('pay_method').orWhereNotNull('paid_amount'))
    .count({ c: '*' });
  const job = await DB.job('t_job_fee_call')
    .where('is_deleted', 0)
    .andWhere((b) => b.whereNotNull('pay_method').orWhereNotNull('paid_amount'))
    .count({ c: '*' });

  const n = (x) => Number(x?.[0]?.c ?? 0);
  const line = (label, v, how) => (v > 0 ? ok(`${label}：${v} 条可转交`) : warn(`${label}：0 条${how ? `（${how}）` : ''}`));

  line('初高 t_class_fee', n(jh), '先在催费页「上传缴费凭证」登记，或跑 npm run seed:fee-dept');
  line('大学 t_class_urge_sync', n(cls), '同上');
  line('就业 t_job_fee_call', n(job), '同上');
}

/* ---------------- 权限台账（容易被忽略的环境差异） ---------------- */
/**
 * 页面权限有两个来源：**静态默认表**（`utils/pagePermissionSource.ts`）与
 * **台账**（`sms_perm.t_perm_role_page`）。口径是「台账有行 → 以台账为准；没行 → 沿用默认」。
 *
 * 本仓库默认表是空的（0 行），所以大家改权限只改静态表就生效。
 * 但**别人的库里如果有台账数据**（从生产导过、或在权限管理界面点过），
 * 静态表就失效了 —— 表现是「代码里明明给了权限码，他还是进不去」。
 * 这是「本地行、他那不行」的经典原因之一，所以单独查一下。
 */
async function checkPermLedger() {
  title('F. 权限台账（有数据时会覆盖代码里的静态默认表）');
  try {
    const rows = await DB.perm('t_perm_role_page').count({ c: '*' });
    const n = Number(rows?.[0]?.c ?? 0);
    if (n === 0) ok('t_perm_role_page 是空表 → 走代码静态默认表（与本地一致）');
    else
      warn(
        `t_perm_role_page 有 ${n} 行 → **以台账为准**，代码里的静态权限表在这个库上不生效。` +
          '若怀疑权限不对，先在「权限管理 → 页面管理」里核对，或清空该表回到默认。',
      );
  } catch (e) {
    warn(`查不到 sms_perm.t_perm_role_page（${e.message}）—— 权限库可能没连上，忽略此项`);
  }
}

/* ---------------- E. 接口 ---------------- */
async function checkApi() {
  title(`E. 接口连通（账号 ${ACCOUNT}）`);
  let token = '';
  try {
    const r = await fetch(`${BASE}/api/portal/account/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: ACCOUNT, password: '123456' }),
    });
    const j = await r.json();
    token = j?.data?.token || '';
  } catch (e) {
    bad(`连不上后端 ${BASE}`, '先启动后端：npm run dev 或在根目录跑一键启动.bat');
    return;
  }
  if (!token) bad(`账号 ${ACCOUNT} 登录失败`, '确认账号存在且密码是 123456');
  else ok(`登录成功（${ACCOUNT}）`);

  const hit = async (path) => {
    const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    let j = null;
    try {
      j = await r.json();
    } catch {
      /* 非 JSON */
    }
    return { status: r.status, body: j };
  };

  const c = await hit('/api/teaching/fee/transfer/candidates?dept=all');
  if (c.status === 404) {
    bad('接口 /api/teaching/fee/transfer/candidates 返回 404', '后端是旧进程，重启后端（tsx watch 才会自动热更）');
    return;
  }
  if (c.body?.code !== 200) {
    bad(
      `接口返回 code=${c.body?.code} ${c.body?.message || ''}`,
      '看后端日志；若是「接口不存在」→ 重启后端；若是 SQL 报错 → npm run migrate',
    );
    return;
  }
  const list = c.body?.data?.list || [];
  const errs = c.body?.data?.errors || [];
  ok(`接口正常，候选共 ${list.length} 条（初高 ${list.filter((x) => x.dept === 'jh').length} / 大学 ${list.filter((x) => x.dept === 'class').length} / 就业 ${list.filter((x) => x.dept === 'employ').length}）`);
  if (errs.length) {
    for (const e of errs) bad(`「${e.deptName}」部取候选失败：${e.message}`, '看后端日志定位该部门的查询');
  }
}

/* ---------------- G. 退费「校长审批 → 财务」结构 ---------------- */
/**
 * ★ 2026-10-23 新增：这一组结构**不在 knex 迁移里**（knexfile 没有 finance env），
 *   全靠 `scripts/_migrate-finance-refund-20261022.mjs` 单独补。
 *   漏跑的症状就是「校长审批通过后提示：推送财务失败，请人工补录」，
 *   而后端日志里是 `ER_BAD_FIELD_ERROR ... source_module` 或 `t_finance_refund_item doesn't exist`。
 *
 *   ✅ 已并入 `npm run migrate`（migrate-all.mjs 的 POST_STEPS），
 *      所以正常跑过一次 migrate 就不会缺；这里留着是为了**快速定位**。
 */
async function checkRefundFinanceSchema() {
  title('G. 退费「校长审批 → 财务」依赖的结构（财务库无 knex env，靠独立脚本补）');
  const F = ENV.DB_NAME_FINANCE || 'sms_finance';
  const C = ENV.DB_NAME_COMMON || 'sms_common';
  const fix = 'npm run migrate（内部会跑 scripts/_migrate-finance-refund-20261022.mjs --apply）';

  // ① 主表三列 + 唯一索引
  const cols = await DB.finance
    .select(DB.finance.raw('COLUMN_NAME AS name'))
    .from(DB.finance.raw('information_schema.COLUMNS'))
    .whereRaw('TABLE_SCHEMA = ? AND TABLE_NAME = ?', [F, 't_finance_refund']);
  const have = new Set(cols.map((x) => x.name));
  if (!have.size) {
    bad(`${F}.t_finance_refund **表不存在**`, '确认 sms_finance 已建库并导入 sql/init/sms_finance.sql');
  } else {
    const miss = ['source_module', 'source_stage', 'source_refund_id'].filter((c) => !have.has(c));
    if (miss.length) bad(`${F}.t_finance_refund 缺列：${miss.join(', ')}（推送财务必然失败）`, fix);
    else ok(`${F}.t_finance_refund 三列齐全（source_module / source_stage / source_refund_id）`);
  }

  const idx = await DB.finance
    .select(DB.finance.raw('INDEX_NAME AS name'))
    .from(DB.finance.raw('information_schema.STATISTICS'))
    .whereRaw('TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?', [F, 't_finance_refund', 'uk_source'])
    .first();
  if (idx) ok('唯一索引 uk_source 存在（重复推送不会建第二张单）');
  else bad('缺唯一索引 uk_source（重复推送会建出重复财务单）', fix);

  // ② 费用项明细表
  const itemT = await DB.finance
    .select(DB.finance.raw('TABLE_NAME AS name'))
    .from(DB.finance.raw('information_schema.TABLES'))
    .whereRaw('TABLE_SCHEMA = ? AND TABLE_NAME = ?', [F, 't_finance_refund_item'])
    .first();
  if (itemT) ok(`${F}.t_finance_refund_item 存在（每个费用项一行）`);
  else bad(`${F}.t_finance_refund_item **不存在**（推送财务必然失败）`, fix);

  // ③ 教学统一表回写列
  const cCols = await DB.common
    .select(DB.common.raw('COLUMN_NAME AS name'))
    .from(DB.common.raw('information_schema.COLUMNS'))
    .whereRaw('TABLE_SCHEMA = ? AND TABLE_NAME = ?', [C, 't_uni_refund']);
  const cHave = new Set(cCols.map((x) => x.name));
  if (!cHave.size) {
    warn(`${C}.t_uni_refund 不存在 —— 统一表没导入？教学域会整片空（见 uni-tables.sql）`);
  } else {
    const miss = ['finance_refund_id', 'finance_refund_no'].filter((c) => !cHave.has(c));
    if (miss.length) bad(`${C}.t_uni_refund 缺列：${miss.join(', ')}（财务单号回写不进来）`, fix);
    else ok(`${C}.t_uni_refund 回写列齐全（finance_refund_id / finance_refund_no）`);
  }
}

/* ---------------- 汇总 ---------------- */
async function main() {
  console.log('\n========== 催费「批量上传到财务」环境自检 ==========');
  console.log(`后端：${BASE}    库：${ENV.DB_NAME_CLASS_JH || 'sms_class_jh'} / ${ENV.DB_NAME_CLASS || 'sms_class'} / ${ENV.DB_NAME || 'sms_job'} / ${ENV.DB_NAME_COMMON || 'sms_common'}`);

  await checkColumns().catch((e) => bad(`表结构检查失败：${e.message}`, '确认 MySQL 在跑、.env 的库名/密码正确'));
  await checkMigrationRecord().catch((e) => bad(`迁移记录检查失败：${e.message}`, '同上'));
  checkSharedTypes();
  await checkCandidatesData().catch((e) => bad(`候选数据检查失败：${e.message}`, '同上'));
  await checkPermLedger();
  await checkRefundFinanceSchema().catch((e) => bad(`退费→财务结构检查失败：${e.message}`, '同上'));
  await checkApi().catch((e) => bad(`接口检查失败：${e.message}`, '确认后端在跑'));

  console.log(
    problems
      ? `\n===== ❌ 有 ${problems} 项需要处理（按上面「→ 处理」的提示做）=====\n`
      : '\n===== ✅ 环境就绪 =====\n',
  );
  await Promise.allSettled(Object.values(DB).map((d) => d.destroy()));
  process.exit(problems ? 1 : 0);
}

main().catch((e) => {
  console.error('自检本身失败：', e);
  process.exit(1);
});
