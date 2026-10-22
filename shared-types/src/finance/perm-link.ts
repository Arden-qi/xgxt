/**
 * ⭐ 权限模块联调契约（财务侧出口）
 *
 * ⚠️⚠️ 2026-10-22 重写为「单点转发」：
 *   历史上这份文件与 `src/consult/perm-link.ts` 是两份手工复制的副本，
 *   只改其中一份就会出现「改了没生效」的假象 —— 实测踩坑：
 *   FIN_PERM_ITEM_TO_MENU 只更新了 consult 那份，而财务侧代码
 *   `import { financeMenusFromPerm } from 'shared-types/finance'`
 *   解析到的是本文件，映射仍是旧的功能点名（试学学费名单 / 正式学费名单…），
 *   于是权限树改成「板块 → 页面」之后，财务账号的 menuKeys 永远只有 ['finance']。
 *
 *   现在唯一事实来源是 `src/consult/perm-link.ts`，本文件只做转发。
 *   以后再改映射 / 换算逻辑，只改 consult 那一份即可。
 */

export * from '../consult/perm-link.js';
