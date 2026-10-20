/**
 * 板块 → 页面 台账注册表（单一事实来源）
 *
 * ============================================================
 * 【这份表是什么】
 *   全系统「每个板块里有哪些页面」的清单，供两处使用：
 *     ① `scripts/seed-perm-pages.ts`（`npm run seed:perm-pages`）—— 建表/补数据时按它灌 `sms_perm.t_perm_page`
 *     ② 运行时兜底：`services/page.service.ts` 首次访问时按它补齐新增页面
 *   页面管理页（/perm/page）的勾选结果落在库里那一列 `enabled` 上，
 *   本文件只声明「有哪些页面可选」，不决定「开没开」。
 *
 * 【数据从哪来（改的时候两边一起改）】
 *   · 新模块 consult / finance / perm
 *       → `shared-types/src/portal/portal.ts` 的 `MODULES.menus`
 *   · legacy 模块 job / edu / class / class-jh
 *       → `web-job/src/config/menu.ts` 的 `MENU`（path + pageCode）
 *   · 路由真实性以 `web-job/src/router/index.ts` 为准
 *   三处任何一处加/删页面，本文件都要同步，否则页面管理里会
 *   列出不存在、或漏掉新加的页面。
 *
 * ⚠️ 2026-10-06 汇总口径：《系统板块与页面总览.md》第 3.1~3.8 节（共 7 板块 56 页）。
 * ⚠️ 不收录「已注册但无菜单入口的详情页」（成绩汇总 / 班级花名册 / 复盘信息 /
 *    就业日志记录 4 个）—— 它们是列表页点进去的子页，不是板块里的独立菜单，
 *    去勾后会让父页面点不动。它们跟着各自的父页面走。
 * ============================================================
 */

export interface RegistryPage {
  /** 页面 key：新模块 = menuKey；legacy 模块 = 权限码中段（与 menu.ts 的 pageCode 对应） */
  key: string;
  /** 页面标题（侧栏显示名） */
  title: string;
  /** 路由 path（台账的自然主键，全系统唯一） */
  path: string;
  /** legacy 模块的页面权限码；新模块留空 */
  pageCode?: string;
  /** 锁定：不允许取消勾选（用于防止把自己锁在门外） */
  locked?: boolean;
  /** 一句话说明（页面管理列表的副标题） */
  remark?: string;
}

export interface RegistryBoard {
  /** 板块 key（= 门户模块 key） */
  moduleKey: string;
  /** 板块名（页面管理左栏显示） */
  moduleName: string;
  /** 板块图标（emoji） */
  moduleIcon: string;
  /** 板块说明 */
  moduleDesc: string;
  /** 是否 legacy 模块（页面清单原本来自 config/menu.ts） */
  legacy: boolean;
  /** 板块排序 */
  sortNo: number;
  /** 页面明细（顺序 = 侧栏顺序） */
  pages: RegistryPage[];
}

/* ============================================================
 * 1. 市场咨询（原 01-王寒逸-consult · 8001）
 * ============================================================ */
const CONSULT: RegistryBoard = {
  moduleKey: 'consult',
  moduleName: '市场咨询',
  moduleIcon: '📣',
  moduleDesc: '学生 · 缴费 · 审批 · 退费 · 流失',
  legacy: false,
  sortNo: 1,
  pages: [
    { key: 'student', title: '学生管理', path: '/consult/student', remark: '咨询学生名单、跟进记录' },
    { key: 'fee', title: '收款与缴费', path: '/consult/fee', remark: '咨询端收款（学费 / 试学费）' },
    { key: 'approve', title: '审批中心', path: '/consult/approve', remark: '待办事项、审批流转' },
    { key: 'refund', title: '退费管理', path: '/consult/refund', remark: '退费申请与查看' },
    { key: 'loss', title: '流失记录', path: '/consult/loss', remark: '流失学生登记' },
  ],
};

/* ============================================================
 * 2. 财务管理（原 05-周铭-finance · 8005）
 * ============================================================ */
const FINANCE: RegistryBoard = {
  moduleKey: 'finance',
  moduleName: '财务管理',
  moduleIcon: '💰',
  moduleDesc: '概览 · 缴费 · 退费 · 冻结 · 账单 · 标准',
  legacy: false,
  sortNo: 2,
  pages: [
    // ⚠️ path 必须是 /finance/overview（真实路由），不是 portal.ts 里那个历史笔误 /finance
    { key: 'finance', title: '财务概览', path: '/finance/overview', remark: '收支总览、KPI' },
    { key: 'fee', title: '缴费管理', path: '/finance/fee', remark: '缴费总记录、到期预警、凭证 OCR' },
    { key: 'refund', title: '退费管理', path: '/finance/refund', remark: '退费审批与执行' },
    { key: 'freeze', title: '冻结名单', path: '/finance/freeze', remark: '批量冻结 / 解冻' },
    { key: 'bill', title: '账单明细', path: '/finance/bill', remark: '逐笔账单流水' },
    { key: 'standard', title: '费用标准', path: '/finance/standard', remark: '各类型费用标准配置' },
  ],
};

/* ============================================================
 * 3. 权限管理（原 06-林晓-perm · 8006）
 * ============================================================ */
const PERM: RegistryBoard = {
  moduleKey: 'perm',
  moduleName: '权限管理',
  moduleIcon: '🔐',
  moduleDesc: '部门 · 职位 · 账号 · 授权 · 页面 · 日志',
  legacy: false,
  sortNo: 3,
  pages: [
    { key: 'overview', title: '权限总览', path: '/perm/overview', remark: '权限体系总览、最近操作动态' },
    { key: 'dept', title: '部门管理', path: '/perm/dept', remark: '组织架构 / 部门两级树' },
    { key: 'role', title: '职位管理', path: '/perm/role', remark: '14 个内置职位 + 自建职位' },
    { key: 'user', title: '账号管理', path: '/perm/user', remark: '全系统账号维护（唯一入口）' },
    { key: 'assign', title: '职位权限分配', path: '/perm/assign', remark: '职位 → 功能点/动作授权' },
    {
      key: 'page',
      title: '页面管理',
      path: '/perm/page',
      /* ★ 本页自己也在台账里 —— 但 locked=true：
       *   它是唯一能改台账的入口，去勾后会把自己锁死（谁都进不来、也没法再改回来）。 */
      locked: true,
      remark: '板块 → 页面 台账：打勾即该板块有此页面（本页不可取消）',
    },
    { key: 'log', title: '操作日志', path: '/perm/log', remark: '权限变更与操作留痕' },
  ],
};

/* ============================================================
 * 4. 就业管理（实训 9 + 就业 5）
 * ============================================================ */
const JOB: RegistryBoard = {
  moduleKey: 'job',
  moduleName: '就业管理',
  moduleIcon: '💼',
  moduleDesc: '实训阶段 9 页 + 就业阶段 5 页',
  legacy: true,
  sortNo: 4,
  pages: [
    /* ---- 实训阶段 ---- */
    {
      key: 'class',
      title: '班级信息管理',
      path: '/class',
      pageCode: 'job:class:view',
      remark: '实训班级主档 + 花名册、结业转就业',
    },
    {
      key: 'classTransfer',
      title: '班级管理',
      path: '/class-transfer',
      pageCode: 'job:classTransfer:view',
      remark: '换班交接：整班换负责人并留快照',
    },
    {
      key: 'attendance',
      title: '出勤管理',
      path: '/attendance',
      pageCode: 'job:attendance:view',
      remark: '登记各班每日出勤，自动算出勤率',
    },
    {
      key: 'examScore',
      title: '成绩管理',
      path: '/exam-score',
      pageCode: 'job:examScore:view',
      remark: '卷面/机试/面试两次加权算综合成绩',
    },
    { key: 'exam', title: '考试管理', path: '/exam', pageCode: 'job:exam:view', remark: '考试排期与成绩表管理' },
    {
      key: 'feeCall',
      title: '催费管理',
      path: '/fee-call',
      pageCode: 'job:feeCall:view',
      remark: '住宿费/保险费/餐费催缴，只催办不收款',
    },
    {
      key: 'refund',
      title: '退费申请',
      path: '/refund',
      pageCode: 'job:refund:view',
      remark: '班主任发起 → 学管 → 校长 → 财务执行',
    },
    {
      key: 'suspendApproval',
      title: '休学/退学/复学审批',
      path: '/suspend-approval',
      pageCode: 'job:suspendApproval:view',
      remark: '通过后改学籍状态 + 花名册进出班 + 通知财务',
    },
    {
      key: 'dorm',
      title: '宿舍管理',
      path: '/dorm',
      pageCode: 'job:dorm:view',
      remark: '实训基地宿舍：床位分配 + 调换/退宿申请',
    },
    /* ---- 就业阶段 ---- */
    {
      key: 'empArchive',
      title: '信息档案',
      path: '/archive/basic-info',
      pageCode: 'job:empArchive:view',
      remark: '就业阶段学生名单，待就业可「确认就业」',
    },
    {
      key: 'employmentLog',
      title: '就业日志',
      path: '/employment-log',
      pageCode: 'job:employmentLog:view',
      remark: '简历投递、面试邀约、场次与结果',
    },
    {
      key: 'review',
      title: '复盘填写',
      path: '/review-write',
      pageCode: 'job:review:view',
      remark: '面试复盘 + 录音；已发 offer 锁定复盘结论',
    },
    {
      key: 'statistics',
      title: '数据统计',
      path: '/statistics',
      pageCode: 'job:statistics:view',
      remark: '就业率 / offer 数 / 人均投递 + KPI 达成',
    },
    {
      key: 'empDorm',
      title: '就业基地宿舍',
      path: '/archive/dorm-assign',
      pageCode: 'job:empDorm:view',
      remark: '就业基地宿舍，直接分配不走审批',
    },
  ],
};

/* ============================================================
 * 5. 教务管理
 * ============================================================ */
const EDU: RegistryBoard = {
  moduleKey: 'edu',
  moduleName: '教务管理',
  moduleIcon: '📚',
  moduleDesc: '学生档案 · 宿舍 · 缴费',
  legacy: true,
  sortNo: 5,
  pages: [
    {
      key: 'student',
      title: '学生档案',
      path: '/edu/student',
      pageCode: 'edu:student:view',
      remark: '全校学生档案、Excel 导入；改状态连带冻结缴费记录',
    },
    {
      key: 'dorm',
      title: '宿舍管理',
      path: '/edu/dorm',
      pageCode: 'edu:dorm:view',
      remark: '宿舍总名单 + 分派 + 调换/退宿审批 + 导出',
    },
    {
      key: 'fee',
      title: '缴费管理',
      path: '/edu/fee',
      pageCode: 'edu:fee:view',
      remark: '缴费总记录 + 到期预警 + 凭证 OCR + 批量冻结',
    },
  ],
};

/* ============================================================
 * 6. 班级管理 · 大学部（库 sms_class）
 * ============================================================ */
const CLASS: RegistryBoard = {
  moduleKey: 'class',
  moduleName: '班级管理（大学部）',
  moduleIcon: '🗂️',
  moduleDesc: 'Q1~Q6 阶段 · 花名册/出勤/成绩/考试/催费',
  legacy: true,
  sortNo: 6,
  pages: [
    {
      key: 'student',
      title: '班级信息管理',
      path: '/class/roster',
      pageCode: 'class:student:view',
      remark: '学员花名册、学员详情、升实训交接入口',
    },
    {
      key: 'info',
      title: '班级管理',
      path: '/class/info',
      pageCode: 'class:info:view',
      remark: '建/改/删班、阶段推进、交接班、班主任分配',
    },
    {
      key: 'consult',
      title: '待接收学员',
      path: '/class/consult',
      pageCode: 'class:consult:view',
      remark: '咨询端推来的待接收学员：接收 / 拒绝',
    },
    {
      key: 'attendance',
      title: '出勤管理',
      path: '/class/attendance',
      pageCode: 'class:attendance:view',
      remark: '学员出勤打卡与统计（班级侧）',
    },
    {
      key: 'grade',
      title: '成绩管理',
      path: '/class/grade',
      pageCode: 'class:grade:view',
      remark: '成绩录入与 Excel 批量导入',
    },
    {
      key: 'exam',
      title: '考试管理',
      path: '/class/exam',
      pageCode: 'class:exam:view',
      remark: '考试安排与末班判定；读满第六阶段可「升实训」',
    },
    {
      key: 'urge',
      title: '催费管理',
      path: '/class/urge',
      pageCode: 'class:urge:view',
      remark: '催费发起与催缴记录',
    },
    { key: 'refund', title: '退费', path: '/class/refund', pageCode: 'class:refund:view', remark: '退费申请与审批' },
    {
      key: 'suspend',
      title: '休学/退学审批',
      path: '/class/approval',
      pageCode: 'class:suspend:view',
      remark: '休学/退学/复学审批 + 升实训交接记录',
    },
    {
      key: 'dorm',
      title: '宿舍管理',
      path: '/class/dorm',
      pageCode: 'class:dorm:view',
      remark: '床位分配、换宿/退宿申请（审批在教务）',
    },
  ],
};

/* ============================================================
 * 7. 教学管理 · 初高（库 sms_class_jh）
 * ============================================================ */
const CLASS_JH: RegistryBoard = {
  moduleKey: 'class-jh',
  moduleName: '教学管理（初高）',
  moduleIcon: '🎓',
  moduleDesc: '初高中部（J/G 班）· 与大学部班级管理是两套模块',
  legacy: true,
  sortNo: 7,
  pages: [
    {
      key: 'dashboard',
      title: '工作台',
      path: '/class-jh/dashboard',
      pageCode: 'classjh:dashboard:view',
      remark: '在读人数、今日出勤率、临期缴费与待办',
    },
    {
      key: 'student',
      title: '基础数据',
      path: '/class-jh/student',
      pageCode: 'classjh:student:view',
      remark: '学生主档与学籍状态 + 7 页签详情',
    },
    {
      key: 'classInfo',
      title: '班级管理',
      path: '/class-jh/class',
      pageCode: 'classjh:classInfo:view',
      remark: '班级生命周期、师资交接、学期管理',
    },
    {
      key: 'attendance',
      title: '出勤管理',
      path: '/class-jh/attendance',
      pageCode: 'classjh:attendance:view',
      remark: '按班级+日期考勤台账、上传出勤表、缺勤明细',
    },
    {
      key: 'exam',
      title: '考试管理',
      path: '/class-jh/exam',
      pageCode: 'classjh:exam:view',
      remark: '月考/质素/阶段/结业四类 + 自定义考试',
    },
    {
      key: 'score',
      title: '成绩管理',
      path: '/class-jh/score',
      pageCode: 'classjh:score:view',
      remark: '成绩录入与查询（按成绩/时间/班主任筛选）',
    },
    {
      key: 'dorm',
      title: '宿舍管理',
      path: '/class-jh/dorm',
      pageCode: 'classjh:dorm:view',
      remark: '分派宿舍、调宿申请（审批在教务）',
    },
    {
      key: 'fee',
      title: '催费管理',
      path: '/class-jh/fee',
      pageCode: 'classjh:fee:view',
      remark: '临期/逾期名单、分享推送催费单',
    },
    {
      key: 'refund',
      title: '退费',
      path: '/class-jh/refund',
      pageCode: 'classjh:refund:view',
      remark: '退学退费申请与审批',
    },
    {
      key: 'approval',
      title: '教职·学术审批',
      path: '/class-jh/approval',
      pageCode: 'classjh:approval:view',
      remark: '休学/复学/换人/退学/就业协议五条流程审批',
    },
    {
      key: 'setting',
      title: '系统设置',
      path: '/class-jh/setting',
      pageCode: 'classjh:setting:view',
      remark: '出勤达标线、催费提醒天数、封班可转入类型等',
    },
  ],
};

/* ============================================================
 * 汇总
 * ============================================================ */

/** 全部板块（顺序 = 页面管理左栏顺序 = 侧栏板块顺序） */
export const PAGE_REGISTRY: RegistryBoard[] = [
  CONSULT,
  FINANCE,
  PERM,
  JOB,
  EDU,
  CLASS,
  CLASS_JH,
];

/** 全部页面总数（当前 7 板块 56 页） */
export const PAGE_REGISTRY_TOTAL = PAGE_REGISTRY.reduce((n, b) => n + b.pages.length, 0);

/** 拍平：全部页面的 path（用于「这个 path 有没有被台账管」的判定） */
export const ALL_REGISTRY_PATHS: string[] = PAGE_REGISTRY.flatMap((b) =>
  b.pages.map((p) => p.path),
);

/** 按 moduleKey 取板块 */
export function findRegistryBoard(moduleKey: string): RegistryBoard | undefined {
  return PAGE_REGISTRY.find((b) => b.moduleKey === moduleKey);
}
