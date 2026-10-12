/**
 * 宿舍管理相关类型与常量（前后端共用）—— 教务版
 *
 * 来源：教务管理原型 dorm.html
 * ⚠️ 这些名字和取值必须与原型保持一致，否则页面显示会和原型对不上。
 * ⚠️ 与主包 dorm.ts 同名接口（DormQuery…），所以放在 edu 子模块里，独立命名空间。
 */

// ⚠️ ApplyStatus / APPLY_STATUS_NAME 从 edu-enums 引入，别在 dorm.ts 里重复定义
import { ApplyStatus } from './edu-enums.js';

/** 床位选项：固定 8 个床位，顺序即房间里的排列顺序 */
export const BED_OPTIONS = [
  '1-下',
  '1-上',
  '2-下',
  '2-上',
  '3-下',
  '3-上',
  '4-下',
  '4-上',
] as const;

/** 宿舍楼栋（A 开头男寝，B 开头女寝） */
export const BUILDINGS = ['A-1', 'A-2', 'B-1', 'B-2'];

/** 班级：初高中部 + 大学部（和学生档案页共用同一套） */
export const CLASSES_HIGH = [
  '预科1班',
  '初一1班',
  '初一2班',
  '初二1班',
  '初三1班',
  '高一1班',
  '高一2班',
  '高二1班',
];
export const CLASSES_UNIV = ['Q16', 'Q17', 'Q18', 'Q19', 'Q20', 'Q21', 'Q22', 'Q23'];
export const ALL_CLASSES = [...CLASSES_HIGH, ...CLASSES_UNIV];

/** 床位规则说明（原型编辑弹窗里展示给老师看） */
export const BED_NOTE =
  '床位规则：进门左手边为1号床，左手边靠窗为2号床，二号床对面是3号床，一号床对面是4号床';

/**
 * 宿舍列表分页大小
 *
 * ⚠️ 注意单位是【间】不是【行】：原型里 dormPageSize = 5，
 *    一间宿舍展开成 8 行床位，所以一页实际显示 40 行。
 */
export const DORM_PAGE_SIZE = 5;

/** 申请列表 / 退宿名单的分页大小（原型 pageSize = 10） */
export const DORM_APPLY_PAGE_SIZE = 10;

/** 宿舍类别 */
export enum DormCategory {
  MALE = 1,    // 男寝
  FEMALE = 2,  // 女寝
}

export const DORM_CATEGORY_NAME: Record<number, string> = {
  [DormCategory.MALE]: '男寝',
  [DormCategory.FEMALE]: '女寝',
};

// ⚠️ ApplyStatus / APPLY_STATUS_NAME 已在 edu-enums 中定义（取值完全一致），这里不要重复声明

/** 换宿原因 */
export const REASONS_CHANGE = [
  '宿舍设施问题',
  '与室友生活习惯不合',
  '身体原因需调换',
  '靠近学习区域',
  '其他原因',
];

/** 退宿原因 */
export const REASONS_QUIT = ['毕业离校', '退学', '转校', '走读', '其他'];

/* ============================================================
 * 数据结构
 * ============================================================ */

/** 单个床位 */
export interface DormBed {
  bedNo: string;
  bedIndex: number;
  /** 学号（演示数据里可能为空） */
  studentNo?: string;
  studentName?: string;
  className?: string;
  headTeacherName?: string;
  /** true = 空床位，前端渲染成灰底斜体「空床位」 */
  empty: boolean;
}

/** 宿舍一行（前端按 8 个床位展开成 8 行） */
export interface DormRoomItem {
  roomId: string;
  category: DormCategory;
  categoryName: string;
  building: string;
  room: string;
  capacity: number;
  /** 已入住人数 */
  occupied: number;
  beds: DormBed[];

  // ===== ★ 2026-10-03 合并：来源标记 =====
  /** edu = 教务自己的房间（可编辑）/ job = 实训同步来的（**只读**） */
  source?: 'edu' | 'job';
  /** 来源中文名：教务 / 实训 */
  sourceName?: string;
}

/** 宿舍列表查询参数 */
export interface DormQuery {
  page?: number;
  size?: number;
  category?: DormCategory;
  building?: string;
  /** 关键字：匹配楼栋/宿舍号/入住学生姓名/班级/班主任 */
  keyword?: string;
}

/** 统计数字（宿舍总名单 Tab） */
export interface DormListStats {
  totalDorms: number;
  maleDorms: number;
  femaleDorms: number;
  vacantBeds: number;
}

/** 统计数字（申请审批 Tab） */
export interface DormApprovalStats {
  pendingChange: number;
  pendingQuit: number;
  approvedChange: number;
  approvedQuit: number;
}

/**
 * ★ 2026-10-04：「申请审批」的字段对齐「就业管理 → 调换/退宿申请」
 *
 *   两个列表现在共用同一套展示字段：
 *     学生（姓名 + 性别 + 学号）、班级、宿舍变动（旧 → 新 + 床位）、
 *     申请日期、班主任、审批状态
 *   —— 教务侧另外保留了申请原因 / 驳回原因 / 联系电话（审批时要看）。
 */
export interface DormApplyCommonFields {
  studentNo?: string;
  /** 性别：1=男 / 2=女 */
  gender?: number;
  genderName?: string;
  /** 现宿舍号（building + room 拼好的，如 "A栋 101"） */
  oldDormNo?: string;
  oldBedNo?: string;
  /** 调换后的宿舍号（退宿申请没有这一项） */
  newDormNo?: string;
  newBedNo?: string;
}

/** 换宿申请 */
export interface ChangeApplyItem extends DormApplyCommonFields {
  applyId: string;
  applyNo: string;
  studentName: string;
  className?: string;
  headTeacherName?: string;
  fromBuilding?: string;
  fromRoom?: string;
  fromBed?: string;
  toBuilding?: string;
  toRoom?: string;
  toBed?: string;
  reason?: string;
  applyDate?: string;
  status: ApplyStatus;
  statusName: string;
  rejectReason?: string;
}

/** 退宿申请 */
export interface QuitApplyItem extends DormApplyCommonFields {
  applyId: string;
  applyNo: string;
  studentName: string;
  className?: string;
  headTeacherName?: string;
  quitBuilding?: string;
  quitRoom?: string;
  quitBed?: string;
  reason?: string;
  applyDate?: string;
  phone?: string;
  status: ApplyStatus;
  statusName: string;
  rejectReason?: string;
}

/** 退宿名单 */
export interface CheckoutItem {
  id: string;
  studentName: string;
  quitBuilding?: string;
  quitRoom?: string;
  quitBed?: string;
  className?: string;
  checkoutDate?: string;
  phone?: string;
}

/** 申请列表查询参数 */
export interface ApplyQuery {
  page?: number;
  size?: number;
  status?: ApplyStatus;
  className?: string;
}

/* ============================================================
 * 分派宿舍（班级 ↔ 宿舍）
 * ============================================================ */

/** 分派给某个班级的一间宿舍 */
export interface DormAssignRoom {
  assignId: string;
  roomId: string;
  building: string;
  room: string;
  category: DormCategory;
  categoryName: string;
  /** 额定人数（床位数） */
  capacity: number;
  /** 这间宿舍已入住人数（所有班级） */
  occupied: number;
  /** 其中属于本班的人数 */
  ownOccupied: number;
}

/** 分派宿舍页的一行 = 一个班级 */
export interface DormAssignClassRow {
  className: string;
  headTeacherName?: string;
  /** 已分派的宿舍数 */
  roomCount: number;
  /** 这些宿舍的床位总数 */
  capacity: number;
  occupied: number;
  ownOccupied: number;
  rooms: DormAssignRoom[];
}

/** 分派弹窗里的候选宿舍 */
export interface DormAssignCandidate {
  roomId: string;
  building: string;
  room: string;
  category: DormCategory;
  categoryName: string;
  capacity: number;
  occupied: number;
  /** true = 已被分派（assignedTo 是被分派给的班级） */
  assigned: boolean;
  assignedTo?: string;
}

/** 分派宿舍页统计数字 */
export interface DormAssignStats {
  /** 已分派宿舍的班级数 */
  assignedClasses: number;
  assignedRooms: number;
  /** 尚未分派的宿舍数 */
  unassignedRooms: number;
  capacity: number;
  occupied: number;
}

/** 分派宿舍的提交参数：一个班级可以分到多间 */
export interface DormAssignPayload {
  className: string;
  headTeacherName?: string;
  roomIds: string[];
}

/** 分派宿舍列表查询参数 */
export interface DormAssignQuery {
  keyword?: string;
  building?: string;
  category?: DormCategory;
}

/** 审核结果 */
export interface AuditPayload {
  id: string;
  reason?: string;
}
