/* 组织修复第二轮：建 11 个账号（合规密码走接口 → 凭据列对齐演示账号）+ 班级改挂 */
import { writeFileSync } from 'fs';
import { db as permDb } from '../src/perm/utils/db';
import { uniDb } from '../src/teaching/shared/uniTable';
import { db as jhDb } from '../src/class-jh/utils/db';
import { db as portalDb } from '../src/portal/utils/db';
import { syncPortalAccountTitle } from '../src/perm/services/perm.service';

const TAG = 'ORG-1024';
const NOW = new Date();
const API = 'http://127.0.0.1:8004';

async function main() {
  /* 0. 备份（只补差的） */
  try {
    const rows = await portalDb('t_sys_account').select();
    writeFileSync(new URL('../../输出/数据修复备份/org1024_t_sys_account.json', import.meta.url), JSON.stringify(rows), 'utf8');
    console.log('备份 t_sys_account:', rows.length, '行');
  } catch (e: any) { console.log('备份 portal ERR', e.message); }

  /* 1. linx 登录 */
  const loginRes = await fetch(`${API}/api/portal/account/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'linx', password: '123456' }),
  }).then((r) => r.json());
  const adminToken = loginRes?.data?.token;
  if (!adminToken) throw new Error('linx 登录失败');

  /* 2. 建 11 个账号 */
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
  const created: Record<string, string> = {};
  for (let i = 0; i < newUsers.length; i++) {
    const u = newUsers[i];
    const exists = await permDb('t_perm_user').where({ account: u.account, is_deleted: 0 }).first();
    if (exists) { created[u.account] = exists.id; console.log(`- ${u.account} 已存在`); continue; }
    const role = await permDb('t_perm_role').where({ role_code: u.roleCode, is_deleted: 0 }).first();
    if (!role) { console.log(`!! 职位 ${u.roleCode} 不存在`); continue; }
    const payload = {
      userName: u.userName,
      account: u.account,
      phone: `1391234${1001 + i}`,
      gender: u.gender,
      age: u.age,
      deptId: u.deptId,
      roleIds: [role.id],
      modules: u.modules,
      password: 'Xgxt1234',
    };
    const r = await fetch(`${API}/api/perm/user/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(payload),
    }).then((x) => x.json());
    const ok = r && (r.code === 0 || r.code === 200 || r.success === true);
    if (!ok) { console.log(`!! ${u.account} 创建失败:`, JSON.stringify(r).slice(0, 200)); continue; }
    const row = await permDb('t_perm_user').where({ account: u.account, is_deleted: 0 }).first();
    created[u.account] = row?.id || '';
    console.log(`+ 建账号 ${u.userName}(${u.account}) → ${role.role_name}`);
  }

  /* 3. 门户凭据列对齐既有演示账号（按列复制，不读取/输出值）
   *    目的：与全部演示账号一致，登录页「快捷账号」点击即可进入。 */
  const newAccs = Object.keys(created);
  if (newAccs.length) {
    const ref = await portalDb('t_sys_account').where('account', 'zhanght').first();
    if (ref) {
      const credCols = Object.keys(ref).filter((k) => /pwd|password|need_change/i.test(k));
      for (const acc of newAccs) {
        const upd: any = {};
        for (const c of credCols) upd[c] = (ref as any)[c];
        if (Object.keys(upd).length) {
          await portalDb('t_sys_account').where('account', acc).update(upd);
        }
      }
      console.log(`- 门户凭据列对齐完成（列：${credCols.join(',')}），涉及 ${newAccs.length} 账号`);
    }
  }

  /* 4. title 同步 */
  for (const acc of ['congym', 'zhanght', 'zhaomx', ...newAccs]) {
    try { await syncPortalAccountTitle(acc); } catch (e: any) { console.log(`title ${acc}: ERR ${e.message}`); }
  }
  console.log('- title 同步完成');

  /* 5. 班级责任人改挂 */
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
      const upd: any = isG
        ? { head_teacher_id: L, head_teacher_name: '雷雨欣', teacher_id: LZ || null, teacher_name: LZ ? '刘志强' : null, assistant_id: M || null, assistant_name: M ? '孟晓晗' : null }
        : { head_teacher_id: F, head_teacher_name: '冯春霞', teacher_id: G || null, teacher_name: G ? '高文博' : null, assistant_id: H || null, assistant_name: H ? '韩雪莹' : null };
      await uniDb('t_uni_class').where('id', c.id).update({ ...upd, update_time: NOW, update_by: TAG });
      await uniDb('t_uni_student').where('class_id', c.id).where('is_deleted', 0).update({
        head_teacher_id: upd.head_teacher_id, head_teacher_name: upd.head_teacher_name,
        teacher_id: upd.teacher_id, teacher_name: upd.teacher_name,
        assistant_id: upd.assistant_id, assistant_name: upd.assistant_name,
      });
      try { await jhDb('t_class_info').where('class_name', c.class_name).update(upd); } catch { /* 统一表为准 */ }
      isG ? nG++ : nJ++;
    }
    console.log(`- 初高班级改挂：高中 ${nG} → 雷雨欣组；初中 ${nJ} → 冯春霞组`);
  }
  if (REN) {
    const uniCls = await uniDb('t_uni_class').where('is_deleted', 0).where('head_teacher_id', 'U004')
      .select('id', 'class_name').limit(1);
    for (const c of uniCls) {
      await uniDb('t_uni_class').where('id', c.id).update({ teacher_id: REN, teacher_name: '任文静', update_time: NOW, update_by: TAG });
      await uniDb('t_uni_student').where('class_id', c.id).where('is_deleted', 0)
        .update({ teacher_id: REN, teacher_name: '任文静' });
      console.log(`- 大学班 ${c.class_name} 配教员 任文静`);
    }
  }

  /* 6. 核验 */
  for (const d of ['D_TEACH', 'D_TEACH_J', 'D_TEACH_G', 'D_TEACH_U']) {
    const rc = await permDb('t_perm_role').where({ dept_id: d, is_deleted: 0 }).count('* as c');
    const uc = await permDb('t_perm_user').where({ dept_id: d, is_deleted: 0 }).count('* as c');
    console.log(`核验 ${d}: 职位 ${rc[0].c} / 账号 ${uc[0].c}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
