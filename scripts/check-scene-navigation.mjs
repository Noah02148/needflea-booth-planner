import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser=await puppeteer.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage();await page.setViewport({width:1440,height:1000});page.setDefaultTimeout(30000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(process.env.NEEDFLEA_URL||'http://127.0.0.1:3002',{waitUntil:'networkidle0'});
  await page.evaluate(async()=>{
    const {VenueScene}=await import('./scene-three.js?v=13'),draw=VenueScene.prototype.draw;
    VenueScene.prototype.draw=function(){window.navScene=this;return draw.call(this);};
    await projectIO.load({version:3,items:[],metersPerUnit:1,environment:{schema:'needflea-environment/1',objects:[],sitePlan:{schema:'needflea-site-plan/1',points:[{x:0,y:0},{x:20,y:0},{x:20,y:15},{x:0,y:15}]}}});
  });
  await page.click('#btn-environment');await page.waitForFunction(()=>_3dMode&&!document.querySelector('#btn-environment').disabled);
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  const snapshot=()=>page.evaluate(()=>({position:navScene.camera.position.toArray(),target:navScene.controls.target.toArray(),rotation:navScene.camera.quaternion.toArray()}));
  const restore=async(position=[8,6,8],target=[0,0,0])=>page.evaluate(({position,target})=>{navScene.stopNavigation();navScene.restoreView({position,target,fov:40});}, {position,target});
  const before=await page.evaluate(()=>projectIO.capture(false));
  for(const [key,x,z] of [['w',-1,-1],['s',1,1],['a',-1,1],['d',1,-1]]) {
    await restore();await page.focus('#scene-three canvas');const a=await snapshot();
    await page.keyboard.down(key);await pause(260);await page.keyboard.up(key);const b=await snapshot();
    const delta=b.position.map((v,i)=>v-a.position[i]);assert.ok(delta[0]*x>.01&&delta[2]*z>.01,key+' moves in the view-relative direction');assert.ok(Math.abs(delta[1])<1e-8,'Navigation keeps camera height');
    for(let i=0;i<3;i++)assert.ok(Math.abs((b.target[i]-a.target[i])-delta[i])<1e-7,'Camera and orbit target move together');
    for(let i=0;i<4;i++)assert.ok(Math.abs(b.rotation[i]-a.rotation[i])<1e-7,'Navigation preserves viewing direction');
    await pause(150);assert.deepEqual(await snapshot(),b,'Releasing a key stops navigation');
  }
  await restore([8,6,-8]);await page.focus('#scene-three canvas');let a=await snapshot();await page.keyboard.down('w');await pause(220);await page.keyboard.up('w');let b=await snapshot();assert.ok(b.position[0]<a.position[0]&&b.position[2]>a.position[2],'Movement follows a rotated camera');
  await restore([0,1.65,8],[0,1.65,0]);await page.focus('#scene-three canvas');a=await snapshot();await page.keyboard.down('w');await pause(220);await page.keyboard.up('w');b=await snapshot();assert.ok(b.position[2]<a.position[2]);assert.ok(Math.abs(b.position[1]-1.65)<1e-8);
  await page.click('#env-step-export');await page.focus('#env-view-name');a=await snapshot();await page.keyboard.type('wasdWASD');await pause(150);assert.deepEqual(await snapshot(),a);assert.equal(await page.$eval('#env-view-name',e=>e.value),'wasdWASD');
  await page.focus('#scene-three canvas');await page.keyboard.down('w');await pause(100);await page.focus('#env-view-name');a=await snapshot();await pause(200);assert.deepEqual(await snapshot(),a,'Losing canvas focus clears held keys');await page.keyboard.up('w');
  await page.focus('#scene-three canvas');await page.keyboard.down('d');await pause(100);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));a=await snapshot();await pause(150);assert.deepEqual(await snapshot(),a,'Window blur stops held keys');await page.keyboard.up('d');
  a=await snapshot();await page.$eval('#scene-three canvas',e=>e.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',key:'w',ctrlKey:true,bubbles:true})));await pause(150);assert.deepEqual(await snapshot(),a,'Modifier shortcuts do not navigate');
  await page.focus('#scene-three canvas');await page.keyboard.down('w');await pause(100);await page.click('#env-view-2d');a=await snapshot();await pause(150);assert.deepEqual(await snapshot(),a,'Switching to 2D stops motion');await page.keyboard.up('w');
  assert.equal(await page.evaluate(()=>_3dMode),false);assert.equal(await page.evaluate(()=>navScene.navigationKeys.size),0);
  assert.deepEqual(await page.evaluate(()=>projectIO.capture(false)),before,'Navigation does not change project geometry or saved views');
  assert.deepEqual(errors,[]);
  console.log('PASS: WASD view-relative planar movement, orbit target/height/direction preserved, key release, rotated/human views, typing, canvas/window blur, modifiers, 2D exit and unchanged project data.');
} finally {await browser.close();}
