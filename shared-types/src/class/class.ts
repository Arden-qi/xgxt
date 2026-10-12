import { BaseEntity } from './common';
import { ClassStatus, DeptCode, ExamContentType, ExamResult, ExamType, Gender } from './enums';

/** 班级档案（对应原型「班级管理」） */
export interface ClassInfo extends BaseEntity {
  /** 班级名称，如 G104、Q17 */
  className: string;
  deptCode: DeptCode;
  /** 学习阶段，见数据字典 4.4 */
  stage: number;
  stageName?: string;
  headTeacherId?: string;
  headTeacherName?: string;
  /** 教员 */
  teacherId?: string;
  teacherName?: string;
  /** 助教 */
  assistantId?: string;
  assistantName?: string;
  /** 教室 */
  room?: string;
  /** 开班日期 YYYY-MM-DD */
  openDate?: string;
  /** 班级人数 */
  studentCount?: number;
  classStatus: ClassStatus;
  classStatusName?: string;
  /** 出勤率 */
  attendanceRate?: number;
}

export interface ClassQuery {
  page: number;
  size: number;
  className?: string;
  deptCode?: DeptCode;
  stage?: number;
  classStatus?: ClassStatus;
  headTeacherId?: string;
  keyword?: string;
}

/** 班级交接记录（班主任/教员/助教变更，供「详情 → 班级信息 → 历史信息」使用） */
export interface ClassTransfer extends BaseEntity {
  classId: string;
  className: string;
  /** 交接类型：headTeacher / teacher / assistant */
  transferType: string;
  fromUserId?: string;
  fromUserName?: string;
  toUserId?: string;
  toUserName?: string;
  transferTime: string;
  reason?: string;
}

/** 末班记录（考试不合格 → 转班重修；末班不是学生状态） */
export interface ClassRepeat extends BaseEntity {
  studentId: string;
  studentNo: string;
  studentName: string;
  /** 末班时间 */
  repeatTime: string;
  /** 末班原因 */
  repeatReason: string;
  /** 原班级 */
  fromClassId: string;
  fromClassName: string;
  /** 末班班级（转入） */
  toClassId?: string;
  toClassName?: string;
  /** 末班次数（累计） */
  repeatCount: number;
}

/** 出勤记录（按班级按天） */
export interface AttendanceRecord extends BaseEntity {
  classId: string;
  className: string;
  /** 考勤日期 YYYY-MM-DD */
  attendanceDate: string;
  shouldCount: number;
  presentCount: number;
  absentCount: number;
  /** 出勤率（百分比整数） */
  attendanceRate: number;
  teacherName?: string;
  headTeacherName?: string;
}

/** 缺勤明细 */
export interface AttendanceAbsent extends BaseEntity {
  attendanceId: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  className: string;
  phone?: string;
  /** 缺勤原因 */
  absentReason: string;
}

export interface AttendanceQuery {
  page: number;
  size: number;
  classId?: string;
  startDate?: string;
  endDate?: string;
  keyword?: string;
}

/** 考试内容项（笔试 / 机试 / 面试 / 其他，含自定义字段） */
export interface ExamContent {
  id?: string;
  examId?: string;
  examContentType: ExamContentType;
  examContentTypeName?: string;
  /** 满分 */
  fullScore: number;
  /** 自定义内容名称（examContentType = OTHER 时使用，如「作品评分」） */
  contentName?: string;
}

/** 考试信息（对应原型「考试管理」） */
export interface ExamInfo extends BaseEntity {
  examName: string;
  examType: ExamType;
  examTypeName?: string;
  creatorId?: string;
  creatorName?: string;
  /** 考试时间 YYYY-MM-DD */
  examDate: string;
  classId?: string;
  className?: string;
  /** 参考人数 */
  attendeeCount?: number;
  contents: ExamContent[];
}

/** 考试自定义字段（考试管理里可自定义，如「作品评分」「质素分析」） */
export interface ExamCustomField extends BaseEntity {
  fieldKey: string;
  /** 数值 / 文本 */
  fieldType: string;
  defaultValue?: string;
  /** 来源：系统内置 / 自定义字段 */
  source: string;
}

/** 成绩记录（综合成绩 = 笔试 × 50% + 面试 × 50%，后端自动算） */
export interface GradeRecord extends BaseEntity {
  studentId: string;
  studentNo: string;
  studentName: string;
  classId: string;
  className: string;
  examId?: string;
  examName?: string;
  writtenScore?: number;
  machineScore?: number;
  interviewScore?: number;
  /** 综合成绩，后端计算后返回，前端只读 */
  compScore?: number;
  examResult: ExamResult;
  examResultName?: string;
  /** 素质分析（非必填） */
  analysis?: string;
  remark?: string;
}

export interface GradeQuery {
  page: number;
  size: number;
  examId?: string;
  classId?: string;
  studentNo?: string;
  studentName?: string;
  examResult?: ExamResult;
  keyword?: string;
}

/** 学员花名册行（原型「班级信息管理」列表，字段与原型表格一致） */
export interface RosterListItem {
  studentId: string;
  studentNo: string;
  studentName: string;
  gender: Gender;
  genderName: string;
  className?: string;
  age?: number;
  phone?: string;
  parentPhone?: string;
  dormNo?: string;
  enrollDate?: string;
  education?: string;
  studentStatus: number;
  studentStatusName: string;
  repeatCount?: number;
  stage?: number;
  stageName?: string;
  remark?: string;
  qualityTags?: string[];
}
