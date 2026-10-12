/**
 * 第 3 期 · 阶段 D2 执行清单（★ 斌哥 2026-10-09 拍板：只删已合并的八域页面）
 * ============================================================
 *
 * 【★ 为什么不一次性全删】
 *   `router/index.ts` 里 50+ 条路由混着两类东西：
 *     · 八域已合并 → 旧页面已被统一页取代，可以删
 *     · **不在八域里** → 工作台 / 系统设置 / 催费 / 待接收 / 班级转让 /
 *       就业基地宿舍 / 咨询 / 财务 / 教务 / 权限 —— 这些域本期没合并，
 *       删了用户就没入口了。
 *
 * 【★★ 下线前的硬前提 —— 阶段 A 是这次能安全下线的原因】
 *   统一页的「学段下拉」原来靠 `hasPage(旧路由)` 判权限。
 *   如果不是阶段 A 把它改成 `hasPerm(权限码)` 主判权，
 *   现在删掉这些路由 → **学段下拉会集体消失**。
 *
 *   阶段 A 保留了旧路由作为**兜底**（权限码判不出时用），
 *   所以删路由后仍有一层保险；等 D2 完成、观察期过了再把兜底也删掉。
 */

/** 要删的路由（八域已合并的 25 个页面） */
const ROUTES_TO_REMOVE = [
  // —— 实训（job） ——
  { path: '/exam', comp: '@/views/ExamList.vue', domain: '考试' },
  { path: '/exam-score', comp: '@/views/ExamScoreList.vue', domain: '成绩' },
  { path: '/class', comp: '@/views/ClassList.vue', domain: '班级' },
  { path: '/attendance', comp: '@/views/AttendanceBoard.vue', domain: '出勤' },
  { path: '/refund', comp: '@/views/RefundList.vue', domain: '退费' },
  { path: '/suspend-approval', comp: '@/views/StudentLeaveList.vue', domain: '审批' },
  { path: '/dorm', comp: '@/views/DormList.vue', domain: '宿舍' },

  // —— 大学（class） ——
  { path: '/class/roster', comp: '@/class/views/Roster.vue', domain: '学生档案' },
  { path: '/class/info', comp: '@/class/views/ClassView.vue', domain: '班级' },
  { path: '/class/attendance', comp: '@/class/views/Attendance.vue', domain: '出勤' },
  { path: '/class/grade', comp: '@/class/views/Grade.vue', domain: '成绩' },
  { path: '/class/exam', comp: '@/class/views/Exam.vue', domain: '考试' },
  { path: '/class/refund', comp: '@/class/views/Refund.vue', domain: '退费' },
  { path: '/class/approval', comp: '@/class/views/Approval.vue', domain: '审批' },
  { path: '/class/dorm', comp: '@/class/views/Dorm.vue', domain: '宿舍' },

  // —— 初高（class-jh） ——
  { path: '/class-jh/student', comp: '@/class-jh/views/StudentList.vue', domain: '学生档案' },
  { path: '/class-jh/class', comp: '@/class-jh/views/ClassList.vue', domain: '班级' },
  { path: '/class-jh/attendance', comp: '@/class-jh/views/AttendanceList.vue', domain: '出勤' },
  { path: '/class-jh/exam', comp: '@/class-jh/views/ExamList.vue', domain: '考试' },
  { path: '/class-jh/score', comp: '@/class-jh/views/ScoreList.vue', domain: '成绩' },
  { path: '/class-jh/refund', comp: '@/class-jh/views/RefundList.vue', domain: '退费' },
  { path: '/class-jh/approval', comp: '@/class-jh/views/ApprovalList.vue', domain: '审批' },
  { path: '/class-jh/dorm', comp: '@/class-jh/views/DormList.vue', domain: '宿舍' },
];

/** ★ 明确保留的（不在八域里，删了用户就没入口） */
const KEEP = [
  { path: '/class-jh/dashboard', why: '初高工作台' },
  { path: '/class-jh/setting', why: '初高系统设置' },
  { path: '/class-jh/fee', why: '初高催费管理（八域里没有催费）' },
  { path: '/class/consult', why: '大学待接收学员' },
  { path: '/class/urge', why: '大学催费管理' },
  { path: '/class-transfer', why: '班级管理（实训·转让，未合并）' },
  { path: '/class-student', why: '班级学生（未被 domainConfig 引用）' },
  { path: '/exam-summary', why: '考试汇总（未被 domainConfig 引用）' },
  { path: '/fee-call', why: '实训催费' },
  { path: '/archive/basic-info', why: '就业·信息档案' },
  { path: '/archive/dorm-assign', why: '就业基地宿舍' },
  { path: '/edu/student', why: '教务·学生档案' },
  { path: '/edu/dorm', why: '教务·宿舍管理' },
  { path: '/edu/fee', why: '教务·缴费管理' },
];

module.exports = { ROUTES_TO_REMOVE, KEEP };
