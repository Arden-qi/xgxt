/**
 * 一次性存量清理：合并催费表里「同一学生同一费用项」的重复行
 * ============================================================
 * 【背景】
 *   财务同步原来只认 `source_system + source_id` 一条幂等键，
 *   而教学侧台账里本来就有「某学生 + 某费用项」一行（演示数据 / 班主任登记）
 *   → 财务同步下来匹配不上 → 又插一行
 *   → 催费页同一个学生的学费出现两条（老的一条「已缴」+ 新的一条「已核对」）。
 *
 *   2026-10-23 已把同步改成「三级命中」（见 finance/services/class-sync.ts，
 *   findUrgeTarget），**新数据不会再产生重复**；本脚本负责把历史存量清掉。
 *
 * 【口径】
 *   · 表：t_uni_fee（edu_stage='jh' 初高 / 'job' 就业）、t_uni_urge（大学催费副本）
 *   · 业务键：edu_stage + student_no + fee_type
 *   · 保留：**优先 source_system='finance' 的那条**（财务是真源，状态/金额都准）
 *   · 冗余：其余行 → 先把「它有、保留行却没有」的字段补进保留行，
 *           再**软删**（is_deleted=1，禁止物理删除）
 *   · urge_count / last_urge_time 这种催收进度按「取大 / 取最新」搬，不丢进度
 *
 * 【安全】
 *   · 默认 --plan：只打印计划，一行不改
 *   · --apply   ：才真正写库；被软删的 id 全部打印，可原样恢复
 *
 * 用法（server-job 目录）：
 *   node scripts/_merge-urge-dup.mjs --plan
 *   node scripts/_merge-urge-dup.mjs --apply
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import knex from 'knex';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const APPLY = process.argv.includes('--apply');

const common = knex({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME_COMMON || 'sms_common',
    charset: 'utf8mb4',
    timezone: '+08:00',
    dateStrings: true,
  },
  pool: { min: 0, max: 2 },
});

/** 本次要处理的表（业务键相同 = 同一笔 fees 事実） */
const TARGETS = [
  { table: 't_uni_fee', stages: ['jh', 'job'], amountCol: 'fee_amount' },
  { table: 't_uni_urge', stages: ['class'], amountCol: 'amount' },
];

/** 动手之前按 information_schema 拿一次真实列清单，避免写库里不存在的列 */
async function realColumns(table) {
  const [cols] = await common.raw(
    `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table],
  );
  return new Set(cols.map((c) => c.name));
}

function isBlank(v) {
  return v === null || v === undefined || v === '';
}

async function main() {
  let kept = 0;
  let merged = 0;
  const removedIds = [];

  for (const tgt of TARGETS) {
    const cols = await realColumns(tgt.table);
    for (const stage of tgt.stages) {
      const groups = (
        await common.raw(
          `SELECT student_no, fee_type, COUNT(*) cnt
             FROM \`${tgt.table}\`
            WHERE edu_stage = ? AND is_deleted = 0
            GROUP BY student_no, fee_type
           HAVING cnt > 1
            ORDER BY student_no, fee_type`,
          [stage],
        )
      )[0];

      if (!groups.length) {
        console.log(`\n[${tgt.table}/${stage}] 无重复`);
        continue;
      }
      console.log(`\n[${tgt.table}/${stage}] 重复组 ${groups.length} 组`);

      for (const g of groups) {
        const rows = (
          await common.raw(
            `SELECT * FROM \`${tgt.table}\`
              WHERE edu_stage = ? AND student_no = ? AND fee_type = ? AND is_deleted = 0
              ORDER BY create_time ASC`,
            [stage, g.student_no, g.fee_type],
          )
        )[0];

        /** 保留行：财务来源优先（多条取最新），否则最老那条 */
        const financeRows = rows.filter((r) => r.source_system === 'finance');
        const keep =
          financeRows.sort((a, b) => String(b.update_time || '').localeCompare(String(a.update_time || '')))[0] ||
          rows[0];
        const dups = rows.filter((r) => r.id !== keep.id);

        console.log(
          `  · ${keep.student_no}/${keep.student_name} feeType=${keep.fee_type} 保留 ${keep.id}` +
            `（${keep.source_system}/${keep.source_id} pay=${keep.pay_status}）→ 合并 ${dups.length} 条`,
        );

        /**
         * ① 补空：把冗余行里「它有值、保留行没值」的字段搬进保留行
         *    只补空位，**绝不覆盖**财务已经写下的权威值。
         */
        const patch = {};
        for (const dup of dups) {
          for (const k of Object.keys(dup)) {
            if (!cols.has(k)) continue;
            if (['id', 'edu_stage', 'source_system', 'source_id', 'update_time', 'update_by'].includes(k)) continue;
            if (!isBlank(keep[k]) || isBlank(dup[k])) continue;
            // 金额/状态/日期这类「财务事实」不搬 —— 保留行的值才是权威
            if (['pay_status', 'fee_amount', 'amount', 'sync_status', 'is_deleted'].includes(k)) continue;
            patch[k] = dup[k];
          }
          // ② 催收进度：按「取大 / 取最新」搬过去，不能丢
          if (cols.has('urge_count') && Number(dup.urge_count || 0) > Number(keep.urge_count || 0)) {
            patch.urge_count = Number(dup.urge_count);
            if (cols.has('last_urge_time') && dup.last_urge_time) patch.last_urge_time = dup.last_urge_time;
          }
        }

        if (APPLY) {
          if (Object.keys(patch).length) {
            await common(tgt.table).where({ id: keep.id }).update(patch);
          }
          for (const dup of dups) {
            await common(tgt.table)
              .where({ id: dup.id })
              .update({ is_deleted: true, update_by: 'urge-dup-merge', update_time: new Date() });
            removedIds.push(`${tgt.table}:${dup.id}`);
          }
        } else if (Object.keys(patch).length) {
          console.log(`      补空字段：${Object.keys(patch).join(', ')}`);
        }
        for (const dup of dups) console.log(`      冗余 ${dup.id}（${dup.source_system}/${dup.source_id} pay=${dup.pay_status}）`);

        kept += 1;
        merged += dups.length;
      }
    }
  }

  console.log(`\n===== ${APPLY ? '已执行' : '预演'}：处理 ${kept} 组，合并冗余 ${merged} 行 =====`);
  if (APPLY) {
    console.log(`被软删的 id（${removedIds.length} 条，需要恢复时把这些行的 is_deleted 改回 0）：`);
    removedIds.forEach((x) => console.log('  ' + x));
  } else {
    console.log('★ 这只是预演，没写库。确认无误后加 --apply 执行。');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => common.destroy());
