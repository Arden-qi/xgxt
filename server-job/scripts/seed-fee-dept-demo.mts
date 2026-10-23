/**
 * 演示种子数据（催费 · 大学部 / 就业部）—— 幂等、只增不删
 * ============================================================
 *
 * 执行：npm run seed:fee-dept   （等价于 npx tsx scripts/seed-fee-dept-demo.mts）
 *
 * 【为什么要有这个脚本】
 *   初高 `sms_class_jh.t_class_fee` 一直有演示数据（seed-class-jh-demo.js 造的
 *   `seed-fee-*` 共 64 条，其中 18 条落在 20 天催费窗口内），所以初高的催费页有数据。
 *   但大学部（sms_common.t_class_urge_sync）和就业部（sms_job.t_job_fee_call）
 *   **一条演示数据都没有** —— 表里只剩自检脚本留下的记录，而且全部 is_deleted=1。
 *   结果：校长打开催费页选「大学」或「就业」，永远是「暂无数据」，
 *   分不清是「功能没通」还是「本来就没单」。
 *
 * 【造什么（每个部门 9 条，覆盖窗口内所有展示分支）】
 *   到期日都用「相对今天」的天数偏移，所以**任何时候跑都落在合理区间**：
 *     -12 / -5  → 已过期，展示为「逾期」（库里仍写待缴，与财务真实口径一致）
 *      +2 / +5 / +9 / +14 / +19 → 催费窗口内（≤20 天）
 *      +45       → 窗口外，**刻意造一条**，用来验证列表真的按窗口过滤
 *    其中 3 条带「登记缴费」信息（缴费方式 + 实缴金额），
 *    用来验证「批量上传到财务」的候选与提交（没登记缴费的单不该出现在候选里）。
 *
 * 【三个刻意的口径】
 *   ① 学生/班级全部取**已有演示数据**（seed-ustu-* / seed-jstu-*，班级 seed-ucls-* / seed-jcls-*），
 *      不另造学生 —— 否则学生档案与催费单对不上，列表里姓名/班级列会是空的。
 *   ② 大学部 `source_system='seed'`：这张表是「外部推来的只读副本」，
 *      正常值只有 finance（财务推）/ edu（就业推）。演示数据用 seed 标出来，
 *      将来清库时 `WHERE source_system='seed'` 一句话就能摘干净。
 *      ⚠️ 不要写成 'finance' —— 那会让「批量上传到财务」误判成「财务已有原单」。
 *   ③ 金额单位一律「分」，与全系统一致。
 *
 * ⚠️ 幂等：固定 id（seed-urge-U26xxx / seed-call-SX26xxx），已存在就跳过，可以重复跑。
 * ⚠️ 只增不删：不清空任何表；要清就手工按上面的 id 前缀删。
 *
 * ============================================================
 * ★★ 2026-10-22 重大修正：**所有读写必须走切读层**（`tbl()` / `tblIns()`）
 *
 * 【原来的 bug】
 *   本脚本原来是直接 `dbCommon('t_class_urge_sync').insert(...)` /
 *   `dbJob('t_job_fee_call').insert(...)` —— **裸写老表**。
 *   但教学域的读路径在 P8 之后已经默认走统一表
 *   （`USE_UNI_TABLE = env !== '0'`，见 `src/teaching/shared/uniTable.ts`）：
 *     `sms_common.t_class_urge_sync` → `sms_common.t_uni_urge`
 *     `sms_job.t_job_fee_call`       → `sms_common.t_uni_fee`（edu_stage='job'）
 *   → 脚本「执行成功」但催费页**永远看不到**，因为数据写进了没人读的那张表。
 *   实测：大学催费副本里那 9 条 seed 数据之所以能显示，是后来手工搬进统一表的。
 *
 * 【为什么不再「裸写老表 + 手工搬」】
 *   换一台机器、或别人 clone 下来跑，还会踩同一个坑；而且「写老表、读统一表」
 *   本身就是这个项目反复出过的 bug 类别（见 uniTable.ts 里 N 处注释）。
 *   所以这次直接改成走切读层，脚本和页面读同一张表。
 *
 * 【顺带修正】就业部种子原来不写 `pay_status`，只写 `call_status`。
 *   2026-10-22 的口径已统一为「缴费状态看 pay_status（1待缴/2已缴/3已核对/4逾期/5冻结），
 *   call_status 退化成催收进度」，所以这里按同一张场景表补上 pay_status。
 * ============================================================
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tbl, tblIns } from '../src/teaching/shared/uniTable';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function loadEnv() {
  const env = {};
  try {
    const raw = readFileSync(resolve(__dirname, '../.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* 用默认值 */
  }
  return env;
}

const ENV = loadEnv();
const knex = require('knex');

function conn(database, dateStrings = true) {
  return knex({
    client: 'mysql2',
    connection: {
      host: ENV.DB_HOST || 'localhost',
      port: Number(ENV.DB_PORT) || 3306,
      user: ENV.DB_USER || 'root',
      password: ENV.DB_PASSWORD || 'Meng1210',
      database,
      charset: 'utf8mb4',
      timezone: '+08:00',
      dateStrings,
    },
    pool: { min: 0, max: 3 },
  });
}

const dbClass = conn(ENV.DB_NAME_CLASS || 'sms_class');
const dbJob = conn(ENV.DB_NAME || 'sms_job');
const dbCommon = conn(ENV.DB_NAME_COMMON || 'sms_common');

/** 今天往后/往前挪 n 天，返回 YYYY-MM-DD */
function dayOffset(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/* ============================================================
 * 场景表：同一个偏移/状态在两个部门各生成一条
 * ============================================================
 * pay  = 统一缴费状态 pay_status（1待缴 2已缴 3已核对 4逾期 5冻结）
 * call = 就业部催收进度 call_status（1待催 2跟进中 3已结清）
 */
const SCENARIOS = [
  { off: -12, pay: 1, call: 1, note: '逾期 12 天' },
  { off: -5, pay: 1, call: 1, note: '逾期 5 天' },
  { off: -3, pay: 2, call: 3, note: '已缴（但已过应缴日）' },
  { off: 2, pay: 1, call: 2, payMethod: 1, paidRatio: 0.5, note: '窗口内 · 微信付了一半' },
  { off: 5, pay: 1, call: 1, note: '窗口内 · 待缴' },
  { off: 9, pay: 1, call: 2, payMethod: 3, paidRatio: 1, note: '窗口内 · 现金已缴清' },
  { off: 14, pay: 1, call: 1, note: '窗口内 · 待缴' },
  { off: 19, pay: 2, call: 3, note: '窗口内 · 已缴' },
  { off: 45, pay: 1, call: 1, note: '窗口外（45 天，应被列表过滤掉）' },
];

/**
 * 费用类别
 *
 * ⚠️ 两个部门的**合法类别不一样**（这是踩过的坑）：
 *   · 大学部（催缴副本）跟财务/初高同一套 FeeType：1 学费 / 2 住宿费 / 3 餐费
 *   · 就业部 `t_job_fee_call` 走 `FeeCallCategory`，**只有 2 住宿费 / 3 餐费 / 4 保险费**，
 *     没有学费（实训阶段不催学费，学费在入学时收）。
 *     给就业塞 fee_type=1，后端 `FEE_CALL_CATEGORY_NAME[1]` 取不到名字 →
 *     列表「缴费类型」列是空的，看着像数据坏了。
 */
const FEE_TYPES_CLASS = [
  { type: 1, amount: 1280000 }, // 学费 12800 元
  { type: 2, amount: 120000 }, // 住宿费 1200 元
  { type: 3, amount: 210000 }, // 餐费 2100 元
];
const FEE_TYPES_JOB = [
  { type: 2, amount: 120000 }, // 住宿费 1200 元
  { type: 3, amount: 210000 }, // 餐费 2100 元
  { type: 4, amount: 20000 }, // 保险费 200 元
];

const stat = [];

async function seedClassUrge() {
  const students = (await tbl(dbClass, 'sms_class', 't_class_student', 'class')
    .where('is_deleted', 0)
    .where('student_no', 'like', 'U26%')
    .orderBy('student_no')
    .limit(SCENARIOS.length)
    .select(
      'id',
      'student_no',
      'student_name',
      'class_id',
      'class_name',
      'phone',
      'parent_phone',
    )) as Array<Record<string, any>>;

  if (!students.length) {
    stat.push('  ✗ 大学部：没有 U26* 的学生，先跑 npm run seed:class-job');
    return;
  }

  const teachers = (await tbl(dbClass, 'sms_class', 't_class_info', 'class')
    .where('is_deleted', 0)
    .whereIn(
      'id',
      students.map((s) => s.class_id).filter(Boolean),
    )
    .select('id', 'head_teacher_id', 'head_teacher_name')) as Array<Record<string, any>>;
  const teacherOf = new Map(teachers.map((t) => [t.id, t]));

  let inserted = 0;
  for (let i = 0; i < SCENARIOS.length; i += 1) {
    const sc = SCENARIOS[i];
    const stu = students[i % students.length];
    const ft = FEE_TYPES_CLASS[i % FEE_TYPES_CLASS.length];
    const id = `seed-urge-${stu.student_no}`;

    // eslint-disable-next-line no-await-in-loop
    const exists = await tbl(dbCommon, 'sms_common', 't_class_urge_sync', 'class')
      .where({ id })
      .first();
    if (exists) continue;

    const paidAmount = sc.payMethod ? Math.round(ft.amount * (sc.paidRatio ?? 1)) : null;
    const t = teacherOf.get(stu.class_id) || {};

    // eslint-disable-next-line no-await-in-loop
    await tblIns(dbCommon, 'sms_common', 't_class_urge_sync', 'class', {
      id,
      create_time: new Date(),
      is_deleted: 0,
      // ★ 见文件头口径②：不要写 'finance'
      source_system: 'seed',
      source_id: `seed-src-${stu.student_no}`,
      sync_status: 2,
      student_id: stu.id,
      student_no: stu.student_no,
      student_name: stu.student_name,
      class_id: stu.class_id,
      class_name: stu.class_name,
      phone: stu.phone,
      parent_phone: stu.parent_phone,
      head_teacher_id: t.head_teacher_id ?? null,
      head_teacher_name: t.head_teacher_name ?? null,
      fee_type: ft.type,
      amount: ft.amount,
      expire_date: dayOffset(sc.off),
      pay_status: sc.pay,
      urge_count: sc.off < 0 ? 2 : 0,
      last_urge_time: sc.off < 0 ? new Date() : null,
      pay_method: sc.payMethod ?? null,
      paid_amount: paidAmount,
      pay_date: sc.payMethod ? dayOffset(-1) : null,
      voucher_url: null,
      pay_remark: sc.payMethod ? `演示数据：${sc.note}` : null,
    });
    inserted += 1;
  }
  stat.push(`  ✓ 大学部（t_class_urge_sync → t_uni_urge）：新增 ${inserted} 条（已有跳过）`);
}

async function seedJobCall() {
  const students = (await tbl(dbJob, 'sms_job', 't_student_base', 'job')
    .where('is_deleted', 0)
    .where('student_no', 'like', 'SX26%')
    .orderBy('student_no')
    .limit(SCENARIOS.length)
    .select('id', 'student_no', 'student_name', 'class_id', 'class_name', 'phone', 'parent_phone')) as Array<
    Record<string, any>
  >;

  if (!students.length) {
    stat.push('  ✗ 就业部：没有 SX26* 的学生，先跑 npm run seed:class-job');
    return;
  }

  const teachers = (await tbl(dbJob, 'sms_job', 't_job_class', 'job')
    .where('is_deleted', 0)
    .whereIn(
      'id',
      students.map((s) => s.class_id).filter(Boolean),
    )
    .select('id', 'head_teacher_id', 'head_teacher_name')) as Array<Record<string, any>>;
  const teacherOf = new Map(teachers.map((t) => [t.id, t]));

  let inserted = 0;
  for (let i = 0; i < SCENARIOS.length; i += 1) {
    const sc = SCENARIOS[i];
    const stu = students[i % students.length];
    const ft = FEE_TYPES_JOB[i % FEE_TYPES_JOB.length];
    const id = `seed-call-${stu.student_no}`;

    // eslint-disable-next-line no-await-in-loop
    const exists = await tbl(dbJob, 'sms_job', 't_job_fee_call', 'job').where({ id }).first();
    if (exists) continue;

    const paidAmount = sc.payMethod ? Math.round(ft.amount * (sc.paidRatio ?? 1)) : null;
    const t = teacherOf.get(stu.class_id) || {};

    // eslint-disable-next-line no-await-in-loop
    await tblIns(dbJob, 'sms_job', 't_job_fee_call', 'job', {
      id,
      create_time: new Date(),
      create_by: 'seed',
      is_deleted: 0,
      fee_type: ft.type,
      student_id: stu.id,
      student_no: stu.student_no,
      student_name: stu.student_name,
      phone: stu.phone,
      parent_phone: stu.parent_phone,
      class_id: stu.class_id,
      class_name: stu.class_name,
      dept_code: 3,
      head_teacher_id: t.head_teacher_id ?? null,
      head_teacher_name: t.head_teacher_name ?? null,
      fee_amount: ft.amount,
      due_date: dayOffset(sc.off),
      // ★ 2026-10-22 口径：缴费状态看 pay_status；call_status 只表示催收进度
      pay_status: sc.pay,
      call_reason: `演示数据：${sc.note}`,
      remark: null,
      call_status: sc.call,
      handle_time: sc.call === 3 ? new Date() : null,
      handle_remark: sc.call === 3 ? '演示数据：已缴清' : null,
      applicant_id: 'seed',
      applicant_name: '演示数据',
      pay_method: sc.payMethod ?? null,
      paid_amount: paidAmount,
      pay_date: sc.payMethod ? dayOffset(-1) : null,
      voucher_url: null,
      pay_remark: sc.payMethod ? `演示数据：${sc.note}` : null,
    });
    inserted += 1;
  }
  stat.push(`  ✓ 就业部（t_job_fee_call → t_uni_fee）：新增 ${inserted} 条（已有跳过）`);
}

async function main() {
  console.log('\n=== 催费演示数据（大学部 / 就业部）===\n');
  try {
    await seedClassUrge();
    await seedJobCall();
    stat.forEach((s) => console.log(s));

    // 造完立刻按「催费窗口」算一遍，确认该显示几条 —— 免得又是「跑成功但页面还是空」
    const win = 20;
    // eslint-disable-next-line no-await-in-loop
    const cAfter = (await tbl(dbCommon, 'sms_common', 't_class_urge_sync', 'class')
      .where('is_deleted', 0)
      .whereNotNull('expire_date')
      .whereRaw('DATEDIFF(expire_date, CURDATE()) <= ?', [win])) as Array<Record<string, any>>;
    // eslint-disable-next-line no-await-in-loop
    const jAfter = (await tbl(dbJob, 'sms_job', 't_job_fee_call', 'job')
      .where('is_deleted', 0)
      .whereRaw('DATEDIFF(due_date, CURDATE()) <= ?', [win])) as Array<Record<string, any>>;

    console.log(`\n  催费窗口（到期日距今 ≤ ${win} 天）内应显示：`);
    console.log(`    大学部 ${cAfter.length} 条 · 就业部 ${jAfter.length} 条`);
    console.log('\n（打开 教学管理 → 催费，部门选「大学」或「就业」核对；重复执行不会造重复数据）\n');
  } finally {
    await Promise.allSettled([dbClass.destroy(), dbJob.destroy(), dbCommon.destroy()]);
  }
}

main().catch((e) => {
  console.error('失败：', e?.message || e);
  process.exit(1);
});
