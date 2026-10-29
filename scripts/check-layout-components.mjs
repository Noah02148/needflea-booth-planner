import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'needflea-layout-components-'));
const browser=await puppeteer.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage();await page.setViewport({width:1440,height:1000});page.setDefaultTimeout(30000);
  const errors=[],dialogs=[];let accept=true;
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.message());accept?await d.accept():await d.dismiss();});
  await page.goto(process.env.NEEDFLEA_URL||'http://127.0.0.1:3002',{waitUntil:'networkidle0'});
  await page.evaluate(async()=>{
    const {VenueScene}=await import('./scene-three.js?v=7');const draw=VenueScene.prototype.draw;
    VenueScene.prototype.draw=function(){window.testScene=this;return draw.call(this);};
    await projectIO.load({version:3,items:[],metersPerUnit:1,environment:{schema:'needflea-environment/1',objects:[],sitePlan:{schema:'needflea-site-plan/1',points:[{x:0,y:0},{x:40,y:0},{x:40,y:25},{x:0,y:25}]}}});
  });
  await page.click('#btn-environment');await page.waitForFunction(()=>_3dMode&&!document.querySelector('#btn-environment').disabled);
  const project=async(x,y,h=0)=>page.evaluate((x,y,h)=>{const s=window.testScene,r=s.renderer.domElement.getBoundingClientRect(),p=s.position(x,y,h).project(s.camera);return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};},x,y,h);
  await page.click('#toolbar-tab-layout');
  const styles=['tent','canopy','table','tent-yard','canopy-yard'];
  for(let i=0;i<styles.length;i++){
    await page.select('#btn-booth',styles[i]);const p=await project(8+(i%3)*7,8+Math.floor(i/3)*7);await page.mouse.click(p.x,p.y);
    await page.waitForFunction(n=>booths.items.length===n, {}, i+1);
    assert.equal(await page.evaluate(()=>booths.items.at(-1).height),2.5);
  }
  assert.equal(await page.evaluate(()=>_3dMode),true);
  const sizes=await page.evaluate(async()=>{const {Box3}=await import('three');return window.testScene.scene.children.filter(o=>o.userData.boothId).map(o=>({id:o.userData.boothId,height:new Box3().setFromObject(o).max.y}));});
  for(const [i,s] of sizes.entries()) if(styles[i]!=='table') assert.ok(Math.abs(s.height-2.5)<.001,JSON.stringify(s));
  await page.click('#btn-select');
  const b=await page.evaluate(()=>booths.items[0]);const p=await project(b.wx+b.ww/2,b.wy+b.wh/2,.05);
  accept=false;await page.mouse.click(p.x,p.y,{button:'right'});assert.equal(await page.evaluate(()=>booths.items.length),5);
  accept=true;await page.mouse.click(p.x,p.y,{button:'right'});await page.waitForFunction(()=>booths.items.length===4);
  await page.click('#layout-tab-components');
  assert.equal(await page.$('#env-step-layout'),null,'Activity layout is no longer a scene tab');
  await page.click('[data-env-add=stage]');const sp=await project(20,17);await page.mouse.click(sp.x,sp.y);
  await page.waitForFunction(()=>environmentUI.snapshot().objects.length===1);
  const top=await project(20,17,.6), beforeDialogs=dialogs.length;
  await page.mouse.move(top.x,top.y);await page.mouse.down({button:'right'});await page.mouse.move(top.x+35,top.y+10,{steps:4});await page.mouse.up({button:'right'});
  assert.equal(dialogs.length,beforeDialogs,'Right-drag pans without deleting');
  assert.equal(await page.evaluate(()=>environmentUI.snapshot().objects.length),1);
  const top2=await project(20,17,.6);await page.mouse.click(top2.x,top2.y,{button:'right'});await page.waitForFunction(()=>environmentUI.snapshot().objects.length===0);
  assert.equal(await page.evaluate(()=>booths.items.length),4,'Deleting a component preserves booths');
  await page.click('[data-env-add=stage]');const sp2=await project(20,17);await page.mouse.click(sp2.x,sp2.y);
  await page.waitForFunction(()=>environmentUI.snapshot().objects.length===1);
  await page.click('#env-view-2d');
  const flat=await page.evaluate(()=>{const r=canvas.getBoundingClientRect();return{x:r.left+renderer.wx(20),y:r.top+renderer.wy(17)};});
  await page.mouse.click(flat.x,flat.y,{button:'right'});await page.waitForFunction(()=>environmentUI.snapshot().objects.length===0);
  const saved=await page.evaluate(()=>projectIO.capture());await page.evaluate(p=>projectIO.load(p),saved);
  assert.ok(await page.evaluate(()=>booths.items.every(b=>b.height===2.5)));
  await page.click('#toolbar-tab-layout');await page.click('#layout-tab-components');await page.screenshot({path:join(dir,'desktop.png')});
  await page.setViewport({width:390,height:844});await page.screenshot({path:join(dir,'mobile.png')});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
  console.log('PASS: five booth styles placed in 3D, 2.5m geometry, canceled/confirmed right-delete, right-drag pan, components deleted in 2D/3D, independent IDs, persistence, unified subtabs. Artifacts:',dir);
} finally {await browser.close();}
