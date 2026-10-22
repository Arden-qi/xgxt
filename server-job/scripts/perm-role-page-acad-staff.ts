/**
 * 教务老师（R08 / ACAD_STAFF）页面权限：保留「学生档案」+「合并宿舍（初高/实训）」
 *
 * 【做什么】往 `sms_perm.t_perm_role_page` 给 R08 写显式台账行：
 *   /edu/student（学生档案）     enabled=1
 *   /class-jh/dorm（初高宿舍）   enabled=1  ← 合并域「宿舍管理」的 jh 学段
 *   /dorm        （实训宿舍）    enabled=1  ← 合并域「宿舍管理」的 job 学段
 *   其余所有页面               enabled=0  ← 显式去勾
 *
 * 【为什么必须显式写 0】本表是「增量覆盖」语义（见 rolePage.service.ts 头部注释）：
 *   一个角色**一行都没有** → 完全沿用默认（= 现在教务能看到 40 条权限码对应的所有页面）。
 *   只有显式 enabled=0 才能真正把页面藏起来。
 *
 * 【2026-10-20 调整】把「教务自己的宿舍」(/edu/dorm) 去掉，改用三学段合并页
 *   /teaching/dorm（= 后端 /api/teaching/dorm，requireAnyPage 认
 *   classjh:dorm:view / class:dorm:view / job:dorm:view）。
 *   教务老师本就在 pagePermissionSource.ts 的 ACAD_STAFF 里持有
 *   classjh:dorm:view 与 job:dorm:view（初高调宿审批 + 实训宿舍审批），
 *   3dfb416 把这两个页面置 0 时被 applyLedgerToCodes 一并摘掉，导致合并页消失；
 *   本脚本把它们重新 enabled=1，合并宿舍即对教务老师可见。
 *   /edu/dorm 置 0 → edu:dorm:view 被摘掉 → 教务不再有独立教务宿舍入口。
 *
 * 【2026-10-22 变更】独立的「楼栋设置」页(/class-jh/building) 已下线：
 *   楼栋设置搬到「宿舍管理」第 4 个页签（权限走 classjh/class/job:dorm:view），
 *   因此这里不再保留该页面，classjh:building:view 也不再单独授权。
 *
 * 【不改什么】`t_perm_role_perm` 的权限码**不动**（只改页面分配），
 *   所以教务老师在页面之外要用的审批 / 核算能力不受影响。
 */
import { db } from '../src/perm/utils/db.js';

const ROLE_ID = 'R08';
/** ★ 保留的页面（path 必须和 pageRegistry 里的一致） */
const KEEP = ['/edu/student', '/class-jh/dorm', '/dorm'];

async function main() {
  // 1. 先看看要写哪些
  const pages: any[] = await db('t_perm_page')
    .where({ is_deleted: 0 })
    .select('id', 'module_key', 'page_key', 'page_title', 'page_path');
  console.log(`页面总数：${pages.length}`);
  console.log('保留：', pages.filter((p) => KEEP.includes(p.page_path)).map((p) => `${p.module_key}${p.page_path}（${p.page_title}）`).join(' | '));
  const off = pages.filter((p) => !KEEP.includes(p.page_path));
  console.log(`去勾：${off.length} 个页面`);

  // 2. 现有行（含软删，唯一键会撞）
  const exist: any[] = await db('t_perm_role_page').where({ role_id: ROLE_ID });
  const map = new Map(exist.map((r) => [`${r.module_key}||${r.page_path}`, r]));
  console.log(`R08 现有台账行：${exist.length}（含软删 ${exist.filter((r) => Number(r.is_deleted) === 1).length}）`);

  const now = new Date();
  let inserted = 0;
  let updated = 0;
  for (const p of pages) {
    const enabled = KEEP.includes(p.page_path) ? 1 : 0;
    const key = `${p.module_key}||${p.page_path}`;
    const cur = map.get(key);
    if (cur) {
      await db('t_perm_role_page').where({ id: cur.id }).update({
        enabled,
        is_deleted: false,
        update_time: now,
        update_by: 'script:perm-role-page',
      });
      updated += 1;
    } else {
      await db('t_perm_role_page').insert({
        id: (await import('crypto')).randomUUID(),
        create_time: now,
        create_by: 'script:perm-role-page',
        update_time: now,
        update_by: 'script:perm-role-page',
        is_deleted: false,
        role_id: ROLE_ID,
        module_key: p.module_key,
        page_path: p.page_path,
        enabled,
      });
      inserted += 1;
    }
  }
  console.log(`写入完成：新增 ${inserted} 行、更新 ${updated} 行`);

  // 3. 回读校验
  const after: any[] = await db('t_perm_role_page').where({ role_id: ROLE_ID, is_deleted: 0 });
  const on = after.filter((r) => Number(r.enabled) === 1);
  console.log(`回读：R08 生效行 ${after.length}，其中 enabled=1 的 ${on.length} 行 →`, on.map((r) => `${r.module_key}${r.page_path}`).join(' | '));
}

main()
  .catch((e) => console.error('ERR', e))
  .finally(() => process.exit(0));
