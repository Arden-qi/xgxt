import { db } from '../src/perm/utils/db';
import { deriveDefaultPaths } from '../src/utils/rolePageDefaults';
import { PERM_TREE } from '../src/perm/config/permTree';

async function main() {
  for (const code of ['SYS_ADMIN', 'RM_PRINCIPAL']) {
    const set = await deriveDefaultPaths(code);
    const miss: string[] = [];
    for (const b of PERM_TREE) for (const p of b.pages) {
      if (!set.has(`${b.moduleKey}||${p.path}`)) miss.push(`${b.name}/${p.name}(${p.path})`);
    }
    console.log(code, '缺:', miss.join(', ') || '无');
  }
  await db.destroy();
}
main();
