/**
 * 回归自检：班级管理列表「固定每页 20 条，剩余翻页」
 * ============================================================
 *
 * 【缺陷 / 需求】
 *   2026-10-20 批注：班级管理页的分页器要去掉「条数下拉」（10/20/50/100），
 *   固定每页 20 条，剩余的翻页查看。
 *
 * 【改动】
 *   web-job/src/teaching/views/TeachingClass.vue 的 el-pagination：
 *   layout 去掉 `sizes`、删掉 :page-sizes 与 @size-change。
 *   后端 /api/teaching/class/list 本就按 page/size 服务端分页，不动。
 *
 * 【三层断言】
 *   ① 前端源码级：Vite 实际下发的 TeachingClass.vue 模块里，
 *      分页 layout 不再含 `sizes`，且没有 `page-sizes`（UI 上不会再出条数下拉）
 *   ② 接口级：page=1&size=20 → 返回 size=20，list 条数 = min(total, 20)
 *   ③ 翻页级：page=2&size=20 → total ≤ 20 时为空页；否则恰好是剩余的 total-20 条
 *
 * 【跑法】在 server-job 目录下（依赖 8004/5173 已启动、演示账号已 seed）：
 *     node scripts/_test-class-list-fixed-page20.mjs
 */
import { BASE, login, makeChecker, req } from './_e2e-lib.mjs';

const { check, summary } = makeChecker();

/* ---------- ① 前端源码级：分页器不再有「条数下拉」 ---------- */
const mod = await req(`${BASE}/src/teaching/views/TeachingClass.vue`);
check('TeachingClass.vue 模块可从 Vite 取到', mod.status === 200 && mod.raw.length > 1000);
const src = mod.raw || '';
// Vite 会把模板编译成 render 代码，layout 的值以字符串常量形式出现，属性名形式不定
const layoutVal = (src.match(/["'`]total,\s*([a-z,\s]+)["'`]/) || [])[1] || '';
check(
  '分页 layout 固定为 total/prev/pager/next（无 sizes）',
  !!layoutVal && !layoutVal.includes('sizes'),
  `layout="total, ${layoutVal.trim()}"`.replace('  ', ' '),
);
check('模板中不再出现 page-sizes（条数下拉已删）', !src.includes('page-sizes'));
check('模板中不再监听 size-change', !src.includes('size-change'));
const sizeMatch = src.match(/size:\s*(\d+)/);
check('默认每页条数仍是 20', !!sizeMatch && sizeMatch[1] === '20', sizeMatch?.[0] || '未找到');

/* ---------- ② + ③ 接口级：服务端分页语义 ---------- */
const token = await login('qiansy');
check('演示账号 qiansy 可登录', !!token);

const p1 = await req(`${BASE}/api/teaching/class/list?page=1&size=20`, { token });
check('列表接口 200', p1.status === 200 && !!p1.json?.data, `status=${p1.status}`);
const d1 = p1.json?.data || {};
check('返回 size=20（服务端按 20 条分页）', d1.size === 20, `size=${d1.size}`);
check('page=1 时 list 条数 = min(total, 20)', (d1.list || []).length === Math.min(d1.total || 0, 20),
  `total=${d1.total}, list=${(d1.list || []).length}`);
check('list 内没有超出 20 条（固定每页 20）', (d1.list || []).length <= 20);

const p2 = await req(`${BASE}/api/teaching/class/list?page=2&size=20`, { token });
const d2 = p2.json?.data || {};
const expect2 = Math.max((d1.total || 0) - 20, 0);
check('page=2 恰好是剩余的 total-20 条（total≤20 时为空页）',
  (d2.list || []).length === expect2, `total=${d1.total}, page2=${(d2.list || []).length}, 期望=${expect2}`);

process.exit(summary() ? 0 : 1);
