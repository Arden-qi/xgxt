/**
 * 一次性存量修复：就业催费行「已核对但缴费方式 / 实缴金额被清空」
 * ============================================================
 * 【背景】
 *   就业回写原来抄了 `pay_method: row.pay_method ?? null` / `paid_amount: row.paid_amount ?? null`，
 *   而财务表 `t_finance_fee` **没有这两列** → row 上永远 undefined
 *   → 财务每核对一次，就把催费单里班主任登记好的「微信支付 / 200 元」冲成空。
 *   （2026-10-23 已修：见 finance/services/class-sync.ts::syncFeeToJob，
 *     现在这两列一律不写、其余收款字段「财务有值才覆盖」。）
 *
 *   本脚本负责把被冲掉的历史行补回来。
 *
 * 【数据从哪来（只补有确凿依据的）】
 *   · 缴费方式：财务单 `remark` —— 登记缴费时催费侧会把备注同步过去，
 *     值形如「微信支付 / 支付宝 / 现金」。识别不出就**跳过**，不猜。
 *   · 实缴金额：财务单 `amount`（= 财务已核对入账的金额，账单明细同值）。
 *     仅当该行 `paid_amount` 为空时回填。
 *
 * 【安全】
 *   · 默认 --plan：只打印计划，一行不改
 *   · --apply   ：才写库；每行打印 改前 → 改后，可原样回滚
 *
 * 用法（server-job 目录）：
 *   node scripts/_fix-job-urge-payinfo.mjs --plan
 *   node scripts/_fix-job-urge-payinfo.mjs --apply
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import knex from 'knex';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const APPLY = process.argv.includes('--apply');

const conn = (database) =>
  knex({
    client: 'mysql2',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD ?? '',
      database,
      charset: 'utf8mb4',
      timezone: '+08:00',
      dateStrings: true,
    },
    pool: { min: 0, max: 3 },
  });

const common = conn(process.env.DB_NAME_COMMON || 'sms_common');
const finance = conn(process.env.DB_NAME_FINANCE || 'sms_finance');

/** 财务备注 → 缴费方式码（1 微信支付 2 支付宝 3 现金） */
function detectPayMethod(remark) {
  const s = String(remark || '');
  if (/微信/.test(s)) return 1;
  if (/支付宝/.test(s)) return 2;
  if (/现金/.test(s)) return 3;
  return null;
}

async function main() {
  console.log(`\n===== 就业催费行：恢复被清空的缴费方式 / 实缴金额（${APPLY ? 'APPLY' : 'PLAN'}）=====\n`);

  /**
   * 目标行：就业 + 已核对(3) + 财务来源 + 缴费方式为空。
   * 只碰 `pay_status=3` 的：2「已缴」的行通常是班主任刚登记、值还在，
   * 3 才是被回写冲掉的那批。
   */
  const rows = (
    await common.raw(
      `SELECT id, student_no, student_name, fee_type, pay_status, pay_method, paid_amount,
              pay_date, pay_remark, source_id, update_time
         FROM t_uni_fee
        WHERE edu_stage='job' AND is_deleted=0
          AND pay_status=3
          AND source_system='finance'
          AND (pay_method IS NULL OR pay_method='')
        ORDER BY update_time DESC`,
    )
  )[0];

  console.log(`候选行（就业 / 已核对 / 无缴费方式）：${rows.length} 条\n`);
  if (!rows.length) {
    console.log('无需修复。');
    return;
  }

  let fixed = 0;
  let skipped = 0;

  for (const r of rows) {
    const fin = (
      await finance.raw('SELECT id, amount, remark, is_verified FROM t_finance_fee WHERE id=?', [r.source_id])
    )[0][0];

    if (!fin) {
      console.log(`  跳过 ${r.student_no} fee=${r.fee_type}：财务单 ${r.source_id} 不存在`);
      skipped += 1;
      continue;
    }

    const method = detectPayMethod(fin.remark);
    if (!method) {
      console.log(
        `  跳过 ${r.student_no} fee=${r.fee_type}：财务备注「${fin.remark || '空'}」识别不出缴费方式`,
      );
      skipped += 1;
      continue;
    }

    const patch = { pay_method: method };
    // 实缴金额为空才回填，已有值不动（尊重人工改过的数据）
    if (r.paid_amount == null || Number(r.paid_amount) === 0) patch.paid_amount = Number(fin.amount || 0);

    console.log(
      `  ${APPLY ? '修复' : '待修复'} ${r.id} ${r.student_no}(${r.student_name}) fee=${r.fee_type}：` +
        `方式 ${r.pay_method ?? '空'} → ${patch.pay_method}，` +
        `实缴 ${r.paid_amount ?? '空'} → ${patch.paid_amount ?? '(保持)'}` +
        `　依据：财务备注「${fin.remark}」+ 入账金额 ${fin.amount}`,
    );

    if (APPLY) {
      await common('t_uni_fee').where({ id: r.id }).update({ ...patch, update_time: new Date(), update_by: 'fix-payinfo' });
      fixed += 1;
    }
  }

  console.log(
    `\n===== ${APPLY ? `已修复 ${fixed} 条` : `待修复 ${rows.length - skipped} 条`}，跳过 ${skipped} 条 =====\n`,
  );
  if (!APPLY) console.log('（这是 --plan 预览，未写库；确认后加 --apply 执行）\n');
}

try {
  await main();
} catch (e) {
  console.error('脚本异常：', e.message);
  process.exitCode = 1;
} finally {
  await common.destroy();
  await finance.destroy();
}
