import { createServer } from 'node:http';
import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { gunzipSync, gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { applyChange, fail, stores, validId, validateChange } from './contract.mjs';
import { configuredOSS } from './oss-store.mjs';

import { runPlanner } from './planning-agent.mjs';
import { syncKnowledge } from './planning-knowledge.mjs';

const scrypt = promisify(scryptCallback), MAX = 100 * 1024 * 1024, WIRE_MAX = 24 * 1024 * 1024;
export async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('云端密码须为 12～256 个字符。');
  return `scrypt$${salt}$${(await scrypt(password, salt, 64)).toString('hex')}`;
}
const equal = (a, b) => a.length === b.length && timingSafeEqual(a, b);
export function createCloudServer(options = {}) {
  const env = options.env || process.env, passwordHash = options.passwordHash || env.CLOUD_PASSWORD_HASH || '', secret = options.secret || env.CLOUD_SESSION_SECRET || '';
  if (!/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(passwordHash) || secret.length < 32) throw new Error('请配置 CLOUD_PASSWORD_HASH 和至少 32 字符的 CLOUD_SESSION_SECRET。');
  const allowed = new Set(options.origins || (env.CLOUD_ALLOWED_ORIGINS || 'https://booth-planner.pbrick.cn,http://127.0.0.1:3002,http://localhost:3002,http://localhost:3000').split(',').map(s => s.trim()));
  const getStore = options.store ? () => options.store : req => configuredOSS(req, env);
  const sign = payload => createHmac('sha256', secret).update(payload).digest('base64url');
  const failures = new Map();
  const authenticate = req => {
    const token = (req.headers.authorization || '').replace(/^Bearer /, ''), [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra || !equal(Buffer.from(signature), Buffer.from(sign(payload)))) fail(401, '请先登录云端场地库。');
    let claims; try { claims = JSON.parse(Buffer.from(payload, 'base64url')); } catch { fail(401, '云端登录无效，请重新登录。'); }
    if (claims.aud !== 'needflea-library' || !Number.isFinite(claims.exp) || claims.exp < Date.now()) fail(401, '云端登录已过期，请重新登录。');
  };
  async function body(req, limit = MAX) {
    const parts = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > Math.min(limit, WIRE_MAX)) fail(413, '提交内容过大，请减少照片后重试。'); parts.push(chunk); }
    let data = Buffer.concat(parts);
    const encoding = req.headers['content-encoding'];
    if (encoding && encoding !== 'gzip') fail(415, '不支持的上传编码。');
    if (encoding === 'gzip') { try { data = gunzipSync(data, { maxOutputLength: limit }); } catch { fail(413, '压缩数据无效或解压后过大。'); } }
    if (data.length > limit) fail(413, '提交内容过大。');
    try { return JSON.parse(data.toString()); } catch { fail(400, '请求不是有效 JSON。'); }
  }
  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    let stage = 'request';
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, value) => {
      let data = Buffer.from(JSON.stringify(value));
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (data.length > 2048 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) { data = gzipSync(data); res.setHeader('Content-Encoding', 'gzip'); }
      res.writeHead(status, { 'Content-Length': data.length }); res.end(data);
    };
    try {
      if (origin && !allowed.has(origin)) fail(403, '此网站尚未获准连接云端。');
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin, Accept-Encoding'); }
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Content-Encoding');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      const path = new URL(req.url, 'http://cloud.local').pathname;
      if (path === '/health' && req.method === 'GET') { send(200, { service: 'needflea-cloud-library', version: 1 }); return; }
      if (path === '/session' && req.method === 'POST') {
        const key = req.socket.remoteAddress || 'unknown', previous = failures.get(key);
        if (previous && previous.until > Date.now() && previous.count >= 8) fail(429, '密码尝试过多，请十分钟后再试。');
        const input = await body(req, 4096), password = typeof input.password === 'string' ? input.password : '';
        const [, salt, digest] = passwordHash.split('$');
        const derived = await scrypt(password.slice(0, 257), salt, 64);
        if (password.length > 256 || !equal(derived, Buffer.from(digest, 'hex'))) {
          if (failures.size > 1000) for (const [id, record] of failures) if (record.until < Date.now()) failures.delete(id);
          failures.set(key, { count: previous?.until > Date.now() ? previous.count + 1 : 1, until: Date.now() + 600000 });
          fail(401, '云端密码不正确。');
        }
        failures.delete(key);
        const exp = Date.now() + 8*3600000, payload = Buffer.from(JSON.stringify({ aud: 'needflea-library', exp })).toString('base64url');
        send(200, { token: `${payload}.${sign(payload)}`, expiresAt: exp }); return;
      }
      authenticate(req);
      const store = getStore(req);
      if (path === '/planner/run' && req.method === 'POST') {
        stage = 'planner';
        send(200, await runPlanner({ store, env, secret, body: await body(req, 8*1024*1024), fetcher: options.responsesFetch }));
        return;
      }
      if (path === '/planner/sync' && req.method === 'POST') {
        const index = await syncKnowledge(store, env);
        send(200, { schema: index.schema, revision: index.revision, records: index.records.length, policy: index.policy });
        return;
      }
      if (path === '/library' && req.method === 'GET') { send(200, await store.latest()); return; }
      const chunk = path.match(/^\/cad-chunk\/([a-f0-9]{64})$/);
      if (chunk && req.method === 'POST') {
        const {data} = await body(req, 3*1024*1024);
        if (typeof data!=='string') fail(400,'底图片段无效。');
        await store.putCadChunk(chunk[1],Buffer.from(data,'base64')); send(200,{ok:true}); return;
      }
      if (chunk && req.method === 'GET') {
        send(200,{data:(await store.getCadChunk(chunk[1])).toString('base64')}); return;
      }
      const match = path.match(/^\/project\/(projects|activityProjects)\/([^/]+)\/(\d+)$/);
      if (match && req.method === 'GET') {
        const [, kind, encoded, revision] = match, id = decodeURIComponent(encoded);
        if (!validId(id) || !Number.isSafeInteger(Number(revision))) fail(400, '项目编号无效。');
        const manifest = await store.revision(Number(revision)), row = manifest?.[kind]?.find(row => row.id === id);
        if (!row) fail(404, '云端项目不存在，请刷新场地库。');
        send(200, { id, project: await store.readProject(row.hash,new URL(req.url,'http://cloud.local').searchParams.get('chunks')==='1') }); return;
      }
      if (path === '/commit' && req.method === 'POST') {
        stage = 'decode';
        const change = await body(req); validateChange(change);
        const requestHash = createHash('sha256').update(JSON.stringify(change)).digest('hex');
        // A lost response can be retried with the same operation, never a new write.
        const candidate = await store.revision(change.expectedRevision + 1);
        if (candidate?.operationId === change.operationId) {
          if (candidate.requestHash !== requestHash) fail(409, '此保存编号已用于另一份修改，请刷新云端后重试。');
          send(200, candidate); return;
        }
        const current = await store.latest();
        if (current.revision !== change.expectedRevision) fail(409, '云端已被其他设备更新，请刷新云端并重新载入活动后保存。当前画布仍保留。');
        const projectRows = {};
        // Validate all references before uploading any project assets.
        applyChange(current, change, Object.fromEntries(['projects','activityProjects'].map(kind => [kind, (change.changes[kind] || []).map(row => ({ id: row.id, hash: 'pending' }))])));
        const verifiedCad = new Set();
        for (const kind of ['projects', 'activityProjects']) {
          projectRows[kind] = [];
          stage = `write-${kind}`;
          for (const row of change.changes[kind] || []) {
            if (row.project.cloudCadChunks) {
              const signature = JSON.stringify(row.project.cloudCadChunks);
              if (!verifiedCad.has(signature)) { await store.verifyCadChunks(row.project.cloudCadChunks); verifiedCad.add(signature); }
            }
            projectRows[kind].push({ id: row.id, hash: await store.writeProject(row.project) });
          }
        }
        const next = { ...applyChange(current, change, projectRows), requestHash };
        // An older client may echo a final flag during an ordinary layout save.
        // Bind a publication to that explicit action, never to later edits.
        for (const row of projectRows.activityProjects) {
          const previous = current.activities.find(a => a.id === row.id);
          const activity = next.activities.find(a => a.id === row.id);
          const oldHash = current.activityProjects.find(a => a.id === row.id)?.hash;
          if (oldHash !== row.hash && previous?.status === 'final' && activity?.status === 'final' && previous.finalToken === activity.finalToken) {
            const i = next.activities.indexOf(activity);
            next.activities[i] = { ...activity, status: 'draft', finalToken: null };
          }
        }
        stage = 'commit';
        if (!await store.commit(next)) {
          const written = await store.revision(next.revision);
          if (written?.operationId === change.operationId && written.requestHash === requestHash) { send(200, written); return; }
          fail(409, '另一台设备刚刚保存了修改，本次未覆盖云端。请刷新并重新载入活动。');
        }
        send(200, next); return;
      }
      fail(404, '云端接口不存在。');
    } catch (error) {
      // Never return SDK errors containing credential headers, URLs or signatures.
      const code = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(error.code || '') ? error.code : 'StorageError';
      send(error.expose ? error.status : 503, { error: error.expose ? error.message : '云端存储暂时不可用，请稍后重试；当前画布和本地数据仍保留。', ...(!error.expose ? { code, stage } : {}) });
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3005), host = process.env.HOST || '127.0.0.1';
  createCloudServer().listen(port, host, () => console.log(`NEED!FLEA cloud service listening on ${host}:${port}`));
}
