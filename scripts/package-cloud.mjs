// Package an allowlist only, never a working directory or an env/config file.
import { access, mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cloud = fileURLToPath(new URL('../cloud/', import.meta.url));
const files = ['bootstrap', 'server.mjs', 'contract.mjs', 'oss-store.mjs', 'package.json', 'package-lock.json', 'node_modules'];
try {
  for (const name of files) await access(join(cloud, name));
  const directory = await mkdtemp(join(tmpdir(), 'needflea-cloud-deploy-')), archive = join(directory, 'needflea-cloud.zip');
  const result = spawnSync('zip', ['-q', '-r', archive, ...files], { cwd: cloud, encoding: 'utf8' });
  if (result.error || result.status) throw new Error(result.error?.message || result.stderr || 'zip 打包失败。');
  console.log(JSON.stringify({ archive, bytes: (await stat(archive)).size, includes: files, credentials: 'none' }, null, 2));
} catch (error) { console.error(error.message + '\n请先运行 npm ci --prefix cloud --ignore-scripts，并确认已安装 zip。'); process.exitCode = 1; }
