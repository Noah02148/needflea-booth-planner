/** Local World API bridge. Credentials never reach the static webpage. */
import { createServer } from 'node:http';
import * as http from 'node:http';
import { mkdir, readFile, writeFile, rename, readdir, stat } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { prepareMarblePhotos } from './marble-photo-input.mjs';
import { validateMarbleInput, buildMarbleRequest, estimateMarbleCost } from './marble-contract.mjs';

const active = job => ['submitting', 'generating', 'unknown'].includes(job.status);
export function createMarbleServer({ apiKey = process.env.WORLDLABS_API_KEY, dataDir = process.env.MARBLE_DATA_DIR || join(tmpdir(), 'needflea-marble'), fetchImpl = fetch, dailyLimit = Number(process.env.MARBLE_DAILY_LIMIT || 10) } = {}) {
  const jobs = new Map(), polling = new Map(), downloads = new Map(), transfers = new Map();
  let submitting = false;
  const ready = (async () => {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    for (const file of await readdir(dataDir)) {
      if (!/^[a-f\d-]{36}\.json$/i.test(file)) continue;
      const job = JSON.parse(await readFile(join(dataDir, file), 'utf8'));
      if (job.status === 'submitting') { job.status = 'unknown'; job.message = '提交期间服务中断，请先在 World Labs 控制台确认是否已扣费或生成。不会自动重复提交。'; }
      jobs.set(job.id, job);
    }
  })();
  const save = async job => {
    const path = join(dataDir, `${job.id}.json`), temp = path + '.tmp';
    await writeFile(temp, JSON.stringify(job), { mode: 0o600 }); await rename(temp, path);
  };
  async function api(path, body) {
    if (!apiKey) throw new Error('请在服务端配置 WORLDLABS_API_KEY 后重启 Marble 服务');
    const response = await fetchImpl(`https://api.worldlabs.ai/marble/v1/${path}`, {
      method: body ? 'POST' : 'GET', headers: { 'WLT-Api-Key': apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) {
      const err = new Error(({ 400: 'Marble 拒绝了输入，请检查照片与输入方式', 401: 'Marble API Key 无效，请检查服务端配置', 402: 'Marble API 额度不足，请到 World Labs 开发平台充值', 422: 'Marble 输入格式未通过校验', 429: 'Marble 请求过于频繁，请稍后查询现有任务' })[response.status] || 'World Labs 暂时不可用，请稍后查询现有任务');
      err.httpStatus = response.status; throw err;
    }
    return response.json();
  }
  function acceptOperation(job, operation) {
    job.updatedAt = Date.now();
    if (typeof operation.operation_id === 'string') job.operationId = operation.operation_id;
    if (operation.done && operation.error) { job.status = 'failed'; job.message = 'Marble 生成失败，请到 World Labs 控制台查看任务；原环境未修改。'; return; }
    if (operation.done) {
      const world = operation.response;
      if (!world?.assets?.splats?.spz_urls || !world.world_id) throw new Error('Marble 返回的场景资源不完整');
      job.worldId = world.world_id; job.assets = world.assets;
      job.costCredits = typeof operation.cost?.total_credits === 'number' ? operation.cost.total_credits : null;
      job.status = 'complete'; job.message = 'Marble 生成完成，可以加载预览并与 CAD 校准'; job.percent = 100;
    } else {
      job.status = 'generating'; job.message = 'Marble 正在生成场地环境';
      const percent = operation.metadata?.progress_percentage ?? operation.metadata?.progress_percent;
      job.percent = typeof percent === 'number' && Number.isFinite(percent) ? Math.max(0, Math.min(99, percent)) : null;
    }
    job.updatedAt = Date.now();
  }
  function publicJob(job, base) {
    const output = { id: job.id, requestId: job.requestId, status: job.status, message: job.message, percent: job.percent ?? null, createdAt: job.createdAt, updatedAt: job.updatedAt || null, model: job.model, mode: job.mode, preparation: job.preparation || null, costCredits: job.costCredits ?? null };
    if (job.status === 'complete') {
      const spzUrls = {};
      for (const resolution of ['100k', '500k', 'full_res']) if (job.assets.splats.spz_urls[resolution]) spzUrls[resolution] = `${base}/assets/${job.id}/${resolution}.spz`;
      output.asset = { worldId: job.worldId, model: job.model, spzUrls, colliderUrl: job.assets.mesh?.collider_mesh_url ? `${base}/assets/${job.id}/collider.glb` : null,
        metricScale: job.assets.splats.semantics_metadata?.metric_scale_factor ?? 1, groundOffset: job.assets.splats.semantics_metadata?.ground_plane_offset ?? 0, costCredits: job.costCredits ?? null };
    }
    return output;
  }
  const server = createServer(async (req, res) => {
    const generatingRequest = req.method === 'POST' && req.url === '/jobs';
    const streaming = generatingRequest && req.headers.accept?.includes('application/x-ndjson');
    let requestJob = null, heartbeat;
    const emit = event => {
      if (!streaming || res.destroyed || res.writableEnded) return;
      if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      res.write(JSON.stringify({ ...event, at: Date.now() }) + '\n');
    };
    const reply = (code, data) => {
      if (res.destroyed || res.writableEnded) return;
      if (data.error && generatingRequest) data = { ...data, submission: requestJob ? 'unknown' : 'not_submitted' };
      if (res.headersSent) { emit({ type: 'result', httpStatus: code, ...data }); res.end(); }
      else { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
    };
    const origin = req.headers.origin;
    if (!/^(localhost|127\.0\.0\.1):\d+$/.test(req.headers.host || '') || (origin && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))) { reply(403, { error: 'Marble 本地服务只允许本地页面访问' }); return; }
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    try {
      await ready;
      const base = `http://${req.headers.host}`, url = new URL(req.url, base);
      if (req.method === 'GET' && url.pathname === '/health') { reply(200, { configured: !!apiKey, provider: 'World Labs · Marble API', message: apiKey ? 'Marble 密钥已配置，点击“检查余额”验证连接' : '请在服务端配置 WORLDLABS_API_KEY 后重启服务' }); return; }
      if (req.method === 'GET' && url.pathname === '/credits') { reply(200, await api('credits')); return; }
      if (req.method === 'GET' && url.pathname === '/jobs') { reply(200, { jobs: [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 50).map(j => publicJob(j, base)) }); return; }
      if (req.method === 'POST' && url.pathname === '/jobs') {
        if (submitting) { reply(429, { error: '正在提交一个任务，请稍候查询任务列表' }); return; }
        submitting = true;
        try {
          if (!req.headers['content-type']?.startsWith('application/json')) { reply(415, { error: '请使用 JSON 请求' }); return; }
          let size = 0; const chunks = [];
          for await (const chunk of req) { size += chunk.length; if (size > 32 * 1024 * 1024) { reply(413, { error: '图片总量请小于 32MB' }); return; } chunks.push(chunk); }
          let raw; try { raw = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { reply(400, { error: '无效的 JSON' }); return; }
          let input; try { input = validateMarbleInput(raw); } catch (err) { reply(400, { error: err.message }); return; }
          const duplicate = [...jobs.values()].find(j => j.requestId === input.requestId);
          if (duplicate) { reply(200, publicJob(duplicate, base)); return; }
          if ([...jobs.values()].some(active)) { reply(409, { error: '已有未完成或提交结果待确认的任务，请先查询现有任务' }); return; }
          if ([...jobs.values()].filter(j => Date.now() - j.createdAt < 86400000).length >= dailyLimit) { reply(429, { error: '已达到本地服务的每日生成次数限制' }); return; }
          emit({ type: 'progress', stage: 'preparing', message: `已收到 ${input.photos.length} 张照片，正在整理生成资料` });
          if (streaming) heartbeat = setInterval(() => emit({ type: 'heartbeat' }), 5000);
          let preparation;
          try {
            const prepared = await prepareMarblePhotos(input, progress => emit({ type: 'progress', ...progress }));
            input = prepared.input; preparation = prepared.preparation;
          } catch (err) { reply(400, { error: err.message }); return; }
          emit({ type: 'progress', stage: 'credits', message: '照片已准备好，正在检查 API 余额（不消耗生成额度）' });
          const estimate = estimateMarbleCost(input.model, input.mode, input.photos.length);
          const credits = await api('credits');
          if (!Number.isFinite(credits.remaining_credits) || credits.remaining_credits < estimate.max) { reply(402, { error: `API 余额需至少 ${estimate.max} credits，避免生成费用超出余额` }); return; }
          const job = { id: randomUUID(), requestId: input.requestId, model: input.model, mode: input.mode, preparation, status: 'submitting', message: '正在提交到 Marble', createdAt: Date.now() };
          requestJob = job; jobs.set(job.id, job); await save(job);
          emit({ type: 'progress', stage: 'submitting', jobId: job.id, message: '余额检查通过，正在提交到 Marble；请勿重复生成' });
          try {
            const operation = await api('worlds:generate', buildMarbleRequest(input));
            acceptOperation(job, operation);
            if (!job.operationId && job.status !== 'complete') throw new Error('未收到任务编号');
          } catch (err) {
            // A transport error may occur after a paid request was accepted. Never retry it automatically.
            job.status = err.httpStatus && err.httpStatus < 500 ? 'failed' : 'unknown';
            job.message = job.status === 'unknown' ? '提交结果待确认。请先在 World Labs 控制台检查任务与费用；服务不会自动重复提交。' : err.message;
          }
          await save(job); reply(202, publicJob(job, base)); return;
        } finally { submitting = false; clearInterval(heartbeat); }
      }
      const match = url.pathname.match(/^\/jobs\/([a-f\d-]{36})$/i);
      const recover = url.pathname.match(/^\/jobs\/([a-f\d-]{36})\/recover$/i);
      if (req.method === 'POST' && recover) {
        const job = jobs.get(recover[1]);
        if (!job || job.status !== 'unknown') { reply(409, { error: '只有提交结果待确认的任务需要恢复' }); return; }
        let size = 0, raw = '';
        for await (const chunk of req) { size += chunk.length; if (size > 4096) { reply(413, { error: '恢复请求过大' }); return; } raw += chunk; }
        let body; try { body = JSON.parse(raw); } catch { reply(400, { error: '无效的恢复请求' }); return; }
        if (body.confirmNoOperation === true) {
          job.status = 'failed'; job.message = '使用者已在控制台确认无生成任务，可重新提交';
        } else if (typeof body.operationId === 'string' && /^[a-z\d_-]{1,200}$/i.test(body.operationId)) {
          acceptOperation(job, await api(`operations/${encodeURIComponent(body.operationId)}`));
          job.operationId = body.operationId;
        } else { reply(400, { error: '请输入控制台中的 Operation ID' }); return; }
        await save(job); reply(200, publicJob(job, base)); return;
      }
      if (req.method === 'GET' && match) {
        const job = jobs.get(match[1]); if (!job) { reply(404, { error: '未找到此任务' }); return; }
        if (job.status === 'generating' && job.operationId && Date.now() - (job.lastPoll || 0) > 3000) {
          if (!polling.has(job.id)) polling.set(job.id, (async () => { job.lastPoll = Date.now(); const operation = await api(`operations/${encodeURIComponent(job.operationId)}`); acceptOperation(job, operation); await save(job); })().finally(() => polling.delete(job.id)));
          await polling.get(job.id);
        }
        reply(200, publicJob(job, base)); return;
      }
      const transfer = url.pathname.match(/^\/asset-status\/([a-f\d-]{36})\/(100k\.spz|500k\.spz|full_res\.spz|collider\.glb)$/i);
      if (req.method === 'GET' && transfer) {
        if (!jobs.has(transfer[1])) { reply(404, { error: '场景任务不存在' }); return; }
        const file = join(dataDir, `${transfer[1]}-${transfer[2]}`);
        try { const cached = await stat(file); reply(200, { status: 'ready', received: cached.size, total: cached.size }); }
        catch { reply(200, transfers.get(file) || { status: 'connecting', received: 0, total: null }); }
        return;
      }
      const asset = url.pathname.match(/^\/assets\/([a-f\d-]{36})\/(100k\.spz|500k\.spz|full_res\.spz|collider\.glb)$/i);
      if (req.method === 'GET' && asset) {
        const job = jobs.get(asset[1]), name = asset[2];
        const remote = name === 'collider.glb' ? job?.assets?.mesh?.collider_mesh_url : job?.assets?.splats?.spz_urls[name.slice(0, -4)];
        if (job?.status !== 'complete' || !remote || new URL(remote).protocol !== 'https:') { reply(404, { error: '场景资源不存在' }); return; }
        const file = join(dataDir, `${job.id}-${name}`);
        if (!downloads.has(file)) downloads.set(file, (async () => {
          try { await stat(file); return; } catch { /* Download only URLs returned by the trusted World API; never forward credentials. */ }
          const state = { status: 'connecting', received: 0, total: null, startedAt: Date.now() }; transfers.set(file, state);
          const response = await fetchImpl(remote, { signal: AbortSignal.timeout(name === 'full_res.spz' ? 600000 : 120000) });
          if (!response.ok) throw new Error('场景资源下载失败，请重新查询任务后重试');
          state.status = 'downloading'; state.total = Number(response.headers.get('content-length')) || null;
          const reader = response.body.getReader(), chunks = []; let size = 0;
          try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; state.received = size; state.updatedAt = Date.now(); if (size > 250 * 1024 * 1024) { await reader.cancel(); throw new Error('场景文件超过 250MB，请使用低精度'); } chunks.push(value); } } finally { reader.releaseLock(); }
          await writeFile(file + '.tmp', Buffer.concat(chunks), { mode: 0o600 }); await rename(file + '.tmp', file);
          state.status = 'ready'; state.total = size;
        })().catch(err => {
          const state = transfers.get(file); if (state) state.status = 'failed';
          throw new Error(/^(场景)/.test(err.message) ? err.message : `场景 CDN 下载失败或超过 ${name === 'full_res.spz' ? '10 分钟' : '120 秒'}，可重试已有结果或切回标准精度`);
        }).finally(() => downloads.delete(file)));
        await downloads.get(file);
        const buffer = await readFile(file); res.writeHead(200, { 'Content-Type': name.endsWith('.glb') ? 'model/gltf-binary' : 'application/octet-stream', 'Content-Length': buffer.length, 'Cache-Control': 'private, max-age=3600' }); res.end(buffer); return;
      }
      reply(404, { error: 'Not found' });
    } catch (err) { if (!res.headersSent) reply(502, { error: /^(请在|Marble|World Labs|场景)/.test(err.message) ? err.message : 'Marble 服务连接失败，请稍后查询现有任务。' }); else res.end(); }
  });
  server.marbleReady = ready;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // A key file must live outside the statically served repository.
  try { process.loadEnvFile(join(homedir(), '.config', 'needflea', 'marble.env')); } catch (err) { if (err.code !== 'ENOENT') throw new Error('无法读取 Marble 配置文件，请检查文件权限和格式'); }
  // Native fetch otherwise ignores the proxy configuration already used by curl.
  // Available in Node 24.14+/25.4+; older versions can opt in at process startup.
  http.setGlobalProxyFromEnv?.();
  const server = createMarbleServer();
  await server.marbleReady;
  server.listen(Number(process.env.MARBLE_PORT || 3004), '127.0.0.1', () => console.log('Marble 服务：http://127.0.0.1:' + server.address().port + '（API 按量计费；密钥仅在服务端）'));
}
