/**
 * 临时补搬迁：uni-migrate 会跳过 4 张「同步副本表」（sms_common 里没有学段列）。
 * 本脚本只处理其中**有数据**的两张，学段按表名推断为 class（大学部）：
 *   t_class_urge_sync → t_uni_urge
 *   t_class_fee_sync  → t_uni_fee
 * 只插统一表里没有的 id，可重复跑。
 *
 * 用法：node scripts/_uni-fill-sync.mjs [--apply]
 */
import path from 'node:path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env') });
const APPLY = process.argv.includes('--apply');

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: 'sms_common',
});

const PAIRS = [
  ['t_class_urge_sync', 't_uni_urge', 'class'],
  ['t_class_fee_sync', 't_uni_fee', 'class'],
];

const colsOf = async (t) => {
  const [r] = await conn.query(
    `select column_name c from information_schema.columns
      where table_schema='sms_common' and table_name=? order by ordinal_position`,
    [t],
  );
  return r.map((x) => x.c);
};

console.log(`${APPLY ? '【执行】' : '【预演】'} 同步副本表补搬迁\n`);

for (const [src, dst, stage] of PAIRS) {
  const srcCols = await colsOf(src);
  const dstCols = await colsOf(dst);
  if (!srcCols.length || !dstCols.length) {
    console.log(`  跳过（表不存在） ${src} → ${dst}`);
    continue;
  }
  const shared = srcCols.filter((c) => dstCols.includes(c));
  const needStage = dstCols.includes('edu_stage') && !shared.includes('edu_stage');

  const [[cnt]] = await conn.query(
    `select count(*) n from \`${src}\` s where not exists (select 1 from \`${dst}\` d where d.id = s.id)`,
  );
  console.log(`  ${src} → ${dst}：待补 ${cnt.n} 行（学段=${stage}）`);
  if (!APPLY || cnt.n === 0) continue;

  const colList = needStage ? [...shared, 'edu_stage'] : shared;
  const selList = needStage ? [...shared.map((c) => `\`${c}\``), `'${stage}'`] : shared.map((c) => `\`${c}\``);
  const sql =
    `insert into \`${dst}\` (${colList.map((c) => `\`${c}\``).join(',')}) ` +
    `select ${selList.join(',')} from \`${src}\` s ` +
    `where not exists (select 1 from \`${dst}\` d where d.id = s.id)`;
  const [res] = await conn.query(sql);
  console.log(`    已插入 ${res.affectedRows} 行`);
}

console.log(`\n${APPLY ? '补搬迁完成' : '预演结束，加 --apply 执行'}`);
await conn.end();
