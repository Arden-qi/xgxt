/**
 * 学生档案域 · 仓储契约
 * ============================================================
 *
 * 【为什么要有这个文件】
 *   适配器（service.ts）要把四个学段当成同一个东西来调度，
 *   所以每个仓储必须提供**同一组签名**。签名写在契约里，
 *   哪个仓储少实现一个方法，`tsc` 立刻报错 —— 不靠人肉记。
 *
 * 【四个仓储各自的库 / 表 / 连接】
 *   repo.classJh.ts → sms_class_jh.t_class_student   （class-jh 的 db）
 *   repo.class.ts   → sms_class.t_class_student      （class 的 db）
 *   repo.job.ts     → sms_job.t_student_base         （主 db）
 *   repo.edu.ts     → sms_edu.t_student_base         （主 db + 全限定名）
 */

import type {
  StudentDetail,
  StudentListQuery,
  StudentRow,
  StudentSaveBody,
  StudentSaveResult,
  StudentStage,
} from '../shared/dto';

/** 统计（卡片用）—— ★ 由**适配器**在「合并 + 去重后」的结果上统一计算，
 *  不放进仓储：否则「全部」视图的卡片会和列表对不上（重复计数）。 */
export interface StudentStat {
  total: number;
  studying: number;
  trial: number;
  suspended: number;
  quit: number;
  unassigned: number;
}

/** 学段内阶段码选项 */
export interface PhaseOption {
  value: number;
  label: string;
}

export interface StudentRepo {
  /** 本仓储对应的学段 */
  readonly stage: StudentStage;
  /** 本学段详情里有哪几个特有区块（前端据此决定显示哪些页签） */
  readonly sections: string[];
  /** 是否支持「只看未分配宿舍」筛选 */
  readonly supportUnassigned: boolean;

  /**
   * 列表（**已按数据范围过滤**；分页由适配器统一做，这里返回全量）
   *
   * ⚠️ 数据范围逻辑**各学段原样保留**（口径不一致 = 数据越权）：
   *    · 实训 → 角色判定（校长/学管/管理员全量；项目经理限自班；班主任限自班）
   *    · 大学 → applyDataScope（dataScope: ALL/DEPT/CLASS/SELF）
   *    · 初高 → buildClassScope + getScopedClassIds
   *    · 教务 → 无范围（原实现就是全量台账）
   */
  list(q: StudentListQuery, user: any): Promise<StudentRow[]>;
  /** 详情 */
  detail(id: string, user: any): Promise<StudentDetail | null>;
  /** 新增 / 修改 */
  save(body: StudentSaveBody, userId: string): Promise<StudentSaveResult>;
  /** 逻辑删除 */
  remove(id: string, userId: string): Promise<void>;
  /** 学段内阶段码可选项 */
  phaseOptions(): Promise<PhaseOption[]>;
}
