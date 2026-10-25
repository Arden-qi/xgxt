/**
 * 全账号数据可见性普查 · 2026-10-24
 * 对 9 个教学相关账号，直测：学生档案 listStudents + 班级管理 listClasses
 */
import { summaryStudents } from '../src/teaching/student/service';
import { listClasses } from '../src/teaching/class/service';

const ACCOUNTS: Array<{ account: string; name: string; roles: string[]; uid: string }> = [
  { account: 'sunmin', name: '孙敏·项目经理', roles: ['RM_PROJECT'], uid: 'U008' },
  { account: 'chenxf', name: '陈晓峰·项目经理', roles: ['RM_PROJECT'], uid: 'U_chenxf' },
  { account: 'sunjl', name: '孙建龙·项目经理', roles: ['RM_PROJECT'], uid: 'U_sunjl' },
  { account: 'zhanght', name: '张海涛·班主任(大学部)', roles: ['TEACH_HEAD'], uid: 'U004' },
  { account: 'zhaomx', name: '赵梦雪·助教(大学部)', roles: ['TEACH_ASSIST'], uid: 'U_zhaomx' },
  { account: 'renwj', name: '任文静·教员(大学部)', roles: ['TEACH_TUTOR'], uid: 'U_renwj' },
  { account: 'congym', name: '丛玉梅·学管主任(大学部)', roles: ['TEACH_DEAN'], uid: 'U001' },
  { account: 'fengcx', name: '冯春霞·班主任(初中部)', roles: ['TEACH_HEAD'], uid: 'U_fengcx' },
  { account: 'gaowb', name: '高文博·教员(初中部)', roles: ['TEACH_TUTOR'], uid: 'U_gaowb' },
  { account: 'hanxy', name: '韩雪莹·助教(初中部)', roles: ['TEACH_ASSIST'], uid: 'U_hanxy' },
  { account: 'jicl', name: '纪春兰·教质经理(初中部)', roles: ['TEACH_DEAN'], uid: 'U_jicl' },
  { account: 'leiyx', name: '雷雨欣·班主任(高中部)', roles: ['TEACH_HEAD'], uid: 'U_leiyx' },
  { account: 'liuzq', name: '刘志强·教员(高中部)', roles: ['TEACH_TUTOR'], uid: 'U_liuzq' },
  { account: 'mengxh', name: '孟晓晗·助教(高中部)', roles: ['TEACH_ASSIST'], uid: 'U_mengxh' },
  { account: 'pengyq', name: '彭雅琴·教质经理(高中部)', roles: ['TEACH_DEAN'], uid: 'U_pengyq' },
  { account: 'zhouj', name: '周杰·就业老师', roles: ['JOB_STAFF'], uid: 'U009' },
  { account: 'zhengym', name: '郑一鸣·教务', roles: ['ACAD_STAFF'], uid: 'U011' },
  { account: 'qiansy', name: '钱守义·校长', roles: ['RM_PRINCIPAL'], uid: 'U012' },
];

/** 2026-10-24 晚：uid 改为按权限库账号现查（新账号 id 是 UUID，不能写死） */
async function resolveUids() {
  const { db } = await import('../src/perm/utils/db');
  for (const a of ACCOUNTS) {
    const row = await db('t_perm_user').where({ account: a.account, is_deleted: 0 }).first();
    if (row) a.uid = row.id;
  }
}

function mkUser(a: typeof ACCOUNTS[number], modules: string[]) {
  return {
    userId: a.uid, businessUserId: a.uid, account: a.account, userName: a.name.split('·')[0],
    roles: a.roles, permissions: [], deptCode: 2,
    // ★ 2026-10-24 中间件口径：教学域角色 dataScope 一律 ALL（部门闸放开，隔离交给 visibleClassIds）
    dataScope: 4, modules, kind: 'module_owner',
  };
}

async function main() {
  await resolveUids();
  console.log('账号 | 学生档案(学段→条数) | 班级管理(学段→条数)');
  for (const a of ACCOUNTS) {
    const mods = a.roles.includes('RM_PROJECT') || a.roles.includes('JOB_STAFF') ? ['job']
      : a.roles.includes('TEACH_HEAD') || a.roles.includes('TEACH_ASSIST') ? ['class', 'class-jh']
      : a.roles.includes('SYS_ADMIN') ? [] : ['job', 'class', 'class-jh'];
    const user = mkUser(a, mods);
    const parts: string[] = [];
    try {
      const r = await summaryStudents({ page: 1, size: 200 } as any, user);
      parts.push(`学生:总${(r as any).total} 实训${(r as any).training} 在读${(r as any).studying}`);
    } catch (e: any) {
      parts.push(`学生:ERR(${e.message?.slice(0, 40)} @ ${(e.stack || '').split('\n')[1]?.trim().slice(0, 80)})`);
    }
    try {
      const r2 = await listClasses({ page: 1, size: 200 } as any, user);
      const rows2 = (r2 as any).rows || (r2 as any).list || [];
      const byStage2: Record<string, number> = {};
      for (const row of rows2) byStage2[(row as any).stage] = (byStage2[(row as any).stage] || 0) + 1;
      parts.push('班级:' + (Object.entries(byStage2).map(([k, v]) => `${k}=${v}`).join(',') || '0'));
    } catch (e: any) {
      parts.push(`班级:ERR(${e.message?.slice(0, 40)} @ ${(e.stack || '').split('\n')[1]?.trim().slice(0, 80)})`);
    }
    console.log(`${a.name} | ${parts.join(' | ')}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
