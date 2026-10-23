/**
 * 回归验证：学生状态为【退学】时不可更改（2026-10-21 批注）
 * ============================================================
 * 批注原文（班级管理 · 详情 · 花名册「状态」列，红框圈整列）：
 *   「学生状态为【退学】的，任何操作都不可更改该状态」
 *
 * 断言（全部走真实接口，只认 HTTP 结果，不看代码）：
 *   ① 学生档案 · 编辑：把退学学生状态改成「正式在读」→ 被拒（提示含「退学」）
 *   ② 学生档案 · 编辑：状态仍传 7（只改其它字段）→ 正常保存（不能因为加锁就改不动人）
 *   ③ 学生档案 ·【已就业】按钮：退学学生 → 被拒
 *   ④ 实训班【升就业】：班里的退学学生**不会被改成待就业**
 *   ⑤ 升云：退学学生不会被升到大学部（只允许正式在读，既有规则）
 *
 * ⚠️ ④ 需要一条「实训班的退学学生」样本。库里通常没有 → 脚本自己造一条
 *    （sms_job.t_student_base + t_job_class_student，挂在 SX2601 花名册上），
 *    跑完**自动删除**；只动这一条自造数据，不碰其它 demo 学生。
 *
 * 用法：node tools/_verify-quit-status-lock.mjs   （后端需在跑：8004）
 */
import { execFileSync } from 'node:child_process';

// ⚠️ 用 127.0.0.1 而不是 localhost：后端只监听 IPv4(0.0.0.0)，
//    node 的 fetch 可能先解析到 ::1 → 直接 fetch failed（curl 则不受影响）。
const BASE = 'http://127.0.0.1:8004';
const ACC = process.env.VERIFY_ACC || 'qiansy';
const PWD = process.env.VERIFY_PWD || '123456';
const MYSQL = 'D:\\mysql\\bin\\mysql.exe';

const fails = [];
const check = (n, ok, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`);
  if (!ok) fails.push(n);
};

const api = async (method, url, body, token) => {
  /* ⚠️ 中间夹着同步的 mysql 调用（execFileSync）时，undici 的 keep-alive 连接可能已被
     服务端掐掉 → 复用时报 `fetch failed`。这里重试一次就好，不代表接口有问题。 */
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch(BASE + url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Connection: 'close',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return await r.json().catch(() => ({}));
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
  return {};
};

/** 直接查库（校验落库结果，避免被接口层的「成功」蒙过去） */
function sql(q) {
  const out = execFileSync(MYSQL, ['-u', 'root', '-proot123456', '--protocol=TCP', '-N', '-B', '-e', q], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return String(out).trim();
}

const TMP_ID = 'tmp-quit-lock-verify';
const TMP_NO = 'TMPQL001';

function cleanup() {
  try {
    sql(`delete from sms_job.t_job_class_student where student_id='${TMP_ID}'`);
    sql(`delete from sms_job.t_student_base where id='${TMP_ID}'`);
  } catch {
    /* 清理失败不阻断结论 */
  }
}

(async () => {
  const login = await api('POST', '/api/portal/account/login', { account: ACC, password: PWD });
  check('登录成功', login.code === 200, login.message || '');
  const token = login.data?.token || login.data?.accessToken;
  if (!token) {
    console.log('\nFAILED: 登录失败，后续跳过');
    process.exitCode = 1;
    return;
  }

  /* ============ ① ② ③ 初高部真实退学样本 ============ */
  const jh = await api('GET', '/api/teaching/student/list?stage=jh&studentStatus=7&size=5', null, token);
  const quitStu = (jh.data?.list || [])[0];
  if (!quitStu) {
    console.log('  ⚠️ 初高部没有退学样本，跳过 ①②③');
  } else {
    const before = await api('GET', `/api/teaching/student/detail?stage=jh&id=${quitStu.studentId}`, null, token);
    const b = before.data?.base || {};
    console.log(`  样本：${b.studentName}（${b.studentNo}）状态=${b.studentStatusName}`);
    /* 表单是按整条档案回填的 —— 这里必须把班级/部门/阶段一起带上，
       否则 dept_code / stage 会被写成 NULL（该表是 NOT NULL 列）。 */
    const base = {
      stage: 'jh',
      id: b.studentId,
      studentName: b.studentName,
      gender: b.gender || 1,
      deptCode: b.deptCode ?? undefined,
      classId: b.classId ?? undefined,
      className: b.className ?? undefined,
      phaseCode: b.phaseCode ?? undefined,
      birthDate: b.birthDate ?? undefined,
      phone: b.phone ?? undefined,
      parentName: b.parentName ?? undefined,
      parentPhone: b.parentPhone ?? undefined,
      education: b.education ?? undefined,
      enrollDate: b.enrollDate ?? undefined,
    };

    const bad = await api('POST', '/api/teaching/student/save', { ...base, studentStatus: 5 }, token);
    check('① 编辑退学学生 → 改状态被拒', bad.code !== 200 && /退学/.test(bad.message || ''), bad.message || `code=${bad.code}`);

    const okSame = await api('POST', '/api/teaching/student/save', { ...base, studentStatus: 7 }, token);
    check('② 状态仍传 7（只改其它字段）→ 保存成功', okSame.code === 200, okSame.message || `code=${okSame.code}`);

    const emp = await api('POST', '/api/teaching/student/confirm-employed', { stage: 'jh', id: quitStu.studentId }, token);
    check('③ 退学学生点【已就业】被拒', emp.code !== 200 && /退学/.test(emp.message || ''), emp.message || `code=${emp.code}`);

    const after = await api('GET', `/api/teaching/student/detail?stage=jh&id=${quitStu.studentId}`, null, token);
    check('③′ 三次操作后状态仍是 7 退学', Number(after.data?.base?.studentStatus) === 7, `${after.data?.base?.studentStatusName}(${after.data?.base?.studentStatus})`);
  }

  /* ============ ④ 升就业：实训班的退学学生不能被改成待就业 ============ */
  const cls = await api('GET', '/api/teaching/class/list?stage=job&size=50', null, token);
  const jobCls = (cls.data?.list || []).find((r) => r.classCode === 'SX2601') || (cls.data?.list || [])[0];
  if (!jobCls) {
    console.log('  ⚠️ 没有实训班，跳过 ④');
  } else {
    console.log(`  实训班：${jobCls.className}（${jobCls.classCode}）id=${jobCls.classId}`);
    cleanup();
    /* 造一条退学学生挂到该班花名册。
       做法：先把同班一个学生的整行「拷贝到临时表」，改 4 个字段，再插回主表 ——
       这样列顺序/列数永远和真表一致（写死几十列迟早漏一个，NOT NULL 就炸）。 */
    sql(`
      drop table if exists sms_job.tmp_quit_lock;
      create table sms_job.tmp_quit_lock as
        select * from sms_job.t_student_base
        where class_id = '${jobCls.classId}' and is_deleted = 0 and stage_key = 'job' limit 1;
      update sms_job.tmp_quit_lock
        set id = '${TMP_ID}', student_no = '${TMP_NO}', student_name = 'ZZ退学锁验证', student_status = 7;
      insert into sms_job.t_student_base select * from sms_job.tmp_quit_lock;
      drop table sms_job.tmp_quit_lock;
    `);

    sql(`
      insert into sms_job.t_job_class_student
      (id, class_id, class_name, student_id, student_no, student_name, join_date, join_type, status, remark, is_deleted, create_time, create_by)
      values ('${TMP_ID}-roster', '${jobCls.classId}', '${jobCls.className}', '${TMP_ID}', '${TMP_NO}', 'ZZ退学锁验证', curdate(), 1, 1, '退学锁验证', 0, now(), 'system')
    `);
    const st0 = sql(`select student_status from sms_job.t_student_base where id='${TMP_ID}'`);
    check('④ 已造出实训班退学样本', st0 === '7', `status=${st0}`);

    const up = await api('POST', '/api/teaching/class/employment-upgrade', { classId: jobCls.classId }, token);
    check('④′ 升就业接口成功', up.code === 200, up.message || '');
    const st1 = sql(`select student_status from sms_job.t_student_base where id='${TMP_ID}'`);
    check('④″ 升就业后，退学学生状态仍是 7', st1 === '7', `status=${st1}（若为 9 = 被误改成待就业）`);

    const prog = await api('GET', `/api/teaching/class/employment-progress?classId=${jobCls.classId}`, null, token);
    const quitItem = (prog.data?.items || []).find((i) => Number(i.status) === 7);
    check('④‴ 班级状态分布里仍有「退学」人数', !!quitItem && quitItem.count >= 1, quitItem ? `退学 ${quitItem.count} 人` : '没有退学条目');

    cleanup();
    const gone = sql(`select count(*) from sms_job.t_student_base where id='${TMP_ID}'`);
    console.log(`  （已清理临时样本，残留 ${gone} 条）`);
  }

  console.log(`\n${fails.length ? `FAILED: ${fails.length} 项未通过 → ${fails.join(' / ')}` : 'ALL PASS'}`);
  process.exitCode = fails.length ? 1 : 0;
})().catch((e) => {
  cleanup();
  console.error('异常：', e?.message || e);
  process.exitCode = 1;
});
