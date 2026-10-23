/**
 * 一次性数据修复：把「误写进老表的登记缴费数据」补到统一表
 * ============================================================
 * ★ 2026-10-23，配合 commit 8be8d4f（初高中上传缴费凭证后操作列不变「重新登记/查看」）
 *
 * 【为什么需要】
 *   修复前，初高「登记缴费（上传缴费凭证）」走的是裸 `db('t_class_fee')` 写老表，
 *   而页面读的是统一表 `sms_common.t_uni_fee`。
 *   → 用户在修复前上传过的凭证、填过的实缴金额，全部只躺在老表里，
 *     页面永远看不到（= 操作列一直停在「上传缴费凭证」）。
 *   代码改好之后，这些**历史数据仍是孤儿**，必须补过去，否则用户会以为「还是没修」。
 *
 * 【两段修复，都幂等】
 *   ① 补列：老表有值、统一表为 NULL 的列 → 用 COALESCE 补（不覆盖统一表已有值）
 *   ② 补状态：已登记缴费（有 pay_method 或 voucher_url）但统一表 pay_status 仍是
 *      「未结清(1 待缴 / 4 逾期)」→ 推进到 2 已缴。
 *      ★ 口径与 voucher 接口完全一致（fee.route.ts:555）：
 *        rawStatus === UNPAID || rawStatus === OVERDUE ? PAID : rawStatus
 *        冻结(5)/已核对(3) 都不动。
 *      ★ 为什么单独一段：第一版把状态写成 `pay_status = COALESCE(pay_status, 2)`，
 *        而统一表那几行 pay_status 本来就有值（4 逾期，非 NULL）→ COALESCE 保留 4，
 *        于是「扫 0 条」但状态是错的，脚本自以为补完了。教训：状态推断不能用 COALESCE。
 *
 * 【跑法】在 server-job 目录：
 *     node scripts/_backfill-jh-fee-voucher-20261023.mjs            # 预演（只报数，不写库）
 *     node scripts/_backfill-jh-fee-voucher-20261023.mjs --apply    # 真写
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');

/** 缴费状态（与 shared-types/class-jh PayStatus 对齐）：1 待缴 / 2 已缴 / 3 已核对 / 4 逾期 / 5 冻结 */
const PAID = 2;

/** 从 server-job/.env 读库连接（脚本不在 Nest/knex 上下文里，自己拼） */
function loadEnv() {
  const env = {};
  const txt = readFileSync(path.resolve(process.cwd(), '.env'), 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

/** 需要补的列（pay_method 在统一表是 varchar，老表是 int，交给 MySQL 隐式转换） */
const COLS = ['pay_method', 'paid_amount', 'pay_date', 'pay_remark', 'voucher_url'];

/** 「这一行登记过缴费」的判据：有缴费方式、有实缴金额、或有凭证截图 */
const REGISTERED = `(o.pay_method IS NOT NULL OR o.paid_amount IS NOT NULL OR o.voucher_url IS NOT NULL)`;

(async () => {
  const env = loadEnv();
  const conn = await mysql.createConnection({
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    multipleStatements: false,
  });

  try {
    console.log(`\n=== 金额/凭证/方式 补写 ${APPLY ? '（真写）' : '（预演）'} ===`);

    // ── ① 补列 ──────────────────────────────────────────────
    const scanSql = `
      SELECT o.id, o.student_no, o.pay_status,
             ${COLS.map((c) => `o.${c} AS o_${c}`).join(', ')},
             ${COLS.map((c) => `u.${c} AS u_${c}`).join(', ')}
        FROM sms_class_jh.t_class_fee o
        JOIN sms_common.t_uni_fee u ON u.id = o.id AND u.edu_stage = 'jh'
       WHERE o.is_deleted = 0
         AND ${REGISTERED}
         AND (u.pay_method IS NULL AND u.paid_amount IS NULL AND u.voucher_url IS NULL)`;
    const [rows] = await conn.query(scanSql);

    console.log(`待补列：${rows.length} 条`);
    for (const r of rows) {
      const diff = COLS.filter((c) => r[`o_${c}`] != null && r[`u_${c}`] == null);
      console.log(`  · ${r.id}（学号 ${r.student_no}）补：${diff.join(', ') || '无'}`);
    }

    if (APPLY) {
      let affected = 0;
      for (const r of rows) {
        const cols = COLS.filter((c) => r[`o_${c}`] != null);
        if (!cols.length) continue;
        const sets = cols.map((c) => `${c} = COALESCE(${c}, ?)`);
        const vals = cols.map((c) => r[`o_${c}`]);
        const [res] = await conn.query(
          `UPDATE sms_common.t_uni_fee SET ${sets.join(', ')} WHERE id = ? AND edu_stage = 'jh'`,
          [...vals, r.id],
        );
        affected += res.affectedRows;
      }
      console.log(`已补列 ${affected} 行 → sms_common.t_uni_fee`);
    }

    // ── ② 补状态 ────────────────────────────────────────────
    // 判据：这一行**已经登记过缴费**（老表或统一表任一侧有值），
    //       但统一表 pay_status 还是「未结清」→ 应该推进到已缴。
    // 注意：这里不看「老表 pay_status 是不是 1」—— 老表也可能是 4（逾期），
    //       只要登记过缴费就该变 2（回款了）。
    console.log(`\n=== 缴费状态推进（未结清 → 已缴）${APPLY ? '（真写）' : '（预演）'} ===`);
    const statusSql = `
      SELECT u.id, u.student_no, u.pay_status AS u_status, o.pay_status AS o_status,
             u.pay_method AS u_pay_method, u.voucher_url AS u_voucher_url,
             u.paid_amount AS u_paid_amount, u.expire_date
        FROM sms_common.t_uni_fee u
        JOIN sms_class_jh.t_class_fee o ON o.id = u.id AND o.is_deleted = 0
       WHERE u.edu_stage = 'jh'
         AND u.pay_status IN (1, 4)
         AND (u.pay_method IS NOT NULL OR u.paid_amount IS NOT NULL OR u.voucher_url IS NOT NULL
              OR ${REGISTERED})`;
    const [stale] = await conn.query(statusSql);

    console.log(`待推进：${stale.length} 条`);
    for (const r of stale) {
      const why = [
        r.u_pay_method != null ? '统一表有缴费方式' : '',
        r.u_paid_amount != null ? '统一表有实缴金额' : '',
        r.u_voucher_url ? '统一表有凭证' : '',
      ].filter(Boolean).join(' + ') || '老表已登记缴费';
      console.log(
        `  · ${r.id}（学号 ${r.student_no}）状态 ${r.u_status} → ${PAID}（${why}）`,
      );
    }

    if (APPLY && stale.length) {
      const ids = stale.map((r) => r.id);
      const [res] = await conn.query(
        `UPDATE sms_common.t_uni_fee SET pay_status = ?
          WHERE edu_stage = 'jh' AND pay_status IN (1, 4) AND id IN (${ids.map(() => '?').join(',')})`,
        [PAID, ...ids],
      );
      console.log(`已推进 ${res.affectedRows} 行状态`);
    }

    if (!APPLY) {
      console.log('\n预演结束。加 --apply 才写库。');
    } else {
      // 收尾复核：跑完再看一遍，必须双双为 0
      const [left1] = await conn.query(scanSql);
      const [left2] = await conn.query(statusSql);
      console.log(`\n复核：待补列 ${left1.length} 条 / 待推进状态 ${left2.length} 条（都应为 0）`);
      if (left1.length || left2.length) process.exitCode = 1;
    }
  } finally {
    await conn.end();
  }
})();
