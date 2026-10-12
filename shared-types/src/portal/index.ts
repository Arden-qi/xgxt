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
export * from './common.js';
export * from './student.js';
export * from './portal.js';
export * from './api/student.api.js';
export * from './api/finance.api.js';

