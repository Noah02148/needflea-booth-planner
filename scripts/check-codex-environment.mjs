import assert from 'node:assert/strict';
import { readFile, writeFile, stat } from 'node:fs/promises';
import sharp from 'sharp';
import { createCodexRunner, codexProgress } from '../codex-environment-runner.mjs';
import { readAnalysisResponse } from '../environment-progress.mjs';
import { validateAnalysisInput } from '../environment-ai-contract.mjs';

const bytes = await sharp(Buffer.from('<svg width="320" height="240" xmlns="http://www.w3.org/2000/svg"><rect width="320" height="240" fill="#889ca8"/><path d="M0 80H320M0 160H320M80 0V240M160 0V240M240 0V240" stroke="#637780"/><rect x="90" y="35" width="35" height="130" fill="#eeeeee"/></svg>')).jpeg().toBuffer();
const image = `data:image/jpeg;base64,${bytes.toString('base64')}`;
const input = { bounds: { minX: 0, minY: 0, maxX: 20000, maxY: 15000 }, metersPerUnit: .001, notes: '合成参考图，仅验证图片输入和结构化输出，不是实际场地照片。灰蓝色地面，白色方柱，柱中心已确认 CAD (4000,6000)，实测宽深0.6米、高4米。其余结构不生成。', instruction: '', currentEnvironment: null, photos: [{ name: 'synthetic-reference.jpg', note: '仅测试', dataUrl: image }], planImage: image, cadEntities: [{ type: 'line', layer: 'walls', x1: 0, y1: 0, x2: 20000, y2: 0 }] };
if (process.argv.includes('--live')) {
  const runner = createCodexRunner();
  const status = await runner.status();
  assert.equal(status.configured, true, status.message);
  console.log('ChatGPT subscription login verified; running one synthetic-image analysis.');
  const result = await runner.analyze(input, { signal: AbortSignal.timeout(240000) });
  assert.ok(result.proposal.summary); assert.ok(Array.isArray(result.proposal.objects));
  console.log(JSON.stringify({ liveSubscriptionCheck: 'PASS', reference: 'synthetic image, not a real venue', provider: result.provider, objects: result.proposal.objects.length, floorColor: result.proposal.floorColor, summary: result.proposal.summary }));
} else {
  const positioned = validateAnalysisInput({ ...input, photos: [{ ...input.photos[0], camera: { x: 4000, y: 6000, targetX: 4000, targetY: 9000 } }] });
  assert.equal(positioned.photos[0].camera.angle, 90);
  assert.throws(() => validateAnalysisInput({ ...input, photos: [{ ...input.photos[0], camera: { x: 1, y: 1, targetX: 1, targetY: 1 } }] }), /重合/);
  assert.deepEqual(codexProgress({ type: 'item.completed', item: { type: 'reasoning', text: 'PRIVATE REASONING' } }), { stage: 'analyzing', message: 'Codex 仍在处理场地资料' });
  assert.equal(codexProgress({ type: 'unknown', secret: 'private' }), null);
  const events = [], received = [];
  const lines = new TextEncoder().encode(JSON.stringify({ type: 'progress', stage: 'analyzing', message: '正在分析照片' }) + '\n' + JSON.stringify({ type: 'heartbeat' }) + '\n' + JSON.stringify({ type: 'result', proposal: { ok: true } }));
  const stream = new ReadableStream({ start(controller) { for (let i = 0; i < lines.length; i += 3) controller.enqueue(lines.slice(i, i + 3)); controller.close(); } });
  const parsed = await readAnalysisResponse(new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } }), event => received.push(event));
  assert.equal(received[0].message, '正在分析照片'); assert.equal(received[1].type, 'heartbeat'); assert.equal(parsed.proposal.ok, true);
  await assert.rejects(() => readAnalysisResponse(new Response('{"type":"heartbeat"}\n', { headers: { 'Content-Type': 'application/x-ndjson' } })), /中断/);
  let workingDirectory;
  const runner = createCodexRunner({ executeImpl: async (binary, args, options) => {
    if (args[0] === 'login') return { code: 0, stdout: 'Logged in using ChatGPT', stderr: '' };
    assert.equal(args[0], 'exec');
    assert.ok(args.includes('--json'));
    options.onProgress?.({ stage: 'analyzing', message: '正在分析照片' });
    assert.ok(args.includes('--ignore-user-config')); assert.ok(args.includes('--ephemeral'));
    assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
    assert.ok(args.includes('forced_login_method="chatgpt"'));
    assert.equal(args.at(-1), '-');
    assert.match(options.input, /不执行命令/);
    const photos = args.flatMap((arg, i) => arg === '--image' ? [args[i + 1]] : []);
    assert.equal(photos.length, 2);
    assert.deepEqual(await readFile(photos[0]), bytes);
    workingDirectory = options.cwd;
    assert.ok(!workingDirectory.includes('Desktop/needflea-booth-planner'));
    const schema = JSON.parse(await readFile(args[args.indexOf('--output-schema') + 1], 'utf8'));
    assert.ok(schema.required.includes('objects'));
    await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ summary: '测试结果', floorColor: '#889ca8', wallColor: '#eeeeee', floorPattern: 'tile', floorTileMeters: .6, objects: [], observations: [], assumptions: [], questions: [] }));
    return { code: 0, stdout: '', stderr: '' };
  } });
  const result = await runner.analyze(input, { onProgress: event => events.push(event) });
  assert.equal(result.proposal.floorPattern, 'tile');
  assert.ok(events.some(event => event.stage === 'starting')); assert.ok(events.some(event => event.stage === 'analyzing')); assert.ok(events.some(event => event.stage === 'validating'));
  await assert.rejects(() => stat(workingDirectory), { code: 'ENOENT' });
  console.log('PASS: ChatGPT-only execution flags, read-only isolated directory, real image attachments, schema/output handling, temporary-file cleanup. No model called.');
}
