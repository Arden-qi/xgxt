/**
 * shared-types 统一出口
 *
 * 其他项目引用方式：
 *   import { StudentStatus, STUDENT_STATUS_NAME, PageResponse } from 'shared-types';
 *
 * ⚠️ 注意：这里写的是 './enums.js'（带 .js 后缀），不是 './enums'。
 *    原因：前端浏览器加载的是 ES Module 格式，ESM 规范要求相对路径必须写全后缀。
 *    不写后缀在 Node（后端）能跑，但在浏览器里会报 "Failed to resolve module specifier"。
 */

export * from './enums.js';
export * from './roleAlias.js';
export * from './common.js';
export * from './student.js';
export * from './exam.js';
export * from './class.js';
export * from './classInfo.js';
export * from './class-transfer.js';
export * from './approval.js';
export * from './refund.js';
export * from './studentLeave.js';
export * from './dorm.js';
export * from './feeCall.js';
export * from './api/student.api.js';
export * from './api/exam.api.js';
export * from './api/class.api.js';
export * from './api/class-transfer.api.js';
export * from './api/refund.api.js';
export * from './api/studentLeave.api.js';
export * from './api/dorm.api.js';
export * from './api/feeCall.api.js';
export * from './job.js';
