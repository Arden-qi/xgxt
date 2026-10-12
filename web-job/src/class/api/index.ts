/** API 层统一出口：页面只从 '@/api' 引，不直接引具体文件，方便日后换实现 */
// 注意：PageData 在 request.ts 与 types.ts 各导出过一次，直接 `export *` 两者会
// 触发 TS2308 重复导出。这里显式列出 request 需要对外暴露的成员，绕开冲突。
export {
  BizError,
  clearToken,
  del,
  get,
  getToken,
  post,
  put,
  setToken,
  setUnauthorizedHandler,
} from './request';
export type { PageQuery } from './request';
export { default as http } from './request';
export * from './types';
export * from './auth';
export * from './meta';
export * from './student';
export * from './approval';
export * from './class';
export * from './dorm';
export * from './consult';
