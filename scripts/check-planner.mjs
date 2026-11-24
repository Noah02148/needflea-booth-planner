// Synthetic acceptance fixtures. --live replaces only the Responses transport with OpenAI.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { buildSnapIndex, snapPoint } from '../planner-snap.mjs';
import { emptyLibrary } from '../cloud/contract.mjs';
import { readPlan, rectangle, problems } from '../cloud/planning-input.mjs';
import { generate, validate } from '../cloud/planning-geometry.mjs';
import { runPlanner } from '../cloud/planning-agent.mjs';
import { syncKnowledge, findHistory, digest } from '../cloud/planning-knowledge.mjs';
import { createCloudServer, hashPassword } from '../cloud/server.mjs';

// Hidden parent layers and curved bulge segments must never supply phantom wall edges.
const compactIndex = buildSnapIndex(
  {
    Walls: [
      { t: 'L', x1: 0, y1: 0, x2: 20, y2: 0 },
      {
        t: 'P',
        pts: [
          [0, 4],
          [20, 4],
          [20, 8]
        ],
        closed: false,
        sourceLayers: ['Block']
      },
      {
        type: 'LWPOLYLINE',
        vertices: [
          { x: 0, y: 12, bulge: 1 },
          { x: 20, y: 12 }
        ]
      }
    ]
  },
  []
);
assert.deepEqual(snapPoint(compactIndex, { x: 8, y: 0.2 }, 0.5, null, {}).point, { x: 8, y: 0 });
assert.deepEqual(snapPoint(compactIndex, { x: 8, y: 4.2 }, 0.5, null, {}).point, { x: 8, y: 4 });
assert.ok(!snapPoint(compactIndex, { x: 8, y: 4.2 }, 0.5, null, { Block: false }).segment);
assert.ok(!snapPoint(compactIndex, { x: 8, y: 12.1 }, 0.5, null, {}).segment);
const live = process.argv.includes('--live');
if (live && !process.env.OPENAI_API_KEY) throw new Error('真实 Responses 验收需要后端 OPENAI_API_KEY');
const env = {
  ...process.env,
  OPENAI_API_KEY: live ? process.env.OPENAI_API_KEY : 'fixture-only',
  PLANNER_STUDY_MODEL: 'off'
};
const url = process.env.NEEDFLEA_URL || 'http://127.0.0.1:3005',
  secret = 'isolated-fixture-only-secret'.repeat(2);
const points = rectangle(15, 10, 30, 20),
  entrance = { x: 0, y: 10 },
  exit = { x: 30, y: 10 };
const demand = { id: 'shirts', cat: '衣物', style: 'tent', width: 2, depth: 2, min: 10, max: 35 };
const base = {
  version: 3,
  items: [],
  nextId: 1,
  metersPerUnit: 1,
  environment: {
    schema: 'needflea-environment/1',
    objects: [],
    sitePlan: { schema: 'needflea-site-plan/1', points }
  }
};
const project = {
  ...base,
  planning: { regions: [{ id: 'a', name: '全场', points }], entrance, exit, demands: [demand] }
};
const s = readPlan(project);
for (const field of ['regions', 'entrance', 'exit']) assert.equal(problems({ ...s, [field]: null }).length, 1);
const original = generate(s, { strategy: 'edge' });
assert.ok(original.items.length > 0);
assert.ok(validate(s, original).ok);
const mutate = (fn) => {
  const d = structuredClone(original);
  fn(d);
  assert.equal(validate(s, d).ok, false);
};
mutate((d) => {
  d.items[1].wx = d.items[0].wx;
  d.items[1].wy = d.items[0].wy;
});
mutate((d) => {
  d.items[0].wx = -20;
});
mutate((d) => {
  d.lanes[0].width = 0.5;
});
mutate((d) => {
  d.lanes[0].points[1] = { x: 29, y: 10 };
});
assert.ok(!validate({ ...s, demands: [{ ...demand, max: 1, min: 1 }] }, original).ok);
const scarce = { ...s, demands: [{ ...demand, min: 400, max: 400 }] };
const shortage = validate(scarce, generate(scarce, { strategy: 'rows' }));
assert.ok(shortage.ok && shortage.quantities[0].short > 0);
const constrained = {
  ...s,
  obstacles: [rectangle(5, 2, 2, 4, 30)],
  lanes: [
    {
      points: [
        { x: 20, y: 0 },
        { x: 20, y: 20 }
      ],
      width: 2
    }
  ]
};
assert.ok(validate(constrained, generate(constrained)).ok);
assert.ok(validate({ ...s, exit: entrance }, generate({ ...s, exit: entrance })).ok);
assert.throws(() => generate({ ...s, obstacles: [rectangle(15, 10, 1, 40)] }), /连通/);
const head = [emptyLibrary()],
  data = new Map(),
  knowledge = new Map();
let reads = 0;
const store = {
  latest: async () => head.at(-1),
  revision: async (n) => head[n],
  commit: async (m) => {
    if (head.length !== m.revision) return false;
    head.push(m);
    return true;
  },
  writeProject: async (p) => {
    const h = digest(p);
    data.set(h, structuredClone(p));
    return h;
  },
  readProject: async (h) => {
    reads++;
    return structuredClone(data.get(h));
  },
  knowledgeGet: async (k) => structuredClone(knowledge.get(k)),
  knowledgePut: async (k, v) => {
    if (knowledge.has(k)) return false;
    knowledge.set(k, structuredClone(v));
    return true;
  }
};
const caseBooths = original.items.slice(0, 5).map((b, i) => ({ ...b, label: 'A' + (16 + i) }));
const row = { id: 'sz', name: '深圳场', aliases: ['深圳'], createdAt: 1, updatedAt: 1 };
const event = { id: 'festival', siteId: 'sz', name: '市集', status: 'final', updatedAt: 1, createdAt: 1 };
const layout = { ...project, items: caseBooths, nextId: 100 };
head.push({
  ...emptyLibrary(),
  revision: 1,
  sites: [row],
  activities: [event],
  projects: [{ id: 'sz', hash: await store.writeProject(base) }],
  activityProjects: [{ id: 'festival', hash: await store.writeProject(layout) }]
});
const k = await syncKnowledge(store, env);
assert.equal(k.records.length, 2);
assert.equal(reads, 2);
assert.equal((await findHistory(store, k, { site: '深圳', booth: 'A18' }))[0].row.length, 5);
await syncKnowledge(store, env);
assert.equal(reads, 2);
const args = (strategy, scope = 'all', variant = 0) => ({
  strategy,
  scope,
  variant,
  extraWidth: 0,
  axis: 'horizontal'
});
function fixtureResponse(_, req) {
  const b = JSON.parse(req.body),
    f = b.input.filter((m) => m.type === 'function_call_output'),
    local =
      JSON.stringify(b.input[0]).includes('局部') ||
      b.input.some((m) => m.role === 'user' && m.content.includes('右侧不动'));
  const calls = f.map((m) => JSON.parse(m.output));
  let action;
  if (!f.length) action = ['read_canvas', {}];
  else if (local && !b.input.some((m) => m.name === 'find_history'))
    action = [
      'find_history',
      { activity: '', region: '', site: '深圳', booth: 'A18', revision: 0, finalOnly: false }
    ];
  else if (!calls.some((r) => r.candidate))
    action = ['arrange', args(local ? 'island' : 'edge', local ? 'left' : 'all')];
  else if (calls.at(-1).candidate) action = ['validate_layout', { candidate: calls.at(-1).candidate }];
  else if (calls.at(-1).ok === false || (!local && calls.filter((r) => r.ok).length < 2))
    action = ['arrange', args('rows', local ? 'left' : 'all', calls.filter((r) => r.candidate).length)];
  const output = action
    ? [{ type: 'function_call', name: action[0], arguments: JSON.stringify(action[1]), call_id: randomUUID() }]
    : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '已按实际净宽完成校验。' }] }];
  return new Response(JSON.stringify({ output }), { status: 200 });
}
const fetcher = live ? undefined : fixtureResponse;
const request = (body) => runPlanner({ store, env, secret, body, fetcher });
const first = await request({ spec: s, prompt: '生成排布' });
assert.ok(first.candidates.length >= 1, first.message);
let once = true;
const local = await runPlanner({
  store,
  env,
  secret,
  body: { spec: s, selected: first.candidates[0], prompt: '左侧参考深圳场 A18 那一排，右侧不动' },
  fetcher,
  generateLayout(...args) {
    const d = generate(...args);
    if (once) {
      once = false;
      const i = d.items.find((i) => i.wx < 15);
      assert.ok(i);
      i.wx = -100;
    }
    return d;
  }
});
assert.ok(local.trace.some((t) => t.tool === 'find_history' && t.result.count === 1));
assert.ok(local.trace.some((t) => t.tool === 'validate_layout' && t.result.ok === false));
assert.ok(local.trace.some((t) => t.tool === 'validate_layout' && t.result.ok === true));
assert.equal(local.candidates.length, 1, local.message);
const fixed = first.candidates[0].items.filter((i) => i.wx + i.ww > 15);
for (const i of fixed)
  assert.deepEqual(
    local.candidates[0].items.find((b) => b.id === i.id),
    i
  );
assert.ok(fixed.length);
assert.equal(local.candidates[0].references[0].activity, '市集');
await assert.rejects(
  () => request({ spec: s, selected: { ...first.candidates[0], proof: '0'.repeat(64) } }),
  /画布/
);
// Two independent replayable finals, then a worse proposal and a pinned rollback.
const replay = structuredClone(s);
replay.demands[0].min = 50;
replay.demands[0].max = 55;
const replayIndex = [emptyLibrary()],
  policyData = new Map();
let failWrite = false;
const policyStore = {
  ...store,
  latest: async () => replayIndex.at(-1),
  revision: async (n) => replayIndex[n],
  knowledgeGet: async (k) => structuredClone(policyData.get(k)),
  knowledgePut: async (k, v) => {
    if (failWrite) throw new Error('fixture interrupted index write');
    if (!policyData.has(k)) policyData.set(k, structuredClone(v));
  }
};
for (let n = 1; n <= 2; n++) {
  const prev = replayIndex.at(-1),
    id = 'replay' + n,
    aid = 'final' + n;
  const finalProject = {
    ...layout,
    planning: { ...layout.planning, origin: { items: layout.items, spec: replay, strategy: 'island' } }
  };
  replayIndex.push({
    ...prev,
    revision: n,
    sites: [...prev.sites, { ...row, id }],
    activities: [...prev.activities, { ...event, siteId: id, id: aid }],
    projects: [...prev.projects, { id, hash: await store.writeProject(base) }],
    activityProjects: [...prev.activityProjects, { id: aid, hash: await store.writeProject(finalProject) }]
  });
  assert.equal((await syncKnowledge(policyStore, env)).policy, n === 1 ? 'rows' : 'island');
}
const promoted = await syncKnowledge(policyStore, env);
assert.equal(promoted.versions[0].evidence.length, 2);
assert.equal((await syncKnowledge(policyStore, { ...env, PLANNER_POLICY_REVISION: '1' })).policy, 'rows');
const worse = {
  ...layout,
  planning: { ...layout.planning, origin: { items: layout.items, spec: replay, strategy: 'edge' } }
};
const prev = replayIndex.at(-1);
replayIndex.push({
  ...prev,
  revision: 3,
  activityProjects: [prev.activityProjects[0], { id: 'final2', hash: await store.writeProject(worse) }]
});
failWrite = true;
const retained = await syncKnowledge(policyStore, env, true);
assert.equal(retained.revision, 2);
assert.equal(retained.policy, 'island');
failWrite = false;
const recovered = await syncKnowledge(policyStore, env);
assert.equal(recovered.revision, 3);
assert.equal(recovered.policy, 'island');
console.log('PASS replay promotion, rejected regression, rollback, failed checkpoint and retry');
console.log(
  live
    ? 'PASS real Responses with synthetic Shenzhen history'
    : 'PASS scripted Responses transport: genuine geometry failure, adjusted retry, scoped A18 row, frozen right side'
);

const server = createCloudServer({
  store,
  secret,
  passwordHash: await hashPassword('test-password-planner'),
  env,
  origins: [new URL(url).origin],
  responsesFetch: fetcher
});
await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok));
const api = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  assert.equal((await fetch(api + '/planner/run', { method: 'POST' })).status, 401);
  browser = await puppeteer.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1380, height: 960 });
  page.setDefaultTimeout(live ? 120000 : 20000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', (r) =>
    new URL(r.url()).pathname === '/cloud-config.js'
      ? r.respond({
          contentType: 'application/javascript',
          body: 'window.NEEDFLEA_CLOUD_API_URL=' + JSON.stringify(api)
        })
      : r.continue()
  );
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.plannerUI && window.environmentUI);
  await page.evaluate(
    async ({ api, base }) => {
      await venueCloud.login(api, 'test-password-planner');
      await projectIO.load(base);
    },
    { api, base }
  );
  // Crossings are interior to the CAD segments. Offset every mouse click in screen pixels.
  const x1 = 4.345678,
    x2 = 22.789012,
    y1 = 5.123456,
    y2 = 15.654321;
  const cadLine = (ax, ay, bx, by) => [0, 'LINE', 8, 'Walls', 10, ax, 20, ay, 11, bx, 21, by];
  const drawing = [
    0,
    'SECTION',
    2,
    'ENTITIES',
    ...cadLine(0, y1, 30, y1),
    ...cadLine(0, y2, 30, y2),
    ...cadLine(x1, 0, x1, 20),
    0,
    'LWPOLYLINE',
    8,
    'Walls',
    90,
    2,
    70,
    0,
    10,
    x2,
    20,
    0,
    10,
    x2,
    20,
    20,
    0,
    'ENDSEC',
    0,
    'EOF'
  ].join('\n');
  await page.evaluate(
    async (cad) =>
      projectIO.load({
        version: 3,
        metersPerUnit: 1,
        items: [],
        cadFile: { name: 'snap.dxf', base64: btoa(cad) }
      }),
    drawing
  );
  await page.click('#btn-planner');
  await page.evaluate(() => {
    renderer.fitToView();
    render();
  });
  const pix = async (x, y) =>
    page.evaluate(
      ({ x, y }) => {
        const b = canvas.getBoundingClientRect();
        return [b.left + renderer.wx(x), b.top + renderer.wy(y)];
      },
      { x, y }
    );
  const rough = async (x, y, dx = 4, dy = -3) => {
    const [sx, sy] = await pix(x, y);
    await page.mouse.click(sx + dx, sy + dy);
  };
  const drag = async (dx, dy) => {
    const [sx, sy] = await pix(12, 10);
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + dx, sy + dy, { steps: 5 });
    await page.mouse.up();
  };
  await page.click('[data-mark="region"]');
  await rough(x1, y1);
  await rough(12, y1);
  await page.click('#plan-undo');
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  assert.ok(await page.$eval('#plan-undo', (el) => el.disabled));
  await rough(x1, y1);
  await rough(x2, y1, -4, 3);
  const offset = await page.evaluate(() => [renderer.offsetX, renderer.offsetY]);
  await drag(32, -17);
  const afterPan = await page.evaluate(() => [renderer.offsetX, renderer.offsetY]);
  assert.deepEqual(afterPan, [offset[0] + 32, offset[1] - 17]);
  assert.ok(await page.$eval('#plan-finish', (el) => el.disabled), 'dragging must not add a third point');
  await rough(x2, y2);
  await rough(x1, y2);
  await page.click('#plan-finish');
  const corners = await page.evaluate(() => projectIO.capture(false).planning.regions[0].points);
  for (const [i, [x, y]] of [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2]
  ].entries()) {
    assert.ok(Math.hypot(corners[i].x - x, corners[i].y - y) < 1e-8, 'full-precision visible CAD crossing ' + i);
  }
  assert.equal(corners.length, 4);
  await page.click('[data-mark="region"]');
  await rough(7, y1, 0, 4);
  await rough(14, y1, 0, -4);
  await rough(10, 9, 0, 0);
  const scale = await page.evaluate(() => renderer.scale);
  await page.keyboard.down('Shift');
  await drag(18, -15);
  await page.keyboard.up('Shift');
  await page.click('#plan-finish');
  const regions = await page.evaluate(() => projectIO.capture(false).planning.regions);
  assert.deepEqual(regions[0].points, corners);
  assert.equal(regions[1].points.length, 3);
  for (const v of regions[1].points.slice(0, 2))
    assert.ok(Math.abs(v.y - (y1 + 15 / scale)) < 1e-8, 'translated edge retains CAD alignment and length');
  await page.click('#plan-close');
  await page.evaluate((base) => projectIO.load(base), base);
  console.log(
    'PASS CAD LINE/polyline crossing and edge snaps, undo to zero, pan without points, translate unfinished outline'
  );
  await page.click('#btn-planner');
  await page.click('#plan-generate');
  assert.match(await page.$eval('#plan-status', (e) => e.textContent), /可摆区域.*入口.*出口/);
  await page.evaluate(() => {
    renderer.fitToView();
    render();
  });
  const clickWorld = async (p) => {
    const q = await page.evaluate(({ x, y }) => {
      const r = canvas.getBoundingClientRect();
      return [renderer.wx(x) + r.left, renderer.wy(y) + r.top];
    }, p);
    await page.mouse.click(...q);
  };
  await page.click('[data-mark="region"]');
  for (const p of points) await clickWorld(p);
  await page.click('#plan-finish');
  for (const [name, p] of [
    ['entrance', entrance],
    ['exit', exit]
  ]) {
    await page.click('[data-mark="' + name + '"]');
    await clickWorld(p);
  }
  await page.click('#plan-add');
  await page.$$eval('#plan-demands input', (inputs) => {
    for (const [i, v] of [
      [0, '衣物'],
      [3, '3'],
      [4, '20']
    ]) {
      inputs[i].value = v;
      inputs[i].dispatchEvent(new Event('input'));
    }
  });
  await page.click('#plan-generate');
  await page.waitForFunction(
    () => document.querySelector('#plan-cards article') || !document.querySelector('#plan-generate').disabled
  );
  assert.ok(await page.$('#plan-cards article'), await page.$eval('#plan-status', (e) => e.textContent));
  if (await page.$('#plan-cards article:nth-child(2) button'))
    await page.click('#plan-cards article:nth-child(2) button');
  assert.equal(await page.evaluate(() => booths.items.length), 0);
  const dir = await mkdtemp(join(tmpdir(), 'needflea-planner-ui-'));
  await page.screenshot({ path: join(dir, 'candidates.png') });
  await page.type('#plan-chat', '左侧参考深圳场 A18 那一排，右侧不动');
  await page.click('#plan-send');
  await page.waitForFunction(() => !document.querySelector('#plan-send').disabled);
  assert.match(await page.$eval('#plan-cards', (e) => e.textContent), /深圳场.*市集/);
  await page.click('#plan-apply');
  await page.waitForFunction(() => document.querySelector('#planner-panel').hidden);
  const saved = await store.latest();
  assert.equal(saved.activities.length, 3);
  assert.equal(saved.activityProjects.find((r) => r.id === 'festival').hash, head[1].activityProjects[0].hash);
  const placed = await page.evaluate(() => booths.items.length);
  assert.ok(placed > 0);
  const beforeDrag = await page.evaluate(() => {
    const i = booths.items[0],
      r = canvas.getBoundingClientRect();
    return {
      id: i.id,
      wx: i.wx,
      wy: i.wy,
      x: renderer.wx(i.wx + i.ww / 2) + r.left,
      y: renderer.wy(i.wy + i.wh / 2) + r.top
    };
  });
  await page.mouse.move(beforeDrag.x, beforeDrag.y);
  await page.mouse.down();
  await page.mouse.move(beforeDrag.x + 18, beforeDrag.y - 65, { steps: 8 });
  await page.mouse.up();
  assert.ok(
    await page.evaluate((b) => {
      const i = booths.getItem(b.id);
      return i.wx !== b.wx || i.wy !== b.wy;
    }, beforeDrag),
    'Applied booth can be dragged'
  );
  await page.evaluate(() => {
    updateItem(booths.items[0].id, 'label', '人工编号');
  });
  await page.click('#toolbar-tab-files');
  await page.click('#site-library-button');
  await page.waitForSelector('#site-final', { visible: true });
  await page.click('#site-final');
  await page.waitForFunction(() => document.querySelector('#site-message').textContent.includes('已保存定稿'));
  const final = await store.latest(),
    index = await syncKnowledge(store, env);
  const r = index.records.findLast((r) => r.final && r.id !== 'festival');
  assert.ok(r);
  assert.ok((await store.readProject(r.hash)).items.some((i) => i.label === '人工编号'));
  const learned = await store.knowledgeGet('records/' + r.key);
  assert.equal(learned.final, true);
  assert.ok(learned.edits.moved.includes(beforeDrag.id));
  assert.equal(final.revision, saved.revision + 1);
  const indexed = reads;
  await syncKnowledge(store, env);
  assert.equal(reads, indexed);
  assert.deepEqual(errors, []);
  console.log(
    'PASS isolated browser: three canvas marks, requirements, previews, apply independent version, manual edit, final, incremental knowledge; ' +
      dir
  );
} finally {
  await browser?.close();
  await new Promise((ok) => server.close(ok));
}
