/**
 * ★ 教学管理 · 演示学生（含演示班级）补齐脚本 ★
 * ============================================================
 * 用法：
 *   node scripts/seed-teaching-students.mjs                # 三学段各 2 个班，每班 6 名学生
 *   node scripts/seed-teaching-students.mjs --dry          # 只看计划，不写库
 *   node scripts/seed-teaching-students.mjs --stage=jh     # 只补某个学段（可逗号分隔）
 *   node scripts/seed-teaching-students.mjs --per-class=8  # 每班学生数
 *   node scripts/seed-teaching-students.mjs --no-class     # 只补学生，不新建班级
 *
 * 【前置】后端要在 8004 跑着 —— 本脚本**走真实接口**（登录 → /teaching/class/save、
 *   /teaching/student/save），不直接写库。这样造出来的数据必然过得了接口校验：
 *   学号自动按「LZ+班级编号+序号」生成、阶段码能正确解析、学生档案详情页各区块齐全。
 *
 * 【它和 seed-teaching-demo.mjs 的分工】
 *   seed-teaching-demo.mjs  ：补出勤 / 考试 / 成绩 / 退费 / 休学退学 / 宿舍调宿
 *                             （依赖「已有班级和学生」，本脚本跑完再跑它最合适）
 *   本脚本                  ：补**班级 + 学生档案**本身，专治「教学管理打开是空的」
 *
 * 【为什么必须从班级开始造】
 *   P8 之后教学域老表全部下线，统一表 sms_common.t_uni_* 是唯一真源。
 *   学号生成规则是「LZ + 班级编号 + 班内序号」，**没有班级就没有学号**；
 *   而新建班级时「班级编号」是必填项（三部门跨库唯一）。
 *
 * ⚠️ 幂等：
 *   · 班级按「学段 + 班级名」判断，已存在就复用（编号为空时顺手补上）
 *   · 学生按「班级 + 姓名」判断，已存在就跳过 → 重复跑不会翻倍
 */

import { readFileSync } from 'node:fs';

const BASE = process.env.SEED_BASE || 'http://127.0.0.1:8004';
const ACCOUNT = process.env.SEED_ACCOUNT || 'qiansy';
const PASSWORD = process.env.SEED_PASSWORD || '123456';

/* ---------------- 参数 ---------------- */

const argv = process.argv.slice(2);
const has = (k) => argv.includes(`--${k}`);
const valOf = (k, def) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : def;
};

const DRY = has('dry');
const NO_CLASS = has('no-class');
const PER_CLASS = Math.max(1, Math.min(20, Number(valOf('per-class', 6)) || 6));
const STAGE_FILTER = String(valOf('stage', 'jh,class,emp'))
  .split(',')
  .map((s) => s.trim())
  .filter((s) => ['jh', 'class', 'emp'].includes(s));

const STAGE_NAME = { jh: '初高部', class: '大学部', emp: '就业部' };

let token = '';
const stat = [];
const say = (m) => {
  stat.push(m);
  console.log(m);
};

/* ---------------- 接口小工具 ---------------- */

async function api(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.code !== 200) {
    throw new Error(`${method} ${url} → ${json?.code ?? res.status} ${json?.message ?? ''}`);
  }
  return json.data;
}

const tryApi = async (method, url, body) => {
  try {
    return { ok: true, data: await api(method, url, body) };
  } catch (e) {
    return { ok: false, err: e.message };
  }
};

/* ---------------- 演示班级定义 ----------------
 * 班级编号（classCode）三部门跨库唯一，所以初高用 G/J、大学用 U、就业用 SX 开头，
 * 序号跟班级名对齐，学号就是 LZG2601001 / LZU2601001 这种一眼能认出来的形态。
 */

const CLASS_PLAN = {
  jh: [
    { name: 'G2601', code: 'G2601', phase: 102, deptCode: 1, openDate: '2026-09-01', note: '初中部 1 期' },
    { name: 'J2602', code: 'J2602', phase: 105, deptCode: 1, openDate: '2026-09-01', note: '高中部 1 期' },
  ],
  class: [
    { name: 'U2601', code: 'U2601', phase: 201, deptCode: 2, openDate: '2026-09-01', note: '一阶段' },
    { name: 'U2602', code: 'U2602', phase: 203, deptCode: 2, openDate: '2026-09-08', note: '三阶段' },
  ],
  emp: [
    { name: 'SX2601', code: 'SX2601', phase: null, deptCode: 3, openDate: '2026-09-15', note: '实训 1 期' },
    { name: 'SX2602', code: 'SX2602', phase: null, deptCode: 3, openDate: '2026-09-22', note: '实训 2 期' },
  ],
};

/* ---------------- 姓名池 ----------------
 * 每个班从池子里按固定步长切片，保证：同一学段内不重名、重跑结果完全一致。
 */

const NAME_POOL = {
  jh: [
    '孙浩然', '周梓涵', '马思远', '郑雅琪', '何俊熙', '冯欣怡', '许博文', '曹雨轩',
    '严子墨', '华思彤', '金泽宇', '陶雨欣', '姜宇航', '戚梦瑶', '谢子豪', '章可欣',
  ],
  class: [
    '林嘉豪', '苏梦洁', '何子豪', '唐诗雨', '邓宇航', '蒋雨萌', '范志强', '彭思佳',
    '董家豪', '傅静怡', '秦子健', '尤佳慧', '邵文轩', '万若涵', '鲍俊杰', '毛雨菲',
  ],
  emp: [
    '程一鸣', '袁小晴', '傅文杰', '钟雨桐', '石俊豪', '贺佳宁', '汪晓东', '崔嘉美',
    '殷浩然', '廖思远', '邹梦琪', '熊俊峰', '孟雅婷', '徐子昂', '龙嘉豪', '孔晓曼',
  ],
};

/** 家长名（姓 + 常见辈分名），与孩子同姓，看着像一家人 */
const PARENT_GIVEN = ['建国', '秀兰', '国强', '桂英', '志远', '丽华', '海涛', '玉梅'];

/* ---------------- 人口学素材 ---------------- */

/** 身份证前 6 位（省市 + 区县），配 <籍贯> 用 */
const REGIONS = [
  { code: '130102', place: '河北石家庄', school: ['石家庄市第23中学', '石家庄市第二中学'] },
  { code: '410105', place: '河南郑州', school: ['郑州市第一中学', '郑州市外国语中学'] },
  { code: '320102', place: '江苏南京', school: ['南京市第十三中学', '南京师范大学附属中学'] },
  { code: '370102', place: '山东济南', school: ['济南市历城第二中学', '山东省实验中学'] },
  { code: '510107', place: '四川成都', school: ['成都市第七中学', '成都市树德中学'] },
  { code: '420106', place: '湖北武汉', school: ['华中师范大学第一附属中学', '武汉市第二中学'] },
  { code: '610113', place: '陕西西安', school: ['西安高新第一中学', '西安市铁一中学'] },
  { code: '440305', place: '广东深圳', school: ['深圳中学', '深圳市福田中学'] },
];

/** 大学 / 就业部的院校池（跟籍贯错开搭配，看起来更像真人） */
const COLLEGES = [
  '郑州铁路职业技术学院', '南京信息职业技术学院', '山东商业职业技术学院',
  '成都航空职业技术学院', '武汉软件工程职业学院', '西安航空职业技术学院',
  '深圳职业技术大学', '河北工业职业技术学院', '江苏经贸职业技术学院',
];

const ADDRESS_CITY = {
  河北石家庄: '河北省石家庄市长安区中山东路',
  河南郑州: '河南省郑州市金水区花园路',
  江苏南京: '江苏省南京市玄武区长江路',
  山东济南: '山东省济南市历下区经十路',
  四川成都: '四川省成都市武侯区人民南路',
  湖北武汉: '湖北省武汉市洪山区珞喻路',
  陕西西安: '陕西省西安市雁塔区长安南路',
  广东深圳: '广东省深圳市南山区科技园路',
};

/** 招生 / 咨询老师（演示用固定名单，跟账号无关，纯展示） */
const TEACHER_POOL = [
  { name: '王丽娟', phone: '13801380011' },
  { name: '李建军', phone: '13801380022' },
  { name: '张春霞', phone: '13801380033' },
  { name: '陈志刚', phone: '13801380044' },
];

/* ---------------- 小工具 ---------------- */

const pad = (n, w = 2) => String(n).padStart(w, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 稳定伪随机（同一 seed 每次跑结果一致，便于复跑对照） */
let seedN = 20261022;
function rnd() {
  seedN = (seedN * 1103515245 + 12345) % 2147483648;
  return seedN / 2147483648;
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (min, max) => min + Math.floor(rnd() * (max - min + 1));

/** 18 位身份证号（含 GB 11643 校验位）——格式合法，详情页不会显示成乱码 */
function makeIdCard(regionCode, birth, seq) {
  const body = `${regionCode}${birth.replace(/-/g, '')}${pad(seq, 3)}`;
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const check = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  let sum = 0;
  for (let i = 0; i < 17; i += 1) sum += Number(body[i]) * w[i];
  return body + check[sum % 11];
}

/** 按年龄倒推一个生日（今年已经过完生日，保证 age 计算值 == 目标年龄） */
function birthdayOf(age) {
  const now = new Date();
  const d = new Date(now.getFullYear() - age, int(0, now.getMonth()), int(1, 28));
  return ymd(d);
}

/* ---------------- 业务：班级 ---------------- */

async function classesOf(stage) {
  const d = await api('GET', `/api/teaching/class/list?stage=${stage}&page=1&size=200`);
  return d.list || [];
}

/**
 * 确保演示班级存在
 * @returns 班级行（含 classId / className / classCode）
 */
async function ensureClass(stage, def) {
  const all = await classesOf(stage);
  const hit = all.find((c) => String(c.className || '').trim() === def.name);

  if (hit && String(hit.classCode || '').trim()) {
    // 演示班级顺手把开班日期补齐（列表里空着不好看，也不影响接口校验）
    if (def.openDate && !hit.openDate) {
      if (DRY) {
        say(`    · 班级「${def.name}」缺开班日期，将补为 ${def.openDate}`);
      } else {
        const r = await tryApi('POST', '/api/teaching/class/save', {
          stage,
          id: hit.classId,
          className: hit.className,
          classCode: hit.classCode,
          openDate: def.openDate,
        });
        if (r.ok) say(`    · 班级「${def.name}」补上开班日期 ${def.openDate}`);
      }
    }
    return hit;
  }

  if (hit && !hit.classCode) {
    // 历史班缺编号 → 学号生成会失败，顺手补上
    if (DRY) {
      say(`    · 班级「${def.name}」缺班级编号，将补为 ${def.code}`);
      return hit;
    }
    const r = await tryApi('POST', '/api/teaching/class/save', {
      stage,
      id: hit.classId,
      className: hit.className,
      classCode: def.code,
      deptCode: def.deptCode,
      phaseCode: def.phase ?? undefined,
      openDate: def.openDate,
      classStatus: 1,
    });
    if (!r.ok) {
      say(`    ⚠️ 班级「${def.name}」补编号失败：${r.err}`);
      return hit;
    }
    say(`    · 班级「${def.name}」补上班级编号 ${def.code}`);
    const again = await classesOf(stage);
    return again.find((c) => c.classId === hit.classId) || hit;
  }

  if (NO_CLASS) {
    say(`    · 班级「${def.name}」不存在（--no-class 未新建，跳过）`);
    return null;
  }

  if (DRY) {
    say(`    · 将新建班级「${def.name}」（编号 ${def.code}，${def.note}）`);
    return { classId: null, className: def.name, classCode: def.code };
  }

  const r = await tryApi('POST', '/api/teaching/class/save', {
    stage,
    className: def.name,
    classCode: def.code,
    deptCode: def.deptCode,
    phaseCode: def.phase ?? undefined,
    openDate: def.openDate, // 就业部（job/emp）开班日期必填
    classStatus: 1, // 开放：能收学生，演示时各种入口都可点
    remark: '演示数据',
  });
  if (!r.ok) {
    say(`    ⚠️ 班级「${def.name}」创建失败：${r.err}`);
    return null;
  }
  say(`    · 新建班级「${def.name}」（编号 ${def.code}，${def.note}）`);
  return { classId: r.data?.id, className: def.name, classCode: def.code };
}

/* ---------------- 业务：学生 ---------------- */

async function studentsOfClass(stage, classId) {
  if (!classId) return [];
  const d = await api('GET', `/api/teaching/student/list?stage=${stage}&classId=${classId}&page=1&size=200`);
  return d.list || [];
}

/**
 * 每个学段的学生状态轮换表
 *   3 试学中 / 4 预在读（仅初高）/ 5 正式在读 / 6 休学 / 7 退学 / 9 待就业
 *   ⚠️ 8 实训中 / 10 已就业是**系统态**，只能由「升实训 / 已就业」按钮写入，
 *      这里不直接造，避免和状态机打架。
 */
const STATUS_PLAN = {
  jh: [5, 5, 5, 3, 4, 7, 5, 3, 5, 5],
  class: [5, 5, 5, 3, 6, 5, 5, 3, 5, 5],
  emp: [9, 9, 9, 9, 9, 9, 9, 9, 9, 9],
};

const AGE_RANGE = { jh: [14, 17], class: [18, 21], emp: [20, 24] };

/** 初高学历跟阶段走：101~104 初中部、105~107 高中部 */
const JH_EDU = { 101: '初中', 102: '初中', 103: '初中', 104: '初中', 105: '高中', 106: '高中', 107: '高中' };

/** 造一个学生的请求体（字段尽量填满，详情页各区块才不空） */
function buildStudent(stage, cls, def, name, idx, gseq) {
  const status = STATUS_PLAN[stage][idx % STATUS_PLAN[stage].length];
  const [ageMin, ageMax] = AGE_RANGE[stage];
  const age = ageMin + ((idx * 2 + name.length) % (ageMax - ageMin + 1));
  const birth = birthdayOf(age);
  const region = REGIONS[(idx * 3 + name.length) % REGIONS.length];
  const idCard = makeIdCard(region.code, birth, 100 + idx * 7);
  const surname = name[0];
  const parentName = surname + PARENT_GIVEN[(idx + name.length) % PARENT_GIVEN.length];
  const teacher = TEACHER_POOL[idx % TEACHER_POOL.length];
  const consult = TEACHER_POOL[(idx + 2) % TEACHER_POOL.length];
  const isEmp = stage === 'emp';

  /* 手机号必须是 11 位（3 + 4 + 4）：中间 4 位用全局序号错开，
     后 4 位用「班级序号 + 学生序号」，保证整批数据互不重复 */
  const phone = `138${pad(1200 + gseq, 4)}${pad(idx * 10 + (gseq % 9), 4)}`;
  const parentPhone = `139${pad(5200 + gseq, 4)}${pad(idx * 10 + (gseq % 7), 4)}`;

  const body = {
    stage,
    studentName: name,
    gender: idx % 2 === 0 ? 1 : 2,
    birthDate: birth,
    nativePlace: region.place,
    deptCode: def.deptCode,
    classId: cls.classId,
    className: cls.className,
    studentStatus: status,
    // 籍贯/学历/院校按学段差异化：初高是中学，大学/就业是职业院校
    education: isEmp ? (idx % 2 === 0 ? '大专' : '本科') : stage === 'jh' ? JH_EDU[def.phase] || '初中' : '高中',
    graduateSchool: isEmp || stage === 'class'
      ? COLLEGES[(idx * 2 + name.length) % COLLEGES.length]
      : pick(region.school),
    enrollDate: `2026-09-${pad(1 + ((idx * 3) % 10))}`,
    phone,
    parentName,
    parentPhone,
    homeAddress: `${ADDRESS_CITY[region.place] || '北京市朝阳区建国路'}${int(1, 300)}号`,
    idCard,
    recruitTeacherName: teacher.name,
    recruitTeacherPhone: teacher.phone,
    consultTeacherName: consult.name,
    consultTeacherPhone: consult.phone,
    remark: `2026 秋季入学 · 演示数据（${def.note}）`,
  };

  // 阶段码只有初高/大学有；就业部没有阶段，传了反而会写进 stage_code
  if (def.phase) {
    body.phaseCode = def.phase;
    // 档案里的阶段跟着班级走：班级变了学生阶段也要变，演示数据保持一致
  }
  return body;
}

/* ---------------- 主流程 ---------------- */

(async () => {
  console.log(`\n=== 教学管理 · 演示学生补齐 ${DRY ? '（预演，不写库）' : ''} ===\n`);

  try {
    const login = await api('POST', '/api/portal/account/login', {
      account: ACCOUNT,
      password: PASSWORD,
    });
    token = login.token;
  } catch (e) {
    console.error(`${e.message}\n（请先确认后端在 ${BASE} 跑着）`);
    process.exit(1);
  }
  console.log(`已登录：${ACCOUNT}　每班 ${PER_CLASS} 人　学段：${STAGE_FILTER.map((s) => STAGE_NAME[s]).join(' / ')}\n`);

  let totalClass = 0;
  let totalStudent = 0;
  let totalSkip = 0;
  let gseq = 0; // 全局序号：手机号/身份证后几位靠它错开，保证整批不重号

  for (const stage of STAGE_FILTER) {
    console.log(`【${STAGE_NAME[stage]}】`);
    const plans = CLASS_PLAN[stage];
    const pool = NAME_POOL[stage];

    for (let ci = 0; ci < plans.length; ci += 1) {
      const def = plans[ci];
      const cls = await ensureClass(stage, def);
      if (!cls) continue;
      if (cls.classId) totalClass += 1;

      const existed = await studentsOfClass(stage, cls.classId);
      const existedNames = new Set(existed.map((s) => String(s.studentName)));
      const need = Math.max(0, PER_CLASS);
      let created = 0;

      for (let i = 0; i < need; i += 1) {
        // 每个班从姓名池切片，避免同班/同学段重名
        const name = pool[(ci * PER_CLASS + i) % pool.length];
        if (existedNames.has(name)) {
          totalSkip += 1;
          gseq += 1;
          continue;
        }
        gseq += 1;
        const body = buildStudent(stage, cls, def, name, i, gseq);

        if (DRY) {
          created += 1;
          continue;
        }
        const r = await tryApi('POST', '/api/teaching/student/save', body);
        if (r.ok) {
          created += 1;
        } else {
          say(`    ⚠️ 学生「${name}」跳过：${r.err}`);
        }
      }

      totalStudent += created;
      const tail = existed.length ? `（原有 ${existed.length} 人）` : '';
      say(`  ✓ ${def.name}：新增学生 ${created} 人${tail}`);
    }
  }

  /* ---- 就业部的「班级花名册」同步 ----
   * 初高 / 大学班级详情的花名册是直接按 class_id 查学生表的，学生造完就能看到；
   * 就业部（job/emp）不同：班级人数与花名册读的是**关系表**，
   * 而这张表只有「升实训 / 接收学员」流程会写，没有对外接口。
   * → 这里直连库把「学生档案已归班」的人补进花名册，否则班级列表人数是 0、
   *   点进班级详情花名册为空，演示时像坏了。幂等：按（班级, 学生）判重。 */
  if (!DRY && STAGE_FILTER.includes('emp')) {
    const n = await syncJobRoster();
    if (n !== null) say(`  ✓ 就业部花名册：补入 ${n} 条（已存在的不重复写）`);
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  完成：班级 ${totalClass} 个 · 新增学生 ${totalStudent} 人 · 已存在跳过 ${totalSkip} 条`);
  console.log(`${'═'.repeat(50)}`);
  console.log('（打开「教学管理 → 学生档案 / 班级管理」核对；重复执行不会造重复数据）\n');
})().catch((e) => {
  console.error('\n脚本异常：', e.message);
  process.exit(1);
});

/* ---------------- 就业部花名册同步（直连库） ---------------- */

/** 读 server-job/.env 里的数据库配置（避免为了一个字段引入 dotenv 依赖的路径问题） */
function readDbConfig() {
  const envPath = new URL('../.env', import.meta.url);
  let text = '';
  try {
    text = readFileSync(envPath, 'utf8');
  } catch {
    return null;
  }
  const get = (k) => {
    const m = text.match(new RegExp(`^${k}\\s*=\\s*(.*)$`, 'm'));
    return m ? m[1].trim() : '';
  };
  return {
    host: get('DB_HOST') || 'localhost',
    port: Number(get('DB_PORT') || 3306),
    user: get('DB_USER') || 'root',
    password: get('DB_PASSWORD') || '',
    database: get('DB_NAME_COMMON') || 'sms_common',
  };
}

/**
 * 把「学生档案里已归到就业部班级」的学生补进花名册表
 * @returns 补入条数；连不上库时返回 null（只提示，不影响已造好的学生数据）
 */
async function syncJobRoster() {
  const cfg = readDbConfig();
  if (!cfg) {
    say('    ⚠️ 读不到 .env 数据库配置，跳过就业部花名册同步');
    return null;
  }
  let conn;
  try {
    const mysql = await import('mysql2/promise');
    conn = await mysql.createConnection({ ...cfg, charset: 'utf8mb4', timezone: '+08:00' });

    const [rows] = await conn.query(
      `select id, edu_stage, stage_code, class_id, class_name, student_no, student_name
         from t_uni_student
        where edu_stage in ('job','emp') and is_deleted = 0 and class_id is not null and class_id <> ''`,
    );

    /* 就业部班级没有「阶段」口径（meta 的 phaseOptions 为空），
       但班级表 stage_code 列默认值 1 → 列表上会显示成「一阶段」。
       这里统一清成 NULL，让「阶段」列如实显示「—」。 */
    await conn.query(
      `update t_uni_class set stage_code = null where edu_stage in ('job','emp') and stage_code = 1`,
    );

    if (!rows.length) return 0;

    let added = 0;
    for (const r of rows) {
      const [dup] = await conn.query(
        'select id from t_uni_class_student where class_id = ? and student_id = ? limit 1',
        [r.class_id, r.id],
      );
      if (dup.length) continue;
      await conn.query(
        `insert into t_uni_class_student
           (id, edu_stage, stage_code, class_id, class_name, student_id, student_no, student_name,
            join_date, join_type, status, remark, is_deleted, create_by, create_time, update_by, update_time)
         values (uuid(), ?, ?, ?, ?, ?, ?, ?, curdate(), 1, 1, '演示数据入班', 0, 'seed', now(), 'seed', now())`,
        [r.edu_stage, r.stage_code, r.class_id, r.class_name, r.id, r.student_no, r.student_name],
      );
      added += 1;
    }
    return added;
  } catch (e) {
    say(`    ⚠️ 就业部花名册同步失败：${e.message}`);
    return null;
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}
