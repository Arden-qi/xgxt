/**
 * 数据库 snake_case ↔ 接口 camelCase 互转
 *
 * 铁律（数据字典第一节 + 接口契约规范）：
 *  - 数据库列名一律下划线小写，如 student_no
 *  - 接口出入参一律小驼峰，如 studentNo
 *  - 两者之间的转换**只在这一处**，业务代码不再手写映射
 */

const toCamelKey = (k: string): string => k.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
const toSnakeKey = (k: string): string => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

/** 单行：{ student_no: 'S1' } → { studentNo: 'S1' } */
export function rowToCamel<T = Record<string, unknown>>(row: Record<string, unknown> | null | undefined): T {
  if (!row) return {} as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[toCamelKey(k)] = normalizeOutValue(v);
  }
  return out as T;
}

/**
 * 出参里的 Date 怎么转成字符串
 *
 * ⚠️ 2026-10-04 修：原来用 `v.toISOString()`，产出
 *    `2026-08-31T16:00:00.000Z` 这种带时区的完整 ISO 串。
 *    问题有两个：
 *      1. **会差 8 小时**（toISOString 转成 UTC，我们的日期是东八区本地日历日）
 *      2. **下游写回 DATE 列会直接报错** —— MySQL 拒收
 *         `Incorrect date value: '2026-08-31T16:00:00.000Z'`
 *         （全流程回归时「升实训接收」就是栽在这，2/3 学员入库失败）
 *
 * 现在统一输出 `YYYY-MM-DD` / `YYYY-MM-DD HH:mm:ss`（本地时区），
 * 与项目约定的 timezone '+08:00' 一致。
 */
function normalizeOutValue(v: unknown): unknown {
  if (!(v instanceof Date)) return v;
  if (Number.isNaN(v.getTime())) return null;
  const y = v.getFullYear();
  const mo = String(v.getMonth() + 1).padStart(2, '0');
  const d = String(v.getDate()).padStart(2, '0');
  const h = String(v.getHours()).padStart(2, '0');
  const mi = String(v.getMinutes()).padStart(2, '0');
  const se = String(v.getSeconds()).padStart(2, '0');
  // DATE 列（无时分秒）→ 只给日期；DATETIME / TIMESTAMP 列 → 给完整时间
  const hasTime = v.getHours() !== 0 || v.getMinutes() !== 0 || v.getSeconds() !== 0;
  return hasTime ? `${y}-${mo}-${d} ${h}:${mi}:${se}` : `${y}-${mo}-${d}`;
}

/** 多行 */
export function rowsToCamel<T = Record<string, unknown>>(rows: Array<Record<string, unknown>> | null | undefined): T[] {
  return (rows ?? []).map((r) => rowToCamel<T>(r));
}

/** 单行：{ studentNo: 'S1' } → { student_no: 'S1' }（跳过 undefined，便于部分更新） */
export function rowToSnake(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined) continue;
    out[toSnakeKey(k)] = v;
  }
  return out;
}

/** 金额：分（整数存库）→ 元（字符串，展示用，保留两位） */
export function fenToYuan(fen: number | null | undefined): string {
  if (fen === null || fen === undefined) return '0.00';
  return (Number(fen) / 100).toFixed(2);
}

/** 金额：元 → 分（入参兼容前端传元） */
export function yuanToFen(yuan: number | string | null | undefined): number {
  if (yuan === null || yuan === undefined || yuan === '') return 0;
  return Math.round(Number(yuan) * 100);
}

/** 把整行里的金额字段追加「元」版本，方便前端直接显示 */
export function withYuan<T extends Record<string, unknown>>(row: T, fields: string[]): T & Record<string, string> {
  const extra: Record<string, string> = {};
  for (const f of fields) {
    extra[`${f}Yuan`] = fenToYuan(row[f] as number | null | undefined);
  }
  return { ...row, ...extra };
}

export { isPlainObject };
