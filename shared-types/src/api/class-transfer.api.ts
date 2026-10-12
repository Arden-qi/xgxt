/**
 * 班级交接（换班交接）接口响应类型
 *
 * 路径与后端 /api/job/class-transfer 完全一致
 */

import type { PageData } from '../common.js';
import type {
  ClassTransfer,
  ClassTransferListItem,
  ClassTransferResult,
  ClassTransferPreview,
  TeacherOption,
} from '../class-transfer.js';

/* ---------- 交接记录 ---------- */

export type ClassTransferPageResp = PageData<ClassTransferListItem>;
export type ClassTransferDetailResp = ClassTransfer;
export type ClassTransferDoResp = ClassTransferResult;
export type ClassTransferPreviewResp = ClassTransferPreview;
export type ClassTransferTeacherOptionsResp = TeacherOption[];
