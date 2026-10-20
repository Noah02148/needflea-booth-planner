/** Local webpage bridge to Codex with ChatGPT subscription authentication. */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { validateAnalysisInput } from './environment-ai-contract.mjs';
import { createCodexRunner } from './codex-environment-runner.mjs';

export function createEnvironmentServer({ runner = createCodexRunner() } = {}) {
  let busy = false;
  return createServer(async (req, res) => {
    const streaming = req.headers.accept?.includes('application/x-ndjson');
    const emit = event => {
      if (res.destroyed || res.writableEnded) return;
      if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      res.write(JSON.stringify({ ...event, at: Date.now() }) + '\n');
    };
    const origin = req.headers.origin;
    // Only the local webpage may use the local ChatGPT-authenticated CLI.
    const allowedOrigin = origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
    const allowedHost = /^(localhost|127\.0\.0\.1):\d+$/.test(req.headers.host || '');
    const reply = (status, data) => {
      if (res.destroyed) return;
      if (res.headersSent) { emit({ type: 'result', ...data }); res.end(); }
      else { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
    };
    if (!allowedHost || (origin && !allowedOrigin)) { reply(403, { error: '仅允许本地页面访问场地分析服务' }); return; }
    if (allowedOrigin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method === 'GET' && req.url === '/health') {
      reply(200, await runner.status()); return;
    }
    if (req.method !== 'POST' || req.url !== '/analyze') { reply(404, { error: 'Not found' }); return; }
    if (!req.headers['content-type']?.startsWith('application/json')) { reply(415, { error: '请使用 JSON 请求' }); return; }
    if (busy) { reply(429, { error: '已有场地分析正在进行，请稍后重试' }); return; }
    busy = true;
    let timeout, heartbeat;
    const controller = new AbortController();
    const stop = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', stop);
    try {
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 30 * 1024 * 1024) { reply(413, { error: '照片与 CAD 资料总量请小于 30MB' }); return; }
        chunks.push(chunk);
      }
      let raw;
      try { raw = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { reply(400, { error: '无效的 JSON 请求' }); return; }
      let input;
      try { input = validateAnalysisInput(raw); } catch (err) { reply(400, { error: err.message }); return; }
      timeout = setTimeout(() => controller.abort(), 240000);
      if (streaming) {
        emit({ type: 'progress', stage: 'auth', message: '正在验证 ChatGPT 订阅登录' });
        heartbeat = setInterval(() => emit({ type: 'heartbeat' }), 5000);
      }
      const status = await runner.status();
      if (!status.configured) { reply(503, { error: status.message }); return; }
      const result = await runner.analyze(input, { signal: controller.signal, onProgress: progress => { if (streaming) emit({ type: 'progress', ...progress }); } });
      reply(200, result);
    } catch (err) {
      reply(502, { error: controller.signal.aborted ? '分析已取消或超过 4 分钟，请重试' : /^(Codex|模型|请先|检测到|未找到)/.test(err.message) ? err.message : '本地 Codex 分析失败，请检查服务终端与 Codex 登录状态' });
    } finally { clearTimeout(timeout); clearInterval(heartbeat); busy = false; res.off('close', stop); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.ENVIRONMENT_PORT || 3003);
  createEnvironmentServer().listen(port, '127.0.0.1', () => {
    console.log(`场地照片分析服务：http://127.0.0.1:${port}（仅使用 Codex 的 ChatGPT 订阅登录，不调用付费 API）`);
  });
}
