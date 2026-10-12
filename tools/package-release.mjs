import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'release');
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const archive = path.join(outputDir, `liangzhi-sms-source-${stamp}.zip`);
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'liangzhi-release-'));
const stage = path.join(tempRoot, 'project');

const excludedDirs = new Set([
  '.git', '.workbuddy', 'node_modules', 'uploads', 'coverage', '.vite',
  '_p4-regress', '_p4-schema-dump', '_out', 'release', '输出', '数据库备份', '数据库导出',
]);
const excludedFiles = (name) => {
  const lower = name.toLowerCase();
  return name === 'README-先看我.md' || lower === '.env' || (lower.startsWith('.env.') && lower !== '.env.example') ||
    lower.endsWith('.log') || lower.endsWith('.bak') || lower.endsWith('.sql') || lower.endsWith('.traineddata.gz') ||
    lower === '_schema-raw.json' || lower.startsWith('_p12-backup-env');
};

async function copySafeTree(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (excludedDirs.has(entry.name) || entry.name === 'dist' || entry.name.startsWith('dist-')) continue;
      await copySafeTree(path.join(from, entry.name), path.join(to, entry.name));
    } else if (!excludedFiles(entry.name)) {
      await fs.copyFile(path.join(from, entry.name), path.join(to, entry.name));
    }
  }
}

try {
  await fs.mkdir(outputDir, { recursive: true });
  await copySafeTree(root, stage);
  const required = ['README.md', 'LICENSE', 'server-job/.env.example', 'tools/start.mjs'];
  const missing = [];
  for (const name of required) {
    if (!await exists(path.join(stage, name))) missing.push(name);
  }
  if (missing.length) throw new Error(`Required release files are missing: ${missing.join(', ')}`);

  const result = spawnSync('tar.exe', ['-a', '-c', '-f', archive, '-C', stage, '.'], {
    encoding: 'utf8', windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || result.stderr || 'tar.exe failed to create the archive');
  }
  console.log(`Created ${archive}`);
  console.log('Excluded: .env files, database exports/backups, uploads, logs, local memory, test artifacts, and build output.');
  console.log('Provide authorized, sanitized database initialization data separately when deploying.');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}
