/* ============================================================
 * 部门-职位-账号 结构对齐修复（2026-10-24）
 * ============================================================
 * 目标结构（教学部）：
 *   初中部 D_TEACH_J：班主任（R03）、教员（R04）、助教（R05）、
 *                     教质经理（R06）、学术经理（R07）—— 原 6 职位移挂并更名
 *   高中部 D_TEACH_G：班主任（高中部）/教员/助教/教质经理/学术经理
 *                     —— 自建职位（equiv 声明等价内置码）
 *   大学部 D_TEACH_U：班主任（大学部）/教员/助教（自建） + 学管主任（R15 移挂）
 * 账号：一职位一账号（11 个新建 + 3 个既有对齐）
 * 数据：初高班级责任人改挂初中/高中部班主任；大学部教员配班
 * 幂等：全部按 code/account 查重，可重复执行
 * ============================================================ */
import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import { db as permDb } from '../src/perm/utils/db';
import { uniDb } from '../src/teaching/shared/uniTable';
import { db as jhDb } from '../src/class-jh/utils/db';
import { syncPortalAccountTitle } from '../src/perm/services/perm.service';

const TAG = 'ORG-1024';
const NOW = new Date();
const API = 'http://127.0.0.1:8004';

/* ---------- 0. 备份 ---------- */
async function dump(conn: any, table: string, name: string) {
  try {
    const rows = await conn(table).select();
    writeFileSync(
      new URL(`../../输出/数据修复备份/${name}.json`, import.meta.url),
      JSON.stringify(rows),
      'utf8',
    );
    console.log(`备份 ${name}: ${rows.length} 行`);
  } catch (e: any) {
    console.log(`备份 ${name}: ERR ${e.message}`);
  }
}

/** 克隆行：重新生成主键 + 覆盖字段 */
function cloneRow(row: any, overrides: Record<string, any>): any {
  const out: any = { ...row };
  if ('id' in out) out.id = overrides.id ?? randomUUID();
  delete overrides.id;
  Object.assign(out, overrides);
  if ('create_time' in out) out.create_time = NOW;
  if ('update_time' in out) out.update_time = NOW;
  if ('create_by' in out) out.create_by = TAG;
  if ('update_by' in out) out.update_by = TAG;
  return out;
}

async function main() {
  /* ---------- 0. 备份 ---------- */
  await dump(permDb, 't_perm_role', 'org1024_t_perm_role');
  await dump(permDb, 't_perm_role_perm', 'org1024_t_perm_role_perm');
  await dump(permDb, 't_perm_role_page', 'org1024_t_perm_role_page');
  await dump(permDb, 't_perm_user', 'org1024_t_perm_user');
  await dump(permDb, 't_perm_user_role', 'org1024_t_perm_user_role');
  await dump(permDb, 't_perm_dept', 'org1024_t_perm_dept');
  await dump(uniDb, 't_uni_class', 'org1024_t_uni_class');
  await dump(jhDb, 't_class_info', 'org1024_jh_t_class_info');

  /* ---------- 1. 部门说明 ---------- */
  const deptSample = await permDb('t_perm_dept').where('id', 'D_TEACH').first();
  const descCol = Object.keys(deptSample).find((k) => /desc|remark|intro/i.test(k));
  console.log('部门说明列 =', descCol);
  if (descCol) {
    await permDb('t_perm_dept').where('id', 'D_TEACH').update({ [descCol]: '下设初中部、高中部、大学部' });
    await permDb('t_perm_dept').where('id', 'D_TEACH_J').update({ [descCol]: '班主任、教员、助教、教质经理、学术经理' });
    await permDb('t_perm_dept').where('id', 'D_TEACH_G').update({ [descCol]: '班主任、教员、助教、教质经理、学术经理' });
    await permDb('t_perm_dept').where('id', 'D_TEACH_U').update({ [descCol]: '班主任、教员、助教、学管主任' });
    console.log('① 部门说明已更新');
  }

  /* ---------- 2. 基础职位移挂 + 更名（初中部 5 个 / 大学部学管主任） ---------- */
  const baseMoves: Array<[string, string, string]> = [
    ['R03', '班主任（初中部）', 'D_TEACH_J'],
    ['R04', '教员（初中部）', 'D_TEACH_J'],
    ['R05', '助教（初中部）', 'D_TEACH_J'],
    ['R06', '教质经理（初中部）', 'D_TEACH_J'],
    ['R07', '学术经理（初中部）', 'D_TEACH_J'],
    ['R15', '学管主任', 'D_TEACH_U'],
  ];
  for (const [id, name, dept] of baseMoves) {
    await permDb('t_perm_role').where('id', id).update({
      role_name: name,
      dept_id: dept,
      update_time: NOW,
      update_by: TAG,
    });
  }
  console.log('② 基础职位移挂完成（初中部 5 + 学管主任→大学部）');

  /* ---------- 3. 自建职位（高中部 5 + 大学部 3，equiv 声明等价内置码） ---------- */
  const newRoles: Array<{
    id: string; code: string; name: string; dept: string; equiv: string; from: string;
  }> = [
    { id: 'R_BZR_G', code: 'BZR_G', name: '班主任（高中部）', dept: 'D_TEACH_G', equiv: 'TEACH_HEAD', from: 'R03' },
    { id: 'R_JY_G', code: 'JY_G', name: '教员（高中部）', dept: 'D_TEACH_G', equiv: 'TEACH_TUTOR', from: 'R04' },
    { id: 'R_ZJ_G', code: 'ZJ_G', name: '助教（高中部）', dept: 'D_TEACH_G', equiv: 'TEACH_ASSIST', from: 'R05' },
    { id: 'R_JZJL_G', code: 'JZJL_G', name: '教质经理（高中部）', dept: 'D_TEACH_G', equiv: 'TEACH_DEAN', from: 'R06' },
    { id: 'R_XSJL_G', code: 'XSJL_G', name: '学术经理（高中部）', dept: 'D_TEACH_G', equiv: 'TEACH_DEAN', from: 'R07' },
    { id: 'R_BZR_U', code: 'BZR_U', name: '班主任（大学部）', dept: 'D_TEACH_U', equiv: 'TEACH_HEAD', from: 'R03' },
    { id: 'R_JY_U', code: 'JY_U', name: '教员（大学部）', dept: 'D_TEACH_U', equiv: 'TEACH_TUTOR', from: 'R04' },
    { id: 'R_ZJ_U', code: 'ZJ_U', name: '助教（大学部）', dept: 'D_TEACH_U', equiv: 'TEACH_ASSIST', from: 'R05' },
  ];
  for (const nr of newRoles) {
    const exists = await permDb('t_perm_role').where('role_code', nr.code).first();
    if (exists) {
      console.log(`③ ${nr.code} 已存在，跳过建职位`);
      continue;
    }
    const base = await permDb('t_perm_role').where('id', nr.from).first();
    const row = cloneRow(base, {
      id: nr.id,
      role_name: nr.name,
      role_code: nr.code,
      dept_id: nr.dept,
      equiv_role_code: nr.equiv,
      is_sys: 0,
      create_time: NOW,
      update_time: NOW,
      create_by: TAG,
      update_by: TAG,
    });
    await permDb('t_perm_role').insert(row);

    // 权限点全量复制
    const perms = await permDb('t_perm_role_perm').where({ role_id: nr.from, is_deleted: 0 });
    if (perms.length) {
      const rows = perms.map((p: any) => cloneRow(p, { role_id: nr.id }));
      await permDb('t_perm_role_perm').insert(rows);
    }
    // 页面台账全量复制
    const pages = await permDb('t_perm_role_page').where({ role_id: nr.from, is_deleted: 0 });
    if (pages.length) {
      const rows = pages.map((p: any) => cloneRow(p, { role_id: nr.id }));
      await permDb('t_perm_role_page').insert(rows);
    }
    await permDb('t_perm_role').where('id', nr.id).update({ perm_count: perms.length });
    console.log(`③ 建职位 ${nr.name}(${nr.code}) equiv=${nr.equiv} 权限点${perms.length} 页面行${pages.length}`);
  }

  /* ---------- 4. 既有教学账号对齐（部门 + 职位重绑） ---------- */
  async function rebind(userId: string, oldRoleId: string | null, newRoleId: string, newDept: string | null) {
    if (oldRoleId) {
      const link = await permDb('t_perm_user_role')
        .where({ user_id: userId, role_id: oldRoleId, is_deleted: 0 }).first();
      if (link) {
        await permDb('t_perm_user_role').where({ user_id: userId, role_id: oldRoleId, is_deleted: 0 })
          .update({ is_deleted: 1, update_time: NOW });
      }
    }
    const hasNew = await permDb('t_perm_user_role')
      .where({ user_id: userId, role_id: newRoleId, is_deleted: 0 }).first();
    if (!hasNew) {
      const sample = await permDb('t_perm_user_role').first();
      const ins: any = { user_id: userId, role_id: newRoleId, is_deleted: 0, create_time: NOW, create_by: TAG };
      if (sample && 'id' in sample) ins.id = randomUUID();
      if (sample && 'update_time' in sample) ins.update_time = NOW;
      await permDb('t_perm_user_role').insert(ins);
    }
    if (newDept) await permDb('t_perm_user').where('id', userId).update({ dept_id: newDept, update_time: NOW, update_by: TAG });
    console.log(`④ ${userId} → ${newRoleId}${newDept ? ' @' + newDept : ''}`);
  }
  await rebind('U004', 'R03', 'R_BZR_U', 'D_TEACH_U');      // 张海涛 → 班主任（大学部）
  await rebind('U_zhaomx', 'R05', 'R_ZJ_U', 'D_TEACH_U');   // 赵梦雪 → 助教（大学部）
  await rebind('U001', null, 'R15', 'D_TEACH_U');           // 丛玉梅 → 学管主任 @ 大学部

  /* ---------- 5. 新建 11 个账号（走管理接口，门户联动全服务端完成） ---------- */
  const loginRes = await fetch(`${API}/api/portal/account/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'linx', password: '123456' }),
  }).then((r) => r.json());
  const adminToken = loginRes?.data?.token;
  if (!adminToken) throw new Error('linx 登录失败: ' + JSON.stringify(loginRes).slice(0, 200));

  const newUsers = [
    { userName: '冯春霞', account: 'fengcx', gender: 2, age: 32, deptId: 'D_TEACH_J', roleCode: 'TEACH_HEAD', modules: ['class-jh', 'class'] },
    { userName: '高文博', account: 'gaowb', gender: 1, age: 35, deptId: 'D_TEACH_J', roleCode: 'TEACH_TUTOR', modules: ['class-jh', 'class'] },
    { userName: '韩雪莹', account: 'hanxy', gender: 2, age: 27, deptId: 'D_TEACH_J', roleCode: 'TEACH_ASSIST', modules: ['class-jh', 'class'] },
    { userName: '纪春兰', account: 'jicl', gender: 2, age: 38, deptId: 'D_TEACH_J', roleCode: 'TEACH_QTY', modules: ['class-jh', 'class', 'job'] },
    { userName: '康正阳', account: 'kangzy', gender: 1, age: 40, deptId: 'D_TEACH_J', roleCode: 'ACAD_MANAGER', modules: ['class-jh', 'class', 'job'] },
    { userName: '雷雨欣', account: 'leiyx', gender: 2, age: 30, deptId: 'D_TEACH_G', roleCode: 'BZR_G', modules: ['class-jh', 'class'] },
    { userName: '刘志强', account: 'liuzq', gender: 1, age: 34, deptId: 'D_TEACH_G', roleCode: 'JY_G', modules: ['class-jh', 'class'] },
    { userName: '孟晓晗', account: 'mengxh', gender: 2, age: 26, deptId: 'D_TEACH_G', roleCode: 'ZJ_G', modules: ['class-jh', 'class'] },
    { userName: '彭雅琴', account: 'pengyq', gender: 2, age: 37, deptId: 'D_TEACH_G', roleCode: 'JZJL_G', modules: ['class-jh', 'class', 'job'] },
    { userName: '齐志远', account: 'qizy', gender: 1, age: 42, deptId: 'D_TEACH_G', roleCode: 'XSJL_G', modules: ['class-jh', 'class', 'job'] },
    { userName: '任文静', account: 'renwj', gender: 2, age: 29, deptId: 'D_TEACH_U', roleCode: 'JY_U', modules: ['class'] },
  ];
  const created: Record<string, string> = {}; // account -> perm user id
  for (let i = 0; i < newUsers.length; i++) {
    const u = newUsers[i];
    const exists = await permDb('t_perm_user').where({ account: u.account, is_deleted: 0 }).first();
    if (exists) {
      created[u.account] = exists.id;
      console.log(`⑤ ${u.account} 已存在，跳过`);
      continue;
    }
    const role = await permDb('t_perm_role').where({ role_code: u.roleCode, is_deleted: 0 }).first();
    if (!role) throw new Error(`职位 ${u.roleCode} 不存在`);
    const payload: any = {
      userName: u.userName,
      account: u.account,
      phone: `1390000100${i + 1}`,
      gender: u.gender,
      age: u.age,
      deptId: u.deptId,
      roleIds: [role.id],
      modules: u.modules,
      password: '123456',
    };
    const r = await fetch(`${API}/api/perm/user/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(payload),
    }).then((x) => x.json());
    if (r?.code !== 0 && r?.code !== 200 && r?.success !== true) {
      console.log(`⑤ ${u.account} 创建失败:`, JSON.stringify(r).slice(0, 260));
      continue;
    }
    const row = await permDb('t_perm_user').where({ account: u.account, is_deleted: 0 }).first();
    created[u.account] = row?.id || '';
    console.log(`⑤ 建账号 ${u.userName}(${u.account}) → ${role.role_name}`);
  }

  /* ---------- 6. 全部教学账号 title 同步 ---------- */
  for (const acc of ['congym', 'zhanght', 'zhaomx', ...Object.keys(created)]) {
    try { await syncPortalAccountTitle(acc); } catch (e: any) { console.log(`title 同步 ${acc}: ERR ${e.message}`); }
  }
  console.log('⑥ 门户 title 同步完成');

  /* ---------- 7. 班级责任人改挂（初高 → 新学段教师；大学部配教员） ---------- */
  const L = created['leiyx']; const F = created['fengcx'];
  const LZ = created['liuzq']; const G = created['gaowb'];
  const M = created['mengxh']; const H = created['hanxy'];
  const REN = created['renwj'];
  if (L && F) {
    const jhClasses = await uniDb('t_uni_class').where('is_deleted', 0).where('dept_code', 1)
      .select('id', 'class_name');
    let nG = 0; let nJ = 0;
    for (const c of jhClasses) {
      const isG = /^G/i.test(c.class_name || '');
      const upd = isG
        ? { head_teacher_id: L, head_teacher_name: '雷雨欣', teacher_id: LZ || null, teacher_name: LZ ? '刘志强' : null, assistant_id: M || null, assistant_name: M ? '孟晓晗' : null }
        : { head_teacher_id: F, head_teacher_name: '冯春霞', teacher_id: G || null, teacher_name: G ? '高文博' : null, assistant_id: H || null, assistant_name: H ? '韩雪莹' : null };
      await uniDb('t_uni_class').where('id', c.id).update({ ...upd, update_time: NOW, update_by: TAG });
      await uniDb('t_uni_student').where('class_id', c.id).where('is_deleted', 0).update({
        head_teacher_id: upd.head_teacher_id, head_teacher_name: upd.head_teacher_name,
        teacher_id: upd.teacher_id, teacher_name: upd.teacher_name,
        assistant_id: upd.assistant_id, assistant_name: upd.assistant_name,
      });
      try {
        await jhDb('t_class_info').where('class_name', c.class_name).update(upd);
      } catch { /* 老表列可能不全，统一表为准 */ }
      isG ? nG++ : nJ++;
    }
    console.log(`⑦ 初高班级改挂：高中 ${nG} 个 → 雷雨欣组；初中 ${nJ} 个 → 冯春霞组`);
  }
  if (REN) {
    const uniCls = await uniDb('t_uni_class').where('is_deleted', 0).where('head_teacher_id', 'U004')
      .select('id', 'class_name').limit(1);
    for (const c of uniCls) {
      await uniDb('t_uni_class').where('id', c.id).update({ teacher_id: REN, teacher_name: '任文静', update_time: NOW, update_by: TAG });
      await uniDb('t_uni_student').where('class_id', c.id).where('is_deleted', 0)
        .update({ teacher_id: REN, teacher_name: '任文静' });
      console.log(`⑦ 大学班 ${c.class_name} 配教员 任文静`);
    }
  }

  /* ---------- 8. 结果核验 ---------- */
  const depts = ['D_TEACH', 'D_TEACH_J', 'D_TEACH_G', 'D_TEACH_U'];
  for (const d of depts) {
    const rc = await permDb('t_perm_role').where({ dept_id: d, is_deleted: 0 }).count('* as c');
    const uc = await permDb('t_perm_user').where({ dept_id: d, is_deleted: 0 }).count('* as c');
    console.log(`⑧ ${d}: 职位 ${rc[0].c} / 账号 ${uc[0].c}`);
  }
  const accs = await permDb('t_sys_account_x').limit(0).catch?.(() => []) ?? [];
  void accs;
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
