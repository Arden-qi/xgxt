/**
 * 宿舍管理 —— 前端/后端共用类型
 *
 * 归属模块：就业管理 > 实训阶段（马志斌）
 * 创建时间：2026-09-30
 *
 * ⚠️ 这个文件是「前后端唯一口径」——
 *    后端返回的字段、前端渲染的字段，都以这里为准，不许各写各的。
 */

/* ============================================================
 * 一、宿舍主档
 * ============================================================ */

/** 宿舍主档（列表项） */
export interface DormListItem {
  id: string;
  dormNo: string;          // 宿舍编号 A-301
  building: string;        // 楼栋
  roomNo: string;          // 房间号
  bedCount: number;        // 床位总数
  usedCount: number;       // 已住人数
  /** 空余床位数（后端算好，前端直接用） */
  freeCount: number;
  dormGender: number;      // 0不限 1男 2女
  dormGenderName: string;  // 枚举双返回
  deptCode: number | null;
  deptName: string | null;
  dormStatus: number;      // 1正常 2停用
  dormStatusName: string;
  facility: string | null;
  remark: string | null;
  createTime?: string;
  updateTime?: string;
}

/** 宿舍查询条件 */
export interface DormQuery {
  page?: number;
  size?: number;
  keyword?: string;        // 编号/楼栋/房间号
  building?: string;
  dormGender?: number;
  dormStatus?: number;
  deptCode?: number;
  /** 只看有空床的 */
  onlyFree?: boolean;
}

/** 新建/编辑宿舍的入参 */
export interface DormPayload {
  id?: string;             // 有 = 编辑，无 = 新建
  dormNo: string;
  building: string;
  roomNo: string;
  bedCount: number;
  dormGender: number;
  deptCode?: number | null;
  dormStatus?: number;
  facility?: string | null;
  remark?: string | null;
}

/** 床位 */
export interface DormBedItem {
  id: string;
  dormId: string;
  dormNo: string;
  /**
   * 床位**序号**（库里是 integer：`1`/`2`/`3`/`4`）
   *
   * ⚠️ 要显示成「1-上 / 1-下」请用 `bedNoText`，不要自己拼字符串。
   *    规则在 `shared-types/class` 的 `bedNoText()`（奇上偶下），
   *    大学部花名册 / 教务宿舍 / 实训宿舍三处共用同一份，各拼各的必然分叉。
   */
  bedNo: string | number;
  /** 床位的上/下铺文字（`1-上` / `1-下`）—— 2026-10-04 后端下发 */
  bedNoText?: string;
  /** 完整标签（`301-1-上`）—— 表格里一个字段直接显示 */
  bedLabel?: string;
  bedStatus: number;
  bedStatusName: string;
  studentId: string | null;
  studentNo: string | null;
  studentName: string | null;
  studentGender: number | null;
  checkInDate: string | null;
  remark: string | null;
}

/** 宿舍详情（含所有床位） */
export interface DormDetail extends DormListItem {
  beds: DormBedItem[];
}

/* ============================================================
 * 二、调换 / 退宿申请单
 * ============================================================ */

/** 申请单列表项 */
export interface DormChangeListItem {
  id: string;
  bizType: number;             // 1调换 2退宿
  bizTypeName: string;
  studentId: string;
  studentNo: string | null;
  studentName: string | null;
  gender: number | null;
  genderName: string;
  className: string | null;
  deptCode: number | null;
  deptName: string | null;
  headTeacherId: string | null;
  headTeacherName: string | null;

  oldDormNo: string | null;
  oldBedNo: string | null;
  newDormNo: string | null;
  newBedNo: string | null;

  changeDate: string;
  changeReason: string;
  headTeacherOpinion: string | null;

  approvalId: string | null;
  approvalStatus: number;
  approvalStatusName: string;
  currentStep: number | null;
  currentHandlerHint: string | null;

  /** ★ 当前登录人能不能批这一单（后端算，前端直接用来显隐按钮） */
  canApprove: boolean;
  /** ★ 当前登录人能不能撤回（只有申请人本人 + 未结束） */
  canCancel: boolean;
  /**
   * ★ 当前登录人能不能**提交**这一单（2026-10-01 新增）
   *
   * 班级结业时会自动生成「待提交」的退宿申请，
   * 必须有入口让班主任提交，否则单子永远躺在草稿里。
   */
  canSubmit: boolean;

  remark: string | null;
  createTime: string;
}

/** 查询条件 */
export interface DormChangeQuery {
  page?: number;
  size?: number;
  keyword?: string;
  bizType?: number;
  classId?: string;
  approvalStatus?: number;
  /** 只看跟我有关的（班主任：我发起的；教务：待我批的） */
  onlyMine?: boolean;
  startDate?: string;
  endDate?: string;
}

/** 新建申请单入参 */
export interface DormChangePayload {
  bizType: number;           // 1调换 2退宿
  studentId: string;
  changeDate: string;
  changeReason: string;
  headTeacherOpinion?: string | null;
  /** 调换时必填：新床位 */
  newBedId?: string | null;
  remark?: string | null;
}

/** 详情 */
export interface DormChangeDetail extends DormChangeListItem {
  logs: Array<{
    id: string;
    step: number;
    nodeName: string;
    operatorName: string;
    operatorRole: string | null;
    action: number;
    actionName: string;
    comment: string | null;
    createTime: string;
  }>;
  chainNodes: Array<{
    step: number;
    name: string;
    hint: string;
    roles: string[];
    status: 'done' | 'current' | 'todo' | 'rejected';
  }>;
  /** 该学生的历史宿舍变动 */
  history: Array<{
    id: string;
    bizType: number;
    bizTypeName: string;
    oldDormNo: string | null;
    newDormNo: string | null;
    approvalStatus: number;
    approvalStatusName: string;
    changeDate: string;
  }>;
}

/* ============================================================
 * 三、下拉选项
 * ============================================================ */

/** 可调换/退宿的学生选项 */
export interface DormStudentOption {
  studentId: string;
  studentNo: string;
  studentName: string;
  gender: number | null;
  genderName: string;
  /** ★ 2026-10-03：学生状态（退宿时列表里会包含「休学」的学生，前端要能标出来） */
  studentStatus?: number | null;
  studentStatusName?: string;
  className: string | null;
  deptCode: number | null;
  deptName: string | null;
  headTeacherId: string | null;
  headTeacherName: string | null;
  /** 当前住哪 */
  dormId: string | null;
  dormNo: string | null;
  bedId: string | null;
  bedNo: string | null;
}

/** 可选床位（调换时选新宿舍用） */
export interface DormBedOption {
  bedId: string;
  dormId: string;
  dormNo: string;
  building: string;
  roomNo: string;
  /** 床位序号（`1`/`2`…）；显示用 `bedNoText` 转成 `1-上`/`1-下` */
  bedNo: string | number;
  /** 床位上/下铺文字（`1-上`） */
  bedNoText?: string;
  dormGender: number;
  dormGenderName: string;
}

/** 顶部统计 */
export interface DormSummary {
  totalChange: number;   // 调换申请总数
  totalCheckout: number; // 退宿申请总数
  pending: number;       // 审批中
  approved: number;      // 已通过
  /** 待我审批 */
  todoMine: number;
}

/* ============================================================
 * 入住明细（按学生看）—— 斌哥 2026-09-30
 *   房间视角回答"这间房还有几张空床"；学生视角回答"张三住哪"。
 * ============================================================ */
export interface DormStudentBedItem {
  id: string;
  dormId: string;
  dormNo: string;
  /** 床位号（如 1上 / 1下 / 2上 / 2下） */
  bedNo: string;
  studentId: string;
  studentNo?: string | null;
  studentName?: string | null;
  gender?: number | null;
  genderName?: string;
  /** 入住日期 */
  checkInDate?: string | null;
  className?: string | null;
  deptCode?: number | null;
  deptName?: string | null;
  /** 楼栋（宿舍主档上的，如「B栋（女生公寓）」） */
  building?: string | null;
}

/** 入住明细查询参数 */
export interface DormStudentBedQuery {
  page?: number;
  size?: number;
  /** 学生姓名 / 学号 / 宿舍号 */
  keyword?: string;
  classId?: string;
  dormId?: string;
}

/* ============================================================
 * ★ 分派宿舍（2026-10-01 新增 · 斌哥）
 *
 *   用途：**复学时若学生已退宿，宿舍会留空** ——
 *        由**复学班的班主任**在这里给他分一个床位。
 *   口径：只列【没有宿舍】且【实训中】的学生；班主任只看自己带的班。
 *   特点：**不走审批**，选了床位就直接生效（斌哥 2026-10-01）。
 * ============================================================ */

/** 待分派宿舍的学生（没宿舍的在校生） */
export interface DormAssignStudent {
  studentId: string;
  studentNo: string;
  studentName: string;
  gender?: number | null;
  genderName?: string;
  phone?: string | null;
  classId?: string | null;
  className?: string | null;
  deptCode?: number | null;
  deptName?: string | null;
  studentStatus?: number | null;
  studentStatusName?: string;
}

/** 待分派列表查询参数 */
export interface DormAssignQuery {
  page?: number;
  size?: number;
  /** 学生姓名 / 学号 */
  keyword?: string;
  classId?: string;
}

/** 分派宿舍提交内容 */
export interface DormAssignPayload {
  studentId: string;
  /** 选中的床位 */
  bedId: string;
}
