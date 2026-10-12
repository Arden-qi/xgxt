/**
 * 门户嵌入模式判定（合并版 · shim）
 *
 * ⚠️ 2026-10-05 深度单体合并后，门户不再用 iframe 承载各模块 ——
 *   所有模块页面都是同一个 SPA 里的真实路由，不存在「被 iframe 嵌着」的情况。
 *   因此 isEmbedded() 恒为 false（始终显示完整外壳）。
 *
 * 保留此文件是为了兼容各模块 App.vue / 页面里既有的 isEmbedded() 调用点。
 */

/** 合并后：永远不是嵌入模式 */
export function isEmbedded(): boolean {
  return false;
}

/** 合并后：无需清理 embed 参数 */
export function stripEmbedFlag(): void {
  /* no-op */
}
