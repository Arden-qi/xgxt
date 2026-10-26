/**
 * 逐层定位孙敏学生列表为 0 的层
 */
import { visibleStages } from '../src/teaching/student/service';
import * as repoJob from '../src/teaching/student/repo.job';
import { visibleClassIds } from '../src/teaching/shared/dataScope';

async function main() {
  const user = {
    userId: 'U008',
    businessUserId: 'U008',
    account: 'sunmin',
    userName: '孙敏',
    roles: ['RM_PROJECT'],
    permissions: [],
    dataScope: 3,
    modules: ['job', 'class-jh'],
    kind: 'module_owner',
  };
  const stages = await visibleStages(user);
  console.log('① visibleStages:', stages);

  for (const s of ['jh', 'class', 'job', 'emp'] as const) {
    const ids = await visibleClassIds(s, user);
    console.log(`② visibleClassIds(${s}):`, ids === null ? 'null(不限)' : ids);
  }

  if (stages.includes('job')) {
    const r = await REPOS.job.list({ page: 1, size: 10 }, user);
    console.log('③ REPOS.job.list total:', (r as any).rows?.length ?? (r as any).total, JSON.stringify((r as any).rows?.slice(0, 3).map((x: any) => x.studentName)));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
