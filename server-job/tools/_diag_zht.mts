/** 定位教师账号学生列表 binding 错误 */
import { summaryStudents } from '../src/teaching/student/service';

async function main() {
  const user = {
    userId: 'U004', businessUserId: 'U004', account: 'zhanght', userName: '张海涛',
    roles: ['TEACH_HEAD'], permissions: [], dataScope: 3,
    modules: ['class', 'class-jh'], kind: 'module_owner',
  };
  try {
    const r = await summaryStudents({ page: 1, size: 50 } as any, user);
    console.log('OK', JSON.stringify(r));
  } catch (e: any) {
    console.error('ERR:', e.message);
    console.error((e.stack || '').split('\n').slice(0, 12).join('\n'));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
