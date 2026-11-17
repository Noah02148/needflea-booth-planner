// Interactive only: never accept passwords in arguments, shell history or logs.
import { randomBytes } from 'node:crypto';
import { writeFile, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../cloud/server.mjs';

async function readSecret(prompt) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error('请在交互终端运行，以隐藏密码输入。');
  process.stdout.write(prompt);
  const wasRaw = !!process.stdin.isRaw;
  return new Promise((resolve, reject) => {
    let value = '';
    const done = () => { process.stdin.off('data', data); process.stdin.setRawMode(wasRaw); process.stdin.pause(); process.stdout.write('\n'); };
    function data(chunk) {
      for (const ch of chunk.toString()) {
        if (ch === '\u0003') { done(); reject(new Error('已取消，未写入配置。')); return; }
        if (ch === '\r' || ch === '\n') { done(); resolve(value); return; }
        if (ch === '\u007f' || ch === '\b') value = [...value].slice(0, -1).join('');
        else if (ch >= ' ' && ch !== '\u001b' && value.length < 256) value += ch;
      }
    }
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', data);
  });
}
try {
  if (!process.argv[2] || process.argv.length !== 3) throw new Error('用法：node scripts/configure-cloud-auth.mjs /仓库之外的目录/cloud-auth.env');
  const output = resolve(process.argv[2]);
  const root = await realpath(fileURLToPath(new URL('..', import.meta.url))), parent = await realpath(dirname(output));
  const rel = relative(root, parent);
  if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error('配置须保存在网站仓库之外，避免被静态服务公开。');
  const password = await readSecret('设置云端访问密码（至少 12 字符，输入不显示）：');
  const confirmation = await readSecret('再次输入：');
  if (password !== confirmation) throw new Error('两次密码不同，未写入配置。');
  const passwordHash = await hashPassword(password), secret = randomBytes(32).toString('base64url');
  await writeFile(output, `CLOUD_PASSWORD_HASH='${passwordHash}'\nCLOUD_SESSION_SECRET='${secret}'\n`, { flag: 'wx', mode: 0o600 });
  console.log(`已创建仅本人可读写的配置：${output}。请将两项配置填入 FC 环境变量，不要提交到仓库。`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
