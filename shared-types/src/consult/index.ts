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

// ---- ⭐ 跨模块统一契约（与财务模块同一份，改必同步）----
//    统一账号 / 模块注册表 / 门户 token 载荷
export * from './portal.js';

// ---- 咨询模块专属契约（本模块内使用）----
export * from './consult-enums.js';
export * from './consult.js';

// ---- ⭐ 权限模块联调契约（与财务模块同一份，改必同步）----
export * from './perm-link.js';

// ---- 接口契约 ----
export * from './api/student.api.js';
export * from './api/consult.api.js';

