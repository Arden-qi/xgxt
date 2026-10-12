/**
 * 整份拉取分页数据（下拉框 / 弹窗需要「全部」时用）
 *
 * ⚠️ 为什么必须用它？
 *    后端每个 list 接口的 size 都是 `int().min(1).max(100)`，
 *    直接传 `size: 500` 会被参数校验拒绝（40000），
 *    表现是「弹窗内容莫名其妙是空的」——非常难排查。
 *    所以需要整份数据时，按页拉取直到取完。
 *
 * 用法：
 *   const students = await fetchAllPages((page, size) => fetchStudentList({ page, size }));
 */

import type { PageData } from 'shared-types/class-jh';

/** 后端分页单页上限（与各 list 接口的 max(100) 保持一致） */
const PAGE_SIZE = 100;
/** 安全上限，避免死循环（20 页 = 2000 条） */
const MAX_PAGES = 20;

export async function fetchAllPages<T>(
  fetchPage: (page: number, size: number) => Promise<PageData<T>>,
  maxPages: number = MAX_PAGES,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const data = await fetchPage(page, PAGE_SIZE);
    const list = data?.list ?? [];
    out.push(...list);
    // 已取满总数，或这一页不满（说明是最后一页）
    if (out.length >= (data?.total ?? 0) || list.length < PAGE_SIZE) break;
  }
  return out;
}
