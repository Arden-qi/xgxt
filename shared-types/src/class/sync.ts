/**
 * 跨模块数据同步的通用契约
 *
 * 本模块（学管 / 班级管理，8003）需要从三个上游模块同步数据：
 *   - 市场咨询（8001）：学生信息、升学信息
 *   - 教务管理（8002）：催费信息、宿舍信息
 *   - 财务管理（8005）：缴费信息
 *
 * ⚠️ 铁律：不许直接读别人的数据库表，必须通过接口拿数据（见接口契约规范 6.3）
 * ⚠️ 幂等：同一条上游数据重复推送，本模块按 (sourceSystem + sourceId) 更新而不是新增
 */

/** 上游系统标识 */
export enum SourceSystem {
  CONSULT = 'consult', // 市场咨询 8001
  EDU = 'edu',         // 教务管理 8002
  FINANCE = 'finance', // 财务管理 8005
  /** 本模块本地新建（原型「新建宿舍分配」等原型演示数据） */
  CLASS = 'class',     // 学管 / 班级管理 8003
}

/** 同步模式 */
export enum SyncMode {
  /** 全量：本次 items 为上游全量快照，多出的本地记录标记为已删除 */
  FULL = 'full',
  /** 增量：只处理本次 items */
  INCREMENT = 'increment',
}

/** 同步请求（上游 → 本模块） */
export interface SyncRequest<T> {
  /** 上游系统标识 */
  sourceSystem: SourceSystem | string;
  /** 同步模式 */
  syncMode: SyncMode | string;
  /** 批次号（上游生成，用于幂等与追溯） */
  batchNo: string;
  /** 上游数据最后变更时间 YYYY-MM-DD HH:mm:ss */
  sourceUpdateTime?: string;
  /** 数据条目 */
  items: T[];
}

/** 单条失败明细 */
export interface SyncItemError {
  /** 上游主键 */
  sourceId?: string;
  /** 学号（便于人工定位） */
  studentNo?: string;
  /** 失败原因（中文） */
  reason: string;
}

/** 同步结果（本模块 → 上游） */
export interface SyncResult {
  /** 接收条数 */
  accepted: number;
  /** 新增条数 */
  inserted: number;
  /** 更新条数 */
  updated: number;
  /** 跳过条数（无变化 / 幂等命中） */
  skipped: number;
  /** 失败条数 */
  failed: number;
  /** 失败明细 */
  errors: SyncItemError[];
  /** 批次号 */
  batchNo: string;
  /** 处理完成时间 */
  finishTime: string;
}
