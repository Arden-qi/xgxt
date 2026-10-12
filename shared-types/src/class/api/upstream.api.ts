import { ApiResponse, PageData } from '../common';
import { SyncRequest, SyncResult } from '../sync';

/**
 * 上游模块契约（本模块作为「调用方」）
 *
 * ⚠️ 这些接口由其他模块提供，本模块**只按契约调用**，不实现。
 *    调用时必须：加 5 秒超时；失败要有兜底（页面显示「加载失败」，不能白屏）。
 */

/** 市场咨询（8001，/api/consult/**）：拉取学生基础信息（备选方案，主推上游推送 /api/class/student/sync） */
export interface ConsultStudentQuery {
  page: number;
  size: number;
  deptCode?: number;
  updateTimeStart?: string;
  keyword?: string;
}
export interface ConsultStudentItem {
  studentId: string;
  studentNo: string;
  studentName: string;
  gender: number;
  deptCode: number;
  phone?: string;
  parentPhone?: string;
  studentStatus: number;
  updateTime: string;
}
export type ConsultStudentListResponse = ApiResponse<PageData<ConsultStudentItem>>;

/** 教务管理（8002，/api/edu/**）：催费信息 / 宿舍信息 */
export interface EduUrgeSyncPayload extends SyncRequest<unknown> {}
export interface EduUrgeSyncResponse extends ApiResponse<SyncResult> {}
export interface EduDormSyncPayload extends SyncRequest<unknown> {}
export interface EduDormSyncResponse extends ApiResponse<SyncResult> {}

/** 财务管理（8005，/api/finance/**）：缴费信息 */
export interface FinanceFeeSyncPayload extends SyncRequest<unknown> {}
export interface FinanceFeeSyncResponse extends ApiResponse<SyncResult> {}

/** 跨模块调用统一入参（走 HTTP，不直连库） */
export interface CrossModuleRequest {
  /** 目标服务地址，取自环境变量，不硬编码 */
  baseUrl: string;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** 透传当前登录人 token */
  token: string;
  /** 超时毫秒，默认 5000 */
  timeout?: number;
}
