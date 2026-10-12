/**
 * 班级信息管理 —— 本班学生详细名单
 *
 * ★ 斌哥 2026-09-30 大改：
 *   实训老师一人只带一个班，所以「班级信息管理」不再是"班级列表"，
 *   而是**直接展示我带的那个班的学生详细信息** + 各种操作。
 *   原「班级花名册」菜单已合并进来。
 */

/** 表格里的一行 = 一个学生 */
export interface ClassInfoStudent {
  studentId: string;
  studentNo: string;
  studentName: string;
  gender?: number | null;
  /** 双返回：男 / 女 */
  genderName?: string;
  className?: string | null;
  deptCode?: number | null;
  deptName?: string | null;
  age?: number | null;
  phone?: string | null;
  parentPhone?: string | null;
  dormNo?: string | null;
  /** 入学时间（已格式化 YYYY-MM-DD） */
  enrollDate?: string | null;
  education?: string | null;
  studentStatus?: number | null;
  /** 双返回：正式在读 / 休学 … */
  studentStatusName?: string;
  repeatCount?: number;
  stage?: number | null;
  /** 双返回：第一阶段 … */
  stageName?: string;
  /**
   * 备注（★ 已与「综合素质」合并 —— 斌哥 2026-09-30）
   * 参考页原本有单独的"综合素质"列，这里合并进备注，不单独建字段。
   */
  remark?: string | null;
  /** 有没有未缴清的催费单 → 前端显示"欠费"标记 */
  hasUnpaid?: boolean;
}

/** 名单查询参数 */
export interface ClassInfoStudentQuery {
  page?: number;
  size?: number;
  /** 不传 = 用「我带的班」 */
  classId?: string;
  keyword?: string;
  studentStatus?: number;
}

/** 顶部统计卡片 */
export interface ClassInfoSummary {
  /** 在读学员总数（含试学中） */
  totalInSchool: number;
  /** 其中试学中 */
  trialCount: number;
  /** 学籍异动人数（休学 + 退学） */
  statusChanged: number;
  /** 末班记录人次 */
  repeatTotal: number;
  /** 欠费待催人数 */
  unpaidCount: number;
}

/** 我带的班（正常 0 或 1 条；教务/校长等其它角色可能返回多条） */
export interface MyClassItem {
  id: string;
  className: string;
  classCode?: string;
  deptCode?: number | null;
  deptName?: string | null;
  stage?: number | null;
  stageName?: string;
  classStatus?: number;
  /** 班级状态名（开放/封班/待结业/已结业）—— 2026-10-01 结业转就业用 */
  classStatusName?: string;
  /** ★ 2026-10-04 交棒模型：岗位责任人（结业按钮按「项目经理是不是我」判断） */
  projectManagerId?: string | null;
  employmentTeacherId?: string | null;
}

/** 缴费记录（跨模块调财务 8005） */
/**
 * 缴费记录一行（★ 2026-10-06：与财务管理·缴费管理对齐）
 *
 * 与 `server-job/src/utils/financeFeeRef.ts` 的 StudentFeeRecord 一一对应，
 * 实训 / 大学部 / 初高 三处详情展示同一套字段。
 */
export interface ClassInfoFeeRecord {
  feeId: string;
  studentNo: string;
  studentName: string;
  classId?: string | null;
  className?: string | null;
  /** 部门 1 二三期（初高部） / 2 大学部 */
  deptCode?: number | null;
  deptName: string;
  feeType: number;
  feeTypeName: string;
  /** 费用周期（财务侧 period，如 2026-09） */
  period?: string | null;
  amount: number;
  paidAmount: number;
  amountYuan: string;
  paidAmountYuan: string;
  unpaidAmountYuan: string;
  payStatus: number;
  payStatusName: string;
  payDate?: string | null;
  expireDate?: string | null;
  payMethod?: string | null;
  voucherUrl?: string | null;
}

export interface ClassInfoFeeRecords {
  /** 该学员是否有缴费记录（false 时前端显示提示而不是报错） */
  available: boolean;
  /** true = 未取到实时财务数据，显示的是副本（可能不是最新） */
  degraded?: boolean;
  /** finance = 实时取自财务管理；mirror = 财务不可用，走副本兜底 */
  source?: 'finance' | 'mirror';
  studentId: string;
  studentNo?: string | null;
  studentName?: string | null;
  /** 应缴 / 已缴 / 待缴 汇总 */
  summary?: {
    totalAmount: number;
    totalPaid: number;
    totalUnpaid: number;
    totalAmountYuan: string;
    totalPaidYuan: string;
    totalUnpaidYuan: string;
  };
  records: ClassInfoFeeRecord[];
  /** 无记录 / 降级时的友好提示文案 */
  message?: string;
}

/* ============================================================
 * 学生档案详情（「详情」弹窗的 6 个 Tab）
 * ★ 斌哥 2026-09-30
 * ============================================================ */

/** ① 基础信息 */
export interface ClassInfoBasic {
  studentId: string;
  studentNo: string;
  studentName: string;
  gender?: number | null;
  /** 双返回：男 / 女 */
  genderName?: string;
  age?: number | null;
  className?: string | null;
  deptCode?: number | null;
  deptName?: string | null;
  education?: string | null;
  phone?: string | null;
  parentPhone?: string | null;
  /** 入学时间 YYYY-MM-DD */
  enrollDate?: string | null;
  /** 出生日期 YYYY-MM-DD（2026-09-30 新增字段） */
  birthDate?: string | null;
  nativePlace?: string | null;
  graduateSchool?: string | null;
  homeAddress?: string | null;
  studentStatus?: number | null;
  studentStatusName?: string;
  stage?: number | null;
  stageName?: string;
  /** 备注（已与「综合素质」合并） */
  remark?: string | null;
  /**
   * 身份证 / 户口本照片
   * ⚠️ 本期只做展示位，不接上传 —— 后端恒返回 null
   */
  idCardPhoto?: string | null;
  householdPhoto?: string | null;
}

/** ② 市场信息（★ 升阶时由大学部 8003 搬过来，本模块读自己库，不再调 8001） */
export interface ClassInfoMarket {
  admissionTeacher?: string | null;
  admissionTeacherPhone?: string | null;
  consultTeacher?: string | null;
  consultTeacherPhone?: string | null;
}

/** ③ 末班 —— 一次末班记录 */
export interface ClassInfoRepeatRecord {
  id: string;
  examId?: string | null;
  examName: string;
  examType?: number | null;
  examTypeName?: string;
  examTime?: string | null;
  totalScore?: number | null;
  writtenAvg?: number | null;
  interviewScore?: number | null;
  className?: string | null;
  remark?: string | null;
}

/** ③ 末班 —— 汇总 */
export interface ClassInfoRepeat {
  repeatCount: number;
  records: ClassInfoRepeatRecord[];
}

/**
 * ④ 宿舍（没住宿舍时整个对象为 null）
 *
 * ★ 2026-10-02：宿舍有**两套**（实训基地 / 就业基地），这里用 `dormSource` 区分：
 *   - `training`   实训基地宿舍 —— 有床位表，有床位号（1上/1下），换宿退宿走**教务审批**
 *   - `employment` 就业基地宿舍 —— **只是个房间**，不分床位号，分派**直接生效**
 */
export interface ClassInfoDorm {
  bedId: string | null;
  dormId: string;
  dormNo: string;
  bedNo: string | number | null;
  building?: string | null;
  roomNo?: string | null;
  dormGender?: number | null;
  dormGenderName?: string;
  bedCount?: number | null;
  usedCount?: number | null;
  checkInDate?: string | null;
  /** 宿舍来源：实训基地 / 就业基地 */
  dormSource?: 'training' | 'employment' | null;
  dormSourceName?: string;
  /** 就业基地宿舍专有：楼层 */
  floor?: number | null;
  /** 就业基地宿舍专有：房间类型 1男寝 2女寝 */
  roomType?: number | null;
  roomTypeName?: string;
}

/** ⑤ 考试信息 —— 一条考试记录 */
export interface ClassInfoExamRecord {
  id: string;
  examId?: string | null;
  examName: string;
  examType?: number | null;
  examTypeName?: string;
  examTime?: string | null;
  paperScore?: number | null;
  machineScore?: number | null;
  /** 笔试分数（= 卷面×50% + 机试×50%，参考页叫「笔试分数」） */
  writtenAvg?: number | null;
  interviewScore?: number | null;
  totalScore?: number | null;
  examResult?: number | null;
  examResultName?: string;
  /** 素质分析（非必填）—— 即成绩表的备注 */
  qualityAnalysis?: string | null;
  entryByName?: string | null;
  entryTime?: string | null;
}

/** ⑤ 考试信息 —— 汇总 */
export interface ClassInfoExams {
  /** 只展示最近几次（后端限制） */
  limit: number;
  writtenWeight: number;
  interviewWeight: number;
  list: ClassInfoExamRecord[];
}

/** ⑥ 班级信息 —— 一条历史流转 */
export interface ClassInfoHistoryItem {
  id: string;
  classId: string;
  className: string;
  joinDate?: string | null;
  joinType?: number | null;
  joinTypeName?: string;
  leaveDate?: string | null;
  leaveType?: number | null;
  leaveTypeName?: string;
  leaveReason?: string | null;
  status?: number | null;
  statusName?: string;
}

/** ⑥ 班级信息 */
export interface ClassInfoClassBlock {
  classId?: string | null;
  className?: string | null;
  classCode?: string | null;
  deptCode?: number | null;
  deptName?: string | null;
  stage?: number | null;
  stageName?: string;
  classStatus?: number | null;
  classStatusName?: string;
  classroom?: string | null;
  headTeacherName?: string | null;
  teacherName?: string | null;
  assistantName?: string | null;
  studentCount: number;
  history: ClassInfoHistoryItem[];
}

/** 就业日志（学员档案 →「就业日志」Tab 的一条记录） */
export interface ClassInfoEmploymentLog {
  id: string;
  logDate: string;
  /** 有效简历投递数 */
  resumeCount: number;
  /** 面试邀约数 */
  interviewInvite: number;
  /** 面试场次 */
  interviewCount: number;
  interviewTime?: string | null;
  company?: string | null;
  position?: string | null;
  /** 薪资（元/月） */
  salary?: number | null;
  interviewSituation?: string | null;
}

/** 就业复盘（学员档案 →「复盘记录」Tab 的一条记录） */
export interface ClassInfoEmploymentReview {
  id: string;
  reviewTime: string;
  interviewTime?: string | null;
  position?: string | null;
  /** 工资（元/月） */
  salary?: number | null;
  interviewConclusion?: number | null;
  interviewConclusionName?: string;
  reviewConclusion?: number | null;
  reviewConclusionName?: string;
  detail?: string | null;
}

/**
 * 学生的就业信息
 *
 * ★ 斌哥 2026-10-02：学生**转就业之后**，班主任在「班级信息管理 → 详情」里
 *   仍然要能看到他的就业日志和复盘记录（否则一转出去就彻底看不见了）。
 *
 * ⚠️ 只有「待就业(9) / 已就业(10)」的学生有值，其余为 null。
 */
export interface ClassInfoEmployment {
  logs: ClassInfoEmploymentLog[];
  reviews: ClassInfoEmploymentReview[];
}

/** 学生档案详情（一次返回各 Tab 的全部数据） */
export interface ClassInfoDetail {
  basic: ClassInfoBasic;
  market: ClassInfoMarket;
  repeat: ClassInfoRepeat;
  dorm: ClassInfoDorm | null;
  exams: ClassInfoExams;
  classInfo: ClassInfoClassBlock;
  /** ★ 就业信息（仅「待就业 / 已就业」的学生有值） */
  employment?: ClassInfoEmployment | null;
}

/**
 * 修改学生的入参
 *
 * ⚠️ 这里**没有**以下字段（它们各有流程，不走这个口）：
 *    学号 / 学生状态 / 宿舍号 / 班级 / 入学日期 / 末班次数
 */
export interface ClassInfoUpdatePayload {
  studentId: string;
  studentName?: string;
  gender?: number;
  age?: number;
  education?: string;
  phone?: string;
  parentPhone?: string;
  birthDate?: string;
  nativePlace?: string;
  graduateSchool?: string;
  homeAddress?: string;
  stage?: number;
  remark?: string;
  /**
   * ★ 2026-10-02（斌哥）：「修改」里可以直接换宿舍床位
   *
   * 传了就会走完整同步：释放旧床位 → 占用新床位 → 同步学生主档 → 两端「已住人数」重算。
   * ⚠️ 只支持**换床位**，不支持在这里退宿（退宿要走宿舍管理的审批流程）。
   */
  bedId?: string;
}
