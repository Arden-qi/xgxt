/**
 * 班级管理子模块（原 8003 · 学管主体）
 *
 * ============================================================
 * 【为什么做成独立子模块】
 * ============================================================
 *   班级模块和我们主包同源，但已经各自分叉：
 *
 *   | 枚举          | 班级版                        | 主包版                      |
 *   |---------------|-------------------------------|-----------------------------|
 *   | SuspendStatus | 1/2/3待校长/4/5 （5 值）       | 1/2/3已同意/4 （4 值）      |
 *   | ClassStatus   | 1开放/2封班/5实训中            | 1开放/2封班/3待结业/4已结业 |
 *   | RefundStatus  | 1~8（含已撤回）                | 1~7                         |
 *   | StudentStatus | 3/5/6/7/8（5 值，是子集）      | 1~11（11 值）               |
 *   | DeptCode      | 只有 UNIVERSITY(2)             | JUNIOR_SENIOR(1)+UNIV(2)    |
 *
 *   所以整份保留在子模块里，班级代码只改 import 路径：
 *     from 'shared-types'  →  from 'shared-types/class'
 *
 * ============================================================
 * 【使用注意】
 * ============================================================
 *   1. 本子模块的 SuspendStatus / ClassStatus / RefundStatus
 *      与主包同名但值不同，不要混用。
 *   2. 跨模块传数据时只认「值一致」的这几个：
 *      Gender / DeptCode / StudentStatus / PayStatus / DataScope / ApplyStatus
 *   3. 本子模块的 ApiResponse / BizCode 也是班级自己那版
 *      （结构一致、错误码是主包的超集，运行时兼容）
 */

export * from './enums.js';
export * from './common.js';
export * from './sync.js';
export * from './student.js';
export * from './class.js';
export * from './edu.js';
export * from './finance.js';
export * from './approval.js';
export * from './notify.js';
export * from './perm.js';
export * from './api/class.api.js';
export * from './api/auth.api.js';
export * from './api/perm.api.js';
export * from './api/upstream.api.js';
