/**
 * 教务模块类型出口（子路径：shared-types/edu）
 *
 * 用法：
 *   import { StudentListItem, DormQuery, PaymentItem } from 'shared-types/edu';
 *
 * ⚠️ 为什么单独开一个子入口，而不是并进主 index？
 *   教务的 student.ts / dorm.ts 与主包的**同名文件、同名接口**（Student、DormQuery…），
 *   如果并进主 index `export *` 会直接冲突。
 *   做成独立子模块后：
 *     · 教务代码只需把 `from 'shared-types'` 改成 `from 'shared-types/edu'`（类型名一个都不用改）；
 *     · 与主包类型体系完全隔离，互不影响。
 *
 * ⚠️ 公共类型（BizCode / ApiResponse / Gender / StudentStatus…）**从主包 re-export**，
 *    保证与后端 utils/response.ts、middleware/errorHandler.ts 的类型完全一致，
 *    不会出现「教务的 BizCode 传不进主包的 fail()」这种跨边界类型报错。
 *
 * ⚠️ 相对路径必须带 .js 后缀（ESM 规范，见主 index.ts 说明）。
 */

// 通用响应 / 分页 / 业务码（直接用主包的，保证类型统一）
export * from '../common.js';

// 枚举（主包 enums 全量 re-export + 教务独有的 Stage）
export * from './edu-enums.js';

// 学生档案（教务版）
export * from './edu-student.js';

// 宿舍管理（教务版）
export * from './edu-dorm.js';

// 缴费管理（教务版）
export * from './edu-payment.js';
