import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'needflea-3d-annotations-'));
const browser=await puppeteer.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage();await page.setViewport({width:1440,height:1000});page.setDefaultTimeout(30000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(process.env.NEEDFLEA_URL||'http://127.0.0.1:3002',{waitUntil:'networkidle0'});
  await page.evaluate(async()=>{
    const {VenueScene}=await import('./scene-three.js?v=13'),draw=VenueScene.prototype.draw;
    VenueScene.prototype.draw=function(){window.annotationScene=this;return draw.call(this);};
    const dxf=['0','SECTION','2','ENTITIES',...[[0,0,20000,0],[20000,0,20000,15000],[20000,15000,0,15000],[0,15000,0,0]].flatMap(([a,b,c,d])=>['0','LINE','8','Boundary','10',a,'20',b,'11',c,'21',d]),'0','ENDSEC','0','EOF'].join('\n');
    await projectIO.load({version:3,cadFile:{name:'annotation-fixture.dxf',base64:btoa(dxf)},metersPerUnit:.001,items:[
      {id:1,type:'zone',wx:4000,wy:4000,label:'柱子',fontSize:40},
      {id:2,type:'zone',wx:8000,wy:4000,label:'柱子',fontSize:20},
      {id:3,type:'arrow',wx1:3000,wy1:7000,wx2:8000,wy2:7000},
      {id:4,type:'dim',wx1:3000,wy1:9500,wx2:8000,wy2:9500,label:'5.00m'},
      {id:5,type:'line',pts:[{wx:10000,wy:3000},{wx:15000,wy:3000},{wx:15000,wy:6000}],closed:true,lineStyle:'dashed'},
      {id:6,type:'guard',wx:12000,wy:10000},{id:7,type:'fire',wx:15000,wy:10000},
      {id:8,type:'booth',wx:11000,wy:6500,ww:2000,wh:2000,size:'2x2',boothStyle:'tent',label:'B4',cat:'二手'}
    ],environment:{schema:'needflea-environment/1',objects:[{id:77,type:'column',x:4000,y:4000,width:2,depth:2,height:3,angle:0,color:'#ff00ff'}]}});
  });
  const original=await page.evaluate(()=>structuredClone(booths.items));
  await page.click('#btn-environment');await page.waitForFunction(()=>_3dMode&&!document.querySelector('#btn-environment').disabled);
  const details=await page.evaluate(async()=>{
    const {Vector3,Quaternion}=await import('three');
    return annotationScene.scene.children.filter(g=>g.userData.annotationType).map(g=>{
      const text=g.getObjectByName('annotation-text'),head=g.getObjectByName('annotation-arrowhead');
      return {id:g.userData.boothId,type:g.userData.annotationType,ground:!text||new Vector3(0,0,1).applyQuaternion(text.getWorldQuaternion(new Quaternion())).y>.999,position:text?.getWorldPosition(new Vector3()).toArray(),width:text?.geometry.parameters.width,alpha:text?.material.map.image.getContext('2d').getImageData(0,0,1,1).data[3],depth:!text||text.material.depthTest,head:head?.geometry.attributes.position.count,strokes:g.children.filter(c=>c.name==='annotation-stroke').length};
    });
  });
  assert.equal(details.length,7);assert.ok(details.every(g=>g.ground&&g.depth));
  assert.deepEqual(details[0].position.map(v=>Math.round(v*1000)/1000),[-6,.015,3.5]);
  assert.ok(Math.abs(details[0].width/details[1].width-2)<1e-8,'Font size ratio is preserved');assert.equal(details[0].alpha,0,'Ground text has no white signboard');
  assert.equal(details.find(d=>d.type==='arrow').head,3,'Arrow uses a flat triangle');assert.equal(details.find(d=>d.type==='dim').strokes,3,'Dimension includes two perpendicular endpoint ticks');
  // Actual rendered occlusion: the magenta column must cover the ground word.
  const capture=async visible=>page.evaluate(async visible=>{
    const {Vector3,MeshBasicMaterial}=await import('three'),s=annotationScene;
    s.restoreView({position:[0,35,.001],target:[0,0,0],fov:40});
    const column=s.scene.children.find(g=>g.userData.objectId===77);column.visible=visible;
    column.traverse(o=>{if(o.isMesh){o.material.dispose();o.material=new MeshBasicMaterial({color:'#ff00ff'});}});
    s.draw();
    const text=s.scene.children.find(g=>g.userData.boothId===1).getObjectByName('annotation-text'),coords=[];
    const attr=text.geometry.attributes.position;
    for(let i=0;i<attr.count;i++){const p=new Vector3().fromBufferAttribute(attr,i).applyMatrix4(text.matrixWorld).project(s.camera);coords.push([(p.x+1)*s.renderer.domElement.width/2,(1-p.y)*s.renderer.domElement.height/2]);}
    return {data:s.renderer.domElement.toDataURL('image/png').split(',')[1],bounds:{left:Math.floor(Math.min(...coords.map(p=>p[0]))),top:Math.floor(Math.min(...coords.map(p=>p[1]))),width:Math.ceil(Math.max(...coords.map(p=>p[0])))-Math.floor(Math.min(...coords.map(p=>p[0]))),height:Math.ceil(Math.max(...coords.map(p=>p[1])))-Math.floor(Math.min(...coords.map(p=>p[1])))}};
  },visible);
  const hidden=await capture(false),covered=await capture(true);
  const darkPixels=async image=>{const {data,info}=await sharp(Buffer.from(image.data,'base64')).extract(image.bounds).removeAlpha().raw().toBuffer({resolveWithObject:true});let count=0;for(let i=0;i<data.length;i+=info.channels)if(data[i]<100&&data[i+1]<100&&data[i+2]<100)count++;return count;};
  assert.ok(await darkPixels(hidden)>10);assert.equal(await darkPixels(covered),0,'Opaque geometry occludes ground annotations');
  await writeFile(join(dir,'top-plan-annotations.png'),Buffer.from(hidden.data,'base64'));
  await page.evaluate(()=>{annotationScene.scene.children.find(g=>g.userData.objectId===77).visible=false;annotationScene.fit();});
  await page.click('#env-close');await page.screenshot({path:join(dir,'annotations-perspective.png')});
  await page.click('#btn-environment');await page.click('#env-step-export');await page.click('#env-annotations');
  assert.equal(await page.evaluate(()=>annotationScene.scene.children.filter(g=>g.userData.annotationType).length),0);
  assert.equal(await page.evaluate(()=>annotationScene.scene.children.some(g=>g.isSprite&&g.userData.boothId===8)),true,'Booth labels have their own visibility');
  const saved=await page.evaluate(()=>projectIO.capture());await page.evaluate(p=>projectIO.load(p),saved);assert.equal(await page.evaluate(()=>environmentUI.snapshot().showAnnotations),false);
  assert.deepEqual(await page.evaluate(()=>booths.items),original);
  assert.deepEqual(errors,[]);
  console.log('PASS: CAD mm/metres coordinate alignment, grounded transparent text and font ratios, planar arrow, dashed closed polyline, dimension ticks, facilities, real depth occlusion, independent visibility, save/load. Artifacts:',dir);
} finally {await browser.close();}
