// Operator commands use the same scoped OSS role as the cloud service. Archives are private team data.
import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { configuredOSS } from '../cloud/oss-store.mjs';
import { syncKnowledge } from '../cloud/planning-knowledge.mjs';

const [action, path] = process.argv.slice(2);
if (!['export', 'import', 'sync'].includes(action) || (action !== 'sync' && !path))
  throw new Error('用法：node scripts/planner-knowledge.mjs sync | export 私有文件 | import 私有文件');
const store = configuredOSS({ headers: {} }, process.env);
if (action === 'import') {
  const archive = JSON.parse(gunzipSync(await readFile(path)));
  if (archive.schema !== 'NEED! 排布知识 v1' || !Array.isArray(archive.records)) throw new Error('知识包格式不符');
  for (const r of archive.records) {
    if (!/^[a-f0-9]{64}$/.test(r.hash) || !r.data?.facts || typeof r.final !== 'boolean')
      throw new Error('案例资料无效');
    await store.knowledgePut('seeds/' + r.hash + (r.final ? '-final' : '-observation'), r.data);
  }
}
const index = await syncKnowledge(store, process.env);
if (action === 'export') {
  const records = [];
  for (const r of index.records)
    records.push({ hash: r.hash, final: r.final, source: r, data: await store.knowledgeGet('records/' + r.key) });
  await writeFile(path, gzipSync(JSON.stringify({ schema: index.schema, revision: index.revision, records })), {
    mode: 0o600,
    flag: 'wx'
  });
}
console.log(
  JSON.stringify({
    schema: index.schema,
    revision: index.revision,
    versions: index.records.length,
    venues: index.visible?.length || 0,
    activities: index.activities?.length || 0,
    policy: index.policy
  })
);
