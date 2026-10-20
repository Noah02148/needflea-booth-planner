// Real browser checks: CAD import, placement, photo/material input, persistence,
// legacy JSON and 2D fallback. Uses an isolated browser and temporary fixtures.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import sharp from 'sharp';

const dir = await mkdtemp(join(tmpdir(), 'needflea-environment-'));
console.log(`Fixtures: ${dir}`);
const url = process.env.NEEDFLEA_URL || 'http://127.0.0.1:3002';
const browser = await puppeteer.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.setDefaultTimeout(60000);
console.log('Browser ready');
const errors = [], dialogs = [];
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
const client = await page.createCDPSession();
await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true });
const download = async (action, name) => {
  let timeout;
  const complete = new Promise(resolve => {
    const handler = e => { if (e.state === 'completed') { client.off('Browser.downloadProgress', handler); resolve(); } };
    client.on('Browser.downloadProgress', handler);
  });
  await action();
  try {
    await Promise.race([complete, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Download timeout: ${name}`)), 15000); })]);
  } finally { clearTimeout(timeout); }
  return join(dir, name);
};
try {
  await page.goto(url, { waitUntil: 'networkidle0' });
  console.log('Page loaded');
  await page.click('#btn-3d');
  assert.match(dialogs.pop(), /比例尺/);
  const dxf = ['0','SECTION','2','ENTITIES', ...[[0,0,20000,0],[20000,0,20000,15000],[20000,15000,0,15000],[0,15000,0,0],[4000,0,4000,15000]].flatMap(([x1,y1,x2,y2]) => ['0','LINE','8','Walls','10',x1,'20',y1,'11',x2,'21',y2]), '0','ENDSEC','0','EOF'].join('\n');
  const dxfPath = join(dir, 'venue.dxf'); await writeFile(dxfPath, dxf);
  const fileInput = await page.$('input[type=file][accept*=".dxf" i]');
  assert.ok(fileInput, 'CAD import input exists'); await fileInput.uploadFile(dxfPath);
  await page.waitForFunction(() => dxfLoaded && renderer.dxfData?.entities?.length === 5);
  const cadBounds = await page.evaluate(() => renderer.dxfData.bounds);
  assert.ok(Object.values(cadBounds).every(Number.isFinite), 'Small CAD files must have finite bounds');
  assert.ok(cadBounds.maxX >= 20000 && cadBounds.maxY >= 15000, 'Small CAD bounds include the whole room');
  console.log('CAD imported');
  await page.evaluate(() => {
    metersPerUnit = 0.001; updateScaleInfo();
    const styles = ['tent', 'canopy', 'table', 'tent-yard', 'canopy-yard'];
    styles.forEach((style, i) => {
      const b = booths.addBooth(3000 + (i % 3) * 5000, 4000 + Math.floor(i / 3) * 6000, '二手', '3x3');
      // The app converts metre-sized booth presets to CAD world units.
      const cx = b.wx + b.ww / 2, cy = b.wy + b.wh / 2;
      b.ww = b.wh = 3000; b.wx = cx - 1500; b.wy = cy - 1500;
      b.boothStyle = style; b.label = `A${i + 1}`; b.angle = i * 15;
    }); render();
  });
  await page.click('#btn-environment');
  await page.waitForSelector('#scene-three canvas', { visible: true });
  await page.waitForFunction(() => !document.querySelector('#btn-3d').disabled);
  console.log('Three.js initialized');
  assert.equal(await page.$eval('#canvas', e => e.style.visibility), 'hidden');
  await page.click('[data-env-add="column"]');
  await page.mouse.click(580, 550);
  await page.waitForFunction(() => environmentUI.snapshot().objects.length === 1);
  console.log('Column placed');
  await page.click('[data-env-add="wall"]');
  await page.mouse.click(450, 480); await page.mouse.click(650, 480);
  await page.waitForFunction(() => environmentUI.snapshot().objects.length === 2);
  console.log('Wall placed');
  const placed = await page.evaluate(() => environmentUI.snapshot().objects);
  assert.equal(placed[0].height, 3); assert.ok(placed[1].width > 0.01);
  // Editing a selected object must keep selection and exact dimensions.
  await page.evaluate(() => {
    const inputs = document.querySelectorAll('#env-object-editor input');
    inputs[4].value = '4.2'; inputs[4].dispatchEvent(new Event('change'));
  });
  assert.equal(await page.evaluate(() => environmentUI.snapshot().objects[1].height), 4.2);
  const photo = join(dir, 'floor.jpg');
  await sharp({ create: { width: 80, height: 80, channels: 3, background: '#afab98' } }).jpeg().toFile(photo);
  await (await page.$('#env-photos')).uploadFile(photo);
  await page.waitForFunction(() => environmentUI.snapshot().photos.length === 1);
  await page.click('[data-photo-place="0"]');
  await page.waitForFunction(() => environmentUI.isPhotoPositioning() && !_3dMode);
  const posePoints = await page.evaluate(() => { const r = canvas.getBoundingClientRect(); return [[6000, 5000], [9000, 8000]].map(([x, y]) => ({ x: r.left + renderer.wx(x), y: r.top + renderer.wy(y) })); });
  await page.mouse.click(posePoints[0].x, posePoints[0].y);
  await page.mouse.move(posePoints[1].x, posePoints[1].y);
  await page.screenshot({ path: join(dir, 'photo-camera-preview.png') });
  await page.mouse.click(posePoints[1].x, posePoints[1].y);
  await page.waitForFunction(() => !environmentUI.isPhotoPositioning() && _3dMode);
  const camera = await page.evaluate(() => environmentUI.snapshot().photos[0].camera);
  const pixelTolerance = await page.evaluate(() => 1.1 / renderer.scale);
  assert.ok(Math.abs(camera.x - 6000) < pixelTolerance && Math.abs(camera.y - 5000) < pixelTolerance);
  assert.ok(Math.abs(camera.targetX - 9000) < pixelTolerance && Math.abs(camera.targetY - 8000) < pixelTolerance);
  assert.match(await page.$eval('.env-photo-pose', e => e.textContent), /45°/);
  // A partial replacement must not destroy the existing pose.
  await page.click('[data-photo-place="0"]');
  await page.mouse.click(posePoints[0].x + 30, posePoints[0].y + 30);
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(() => environmentUI.snapshot().photos[0].camera), camera);
  assert.equal(await page.evaluate(() => _3dMode), true);
  assert.equal(await page.evaluate(() => booths.items.length), 5, 'Photo marking must not place or delete booths');
  await (await page.$('#env-texture')).uploadFile(photo);
  await page.waitForFunction(() => !!environmentUI.snapshot().floorTexture);
  console.log('Photos/material loaded');
  await page.click('#env-plan');
  await page.evaluate(() => booths.selectedIds.add(booths.items[0].id));
  await page.type('#env-notes', 'Wall');
  assert.equal(await page.evaluate(() => booths.items[0].angle), 0, 'Typing scene notes must not rotate the selected booth');
  await page.evaluate(() => { document.querySelector('#env-notes').value = '层高 4.2 米；柱位按 CAD'; document.querySelector('#env-notes').dispatchEvent(new Event('input')); });
  const png = await download(() => page.evaluate(() => export3DPNG()), 'NEEDFLEA_environment.png');
  const meta = await sharp(png).metadata(); assert.ok(meta.width > 500 && meta.height > 300);
  const savedName = `NEEDFLEA_project_${new Date().toISOString().slice(0,10)}.json`;
  const saved = await download(() => page.evaluate(() => saveProject()), savedName);
  const project = JSON.parse(await readFile(saved, 'utf8'));
  assert.equal(project.environment.objects.length, 2);
  assert.equal(project.environment.photos.length, 1);
  assert.deepEqual(project.environment.photos[0].camera, camera);
  assert.equal(project.items[0].ww * project.metersPerUnit, 3);
  assert.equal(project.environment.notes, '层高 4.2 米；柱位按 CAD');
  assert.ok(project.venue.entities.length >= 5);
  console.log('PNG/project exported');
  // Reject malformed data without overwriting environment or current booths.
  const invalid = join(dir, 'invalid.json');
  await writeFile(invalid, JSON.stringify({ ...project.environment, objects: [{ ...placed[0], height: -1 }] }));
  await (await page.$('#env-import')).uploadFile(invalid);
  await page.waitForFunction(() => document.querySelector('#env-message').textContent.includes('导入失败'));
  assert.equal(await page.evaluate(() => environmentUI.snapshot().objects.length), 2);
  const valid = join(dir, 'valid-environment.json');
  await writeFile(valid, JSON.stringify({ schema: 'needflea-environment/1', objects: [{ ...placed[0], height: 3.6 }] }));
  await (await page.$('#env-import')).uploadFile(valid);
  await page.waitForFunction(() => environmentUI.snapshot().objects.length === 1);
  assert.equal(await page.evaluate(() => environmentUI.snapshot().objects[0].height), 3.6);
  assert.equal(await page.evaluate(() => environmentUI.snapshot().photos.length), 1);
  const brief = await download(() => page.evaluate(() => document.querySelector('#env-brief').click()), 'NEEDFLEA_modeling_brief.json');
  const briefData = JSON.parse(await readFile(brief, 'utf8'));
  assert.equal(briefData.metersPerUnit, 0.001); assert.ok(briefData.cadEntities.length >= 5);
  assert.ok(!('dataUrl' in briefData.photos[0]));
  assert.deepEqual(briefData.photos[0].camera, camera);
  await page.click('#env-close');
  await page.screenshot({ path: join(dir, 'scene.png') });
  await page.click('#btn-3d');
  assert.equal(await page.$eval('#canvas', e => e.style.visibility), '');
  await page.reload({ waitUntil: 'networkidle0' });
  await (await page.$('#load-input')).uploadFile(saved);
  await page.waitForFunction(() => booths.items.length === 5 && environmentUI.snapshot().objects.length === 2);
  assert.equal(await page.evaluate(() => environmentUI.snapshot().objects[1].height), 4.2);
  assert.equal(await page.evaluate(() => environmentUI.snapshot().floorTexture !== null), true);
  assert.deepEqual(await page.evaluate(() => environmentUI.snapshot().photos[0].camera), camera);
  await page.click('#btn-environment');
  await page.waitForFunction(() => _3dMode && !document.querySelector('#btn-3d').disabled);
  await page.click('#env-plan');
  await page.screenshot({ path: join(dir, 'environment-panel.png') });
  await page.click('#env-close');
  await page.screenshot({ path: join(dir, 'cad-ground.png') });
  // A legacy v3 project resets the optional environment, avoiding state leaks.
  const legacy = join(dir, 'legacy.json'); delete project.environment; await writeFile(legacy, JSON.stringify(project));
  await (await page.$('#load-input')).uploadFile(legacy);
  await page.waitForFunction(() => !_3dMode && environmentUI.snapshot().objects.length === 0);
  assert.equal(await page.evaluate(() => environmentUI.snapshot().photos.length), 0);
  // WebGL failure must return to the usable 2D editor.
  // Test failure in a fresh page, leaving the completed scene checks isolated.
  const fallback = await browser.newPage();
  await fallback.evaluateOnNewDocument(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type.startsWith('webgl') ? null : original.call(this, type, ...args); };
  });
  const fallbackDialogs = [];
  fallback.on('dialog', async d => { fallbackDialogs.push(d.message()); await d.accept(); });
  await fallback.goto(url, { waitUntil: 'networkidle0' });
  await (await fallback.$('#load-input')).uploadFile(saved);
  await fallback.waitForFunction(() => booths.items.length === 5);
  await fallback.evaluate(() => toggle3DView());
  assert.equal(await fallback.evaluate(() => _3dMode), false);
  assert.equal(await fallback.$eval('#canvas', e => e.style.visibility), '');
  assert.ok(fallbackDialogs.some(m => m.includes('三维预览无法启动')));
  await fallback.close();
  assert.deepEqual(errors, []);
  console.log(`PASS: CAD + 5 booth styles, 3D placement/editing, photo/material, PNG, save/load, legacy compatibility, malformed import, WebGL fallback. Artifacts: ${dir}`);
} catch (err) {
  console.error('Diagnostics:', { errors, dialogs });
  await page.screenshot({ path: join(dir, 'failure.png') }).catch(() => {});
  throw err;
} finally { await browser.close(); }
