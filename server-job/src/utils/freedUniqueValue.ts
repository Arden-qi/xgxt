/**
 * ★ 2026-10-24：逻辑删除时「释放唯一键」的改名值生成器。
 *
 * 【为什么需要】
 *   唯一索引（account / gw_no / phone / role_code …）不认 is_deleted，
 *   软删行占着键，同一个值就没法再次建号。删除时把原值改名腾出键位。
 *
 * 【旧实现的坑（本次 bug）】
 *   旧写法 `${value}#DEL#${Date.now()}` 再 slice(0, 列长) —— 截断的是**尾巴**，
 *   而 13 位毫秒时间戳的前几位在几周内都不变（如 2026 年都是 "1792…"）。
 *   手机号 11 位 + "#DEL#"（5 字符）= 16，列长 20 只剩 4 位时间戳 →
 *   "18931812913#DEL#1792"。同一手机号之前软删过一次（哪怕账号名不同），
 *   再次删除就生成一模一样的值 → 撞唯一键 → ER_DUP_ENTRY
 *   → 前端统一报「数据已存在，请勿重复添加」。
 *   （实例：qitt 旧号 2026-10-19 软删占掉 "18931812913#DEL#1792"，
 *     再删同手机号的 qitiantian 必失败。）
 *
 * 【现在的规则】
 *   后缀 = "#D" + Date.now().toString(36)（固定 10 字符，36 进制无 "#"，不会与
 *   旧格式 "#DEL#…" 撞值）；列长不够时**截原值、绝不截时间戳**——时间戳是
 *   唯一性的唯一保证。同一毫秒内重复删除同值在人工操作下不可能发生。
 *
 * @param original 原值（null/undefined 按空串处理）
 * @param colLen   列字符长度（phone/gw_no=20，account=50，role_code=64 …）
 */
export function freedUniqueValue(original: string | null | undefined, colLen: number): string {
  const suffix = '#D' + Date.now().toString(36);
  const val = String(original ?? '');
  if (val.length + suffix.length <= colLen) return val + suffix;
  return val.slice(0, Math.max(0, colLen - suffix.length)) + suffix;
}
