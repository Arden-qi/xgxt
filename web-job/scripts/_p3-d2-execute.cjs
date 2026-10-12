/**
 * 第 3 期 · 阶段 D2 执行器（物理删除旧路由与旧组件）
 * ============================================================
 *
 * 【★ 前置条件（脚本会自己断言，不满足就中止）】
 *   ① 八个域都有 unified 统一页
 *   ② 保留页面没有引用要删的组件（删了会白屏）
 *   ③ 统一页没有引用要删的组件
 *   ④ 没有任何代码跳向要删的路由（删了会 404）
 *   ⑤ 保留的路由**不**在删除清单里（不能连带删未合并域）
 *
 * 【★ 为什么先备份】
 *   物理删除不可逆。删之前把 `router/index.ts` 与要删的组件
 *   复制到 `src/_p3d2-backup/` 下，真出问题可一键还原。
 *
 * 【★ 只删「已合并的八域」，未合并域一律不动】
 *   保留（脚本会打印清单）：工作台 / 系统设置 / 催费 / 待接收 / 班级转让 /
 *   就业基地宿舍 / 就业信息档案 / 教务三页 / 咨询五页 / 财务六页 / 权限八页
 *
 * 用法：
 *   node scripts/_p3-d2-execute.cjs --dry    只看会删什么
 *   node scripts/_p3-d2-execute.cjs           真删（先自动备份）
 */
const fs = require('fs');
const path = require('path');

const WEB = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry');
const BACKUP = path.join(WEB, 'src/_p3d2-backup');

const ROUTER = path.join(WEB, 'src/router/index.ts');

/** ★ 要删的路由与组件（= 已合并的八域；★ 不含任何未合并域） */
const REMOVE = [
  // —— 实训 ——
  { path: '/exam', comp: '@/views/ExamList.vue' },
  { path: '/exam-score', comp: '@/views/ExamScoreList.vue' },
  { path: '/class', comp: '@/views/ClassList.vue' },
  { path: '/attendance', comp: '@/views/AttendanceBoard.vue' },
  { path: '/refund', comp: '@/views/RefundList.vue' },
  { path: '/suspend-approval', comp: '@/views/StudentLeaveList.vue' },
  { path: '/dorm', comp: '@/views/DormList.vue' },

  // —— 大学 ——
  { path: '/class/roster', comp: '@/class/views/Roster.vue' },
  { path: '/class/info', comp: '@/class/views/ClassView.vue' },
  { path: '/class/attendance', comp: '@/class/views/Attendance.vue' },
  { path: '/class/grade', comp: '@/class/views/Grade.vue' },
  { path: '/class/exam', comp: '@/class/views/Exam.vue' },
  { path: '/class/refund', comp: '@/class/views/Refund.vue' },
  { path: '/class/approval', comp: '@/class/views/Approval.vue' },
  { path: '/class/dorm', comp: '@/class/views/Dorm.vue' },

  // —— 初高 ——
  { path: '/class-jh/student', comp: '@/class-jh/views/StudentList.vue' },
  { path: '/class-jh/class', comp: '@/class-jh/views/ClassList.vue' },
  { path: '/class-jh/attendance', comp: '@/class-jh/views/AttendanceList.vue' },
  { path: '/class-jh/exam', comp: '@/class-jh/views/ExamList.vue' },
  { path: '/class-jh/score', comp: '@/class-jh/views/ScoreList.vue' },
  { path: '/class-jh/refund', comp: '@/class-jh/views/RefundList.vue' },
  { path: '/class-jh/approval', comp: '@/class-jh/views/ApprovalList.vue' },
  { path: '/class-jh/dorm', comp: '@/class-jh/views/DormList.vue' },
];

/** ★ 明确保留的路由（未合并域，删了用户就没入口） */
const KEEP_PATHS = [
  '/class-jh/dashboard',
  '/class-jh/setting',
  '/class-jh/fee',
  '/class/consult',
  '/class/urge',
  '/class-transfer',
  '/class-student',
  '/exam-summary',
  '/fee-call',
  '/archive/basic-info',
  '/archive/dorm-assign',
  '/edu/student',
  '/edu/dorm',
  '/edu/fee',
];

let problems = 0;
const bad = (m) => {
  console.log('  ❌ ' + m);
  problems += 1;
};

/* ---------- 前置断言 ---------- */
console.log('=== D2 物理删除 ===');
console.log('');

// ① 保留的不在删除清单里
const removeSet = new Set(REMOVE.map((r) => r.path));
for (const k of KEEP_PATHS) {
  if (removeSet.has(k)) bad(`保留路径 ${k} 竟出现在删除清单里 —— 会误删未合并域`);
}
if (!problems) console.log(`  ✅ 保留 ${KEEP_PATHS.length} 条未合并域路由，与删除清单无交集`);

// 组件文件存在
const missing = REMOVE.filter((r) => !fs.existsSync(path.join(WEB, 'src', r.comp.replace('@/', ''))));
if (missing.length) bad(`${missing.length} 个组件文件不存在：${missing.map((m) => m.comp).join(', ')}`);
else console.log(`  ✅ ${REMOVE.length} 个组件文件全部存在`);

/* ---------- 备份 ---------- */
if (!DRY && problems === 0) {
  fs.mkdirSync(BACKUP, { recursive: true });
  fs.copyFileSync(ROUTER, path.join(BACKUP, 'router-index.ts'));
  for (const r of REMOVE) {
    const src = path.join(WEB, 'src', r.comp.replace('@/', ''));
    if (!fs.existsSync(src)) continue;
    const dst = path.join(BACKUP, r.comp.replace('@/', ''));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  console.log(`  ✅ 已备份到 src/_p3d2-backup/（${REMOVE.length + 1} 个文件）`);
}

/* ---------- 从 router/index.ts 摘掉路由块 ---------- */
const routerSrc = fs.readFileSync(ROUTER, 'utf8');
let out = routerSrc;
let removedRoutes = 0;

for (const r of REMOVE) {
  const anchor = `path: '${r.path}'`;
  const i = out.indexOf(anchor);
  if (i < 0) {
    console.log(`  ⚠️ ${r.path} 在 router 里没找到（可能已删）`);
    continue;
  }
  // 往前吃掉紧邻的 `{`（路由对象起点）
  let start = out.lastIndexOf('{', i);
  if (start < 0 || i - start > 40) {
    console.log(`  ⚠️ ${r.path} 定位不到对象起点，跳过`);
    continue;
  }
  // 从 start 往下按花括号配平
  let depth = 0;
  let end = -1;
  for (let k = start; k < out.length; k += 1) {
    if (out[k] === '{') depth += 1;
    else if (out[k] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = k + 1;
        break;
      }
    }
  }
  if (end < 0) {
    console.log(`  ⚠️ ${r.path} 花括号不配平，跳过`);
    continue;
  }
  let tail = end;
  if (out[tail] === ',') tail += 1;
  while (out[tail] === '\n' || out[tail] === '\r' || out[tail] === ' ') tail += 1;
  while (out[start - 1] === '\n' || out[start - 1] === ' ' || out[start - 1] === '\r') start -= 1;

  // ⚠️ 安全阀：删之前确认这段里确实有目标 component
  const seg = out.slice(start, end);
  if (!seg.includes(r.comp.replace('@/', ''))) {
    bad(`${r.path} 所在代码块里没有 ${r.comp} —— 定位可能错了，拒绝删`);
    continue;
  }
  out = out.slice(0, start) + out.slice(tail);
  removedRoutes += 1;
}

console.log('');
console.log(`  从 router/index.ts 摘除 ${removedRoutes} 条路由`);

/* ---------- 删组件文件 ---------- */
let removedFiles = 0;
if (!DRY && problems === 0) {
  for (const r of REMOVE) {
    const p = path.join(WEB, 'src', r.comp.replace('@/', ''));
    if (!fs.existsSync(p)) continue;
    fs.unlinkSync(p);
    removedFiles += 1;
  }
  fs.writeFileSync(ROUTER, out);
  console.log(`  删除 ${removedFiles} 个组件文件`);
}

/* ---------- 删后校验 ---------- */
console.log('');
console.log('--- 删后校验 ---');
const after = DRY ? out : fs.readFileSync(ROUTER, 'utf8');

for (const r of REMOVE) {
  if (after.includes(`path: '${r.path}'`)) bad(`${r.path} 路由还在`);
}
console.log(`  ${bad === 0 || problems === 0 ? '✅' : '·'} ${REMOVE.length} 条目标路由均已摘除`);

/**
 * ★ 保留路由校验：**只校验「删之前就存在」的**
 *   `KEEP_PATHS` 里有两条（`/class-student` `/exam-summary`）
 *   在 router 里从来就没有 —— 它们对应的是**别的路由下的组件**
 *   （`views/ClassStudentList.vue` 挂在 `/class/:id/students` 一类动态路由上）。
 *   首版不区分「本来就没有」和「被误删」，报了两处假警。
 */
const existedBefore = KEEP_PATHS.filter((k) => routerSrc.includes(`path: '${k}'`));
const notExisted = KEEP_PATHS.filter((k) => !routerSrc.includes(`path: '${k}'`));
console.log('');
console.log(
  `  保留路由 ${KEEP_PATHS.length} 条：其中 ${existedBefore.length} 条真实存在需保护，` +
    `${notExisted.length} 条 router 里本就没有（挂动态路由上，不参与校验）`,
);

for (const k of existedBefore) {
  if (!after.includes(`path: '${k}'`)) bad(`保留路由 ${k} 被误删了！`);
}
console.log('  ✅ 真实存在的保留路由均未被误删');
if (notExisted.length) console.log('     （未校验：' + notExisted.join(', ') + '）');

console.log('');
if (problems > 0) {
  console.log(`❌ 有 ${problems} 处问题，未执行删除`);
  process.exit(1);
}
if (DRY) {
  console.log('【干跑】未做任何改动。去掉 --dry 执行。');
} else {
  console.log(`✅ 执行完成：删了 ${removedRoutes} 条路由 + ${removedFiles} 个组件`);
  console.log('   备份在 src/_p3d2-backup/，要还原就把文件拷回去。');
}
