// CAD encoding/layout/block regressions; optional real DWG via NEEDFLEA_DWG_FILE.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import puppeteer from 'puppeteer';

const context = vm.createContext({ window: {}, TextDecoder, Uint8Array });
for (const name of ['cad-text.js', 'dxf-parser.js']) vm.runInContext(await readFile(new URL('../' + name, import.meta.url), 'utf8'), context);
const { CADText, DXFParser } = context.window;
assert.equal(CADText.plain(String.raw`{\fSimSun;\M+5D1DD\M+5D2D5\U+4E2D\U+5FC3}\P座椅%%p5`), '演艺中心\n座椅±5');
assert.equal(CADText.plain(String.raw`{\H2x;中文{\W0.7;仍保留}} \\ \{字\} \S1#2;`), '中文仍保留 \\ {字} 1/2');
assert.equal(CADText.decode('中文 Café'), '中文 Café');
assert.equal(CADText.decode('\xb3\xdf\xb4\xe7\0', true), '尺寸');
assert.equal(CADText.readBytes(Uint8Array.of(0xd1, 0xdd, 0xd2, 0xd5)), '演艺');
assert.equal(CADText.readBytes(new TextEncoder().encode('UTF-8 中文')), 'UTF-8 中文');

const entity = (type, tags) => [0, type, ...tags];
const line = (x1,y1,x2,y2,extra=[]) => entity('LINE',[8,'0',10,x1,20,y1,11,x2,21,y2,...extra]);
const block = (name,x,y,children) => [...entity('BLOCK',[2,name,10,x,20,y]),...children,...entity('ENDBLK',[])];
const fixture = [0,'SECTION',2,'TABLES',
  ...entity('LAYER',[2,'0',62,7]),...entity('LAYER',[2,'Layout',62,2]),...entity('LAYER',[2,'Frozen',62,7,70,1]),...entity('LAYER',[2,'Furniture',62,3]),
  0,'ENDSEC',0,'SECTION',2,'BLOCKS',
  ...block('Seat',10,20,[...line(10,20,12,20,[62,0]),...entity('TEXT',[8,'Furniture',10,10,20,20,40,2,1,'座椅'])]),
  ...block('Nested',0,0,entity('INSERT',[2,'Seat',10,10,20,20,41,2,42,3,50,90])),
  ...block('Dim',0,0,line(30,40,35,40)),
  ...block('Cycle',0,0,entity('INSERT',[2,'Cycle',10,0,20,0])),
  0,'ENDSEC',0,'SECTION',2,'ENTITIES',
  ...line(0,0,1000,0),...line(1000,0,1000,500),...line(1000,500,0,500),...line(0,500,0,0),
  ...entity('INSERT',[8,'Layout',2,'Seat',10,100,20,100,41,2,42,3,50,90]),
  ...entity('INSERT',[8,'Layout',2,'Nested',10,200,20,200]),
  ...entity('INSERT',[8,'Frozen',2,'Seat',10,300,20,100]),
  ...entity('INSERT',[2,'Cycle',10,0,20,0]),
  ...entity('DIMENSION',[2,'Dim',10,900,20,900]),
  ...entity('LWPOLYLINE',[8,'Layout',90,2,38,500,10,10,20,0,10,20,20,0,210,1,220,0,230,0]),
  ...entity('MTEXT',[8,'Layout',10,500,20,300,40,5,41,80,71,1,3,'{\\fSimSun;\\M+5D1DD',1,'\\M+5D2D5}\\P中心']),
  ...entity('TEXT',[8,'Layout',10,0,20,0,11,500,21,250,40,2,72,1,73,2,1,'小字']),
  0,'ENDSEC',0,'EOF'].join('\n');
const data = new DXFParser().parse(fixture);
const lines = data.entities.filter(e => e.type === 'LINE');
assert.ok(lines.some(e => e.x1 === 100 && e.y1 === 100 && Math.abs(e.x2-100)<1e-8 && e.y2 === 104 && e.layer === 'Layout' && e.color === 2), 'INSERT base point, rotation, nonuniform scale and BYBLOCK color');
assert.ok(lines.some(e => e.x1 === 210 && e.y1 === 220 && Math.abs(e.x2-210)<1e-8 && e.y2 === 224), 'Nested block transform');
assert.ok(lines.some(e => e.x1 === 30 && e.y1 === 40), 'Dimension block uses its existing world coordinates');
assert.equal(data.layers.Frozen.visible, false);
assert.ok(data.entities.some(e => e.layer === 'Furniture' && e.sourceLayers.includes('Frozen')), 'Child keeps both explicit layer and parent visibility');
assert.ok(data.entities.some(e => e.type === 'LWPOLYLINE' && e.vertices[0].x === 500 && e.vertices[0].y === 10 && e.vertices[1].y === 20), 'Vertical OCS/elevation projected to WCS');
assert.equal(data.entities.find(e => e.type === 'MTEXT').text, '演艺\n中心');
assert.ok(data.entities.length < 30, 'Recursive block is safely skipped');

const dir = await mkdtemp(join(tmpdir(), 'needflea-cad-import-'));
const file = join(dir, 'cad-regression.dxf'); await writeFile(file, fixture);
const browser = await puppeteer.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 1000 }); page.setDefaultTimeout(120000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { await d.accept(); });
  await page.goto(process.env.NEEDFLEA_URL || 'http://127.0.0.1:3002', { waitUntil: 'networkidle0' });
  await (await page.$('#file-input')).uploadFile(file); await page.waitForFunction(() => dxfLoaded);
  const rendering = await page.evaluate(() => {
    const calls = [], original = ctx.fillText;
    ctx.fillText = function(text,x,y,...rest) { calls.push({ text, font: this.font, x, y }); return original.call(this,text,x,y,...rest); };
    try { render(); } finally { ctx.fillText = original; }
    const raw = _extractEntityForSvg({DRW_ETYPE:{TEXT:1,MTEXT:2}}, {eType:2,basePoint:{x:2,y:3},text:'{\\fSimSun;中文}\\P下一行',height:2,textGen:1,widthScale:20}, {}, {});
    return { calls, raw };
  });
  assert.ok(rendering.calls.some(c => c.text === '演艺'));
  assert.ok(rendering.calls.some(c => c.text === '中心'));
  assert.ok(rendering.calls.some(c => c.text === '小字' && parseFloat(c.font) < 8), 'Small annotations retain their real scale');
  assert.equal(rendering.raw.text, '中文\n下一行', 'DWG text follows the same decoding/formatting rules');
  await page.evaluate(() => toggleLayer('Layout', false));
  assert.ok(await page.evaluate(() => !renderer.dxfData.entities.some(e => e.sourceLayers.includes('Layout'))), 'Layer toggle also hides explicit-layer children of that INSERT');
  await page.evaluate(() => toggleLayer('Layout', true));
  await page.evaluate(() => toggleLayer('Frozen', true));
  assert.ok(await page.evaluate(() => renderer.dxfData.entities.some(e => e.sourceLayers.includes('Frozen')) && renderer.dxfData.layers.Frozen.visible), 'Explicit layer selection can show an originally frozen INSERT');
  await page.evaluate(() => toggleLayer('Frozen', false));
  const retained = await page.evaluate(async () => {
    const saved = window.projectIO.capture(); await window.projectIO.load(saved);
    const svg = saved.venue?.svg?.content || '';
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const url = URL.createObjectURL(new Blob([svg], {type:'image/svg+xml'}));
    const loads = await new Promise(resolve => { const img = new Image(); img.onload = () => resolve(img.naturalWidth > 0); img.onerror = () => resolve(false); img.src = url; });
    URL.revokeObjectURL(url);
    return { text: renderer.dxfData.entities.find(e => e.type === 'MTEXT').text, svg, valid: !parsed.querySelector('parsererror') && loads, count: _dxfFullData.entities.length };
  });
  assert.equal(retained.text, '演艺\n中心'); assert.equal(retained.count, data.entities.length);
  assert.ok(retained.valid && retained.svg.includes('演艺') && retained.svg.includes('中心'), 'Portable SVG snapshot retains Chinese/multiline text and is renderable');
  await writeFile(join(dir, 'portable.svg'), retained.svg);
  await page.screenshot({ path: join(dir, 'fixture.png') });
  if (process.env.NEEDFLEA_DWG_FILE) {
    await (await page.$('#file-input')).uploadFile(process.env.NEEDFLEA_DWG_FILE);
    await page.waitForFunction(() => dxfLoaded && _cadFileData?.name !== 'cad-regression.dxf' && (_dxfFullData?.entities.length > 1000 || Object.values(_dwgEntitiesByLayer).flat().length > 1000));
    const real = await page.evaluate(() => {
      const texts = _dxfFullData?.entities.filter(e => ['TEXT','MTEXT','ATTRIB'].includes(e.type)).map(e => e.text) || Object.values(_dwgEntitiesByLayer).flat().filter(e => e.t === 'T').map(e => e.text);
      return { count: _dxfFullData?.entities.length, titles: texts.filter(t => t.includes('演艺中心')), escaped: texts.filter(t => /\\[MU]\+[0-9a-f]/i.test(t)), bounds: renderer.dxfData.bounds };
    });
    assert.ok(real.titles.some(t => t.includes('座椅收起'))); assert.ok(real.titles.some(t => t.includes('座椅伸出')));
    assert.deepEqual(real.escaped, []); if (real.count) assert.ok(real.count > 40000, 'Seat and other block geometry is present');
    assert.ok(real.bounds.height < 300000, 'Vertical OCS geometry no longer expands bounds by millions of units');
    await page.screenshot({ path: join(dir, 'real-dwg.png') });
    await page.evaluate(() => { const e = renderer.dxfData.entities.find(e => e.text?.includes('演艺中心一层')); if (e) { renderer.scale *= 2; renderer.offsetX = 500-e.x*renderer.scale; renderer.offsetY = 500+e.y*renderer.scale; render(); } });
    await page.screenshot({ path: join(dir, 'real-dwg-detail.png') });
    console.log('Real DWG:', JSON.stringify(real));
  }
  assert.deepEqual(errors, []);
  console.log('PASS: legacy/Unicode/GBK text, formatting and multiline chunks, small text scale, block hierarchy/transforms/OCS, layer visibility, project round trip, browser errors. Artifacts:', dir);
} finally { await browser.close(); }
