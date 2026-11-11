// Project backups must reopen without WASM or localhost conversion requests.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const dir = await mkdtemp(join(tmpdir(), 'needflea-portable-'));
const browser = await puppeteer.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage(); page.setDefaultTimeout(120000);
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [], conversions = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', r => {
    if (r.url().includes(':3001/')) { conversions.push(r.url()); r.abort(); }
    else r.continue();
  });
  await page.goto(process.env.NEEDFLEA_URL || 'http://127.0.0.1:3002', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.environmentUI && window.projectIO);
  const result = await page.evaluate(async () => {
    parseDWGtoSVG = async () => { throw new Error('DWG parser deliberately disabled'); };
    const venue = { schema: 'needflea-venue/1', bounds: { minX: 0, minY: 0, maxX: 20, maxY: 15 }, layers: [{ name: 'Walls', color: '#12ab34', visible: true }, { name: 'Hidden', color: '#ffffff', visible: false }], entities: [
      { type: 'line', layer: 'Walls', color: '#12ab34', x1: 0, y1: 0, x2: 20, y2: 15 },
      { type: 'text', layer: 'Walls', color: '#ffffff', x: 2, y: 5, height: 1, angle: 20, text: '中文\n场地', textTransform: [1, 0, 0, 1], widthScale: .8 },
      { type: 'polyline', layer: 'Hidden', color: '#ffffff', closed: true, points: [[1, 1], [2, 1], [2, 2]] },
      { type: 'arc', layer: 'Walls', color: '#abcdef', cx: 4, cy: 4, r: 2, startAngle: 10, endAngle: 180 },
      { type: 'circle', layer: 'Walls', color: '#abcdef', cx: 7, cy: 4, r: 1 }
    ] };
    const input = { version: 3, cadFile: { name: 'unsupported.dwg', base64: btoa('AC1032') }, venue, items: [{ id: 1, type: 'booth', wx: 1, wy: 2, ww: 2, wh: 2, cat: '二手', label: 'A1' }], metersPerUnit: 1, layerVisibility: { Walls: true, Hidden: false }, environment: { schema: 'needflea-environment/1', objects: [], photos: [] } };
    await projectIO.load(input);
    const color = renderer._getEntityColor(_dxfFullData.entities[0]);
    const hidden = renderer.dxfData.entities.every(e => e.layer !== 'Hidden');
    toggleLayer('Hidden', true);
    const shown = renderer.dxfData.entities.some(e => e.layer === 'Hidden');
    const backup = projectIO.capture(false);
    await projectIO.load({ version: 3, items: [] });
    await projectIO.load(backup);
    const dxfRoundtrip = _dxfFullData.entities.length === 5 && booths.items[0].label === 'A1' && metersPerUnit === 1;
    const reexport = projectIO.capture().venue.entities;
    const text = reexport.find(e => e.type === 'text');
    const compact = { ...input, venue: null, items: [], cadFile: { ...input.cadFile, renderData: { schema: 'needflea-cad-render/1', bounds: { ...venue.bounds, bx0: 0, bx1: 20, by0: 0, by1: 15 }, colors: { Walls: 3 }, visibility: { Walls: true }, entitiesByLayer: { Walls: [{ t: 'L', x1: 0, y1: 0, x2: 20, y2: 15, c: '#12ab34' }] } } } };
    await projectIO.load(compact);
    const svgLoaded = renderer.useSvgBackground && renderer.svgImage.naturalWidth > 0;
    const compactBackup = projectIO.capture();
    await projectIO.load(compactBackup);
    return { color, hidden, shown, dxfRoundtrip, text, svgLoaded, svgAgain: renderer.useSvgBackground, snapshot: backup.cadFile.renderData.schema };
  });
  assert.equal(result.color, '#12ab34'); assert.ok(result.hidden && result.shown);
  assert.ok(result.dxfRoundtrip && result.svgLoaded && result.svgAgain);
  assert.equal(result.text.text, '中文\n场地'); assert.equal(result.text.widthScale, .8);
  assert.equal(result.snapshot, 'needflea-cad-render/1');
  if (process.env.NEEDFLEA_PROJECT_FILE) {
    const input = JSON.parse(await readFile(process.env.NEEDFLEA_PROJECT_FILE, 'utf8'));
    await page.evaluate(() => { dxfLoaded = false; });
    await (await page.$('#load-input')).uploadFile(process.env.NEEDFLEA_PROJECT_FILE);
    await page.waitForFunction(() => dxfLoaded && document.querySelector('#tool-hint').textContent.startsWith('项目已载入'));
    const actual = await page.evaluate(async () => {
      const count = _dxfFullData.entities.length;
      const saved = projectIO.capture(false);
      await projectIO.load({ version: 3, items: [] });
      await projectIO.load(saved);
      return { count, restored: _dxfFullData.entities.length, items: booths.items.length, metersPerUnit, layers: Object.keys(_dwgLayerVisibility).length };
    });
    assert.equal(actual.count, input.venue.entities.length);
    assert.equal(actual.restored, actual.count); assert.equal(actual.items, input.items.length);
    assert.equal(actual.metersPerUnit, input.metersPerUnit);
    console.log('Actual project:', actual);
  }
  const guarded = await page.evaluate(() => {
    const original = [_cadFileData, _dxfFullData, _dwgBounds];
    try {
      _cadFileData = { name: 'not-ready.dwg', base64: btoa('AC1032') };
      _dxfFullData = null; _dwgBounds = null;
      try { projectIO.capture(); return false; } catch (err) { return /解析完成/.test(err.message); }
    } finally { [_cadFileData, _dxfFullData, _dwgBounds] = original; }
  });
  assert.ok(guarded, 'Never save a DWG backup without its parsed base map');
  await page.screenshot({ path: join(dir, 'portable-project.png') });
  // Exercise the actual Save entry, then transfer its file to another browser.
  await page.evaluate(() => saveProject());
  let filename;
  for (let i = 0; i < 100; i++) {
    filename = (await readdir(dir)).find(name => name.endsWith('.json'));
    if (filename) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(filename, 'Save downloads a complete JSON');
  const downloaded = JSON.parse(await readFile(join(dir, filename), 'utf8'));
  assert.equal(downloaded.cadFile.renderData.schema, 'needflea-cad-render/1');
  await page.close();
  const peerContext = await browser.createBrowserContext();
  const peer = await peerContext.newPage();
  await peer.goto(process.env.NEEDFLEA_URL || 'http://127.0.0.1:3002', { waitUntil: 'networkidle0' });
  await peer.waitForFunction(() => window.projectIO && window.environmentUI);
  await peer.evaluate(() => {
    parseDWGtoSVG = convertDWGtoDXF = async () => { throw new Error('No DWG tools on colleague computer'); };
  });
  await (await peer.$('#load-input')).uploadFile(join(dir, filename));
  await peer.waitForFunction(() => dxfLoaded);
  const peerResult = await peer.evaluate(async () => {
    const first = projectIO.capture(false);
    await projectIO.load(first);
    return { loaded: dxfLoaded, items: booths.items.length, portable: first.cadFile.renderData.schema };
  });
  assert.ok(peerResult.loaded); assert.equal(peerResult.items, downloaded.items.length);
  assert.equal(peerResult.portable, 'needflea-cad-render/1');
  await peerContext.close();
  assert.deepEqual(conversions, []); assert.deepEqual(errors, []);
  console.log('Portable project checks passed:', dir);
} finally { await browser.close(); }
