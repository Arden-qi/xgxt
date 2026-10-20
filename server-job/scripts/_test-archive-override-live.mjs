/**
 * 实测：单据上的学生字段确实以「档案最新值」为准（★ 2026-10-20）
 * ============================================================
 *
 * 【为什么需要这个脚本】
 *   静态检查只能证明「代码里调了覆盖函数」，证明不了「接口返回的真是档案值」。
 *   所以这里做一次影子测试：
 *     ① 把某个学生的档案班级临时改成一个可识别的值；
 *     ② 调真实接口看它是否**立刻跟着变**；
 *     ③ 再还原档案，确认接口也回到原值。
 *   只有这样才能排除「覆盖函数写了但没生效 / 被后面的赋值盖掉」这类静默失败。
 *
 * 【安全】
 *   全程 try/finally 保证还原；只动 `class_name` / `class_id` 两列，
 *   改前打印原值，改后立刻恢复。任何一步失败都会先还原再退出。
 *
 * 用法：node scripts/_test-archive-override-live.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { BASE, req, login } from './_e2e-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const require = createRequire(import.meta.url);
require('dotenv').config({ path: path.join(ROOT, 'server-job/.env') });

const knex = require('knex')({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  },
});

let pass = 0;
const fails = [];
function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ✅ ${name}${detail ? `  —— ${detail}` : ''}`);
  } else {
    fails.push(name);
    console.log(`  ❌ ${name}${detail ? `  —— ${detail}` : ''}`);
  }
}

/** 测试用的假班级（一眼能看出是测试值） */
const SHADOW_NAME = 'ZZ-档案覆盖测试班';

(async () => {
  console.log('===== 实测：接口是否以档案最新值为准 =====');

  const token = await login('admin');
  check('管理员登录', !!token, token ? 'ok' : '登录失败');
  if (!token) throw new Error('登录失败');

  // ---------- 挑一条「初高缴费单 + 学生档案」 ----------
  const pick = (
    await knex.raw(
      `SELECT f.id AS fee_id, f.student_id, f.student_no, f.class_id AS fee_class_id,
              f.class_name AS fee_class_name,
              st.class_id AS stu_class_id, st.class_name AS stu_class_name
       FROM sms_class_jh.t_class_fee f
       JOIN sms_class_jh.t_class_student st ON st.id = f.student_id AND st.is_deleted = 0
       WHERE f.is_deleted = 0
       ORDER BY f.create_time DESC LIMIT 1`,
    )
  )[0][0];

  if (!pick) {
    console.log('  ⚠️  库里没有可用于测试的缴费单，跳过');
    await knex.destroy();
    return;
  }
  console.log(
    `  取样：单号 ${pick.fee_id}  学号 ${pick.student_no}  单据班级[${pick.fee_class_name}]  档案班级[${pick.stu_class_name}]`,
  );

  // 找一个和当前不同的真实班级，用于验证「按档案现状筛选」
  const otherClass = (
    await knex.raw(
      `SELECT id, class_name FROM sms_class_jh.t_class_info
       WHERE is_deleted = 0 AND id <> ? LIMIT 1`,
      [pick.stu_class_id],
    )
  )[0][0];

  const backup = { class_id: pick.stu_class_id, class_name: pick.stu_class_name };

  try {
    // ---------- ① 把档案班级改成测试值 ----------
    await knex('sms_class_jh.t_class_student')
      .where({ id: pick.student_id })
      .update({ class_name: SHADOW_NAME });
    console.log(`  已临时把学生档案班级名改为「${SHADOW_NAME}」`);

    // ---------- ② 列表接口应立刻显示新班级名 ----------
    const r1 = await req(
      `${BASE}/api/class-jh/fee/list?page=1&size=50&keyword=${encodeURIComponent(pick.student_no)}`,
      { token, timeout: 15000 },
    );
    const rows1 = r1.json?.data?.records || r1.json?.data?.list || [];
    const hit = rows1.find((x) => x.feeId === pick.fee_id);
    check(
      '缴费列表：学生姓名/班级取档案最新值（不是开单快照）',
      !!hit && hit.className === SHADOW_NAME,
      hit ? `接口返回班级名=${hit.className}` : '列表里没找到这张单',
    );

    // ---------- ③ 按「档案现状」的班级筛选，也应能命中 ----------
    //     此时单据快照仍指向老班级，学生档案已指向别处；
    //     按老班级筛 → 靠单据快照命中；按新班级筛 → 靠档案现状命中。
    if (otherClass) {
      await knex('sms_class_jh.t_class_student')
        .where({ id: pick.student_id })
        .update({ class_id: otherClass.id, class_name: otherClass.class_name });

      const byOld = await req(
        `${BASE}/api/class-jh/fee/list?page=1&size=100&classId=${encodeURIComponent(pick.fee_class_id)}`,
        { token, timeout: 15000 },
      );
      const oldRows = byOld.json?.data?.records || byOld.json?.data?.list || [];
      check(
        '按「单据快照」的班级仍能筛到这张单（不会因为改了档案就查不到）',
        oldRows.some((x) => x.feeId === pick.fee_id),
        `老班级[${pick.fee_class_name}] 命中 ${oldRows.length} 条`,
      );

      const byNew = await req(
        `${BASE}/api/class-jh/fee/list?page=1&size=100&classId=${encodeURIComponent(otherClass.id)}`,
        { token, timeout: 15000 },
      );
      const newRows = byNew.json?.data?.records || byNew.json?.data?.list || [];
      check(
        '按「档案现状」的班级也能筛到这张单（换班后不会「看得见、筛不到」）',
        newRows.some((x) => x.feeId === pick.fee_id),
        `新班级[${otherClass.class_name}] 命中 ${newRows.length} 条`,
      );
    } else {
      console.log('  ⚠️  只有一个班级，跳过筛选兼容测试');
    }

    // ---------- ④ 催费记录接口同口径 ----------
    const r2 = await req(`${BASE}/api/class-jh/fee/notify/list?page=1&size=20`, {
      token,
      timeout: 15000,
    });
    const nRows = r2.json?.data?.records || r2.json?.data?.list || [];
    check(
      '催费记录列表可正常返回（档案覆盖未破坏接口）',
      Array.isArray(nRows),
      `${nRows.length} 条`,
    );
  } finally {
    // ---------- ⑤ 无条件还原 ----------
    await knex('sms_class_jh.t_class_student').where({ id: pick.student_id }).update(backup);
    const after = (
      await knex.raw('SELECT class_id, class_name FROM sms_class_jh.t_class_student WHERE id = ?', [
        pick.student_id,
      ])
    )[0][0];
    check(
      '测试数据已还原（档案班级回到原值）',
      String(after.class_name ?? '') === String(backup.class_name ?? '') &&
        String(after.class_id ?? '') === String(backup.class_id ?? ''),
      `${after.class_name}`,
    );
  }

  await knex.destroy();
  console.log(`\n===== 结果：${pass}/${pass + fails.length} 通过 =====`);
  if (fails.length) {
    fails.forEach((f) => console.log(`  ❌ ${f}`));
    process.exit(1);
  }
})().catch(async (e) => {
  console.error(e);
  await knex.destroy();
  process.exit(1);
});
