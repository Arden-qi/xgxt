/** 第 4 期 · 全域回归前的残留清理（自检失败会留下数据，软删+唯一索引会导致下一轮 Duplicate entry） */
const mysql = require('mysql2/promise');
const JOBS = [
  ['sms_class_jh','t_class_info',"class_name LIKE '自检%'"],
  ['sms_class_jh','t_class_student',"student_no='U0001' OR student_name LIKE '自检%'"],
  ['sms_class_jh','t_student_base',"student_no IN ('U0001','DUP001') OR student_name LIKE '自检%'"],
  ['sms_job','t_job_class',"class_name LIKE '自检%'"],
  ['sms_job','t_student_base',"student_no IN ('U0001','DUP001') OR student_name LIKE '自检%'"],
  ['sms_class','t_class_info',"class_name LIKE '自检%'"],
  ['sms_class','t_class_student',"student_no='U0001' OR student_name LIKE '自检%'"],
  ['sms_class','t_class_grade',"student_name LIKE '自检%'"],
  ['sms_class','t_class_consult_push',"consult_no LIKE 'HB%'"],
  ['sms_class','t_class_suspend_apply',"student_name LIKE '自检%'"],
  ['sms_class','t_class_transfer',"class_name LIKE '自检%'"],
  ['sms_common','t_uni_class',"class_name LIKE '自检%'"],
  ['sms_common','t_uni_student',"student_no='U0001' OR student_name LIKE '自检%'"],
  ['sms_common','t_uni_exam_score',"student_name LIKE '自检%'"],
  ['sms_common','t_uni_class_transfer',"class_name LIKE '自检%' OR from_class_name LIKE '自检%'"],
  ['sms_common','t_uni_upgrade_apply',"student_name LIKE '自检%'"],
  ['sms_common','t_uni_consult_push',"consult_no LIKE 'HB%'"],
  // ★ 第 4 期第 8 批补：老清理只认「自检%」前缀，但第 6/7 批新自检用的是
  //   「E2E-域名-%」前缀（consult / grade / dorm…）→ 一直漏在这里。
  //   症状：统一表班级越跑越多（实测 t_uni_class 18 行里 11 行是残留），
  //   演示数据被自检垃圾淹没；软删 + 唯一索引 = 下一轮直接撞墙。
  ['sms_common','t_uni_class',"class_name LIKE 'E2E-%' OR class_name LIKE 'DBG%'"],
  ['sms_common','t_uni_student',"student_name LIKE 'E2E-%' OR student_no LIKE 'E2E%'"],
  ['sms_common','t_uni_exam',"exam_name LIKE 'E2E-%'"],
  ['sms_common','t_uni_exam_score',"student_name LIKE 'E2E-%'"],
  ['sms_common','t_uni_exam_content',"id LIKE 'ec-%' OR id LIKE 'EC%'"],
  // ★★ 第 8 批补：老表的E2E-/cls- 前缀残留也一起清。
  //   第 6/7 批只补了统一表那侧，老表一直在涨（实测 t_class_info 32 行里 26 行是残留）。
  //   危害不是「脏」而已 —— `classapproval` 自检会**先查老表找现成夹具班**，
  //   找到老残留就不再新建、也就不再镜像统一表→ 切读时 auth.ts 在统一表里找不到
  //   那个班 → `user.classIds = []` → 全域40302（老表全绿、切读全挂）。
  ['sms_class','t_class_info',"class_name LIKE 'E2E-%' OR class_name LIKE '自检班级%' OR class_name LIKE '自检大学%' OR class_name LIKE '自检目标班%' OR id LIKE 'cls-cc-%' OR id LIKE 'cls-gd-%' OR id LIKE 'cls-cd-%' OR id LIKE 'cls-A-%' OR id LIKE 'cls-B-%' OR id LIKE 'cls-NOPM-%'"],
  ['sms_class','t_class_student',"student_name LIKE 'E2E-%' OR student_name LIKE '自检学员%' OR student_no LIKE 'E2E%' OR student_no LIKE 'BJ%'"],
  ['sms_class','t_class_exam',"exam_name LIKE 'E2E-%' OR id LIKE 'exam-gd-%'"],
  ['sms_class','t_class_exam_content',"exam_id LIKE 'EX%' OR id LIKE 'EC%'"],
  ['sms_class','t_class_exam_field',"id LIKE 'EF%'"],
  ['sms_class','t_class_grade',"student_name LIKE 'E2E-%' OR id LIKE 'GR%'"],
  ['sms_class','t_class_consult_push',"student_name LIKE '%E2E%' OR source_system='grade-repeat'"],
  ['sms_class','t_class_attendance',"teacher_name LIKE '%E2E%' OR id LIKE 'ATT_C1_%'"],
  ['sms_class','t_class_attendance_absent',"student_name LIKE 'E2E-%' OR id='AB1'"],
  ['sms_class','t_class_transfer',"from_user_name LIKE '%E2E%' OR id='TR1'"],
  ['sms_class','t_class_repeat',"student_name LIKE 'E2E-%' OR id='RP1'"],
  ['sms_class','t_class_suspend_apply',"student_name LIKE 'E2E-%'"],
  // ★★ 第 10 批补：出勤/通知/催费/费用 四域
  //   统一表侧（切读时数据落这里）
  ['sms_common','t_uni_attendance',"teacher_name LIKE '%E2E%' OR head_teacher_name LIKE '%E2E%' OR class_name LIKE 'E2E-%'"],
  ['sms_common','t_uni_attendance_detail',"student_name LIKE 'E2E-%'"],
  ['sms_common','t_uni_notify',"title LIKE 'E2E-%' OR content LIKE 'E2E-%' OR apply_no LIKE 'E2E-%'"],
  ['sms_common','t_uni_urge_log',"student_name LIKE 'E2E-%'"],
  ['sms_common','t_uni_urge',"student_name LIKE 'E2E-%' OR source_id LIKE 'E2E-%'"],
  ['sms_common','t_uni_fee',"student_name LIKE 'E2E-%' OR source_id LIKE 'E2E-%'"],
  //   老表侧
  ['sms_class','t_class_attendance',"class_name LIKE 'E2E-%' OR teacher_name LIKE '%E2E%' OR head_teacher_name LIKE '%E2E%'"],
  ['sms_class','t_class_attendance_absent',"student_name LIKE 'E2E-%' OR class_name LIKE 'E2E-%' OR id LIKE 'AB%'"],
  ['sms_class','t_class_notify',"title LIKE 'E2E-%' OR content LIKE 'E2E-%' OR apply_no LIKE 'E2E-%'"],
  ['sms_class','t_class_urge_log',"student_name LIKE 'E2E-%' OR remark LIKE 'E2E-%'"],
  ['sms_common','t_class_urge_sync',"student_name LIKE 'E2E-%' OR source_id LIKE 'E2E-%' OR source_batch_no LIKE 'E2E-%'"],
  ['sms_common','t_class_fee_sync',"student_name LIKE 'E2E-%' OR source_id LIKE 'E2E-%' OR source_batch_no LIKE 'E2E-%'"],
  // ★★★ 第 10 批补：宿舍域 E2E 房间残留（实测累积到 73 行 / 15 个批次）
  //   这是**历史欠账**，不是本批引入的回归 —— 但它会让 classdorm 自检在串跑时
  //   从 63/63 掉到 60/63，症状极难定位：
  //     t_uni_dorm_room 的 class 段已有 93 行 > 自检请求的 `size=50`
  //     → 刚同步的夹具房间被挤到第 2 页 → 3 条「能查到刚同步的房间」类断言全红
  //   单跑却绿（跑前残留被上一轮清过一部分），只在串跑时暴露。
  //   ⚠️ 关键：清理必须按**房间号前缀**（room_no），不能用 id ——
  //     自检的 id 是 uuid，随机数前缀看不出来。
  ['sms_common','t_uni_dorm_room',"room_no LIKE 'E2E-%' OR building_name LIKE '自检%'"],
];
(async () => {
  const c = await mysql.createConnection({ host: 'localhost', user: 'root', password: '123456' });
  let tot = 0;
  for (const [db, t, w] of JOBS) {
    const [cs] = await c.query('SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [db, t]);
    if (!cs.length) continue;
    try {
      const [r] = await c.query(`DELETE FROM \`${db}\`.\`${t}\` WHERE ${w}`);
      tot += r.affectedRows;
      if (r.affectedRows) console.log(`  ✓ ${db}.${t} → ${r.affectedRows} 行`);
    } catch (e) { console.log(`  ✗ ${db}.${t}: ${e.message.slice(0, 60)}`); }
  }
  console.log('清理完成，共删', tot, '行');
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
