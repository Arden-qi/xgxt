import { ApiResponse, PageData } from '../common';
import {
  AttendanceQuery,
  AttendanceRecord,
  ClassInfo,
  ClassQuery,
  ClassRepeat,
  ClassTransfer,
  ExamInfo,
  GradeQuery,
  GradeRecord,
  RosterListItem,
} from '../class';
import { DormApply, DormApplyQuery, DormLive, DormQuery, DormRoom } from '../edu';
import { FeeQuery, FeeRecord, RefundApply, RefundApplyPayload, RefundQuery, UrgeQuery, UrgeRecord } from '../finance';
import {
  ApprovalPayload,
  ApprovalLog,
  SuspendApply,
  SuspendApplyPayload,
  SuspendApplyQuery,
  UpgradeApply,
  UpgradeApplyPayload,
  UpgradeApplyQuery,
} from '../approval';
import { Notify, NotifyQuery, NotifyUnreadCount } from '../notify';
import { SyncRequest, SyncResult } from '../sync';
import { StudentListItem, StudentMarket, StudentProfile, StudentQuality } from '../student';

/**
 * 班级管理（学管模块，8003）接口契约
 * 前缀：/api/class/**
 * 资源名一律**单数**；动作只用标准动词。
 */

export type RosterListResponse = ApiResponse<PageData<RosterListItem>>;

/* ============================================================
 * 一、学生信息接口（需求一）
 * ============================================================ */

/** 上游学生信息（市场咨询推送的最小字段集） */
export interface StudentSyncItem {
  /** 上游主键（幂等键） */
  sourceId: string;
  studentNo: string;
  studentName: string;
  gender: number;
  deptCode: number;
  phone?: string;
  parentPhone?: string;
  age?: number;
  education?: string;
  enrollDate?: string;
  /** 上游学生状态 */
  studentStatus?: number;
  recruitTeacherId?: string;
  recruitTeacherName?: string;
  recruitPhone?: string;
  consultTeacherId?: string;
  consultTeacherName?: string;
  consultPhone?: string;
}

export interface StudentSyncRequest extends SyncRequest<StudentSyncItem> {}

/** 1.1 学生信息同步（咨询管理 → 本模块）POST /api/class/student/sync */
export type StudentSyncResponse = ApiResponse<SyncResult>;

/** 1.2 班主任补充剩余信息 PUT /api/class/student/update */
export interface StudentUpdatePayload {
  studentId: string;
  classId?: string;
  stage?: number;
  education?: string;
  enrollDate?: string;
  idCard?: string;
  /** 档案补充 */
  profile?: StudentProfile;
  /** 综合素质 */
  quality?: StudentQuality;
  studentStatus?: number;
  repeatCount?: number;
  remark?: string;
}
export type StudentUpdateResponse = ApiResponse<{ studentId: string }>;

/** 1.3 班主任新建学生信息 POST /api/class/student/add */
export interface StudentAddPayload {
  studentName: string;
  /** 不传则后端按 S + 年份 + 4 位序号自动生成 */
  studentNo?: string;
  gender: number;
  deptCode: number;
  age?: number;
  classId?: string;
  stage?: number;
  phone?: string;
  parentPhone?: string;
  education?: string;
  enrollDate?: string;
  idCard?: string;
  studentStatus?: number;
  profile?: StudentProfile;
}
export type StudentAddResponse = ApiResponse<{ studentId: string; studentNo: string }>;

/** 1.4 升学信息同步 POST /api/class/student/upgrade/sync */
export interface StudentUpgradeSyncItem {
  sourceId: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  fromDeptCode: number;
  fromStage: number;
  fromClassId?: string;
  toDeptCode: number;
  toStage: number;
  toClassId?: string;
  upgradeDate: string;
  /** 升学考试成绩，随档案一并保存 */
  examScore?: number;
  /** 升学时的成绩明细快照（JSON 字符串） */
  gradeSnapshot?: string;
}
export interface StudentUpgradeSyncRequest extends SyncRequest<StudentUpgradeSyncItem> {}
export type StudentUpgradeSyncResponse = ApiResponse<SyncResult>;

/** 1.5 学生列表 / 详情 GET /api/class/student/list | /detail */
export type StudentListResponse = RosterListResponse;
export interface StudentDetailData {
  student: RosterListItem & { idCard?: string; enrollDate?: string };
  profile?: StudentProfile;
  /** 市场信息只读（同步自市场咨询） */
  market?: StudentMarket;
  quality?: StudentQuality;
  repeats: ClassRepeat[];
  dorm?: DormLive;
  grades: GradeRecord[];
  classInfo?: ClassInfo;
  classTransfers: ClassTransfer[];
}
export type StudentDetailResponse = ApiResponse<StudentDetailData>;

/* ============================================================
 * 二、催费管理接口（需求二：同步教务管理的催费信息）
 * ============================================================ */

export interface UrgeSyncItem {
  sourceId: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  classId?: string;
  className?: string;
  phone?: string;
  parentPhone?: string;
  headTeacherId?: string;
  headTeacherName?: string;
  feeType: number;
  /** 欠费金额，单位「分」 */
  amount: number;
  expireDate: string;
  payStatus: number;
  urgeCount?: number;
  lastUrgeTime?: string;
}
export interface UrgeSyncRequest extends SyncRequest<UrgeSyncItem> {}
export type UrgeSyncResponse = ApiResponse<SyncResult>;
export type UrgeListResponse = ApiResponse<PageData<UrgeRecord>>;

/** 催费（前端触发记录一次催收动作；不改上游数据，只记本地催费流水） */
export interface UrgeDoPayload {
  urgeId: string;
  /** 催收渠道：phone 电话 / sms 短信 / wechat 微信 */
  channel: string;
  remark?: string;
}
export type UrgeDoResponse = ApiResponse<{ urgeId: string; urgeCount: number }>;

/* ============================================================
 * 三、缴费信息接口（需求三：同步财务管理的缴费信息）
 * ============================================================ */

export interface FeeSyncItem {
  sourceId: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  classId?: string;
  className?: string;
  feeType: number;
  /** 单位「分」 */
  amount: number;
  paidAmount?: number;
  payStatus: number;
  payDate?: string;
  expireDate?: string;
  voucherUrl?: string;
  payMethod?: string;
}
export interface FeeSyncRequest extends SyncRequest<FeeSyncItem> {}
export type FeeSyncResponse = ApiResponse<SyncResult>;
export type FeeListResponse = ApiResponse<PageData<FeeRecord>>;

/* ============================================================
 * 四、宿舍信息接口（需求四：同步教务管理的宿舍信息）
 * ============================================================ */

export interface DormSyncItem {
  /** 宿舍房间 */
  room: {
    sourceId: string;
    buildingId: string;
    buildingName: string;
    dormType: number;
    dormNo: string;
    bedCount: number;
    usedCount: number;
    leaderStudentId?: string;
    leaderStudentName?: string;
  };
  /** 该宿舍当前住宿学员 */
  residents: Array<{
    studentId: string;
    studentNo: string;
    studentName: string;
    classId?: string;
    className?: string;
    checkInDate?: string;
  }>;
}
export interface DormSyncRequest extends SyncRequest<DormSyncItem> {}
export type DormSyncResponse = ApiResponse<SyncResult>;
export type DormRoomListResponse = ApiResponse<PageData<DormRoom>>;
export type DormLiveListResponse = ApiResponse<PageData<DormLive>>;

/** 换宿 / 退宿申请（本模块发起，推给教务管理审） */
export interface DormApplyPayload {
  /** 1 换宿 2 退宿 */
  applyCategory: number;
  studentId: string;
  fromDormId?: string;
  toDormId?: string;
  applyReason: string;
}
export type DormApplyResponse = ApiResponse<{ applyId: string; applyNo: string }>;
export type DormApplyListResponse = ApiResponse<PageData<DormApply>>;
export type DormApplyQueryType = DormApplyQuery;

/* ============================================================
 * 五、审批流程接口
 * ============================================================ */

/** 5.1 休学 / 退学 */
export type SuspendSubmitResponse = ApiResponse<{ applyId: string; applyNo: string; applyStatus: number }>;
export type SuspendListResponse = ApiResponse<PageData<SuspendApply>>;
export type SuspendDetailResponse = ApiResponse<{
  apply: SuspendApply;
  logs: ApprovalLog[];
  /** 下一步该谁审 */
  nextHandlerRole?: string;
  nextHandlerName?: string;
}>;
export type SuspendQueryType = SuspendApplyQuery;
export type SuspendPayloadType = SuspendApplyPayload;
export type ApprovalActionResponse = ApiResponse<{ bizId: string; applyStatus: number; applyStatusName: string }>;
export type ApprovalPayloadType = ApprovalPayload;

/** 5.2 退费 */
export type RefundSubmitResponse = ApiResponse<{ applyId: string; applyNo: string; refundStatus: number }>;
export type RefundListResponse = ApiResponse<PageData<RefundApply>>;
export type RefundDetailResponse = ApiResponse<{ apply: RefundApply; logs: ApprovalLog[] }>;
export type RefundQueryType = RefundQuery;
export type RefundPayloadType = RefundApplyPayload;

/** 5.3 升学 */
export type UpgradeSubmitResponse = ApiResponse<{ applyId: string; applyNo: string; applyStatus: number }>;
export type UpgradeListResponse = ApiResponse<PageData<UpgradeApply>>;
export type UpgradeQueryType = UpgradeApplyQuery;
export type UpgradePayloadType = UpgradeApplyPayload;

/** 5.4 我的待办（当前登录人需要处理的单子） */
export interface TodoItem {
  applyType: number;
  applyTypeName: string;
  bizId: string;
  applyNo: string;
  studentName: string;
  studentNo: string;
  className?: string;
  currentStatus: number;
  currentStatusName: string;
  submitTime: string;
  submitterName?: string;
  linkPath?: string;
}
export type TodoListResponse = ApiResponse<PageData<TodoItem>>;

/* ============================================================
 * 六、站内通知
 * ============================================================ */
export type NotifyListResponse = ApiResponse<PageData<Notify>>;
export type NotifyUnreadResponse = ApiResponse<NotifyUnreadCount>;
export type NotifyQueryType = NotifyQuery;

/* ============================================================
 * 七、班级管理 / 出勤 / 成绩 / 考试
 * ============================================================ */
export type ClassListResponse = ApiResponse<PageData<ClassInfo>>;
export type ClassQueryType = ClassQuery;
export type AttendanceListResponse = ApiResponse<PageData<AttendanceRecord>>;
export type AttendanceQueryType = AttendanceQuery;
export type ExamListResponse = ApiResponse<PageData<ExamInfo>>;
export type GradeListResponse = ApiResponse<PageData<GradeRecord>>;
export type GradeQueryType = GradeQuery;
