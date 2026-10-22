// Functional toolbar regression, using an isolated browser and no generation API.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const dir = await mkdtemp(join(tmpdir(), 'needflea-toolbar-'));
const browser = await puppeteer.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.NEEDFLEA_URL || 'http://127.0.0.1:3002', { waitUntil: 'networkidle0' });
  const group = key => page.click('#toolbar-tab-' + key);
  const activeGroup = () => page.$eval('.toolbar-tab[aria-selected="true"]', e => e.dataset.toolbarGroup);
  const onlyOne = async () => assert.equal(await page.$$eval('.toolbar-panel', es => es.filter(e => !e.hidden).length), 1);
  assert.equal(await activeGroup(), 'layout');
  await onlyOne();
  for (const key of ['files', 'layout', 'draw', 'view']) {
    await group(key);
    assert.equal(await activeGroup(), key);
    await onlyOne();
    assert.equal(await page.evaluate(() => tool), 'select', 'Changing group preserves the editing tool');
  }
  await page.focus('#toolbar-tab-view');
  await page.keyboard.press('ArrowRight'); assert.equal(await activeGroup(), 'files');
  await page.keyboard.press('End'); assert.equal(await activeGroup(), 'view');
  await page.keyboard.press('Home'); assert.equal(await activeGroup(), 'files');
  const chooser = page.waitForFileChooser();
  await page.click('button[onclick="document.getElementById(\'file-input\').click()"]');
  const dxf = ['0','SECTION','2','ENTITIES',...[[0,0,20,0],[20,0,20,15],[20,15,0,15],[0,15,0,0]].flatMap(([a,b,c,d]) => ['0','LINE','8','Walls','10',a,'20',b,'11',c,'21',d]),'0','ENDSEC','0','EOF'].join('\n');
  const file = join(dir, 'venue.dxf'); await writeFile(file, dxf);
  await (await chooser).accept([file]);
  await page.waitForFunction(() => dxfLoaded);
  await page.evaluate(() => { metersPerUnit = 1; });
  await group('layout');
  await page.select('#btn-booth', 'tent-yard');
  assert.equal(await page.evaluate(() => tool), 'booth');
  assert.equal(await page.$eval('#custom-w', e => e.value), '4');
  const box = await page.$eval('#canvas', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(box.x, box.y);
  assert.equal(await page.evaluate(() => booths.items.filter(i => i.type === 'booth').length), 1);
  await group('draw');
  await page.click('#btn-line');
  await page.select('#line-style', 'dashed');
  await page.mouse.click(box.x + 50, box.y + 50);
  const before = await page.evaluate(() => JSON.stringify(lineState));
  assert.notEqual(before, 'null');
  await group('files');
  assert.equal(await page.evaluate(() => tool), 'line');
  assert.equal(await page.evaluate(() => JSON.stringify(lineState)), before, 'Partial drawing survives group switching');
  await group('layout');
  assert.equal(await page.$eval('#btn-booth', e => e.value), 'tent-yard');
  assert.equal(await page.$eval('#custom-w', e => e.value), '4');
  await page.click('#btn-select');
  await page.evaluate(() => setTool('measure'));
  assert.equal(await activeGroup(), 'draw', 'Programmatic tool changes reveal their controls');
  await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => tool), 'select');
  await group('view');
  const theme = await page.$eval('#btn-theme', e => e.textContent);
  await page.click('#btn-theme'); assert.notEqual(await page.$eval('#btn-theme', e => e.textContent), theme);
  await page.select('#btn-export-plan', 'crop');
  assert.equal(await page.evaluate(() => tool), 'crop');
  assert.equal(await activeGroup(), 'view');
  await page.keyboard.press('Escape');
  await group('layout');
  await page.screenshot({ path: join(dir, 'desktop.png') });
  for (const width of [1024, 768, 390, 360]) {
    await page.setViewport({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No page overflow at ' + width);
    for (const selector of ['#site-library-button', '#btn-3d', '#btn-environment', '.toolbar-quick button', '#toolbar-tab-view']) {
      assert.ok(await page.$eval(selector, e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0; }), selector + ' reachable at ' + width);
    }
    for (const key of ['files', 'layout', 'draw', 'view']) { await group(key); await onlyOne(); }
  }
  await group('layout');
  await page.screenshot({ path: join(dir, 'mobile.png') });
  await page.click('#site-library-button');
  await page.waitForFunction(() => document.querySelector('#site-library-dialog').open);
  assert.deepEqual(errors, []);
  console.log('PASS: toolbar grouping, keyboard navigation, CAD import, booth placement, parameter and partial drawing retention, tool synchronization, theme, crop export, venue entry, responsive layout. Artifacts:', dir);
} finally { await browser.close(); }
