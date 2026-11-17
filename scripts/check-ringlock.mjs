// Ringlock photo-reference checks: structure, composite corner placement and real rendering.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'needflea-ringlock-'));
const browser=await puppeteer.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage(); await page.setViewport({width:1440,height:1000});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(process.env.NEEDFLEA_URL||'http://127.0.0.1:3002',{waitUntil:'networkidle0'});
  await page.evaluate(async()=>{
    const {VenueScene}=await import('./scene-three.js?v=13'), draw=VenueScene.prototype.draw;
    VenueScene.prototype.draw=function(){window.ringScene=this;return draw.call(this);};
    const corners=[{sx:-1,sy:1},{sx:1,sy:1},{sx:-1,sy:-1},{sx:1,sy:-1}];
    const items=[{id:1,type:'booth',boothStyle:'tent',wx:1,wy:1,ww:2,wh:2,size:'2x2',angle:0,label:'标准 2×2',cat:'二手'},...corners.map((c,i)=>({id:i+2,type:'booth',boothStyle:'tent-yard',wx:5+(i%2)*5,wy:1+Math.floor(i/2)*5,ww:4,wh:2,size:'4x2',angle:i*30,label:`复合 ${i+1}`,cat:'二手',tentCorner:c}))];
    await projectIO.load({version:3,items,metersPerUnit:1,environment:{schema:'needflea-environment/1',objects:[],showLabels:false,sitePlan:{schema:'needflea-site-plan/1',points:[{x:0,y:0},{x:17,y:0},{x:17,y:10},{x:0,y:10}]}}});
  });
  await page.click('#btn-environment');await page.waitForFunction(()=>_3dMode&&!document.querySelector('#btn-environment').disabled);
  const geometry=await page.evaluate(async()=>{
    const {Box3,Matrix4,Vector3}=await import('three');
    return ringScene.scene.children.filter(g=>g.userData.boothId).map(g=>{
      const frame=g.getObjectByName('ringlock-frame'), posts=frame.getObjectByName('ringlock-post'), base=frame.getObjectByName('ringlock-base');
      const positions=[];for(let i=0;i<posts.count;i++){const m=new Matrix4();posts.getMatrixAt(i,m);positions.push(new Vector3().setFromMatrixPosition(m).toArray());}
      const ledgers=frame.children.filter(p=>p.name==='ringlock-ledger').flatMap(p=>{const a=[];for(let i=0;i<(p.count||1);i++){const m=new Matrix4();if(p.isInstancedMesh)p.getMatrixAt(i,m);else m.copy(p.matrix);a.push(new Vector3().setFromMatrixPosition(m).toArray());}return a;});
      return{id:g.userData.boothId,height:new Box3().setFromObject(g).max.y,posts:positions,offset:frame.position.toArray(),bases:base.count,ledgers,draws:frame.children.length,metal:posts.material.metalness,rosettes:frame.getObjectByName('ringlock-rosette').count};
    });
  });
  assert.equal(geometry.length,5);
  for(const g of geometry){
    assert.ok(Math.abs(g.height-2.5)<.001);assert.equal(g.posts.length,4);assert.equal(g.bases,4);assert.equal(g.rosettes,8);assert.equal(g.ledgers.length,7);
    assert.ok(g.metal>.7);assert.ok(g.draws<=12,'Hardware should use instanced draws');
    assert.equal(Math.max(...g.posts.map(p=>p[0]))-Math.min(...g.posts.map(p=>p[0])),2);
    assert.equal(Math.max(...g.posts.map(p=>p[2]))-Math.min(...g.posts.map(p=>p[2])),2);
    assert.ok(g.ledgers.every(p=>p[1]>1),'There must be no ground-level trip rail');
    assert.ok(!g.ledgers.some(p=>p[1]<2 && p[2]>.99 && Math.abs(p[0])<.01),'Lower entry side stays open');
  }
  assert.deepEqual(geometry.map(g=>g.offset[0]),[0,-1,1,-1,1]);
  await page.evaluate(()=>{environmentUI.snapshot();ringScene.restoreView({position:[1.7,3.1,7.8],target:[-3.3,1.2,1.7],fov:45});});
  await page.click('#env-close');await page.screenshot({path:join(dir,'ringlock-overview.png')});
  await page.evaluate(()=>ringScene.restoreView({position:[-1.6,2.5,5.5],target:[-5.1,1.3,2.8],fov:38}));
  await page.screenshot({path:join(dir,'ringlock-detail.png')});
  const before=await page.evaluate(()=>projectIO.capture(false));
  await page.evaluate(p=>projectIO.load(p),before);
  assert.deepEqual(await page.evaluate(()=>booths.items),before.items);
  await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1440;c.height=1000;const r=new IsoRenderer(c);r.render(booths,metersPerUnit,false);window.isoCheck=c.toDataURL();});
  assert.ok(await page.evaluate(()=>isoCheck.length>10000));
  await page.evaluate(async()=>{
    const p=projectIO.capture();p.items=p.items.slice(0,2);
    Object.assign(p.items[0],{wx:1,wy:1,angle:0});Object.assign(p.items[1],{wx:5,wy:1,angle:0,tentCorner:{sx:-1,sy:1}});
    p.environment.sitePlan.points=[{x:0,y:0},{x:10,y:0},{x:10,y:5},{x:0,y:5}];
    p.environment.floorColor='#e0ded8';p.darkMode=false;
    await projectIO.load(p);await openEnvironment();
    ringScene.restoreView({position:[5,4.2,10.5],target:[-.3,1.1,0],fov:43});
    ringScene.renderer.setPixelRatio(1);ringScene.renderer.setSize(1920,1080,false);ringScene.camera.aspect=16/9;ringScene.camera.updateProjectionMatrix();ringScene.draw();
  });
  const preview=await page.evaluate(()=>ringScene.renderer.domElement.toDataURL('image/png').split(',')[1]);
  await writeFile(join(dir,'ringlock-reference-preview.png'),Buffer.from(preview,'base64'));
  assert.deepEqual(errors,[]);
  console.log('PASS: ringlock 2x2, 2x4 yard, all corner positions and rotations, open entry, silver tubes/rosettes/bases, 2.5m height, instancing, save/load, iso rendering. Artifacts:',dir);
} finally {await browser.close();}
