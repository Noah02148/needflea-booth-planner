import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCloudServer, hashPassword } from '../cloud/server.mjs';
import { emptyLibrary } from '../cloud/contract.mjs';
import puppeteer from 'puppeteer';
import { rectangle, footprint } from '../cloud/planning-input.mjs';
import { draftInput, draftProblems } from '../local-draft-input.mjs';
import { searchDrafts } from '../local-drafts.mjs';
import clipping from '../cloud/node_modules/polygon-clipping/dist/polygon-clipping.cjs.js';

const rect = (x, y, w, h) => rectangle(x, y, w, h);
const gate = (x, y, w) => ({ center: { x, y }, a: { x: x - w / 2, y }, b: { x: x + w / 2, y } });
const demand = { id: 'clothes', cat: '衣物', style: 'tent', width: 2, depth: 2, min: 10, max: 64 };
const field = rect(12, 8, 24, 16);
const normal = {
  version: 3,
  items: [],
  metersPerUnit: 1,
  environment: {
    schema: 'needflea-environment/1',
    sitePlan: { schema: 'needflea-site-plan/1', points: field },
    objects: []
  },
  planning: {
    regions: [{ id: 'r', name: '测试区', points: field }],
    entrances: [gate(12, 0, 4)],
    exits: [gate(12, 16, 4)],
    zones: [
      { points: rect(8, 8, 1, 1), passable: false },
      { points: rect(12, 8, 2, 16), passable: true }
    ],
    demands: [demand]
  }
};
const choices = (p) => searchDrafts(draftInput(p), () => {}).candidates;
const summary = (cs) =>
  cs.map((c) => ({
    total: c.metrics.total,
    gap: c.metrics.gap,
    main: c.metrics.main,
    missing: c.metrics.missing
  }));
const cs = choices(normal);
console.log('正常场地', summary(cs));
assert.equal(cs.length, 2);
const ring = (p) => [p.map((v) => [v.x, v.y])];
for (const c of cs)
  for (const item of c.items)
    for (const zone of normal.planning.zones)
      assert.equal(clipping.intersection(ring(footprint(item)), ring(zone.points)).length, 0);
const restricted = structuredClone(normal);
restricted.planning.demands[0].min = restricted.planning.demands[0].max = 90;
restricted.planning.zones.push({ points: rect(4, 8, 8, 16), passable: false });
const less = choices(restricted);
assert.ok(less.length);
assert.ok(less.every((c) => c.report.quantities[0].short === 90 - c.metrics.total));
console.log('受限场地', summary(less));
const barrier = structuredClone(normal);
barrier.planning.zones = [{ points: rect(12, 8, 24, 2), passable: true }];
assert.ok(choices(barrier).length);
barrier.planning.zones[0].passable = false;
assert.equal(choices(barrier).length, 0);
const missing = structuredClone(normal);
missing.planning.zones = [];
assert.match(draftProblems(draftInput(missing)).join(''), /禁摆/);
missing.planning.noZones = true;
assert.deepEqual(draftProblems(draftInput(missing)), []);
assert.deepEqual(summary(choices(normal)), summary(cs));
const tiny = structuredClone(normal);
Object.assign(tiny.planning, {
  regions: [{ id: 'r', points: rect(2, 1, 4, 2) }],
  zones: [],
  noZones: true,
  aisles: { min: 2, max: 2 },
  entrances: [gate(1, 0, 2)],
  exits: [gate(1, 2, 2)],
  demands: [{ ...demand, min: 1, max: 1 }]
});
assert.equal(choices(tiny).length, 1, 'Only one useful layout');
const extra = structuredClone(normal);
extra.planning.entrances.push(gate(4, 0, 3));
const withExtra = choices(extra);
assert.ok(
  withExtra.length && withExtra.every((d) => d.lanes.some((l) => l.kind === 'gate')),
  'Additional entrance connects'
);
extra.planning.exits = [gate(12, 16, 0.5)];
assert.match(draftProblems(draftInput(extra)).join(''), /开口/);
const shared = structuredClone(normal);
shared.planning.exits = structuredClone(shared.planning.entrances);
assert.ok(choices(shared).length, 'One opening can serve both roles');
// Exercise the production HTTP contract with isolated records and a real browser session.
const revisions = [emptyLibrary()],
  files = new Map(),
  password = 'isolated-draft-test';
const store = {
  latest: async () => revisions.at(-1),
  revision: async (n) => revisions[n],
  writeProject: async (p) => {
    const hash = randomUUID();
    files.set(hash, structuredClone(p));
    return hash;
  },
  readProject: async (h) => structuredClone(files.get(h)),
  commit: async (r) => {
    if (revisions[r.revision]) return false;
    revisions.push(r);
    return true;
  }
};
const url = process.env.NEEDFLEA_URL || 'http://127.0.0.1:3005';
const server = createCloudServer({
  store,
  passwordHash: await hashPassword(password),
  secret: randomUUID(),
  origins: [new URL(url).origin]
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
try {
  const p = await browser.newPage();
  p.setDefaultTimeout(120000);
  await p.setViewport({ width: 1480, height: 980 });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto(process.env.NEEDFLEA_URL || 'http://127.0.0.1:3005');
  await p.waitForFunction(() => !!window.plannerUI && !!window.environmentUI);
  const run = async () => {
    await p.click('#plan-generate');
    await p.waitForFunction(() => !document.querySelector('#plan-generate').disabled);
    assert.ok(await p.$('#plan-cards article'), await p.$eval('#plan-status', (e) => e.textContent));
    return p.$$eval('#plan-cards article', (els) => els.map((e) => e.innerText));
  };
  await p.evaluate(async (project) => {
    window.NEEDFLEA_CLOUD_API_URL = '';
    await projectIO.load(project);
  }, normal);
  await p.click('#btn-planner');
  // Exercise canvas tools on an isolated copy before reloading the fixed numeric fixture.
  await p.evaluate(() => {
    planningData = { regions: [], demands: [] };
    renderer.scale = 25;
    renderer.offsetX = 60;
    renderer.offsetY = 500;
    plannerUI.reset();
  });
  await p.click('#plan-generate');
  assert.match(await p.$eval('#plan-status', (e) => e.textContent), /可摆区域/);
  async function mark(kind, points, polygon) {
    await p.click('[data-mark="' + kind + '"]');
    for (const point of points) {
      const coords = await p.evaluate((v) => {
        const b = canvas.getBoundingClientRect();
        return [b.left + renderer.wx(v.x), b.top + renderer.wy(v.y)];
      }, point);
      await p.mouse.click(...coords);
    }
    if (polygon) await p.click('#plan-finish');
  }
  await mark('region', normal.planning.regions[0].points, true);
  await mark('obstacle', normal.planning.zones[0].points, true);
  await p.evaluate(() => (document.querySelector('#plan-regions').parentElement.open = true));
  await p.select('#plan-regions select', 'no');
  await mark('entrance', [gate(12, 0, 4).a, gate(12, 0, 4).b], false);
  await mark('exit', [gate(12, 16, 4).a, gate(12, 16, 4).b], false);
  const marked = await p.evaluate(() => planningData);
  assert.equal(marked.regions.length, 1);
  assert.equal(marked.zones[0].passable, false);
  assert.equal(marked.entrances.length, 1);
  assert.equal(marked.exits.length, 1);
  await p.evaluate((project) => projectIO.load(project), normal);
  await run();
  await p.click('#plan-cards article:nth-child(2) button');
  assert.equal(await p.evaluate(() => booths.items.length), 0);
  await p.click('#plan-dismiss');
  assert.equal(await p.evaluate(() => booths.items.length), 0);
  await run();
  await p.evaluate(
    async ({ url, password }) => {
      window.NEEDFLEA_CLOUD_API_URL = url;
      await venueCloud.login(url, password);
    },
    { url: 'http://127.0.0.1:' + server.address().port, password }
  );
  await p.click('#plan-apply');
  await p.waitForFunction(() => document.querySelector('#planner-panel').hidden);
  const placed = await p.evaluate(() => booths.items.length);
  assert.equal(placed, cs[0].items.length);
  const originalVersion = structuredClone(revisions.at(-1));
  assert.equal(originalVersion.activities.length, 2);
  const preserved = originalVersion.activityProjects.find((row) => files.get(row.hash).items.length === 0);
  assert.ok(preserved);
  const pick = await p.evaluate(() => {
    const i = booths.items[0],
      r = canvas.getBoundingClientRect();
    return {
      x: r.left + renderer.wx(i.wx + i.ww / 2),
      y: r.top + renderer.wy(i.wy + i.wh / 2),
      wx: i.wx,
      wy: i.wy,
      id: i.id
    };
  });
  await p.mouse.move(pick.x, pick.y);
  await p.mouse.down();
  await p.mouse.move(pick.x + 16, pick.y - 12, { steps: 5 });
  await p.mouse.up();
  assert.ok(
    await p.evaluate((o) => {
      const i = booths.getItem(o.id);
      return i.wx !== o.wx || i.wy !== o.wy;
    }, pick)
  );
  await p.keyboard.down('Control');
  await p.keyboard.press('z');
  await p.keyboard.up('Control');
  assert.equal(await p.evaluate(() => booths.items.length), 0);
  await p.click('#btn-planner');
  await run();
  await p.click('#plan-apply');
  await p.waitForFunction(() => document.querySelector('#planner-panel').hidden);
  const copy = await p.evaluate(() => projectIO.capture(false));
  await p.click('#toolbar-tab-files');
  await p.click('#site-library-button');
  await p.waitForFunction(() => !document.querySelector('#site-update').disabled);
  await p.click('#site-update');
  await p.waitForFunction(() =>
    document.querySelector('#site-message').textContent.includes('当前活动布局已保存')
  );
  await p.click('#site-activity-list .site-record:first-child [data-activity-load]');
  await p.waitForFunction(() => !document.querySelector('#site-library-dialog').open);
  assert.deepEqual(await p.evaluate(() => projectIO.capture(false).planning.zones), copy.planning.zones);
  assert.equal(await p.evaluate(() => booths.items.length), placed);
  assert.equal(revisions.at(-1).activityProjects.find((row) => row.id === preserved.id).hash, preserved.hash);
  await p.evaluate((project) => projectIO.load(project), restricted);
  await p.click('#btn-planner');
  const limitedCards = await run();
  assert.ok(limitedCards.every((card) => card.includes('缺 66')));
  await p.click('#plan-cards article:nth-child(2) button');
  await p.click('#plan-apply');
  await p.waitForFunction(() => document.querySelector('#planner-panel').hidden);
  const limitedSaved = structuredClone(revisions.at(-1));
  const limitedActivity = limitedSaved.activities.at(-1);
  const stored = files.get(limitedSaved.activityProjects.find((r) => r.id === limitedActivity.id).hash);
  assert.deepEqual(stored.planning.zones, restricted.planning.zones);
  assert.equal(stored.items.length, 24);
  await p.click('#toolbar-tab-files');
  await p.click('#site-library-button');
  await p.waitForFunction(
    () =>
      document.querySelector('#site-library-dialog').open &&
      document.querySelector('#site-library-dialog').getAttribute('aria-busy') === 'false'
  );
  await p.click('[data-activity-load="' + limitedActivity.id + '"]');
  await p.waitForFunction(() => !document.querySelector('#site-library-dialog').open);
  assert.equal(await p.evaluate(() => booths.items.length), 24);
  if (process.env.NEEDFLEA_REAL_PROJECT) {
    await p.evaluate(() =>
      document.body.append(
        Object.assign(document.createElement('input'), { id: 'fixture-file', type: 'file' })
      )
    );
    await (await p.$('#fixture-file')).uploadFile(process.env.NEEDFLEA_REAL_PROJECT);
    await p.evaluate(async () => {
      const project = JSON.parse(await document.querySelector('#fixture-file').files[0].text());
      await projectIO.load(project);
      const a = planningData.entrance,
        b = planningData.exit;
      const left = Math.min(a.x, b.x) - 9000,
        right = Math.max(a.x, b.x) + 9000,
        top = Math.max(a.y, b.y),
        bottom = Math.min(a.y, b.y);
      planningData.regions = [
        {
          id: 'sample',
          name: '验收范围',
          points: [
            { x: left, y: bottom },
            { x: right, y: bottom },
            { x: right, y: top },
            { x: left, y: top }
          ]
        }
      ];
      planningData.demands = [
        { id: 'sample', cat: '衣物', style: 'tent', width: 2, depth: 2, min: 25, max: 60 }
      ];
    });
    await p.click('#btn-planner');
    console.log('水立方副本', await run());
  }
  assert.deepEqual(errors, []);
  console.log('PASS local drafts');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
