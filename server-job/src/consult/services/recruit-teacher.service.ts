/**
 * 招生老师候选（新建学生「来源 = 市场来源」时的下拉数据源）
 *
 * ============================================================
 * 【用户口径（2026-10-26）】
 *   「来源加一个市场来源，市场来源的话，选了市场来源之后选择招生老师，
 *     手机号是一起的，招生老师下拉选项，转介绍的话就不用出现招生老师哪个了」
 *
 *   → 下拉里的人必须是**系统里真实存在的账号**（不能手打姓名），
 *     而且选中后手机号要能一起带出来，所以这里一并查 phone。
 *
 * ============================================================
 * 【谁是「招生老师」？】
 *   ⚠️ 查了权限库的现状：`sms_perm.t_perm_role` 里**没有**独立「招生老师」职位。
 *      三方统一时已经把它并入咨询老师了 —— 见 shared-types/class/enums.ts：
 *         RECRUIT = 'MKT_CONSULT',  // 招生老师（并入咨询老师）
 *      所以这里认的编码是：
 *         ① MKT_CONSULT / MKT_MANAGER（市场咨询部的咨询老师 / 咨询经理）
 *         ② 兜底：任何角色名里带「招生」或编码带 RECRUIT 的自定义职位
 *            （权限管理里新建了「招生部·招生老师」也能自动出现，不用改代码）
 *
 * 【数据源优先级】
 *   ① 门户账号 sms_portal.t_sys_account × sms_perm（唯一事实来源，带 phone）
 *   ② 本模块历史账号表 t_consult_account（老数据 / 权限库不可用时兜底）
 *
 * ⚠️ 全程 try/catch 兜底返回空数组，绝不因为跨库查询失败把「新建学生」整页打挂。
 */

import { db } from '../utils/db';

function permDb(): string {
  return process.env.DB_NAME_PERM || 'sms_perm';
}

function portalDb(): string {
  return process.env.DB_NAME_PORTAL || 'sms_portal';
}

/** 招生老师候选（前端下拉用） */
export interface RecruitTeacherOption {
  id: string;
  /** 姓名 */
  name: string;
  /** 手机号（可能为空：老账号没登记电话） */
  phone?: string;
  /** 岗位 / 部门（下拉副标题） */
  title?: string;
}

/** 门户账号 × 权限库角色 里挑出招生老师 */
async function recruitFromAccounts(): Promise<RecruitTeacherOption[]> {
  try {
    const [rows] = (await db.raw(
      `SELECT a.id            AS id,
              a.user_name     AS userName,
              a.phone         AS phone,
              a.title         AS title,
              a.dept          AS dept,
              r.role_code     AS roleCode,
              r.role_name     AS roleName
         FROM \`${portalDb()}\`.t_sys_account a
         JOIN \`${permDb()}\`.t_perm_user u
           ON u.account = a.account AND u.is_deleted = 0
         JOIN \`${permDb()}\`.t_perm_user_role ur
           ON ur.user_id = u.id AND ur.is_deleted = 0
         JOIN \`${permDb()}\`.t_perm_role r
           ON r.id = ur.role_id AND r.is_deleted = 0
        WHERE a.is_deleted = 0
          AND a.active = 1
          AND (
                r.role_code IN ('MKT_CONSULT', 'MKT_MANAGER')
             OR r.role_code LIKE '%RECRUIT%'
             OR r.role_name LIKE '%招生%'
          )
        ORDER BY a.user_name`,
    )) as unknown as [Array<Record<string, unknown>>, unknown];

    const out: RecruitTeacherOption[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const id = String(r.id ?? '');
      const name = String(r.userName ?? '').trim();
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      const phone = String(r.phone ?? '').trim();
      const title = String(r.title ?? '').trim();
      const dept = String(r.dept ?? '').trim();
      out.push({
        id,
        name,
        phone: phone || undefined,
        title: title || dept || undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** 兜底：本模块历史账号表（老数据 / 权限库查不到时） */
async function recruitFromLocalAccounts(): Promise<RecruitTeacherOption[]> {
  try {
    const rows: any[] = await db('t_consult_account')
      .where({ is_deleted: false, active: true })
      .whereIn('role', ['consult', 'manager', 'admin'])
      .select('id', 'user_name', 'role_title', 'dept', 'phone');
    const out: RecruitTeacherOption[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const id = String(r.id ?? '');
      const name = String(r.user_name ?? '').trim();
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      const phone = String(r.phone ?? '').trim();
      out.push({
        id,
        name,
        phone: phone || undefined,
        title: String(r.role_title || r.dept || '').trim() || undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** 招生老师候选列表（门户账号优先，兜底本模块账号表） */
export async function listRecruitTeachers(): Promise<RecruitTeacherOption[]> {
  const fromAccounts = await recruitFromAccounts();
  if (fromAccounts.length) return fromAccounts;
  return recruitFromLocalAccounts();
}
