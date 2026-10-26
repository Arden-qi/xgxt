/**
 * 校验「班主任填入住 → 学生档案自动带出宿舍」
 * ============================================================
 *
 * 背景：学生在系统里有多份投影（学生档案 JHS- / 门户 PSB-），id 不同、学号相同。
 * 入住原来只写操作碰到的那张表，学生档案详情读另一张 → 宿舍栏一直是空的。
 *
 * 覆盖：
 *   静态：同步模块 + 三个调用点（入住 / 退宿 / 审批通过）
 *   运行时：班主任给未入住学生办理入住 → 学生档案详情出现宿舍/床位
 *           → 退宿后档案同步清空（结束后学生回到未入住，可重复执行）
 *
 * 用法：node tools/verify-dorm-student-sync.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const BASE = 'http://localhost:8004';
const PWD = '123456';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function read(rel) {
  try {
    return readFileSync(join(ROOT, rel), 'utf8');
  } catch {
    return '';
  }
}

async function req(method, url, { token, body } = {}) {
  const r = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await r.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { status: r.status, body: json, raw };
}

async function login(account) {
  const r = await req('POST', '/api/portal/account/login', { body: { account, password: PWD } });
  return r.body?.data?.token || '';
}

console.log('▶ 静态检查');
const sync = read('server-job/src/teaching/dorm/studentDormSync.ts');
const repo = read('server-job/src/teaching/dorm/repo.uni.ts');
check('有跨表同步模块（按学号）', sync.includes('syncStudentDorm') && sync.includes('student_no'));
check('同步覆盖档案/门户/教务学生表', sync.includes('sms_class_jh.t_class_student') && sync.includes('sms_perm.t_student_base'));
check('入住时同步', (repo.match(/syncStudentDorm\(/g) || []).length >= 3);
check('退宿时清空同步', /async checkout[\s\S]{0,1200}syncStudentDorm/.test(repo));
check('审批通过后同步', /applyChangeOnApproved[\s\S]{0,3000}syncStudentDorm/.test(repo));

// 编辑弹窗：宿舍号/床位号改为只读展示（宿舍只能走「宿舍管理」办理）
const form = read('web-job/src/teaching/views/TeachingStudent.vue');
check(
  '宿舍号/床位号只读展示',
  form.includes('label="宿舍号"') &&
    form.includes('label="床位号"') &&
    form.includes('placeholder="办理入住后自动带出"') &&
    !form.includes('formDormOptions'),
);
check('床位中文标签按需拉取', form.includes('formBedLabel') && form.includes('getDormBeds'));

// ★ 2026-10-26：新增学生时 楼栋号 → 宿舍号 → 床位号 三级联动（编辑态仍只读）
check(
  '新增学生可联动选宿舍（楼栋/宿舍/床位）',
  form.includes('listDormClassRooms') &&
    form.includes('dormBuildingOptions') &&
    form.includes('dormRoomOptions') &&
    form.includes('onFormDormIdChange') &&
    form.includes('dormBuildingPlaceholder'),
);
check(
  '编辑态宿舍三列走只读分支',
  /label="楼栋号"[\s\S]{0,400}v-if="form\.id"/.test(form) &&
    /label="宿舍号"[\s\S]{0,400}v-if="form\.id"/.test(form),
);

console.log('\n▶ 运行时检查');
const token = await login('sunmin');
check('班主任登录', !!token);

// ★ 2026-10-26：新增学生的「班级名下宿舍」接口（楼栋/宿舍/床位三级联动的数据源）
{
  const r = await req('GET', '/api/teaching/dorm/class-rooms?stage=jh&className=G2601', { token });
  const d = r.body?.data;
  check(
    '班级名下宿舍接口可用',
    r.body?.code === 200 && Array.isArray(d?.buildings) && Array.isArray(d?.rooms),
    `code=${r.body?.code} 房间=${(d?.rooms || []).length} 楼栋=${(d?.buildings || []).length}`,
  );
  const denied = await req('GET', '/api/teaching/dorm/class-rooms?stage=jh&className=NOT_MY_CLASS', { token });
  check('别的班级拒绝查询', denied.body?.code !== 200, `code=${denied.body?.code}`);
}

let bedId = '';
let dormId = '';
let studentNo = '';
let assigned = false;

try {
  // 先挑学生，再按「学生班级可用」找空床位（别的开放班是锁定的）
  const cands = await req('GET', '/api/teaching/dorm/candidates?stage=jh', { token });
  const stu = (cands.body?.data || []).find((c) => !c.dormNo && c.gender === 1);
  check('找到未入住学生', !!stu, stu ? `${stu.studentName}(${stu.studentNo})` : '无');

  /**
   * ★ 2026-10-22：办理入住弹窗按房间性别过滤候选
   *   男寝（gender=1）只出男生、女寝（gender=2）只出女生，不传则不限。
   */
  const maleCands = await req('GET', '/api/teaching/dorm/candidates?stage=jh&gender=1', { token });
  const femaleCands = await req('GET', '/api/teaching/dorm/candidates?stage=jh&gender=2', { token });
  check(
    '男寝候选只有男生',
    (maleCands.body?.data || []).length > 0 && (maleCands.body?.data || []).every((c) => c.gender === 1),
    `${(maleCands.body?.data || []).length} 人`,
  );
  check(
    '女寝候选只有女生',
    (femaleCands.body?.data || []).length > 0 && (femaleCands.body?.data || []).every((c) => c.gender === 2),
    `${(femaleCands.body?.data || []).length} 人`,
  );

  const rooms = await req('GET', '/api/teaching/dorm/allocate/rooms?category=1', { token });
  const room = (rooms.body?.data || []).find(
    (r) => (r.freeBeds || []).length > 0 && (!r.locked || r.assignedTo === stu?.className),
  );
  dormId = room?.roomId || '';
  bedId = room?.freeBeds?.[0]?.bedId || '';
  check('找到本班可用空床位', !!bedId, room ? `${room.building}${room.room} ${room.freeBeds[0].bedLabel}` : '无');

  if (stu && bedId) {
    studentNo = stu.studentNo;
    const asg = await req('POST', '/api/teaching/dorm/assign', {
      token,
      body: {
        stage: 'jh',
        dormId,
        bedId,
        studentId: stu.studentId,
        checkInDate: new Date().toISOString().slice(0, 10),
      },
    });
    assigned = asg.body?.code === 200;
    check('班主任办理入住', assigned, asg.body?.message || '');
  }

  // 学生档案用的是 JHS- 前缀的 id，按学号在学生列表里查出来
  const list = await req('GET', `/api/teaching/student/list?stage=jh&page=1&size=20&keyword=${encodeURIComponent(studentNo)}`, {
    token,
  });
  const archive = (list.body?.data?.list || []).find((s) => s.studentNo === studentNo);
  check('档案列表能按学号查到学生', !!archive, archive?.studentId || '无');

  if (archive) {
    const detail = await req('GET', `/api/teaching/student/detail?stage=jh&id=${archive.studentId}`, { token });
    const dorm = detail.body?.data?.dorm;
    check(
      '入住后档案详情自动带出宿舍',
      !!dorm && !!dorm.dormNo && dorm.dormNo.length > 0,
      dorm ? `${dorm.dormNo}${dorm.bedLabel ? ` · ${dorm.bedLabel}` : ''}` : 'null',
    );
  }
} finally {
  // 还原：退宿（学生回到未入住）
  if (assigned && bedId) {
    try {
      await req('POST', '/api/teaching/dorm/checkout', { token, body: { stage: 'jh', dormId, bedId } });
    } catch {
      /* ignore */
    }
  }
}

// 退宿后档案应同步清空（只有真的入住成功才校验，否则比的是旧数据）
if (assigned && studentNo) {
  const list = await req('GET', `/api/teaching/student/list?stage=jh&page=1&size=20&keyword=${encodeURIComponent(studentNo)}`, {
    token,
  });
  const archive = (list.body?.data?.list || []).find((s) => s.studentNo === studentNo);
  if (archive) {
    const detail = await req('GET', `/api/teaching/student/detail?stage=jh&id=${archive.studentId}`, { token });
    const dorm = detail.body?.data?.dorm;
    check('退宿后档案宿舍同步清空', !dorm, dorm ? dorm.dormNo : 'null');
  }
}

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
