/* 新账号真实 HTTP 链路验证：登录 → my-pages → 学生/班级数据 */
import { writeFileSync } from 'fs';

const API = 'http://127.0.0.1:8004';
const CASES = [
  { account: 'leiyx', name: '雷雨欣·班主任（高中部）' },
  { account: 'fengcx', name: '冯春霞·班主任（初中部）' },
  { account: 'jicl', name: '纪春兰·教质经理（初中部）' },
  { account: 'renwj', name: '任文静·教员（大学部）' },
  { account: 'zhanght', name: '张海涛·班主任（大学部）' },
];

async function main() {
  for (const c of CASES) {
    try {
      const lr = await fetch(`${API}/api/portal/account/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: c.account, password: '123456' }),
      }).then((r) => r.json());
      const token = lr?.data?.token;
      if (!token) { console.log(`${c.name}: 登录失败 ${JSON.stringify(lr).slice(0, 120)}`); continue; }
      const H = { Authorization: `Bearer ${token}` };
      const mp = await fetch(`${API}/api/perm/page/my-paths`, { headers: H }).then((r) => r.json());
      const paths: string[] = mp?.data?.paths || mp?.data?.pages || [];
      const sum = await fetch(`${API}/api/teaching/student/summary`, { headers: H }).then((r) => r.json());
      const s = sum?.data || {};
      console.log(`${c.name}: 登录✓ my-paths=${paths.length}页 学生汇总=总${s.total ?? '?'} 实训${s.training ?? '?'} 在读${s.studying ?? '?'}`);
      if (c.account === 'leiyx') {
        writeFileSync(new URL('../../输出/_token_leiyx_1024.txt', import.meta.url), token, 'utf8');
      }
    } catch (e: any) {
      console.log(`${c.name}: ERR ${e.message}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
