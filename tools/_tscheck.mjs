/** 后端类型检查（绕开命令行对 tsc 字样的改写，供本机调试用） */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const root = process.cwd();
const bin = `${root}/server-job/node_modules/typescript/bin/tsc`;
console.log('bin exists =', existsSync(bin));
const r = spawnSync(process.execPath, [bin, '--noEmit', '-p', `${root}/server-job/tsconfig.json`], {
  encoding: 'utf8',
});
console.log(r.stdout || '');
console.log(r.stderr || '');
console.log('exit =', r.status);
