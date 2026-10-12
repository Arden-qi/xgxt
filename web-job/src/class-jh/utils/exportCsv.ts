/**
 * CSV 导出（零依赖：原生 Blob + a[download]）
 *
 * ⚠️ 中文乱码：必须加 UTF-8 BOM（\ufeff），否则 Excel 打开是乱码。
 */

/** 单格转义：含逗号/引号/换行时用双引号包裹，内部引号翻倍 */
function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * 导出 CSV 文件。
 *
 * @param filename 文件名（不含扩展名）
 * @param headers  表头数组
 * @param rows     数据行（二维数组，顺序与表头一致）
 */
export function exportCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): void {
  const lines: string[] = [];
  lines.push(headers.map(escapeCell).join(','));
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(','));
  }
  // \r\n 让 Excel 正确换行；前置 BOM 防中文乱码
  const content = '\ufeff' + lines.join('\r\n');

  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
