import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { draftInput, draftProblems } from '../local-draft-input.mjs';
import { searchDrafts } from '../local-drafts.mjs';
import { rectangle } from '../cloud/planning-input.mjs';
import { validate } from '../cloud/planning-geometry.mjs';
const p = {
  version: 3,
  metersPerUnit: 1,
  items: [],
  planning: {
    regions: [{ id: 'r', points: rectangle(10, 10, 20, 20) }],
    noZones: true,
    entrances: [{ center: { x: 10, y: -3 }, a: { x: 9.8, y: -3 }, b: { x: 10.2, y: -3 } }],
    exits: [{ center: { x: 20, y: 10 }, a: { x: 20, y: 9.8 }, b: { x: 20, y: 10.2 } }],
    demands: [{ id: 'd', cat: '衣物', style: 'tent', width: 2, depth: 2, min: 4, max: 40 }],
    aisles: { min: 2, max: 4 }
  }
};
const s = draftInput(p);
assert.deepEqual(draftProblems(s), []);
const result = searchDrafts(s, () => {});
assert.ok(result.candidates.length);
for (const c of result.candidates) assert.ok(c.metrics.gap == null || c.metrics.gap >= 2);
const modified = structuredClone(result.candidates[0]);
modified.items[0].wx = 19;
modified.items[0].wy = 9;
assert.ok(validate({ ...s, presets: modified.presets }, modified).issues.includes('摊位覆盖出入口标注'));
const b = await puppeteer.launch({ args: ['--no-sandbox'] });
try {
  const page = await b.newPage();
  await page.goto('http://127.0.0.1:3005');
  await page.waitForFunction(() => window.plannerUI && window.environmentUI);
  await page.evaluate((p) => projectIO.load(p), p);
  await page.click('#btn-planner');
  await page.click('#plan-generate');
  await page.waitForFunction(() => !document.querySelector('#plan-generate').disabled);
  assert.ok(await page.$('#plan-cards article'), await page.$eval('#plan-status', (e) => e.textContent));
  console.log('PASS narrow/outside markers, gate avoidance, internal aisle width, browser generation');
} finally {
  await b.close();
}
