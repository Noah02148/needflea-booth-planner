// Browser-local venues with multiple independent activities; includes v1 data migration.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import puppeteer from 'puppeteer';
const dir=await mkdtemp(join(tmpdir(),'needflea-site-activities-'));
const browser=await puppeteer.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage();await page.setViewport({width:1440,height:1100});page.setDefaultTimeout(60000);
  const errors=[],dialogs=[];let accept=true;
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.message());if(accept)await d.accept();else await d.dismiss();});
  const cdp=await page.createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir});
  const dxf=['0','SECTION','2','HEADER','9','$INSUNITS','70','6','0','ENDSEC','0','SECTION','2','ENTITIES',...[[0,0,20,0],[20,0,20,15],[20,15,0,15],[0,15,0,0]].flatMap(([a,b,c,d])=>['0','LINE','8','Walls','10',a,'20',b,'11',c,'21',d]),'0','ENDSEC','0','EOF'].join('\n');
  const cad={name:'venue.dxf',base64:Buffer.from(dxf).toString('base64')};
  const column={id:1,type:'column',name:'实测柱',x:4,y:5,width:.6,depth:.6,height:4.2,angle:0};
  const project={version:3,cadFile:cad,metersPerUnit:1,categories:{'市集':{fill:'#66aadd',stroke:'#335577'}},items:[{id:1,type:'booth',wx:2,wy:3,ww:2,wh:2,cat:'市集',label:'A1'}],nextId:2,environment:{schema:'needflea-environment/1',objects:[column],photos:[],notes:'实测'},site:{name:'深圳 ING 创意社区',eventName:'NEED! FLEA 2026'}};
  const second=structuredClone(project);second.items[0].label='B1';second.items[0].wx=10;second.environment.objects[0].height=5;
  const secondFile=join(dir,'2027.json');await writeFile(secondFile,JSON.stringify(second));
  const legacy=join(dir,'annotations-only.json');await writeFile(legacy,JSON.stringify({version:2,items:[{id:2,type:'zone',wx:1,wy:1,label:'旧项目'}],nextId:3}));
  const invalid=join(dir,'invalid.json');await writeFile(invalid,JSON.stringify({version:3,items:[],environment:{schema:'bad',objects:[]}}));
  const cadFile=join(dir,'new.dxf');await writeFile(cadFile,dxf);
  await page.goto(process.env.NEEDFLEA_URL||'http://127.0.0.1:3002',{waitUntil:'networkidle0'});
  await page.waitForFunction(()=>!!window.environmentUI&&!!window.projectIO);
  // Seed exactly the previous release's schema, then open the new UI to migrate it.
  await page.evaluate(project=>new Promise((resolve,reject)=>{
    const r=indexedDB.open('needflea-site-library',1);r.onupgradeneeded=()=>{for(const n of ['sites','projects'])r.result.createObjectStore(n,{keyPath:'id'});};
    r.onsuccess=()=>{const db=r.result,tx=db.transaction(['sites','projects'],'readwrite');tx.objectStore('sites').put({id:'fixture-site',name:project.site.name,eventName:project.site.eventName,createdAt:1,updatedAt:2,sourceName:project.cadFile.name,itemCount:1});tx.objectStore('projects').put({id:'fixture-site',project});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};r.onerror=()=>reject(r.error);
  }),project);
  const idle=()=>page.waitForFunction(()=>document.querySelector('#site-library-dialog').getAttribute('aria-busy')==='false');
  const open=async()=>{await page.click('#toolbar-tab-files');await page.click('#site-library-button');await idle();};
  const dbGet=(store,id)=>page.evaluate(({store,id})=>new Promise((resolve,reject)=>{const r=indexedDB.open('needflea-site-library',2);r.onsuccess=()=>{const db=r.result,tx=db.transaction(store),q=id?tx.objectStore(store).get(id):tx.objectStore(store).getAll();tx.oncomplete=()=>{db.close();resolve(q.result);};tx.onerror=()=>reject(tx.error);};}),{store,id});
  const load=async id=>{await page.click(`[data-activity-load="${id}"]`);await page.waitForFunction(()=>!document.querySelector('#site-library-dialog').open);};
  const createActivity=async(name,source,file)=>{
    await page.$eval('#activity-create-details',e=>e.open=true);await page.$eval('#activity-name',(e,v)=>e.value=v,name);await page.select('#activity-source',source);
    if(file)await(await page.$('#activity-file')).uploadFile(file);await page.click('#activity-create');await idle();
  };
  await open();
  const migrated=await dbGet('activities');assert.equal(migrated.length,1);const firstId=migrated[0].id;
  assert.equal(migrated[0].name,'NEED! FLEA 2026');
  assert.deepEqual((await dbGet('activityProjects',firstId)).project.items,project.items,'Migration preserves original booth layout');
  const base=(await dbGet('projects','fixture-site')).project;assert.equal(base.items.length,0);assert.equal(base.environment.objects[0].height,4.2);assert.equal(base.cadFile.base64,cad.base64);
  await load(firstId);assert.equal(await page.evaluate(()=>booths.items[0].label),'A1');
  await open();await createActivity('NEED! FLEA 2027','file',secondFile);
  assert.match(await page.$eval('#site-message',e=>e.textContent),/新活动已保存/);
  const secondId=(await dbGet('activities')).find(a=>a.name==='NEED! FLEA 2027').id;
  assert.equal(await page.evaluate(()=>booths.items[0].label),'B1');assert.equal(await page.evaluate(()=>environmentUI.snapshot().objects[0].height),5);
  await page.evaluate(()=>{booths.items[0].label='B8';render();});await page.$eval('#site-current-event',e=>e.value='NEED! FLEA 2027 春季');await page.click('#site-update');await idle();
  assert.equal((await dbGet('activityProjects',firstId)).project.items[0].label,'A1','Updating 2027 never changes 2026');
  assert.equal((await dbGet('projects','fixture-site')).project.environment.objects[0].height,4.2,'Activity update never changes site base');
  await load(firstId);assert.equal(await page.evaluate(()=>environmentUI.snapshot().objects[0].height),4.2);
  await page.reload({waitUntil:'networkidle0'});await open();assert.equal(await page.$$eval('[data-activity-load]',e=>e.length),2,'Both activities persist after reload');
  await load(secondId);assert.equal(await page.evaluate(()=>booths.items[0].label),'B8');assert.equal(await page.evaluate(()=>projectIO.capture(false).site.eventName),'NEED! FLEA 2027 春季');
  await page.evaluate(()=>{booths.items[0].label='未保存';render();});await open();accept=false;await page.click(`[data-activity-load="${firstId}"]`);await idle();assert.equal(await page.evaluate(()=>booths.items[0].label),'未保存');accept=true;assert.ok(dialogs.some(t=>t.includes('尚未保存')));
  await load(firstId);await open();await createActivity('2028 空布局','base');
  assert.equal(await page.evaluate(()=>booths.items.length),0);assert.equal(await page.evaluate(()=>environmentUI.snapshot().objects[0].height),4.2);
  const emptyId=(await dbGet('activities')).find(a=>a.name==='2028 空布局').id;
  await createActivity('旧 JSON 活动','file',legacy);
  assert.equal(await page.evaluate(()=>renderer.dxfData.entities.length),4,'Annotation-only JSON inherits this venue CAD');assert.equal(await page.evaluate(()=>metersPerUnit),1);
  assert.equal(await page.evaluate(()=>environmentUI.snapshot().objects[0].height),4.2);
  await createActivity('当前布局副本','current');
  assert.equal(await page.evaluate(()=>booths.items[0].label),'旧项目');
  const before=await page.evaluate(()=>projectIO.capture(false));const count=(await dbGet('activities')).length;
  await createActivity('无效活动','file',invalid);assert.deepEqual(await page.evaluate(()=>projectIO.capture(false)),before);assert.equal((await dbGet('activities')).length,count);
  await createActivity('NEED! FLEA 2026','base');assert.match(await page.$eval('#site-message',e=>e.textContent),/同名活动/);assert.equal((await dbGet('activities')).length,count);
  await page.evaluate(()=>{window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException('模拟空间不足','QuotaExceededError');};});
  await createActivity('存储失败','base');await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalPut;delete window.originalPut;});
  assert.deepEqual(await page.evaluate(()=>projectIO.capture(false)),before);assert.equal((await dbGet('activities')).length,count,'Failed transaction leaves no partial activity');
  await page.click(`[data-activity-export="${secondId}"]`);await idle();
  let exported;const filename='深圳 ING 创意社区_NEED! FLEA 2027 春季.json';for(let i=0;i<50;i++){if((await readdir(dir)).includes(filename)){exported=JSON.parse(await readFile(join(dir,filename),'utf8'));break;}await new Promise(r=>setTimeout(r,100));}
  assert.equal(exported.items[0].label,'B8');assert.equal(exported.site.eventName,'NEED! FLEA 2027 春季');assert.equal(exported.cadFile.base64,cad.base64);
  await page.evaluate(()=>{const s=environmentUI.snapshot();s.objects[0].height=6;environmentUI.restore(s);render();});
  await page.$eval('#site-current details',e=>e.open=true);
  await page.click('#site-update-base');await idle();
  assert.equal((await dbGet('projects','fixture-site')).project.items.length,0);
  assert.equal((await dbGet('projects','fixture-site')).project.environment.objects[0].height,6);
  assert.equal((await dbGet('activityProjects',firstId)).project.environment.objects[0].height,4.2);
  assert.equal((await dbGet('activityProjects',secondId)).project.environment.objects[0].height,5);
  // Create a second physical venue; its activities must stay scoped to that venue.
  await page.$eval('#site-create-details',e=>e.open=true);await page.type('#site-name','第二场地');await page.type('#site-event','独立活动');await(await page.$('#site-file')).uploadFile(cadFile);await page.click('#site-create');await idle();
  assert.equal((await dbGet('sites')).length,2);assert.equal(await page.$$eval('[data-activity-load]',e=>e.length),1);assert.equal(await page.evaluate(()=>booths.items.length),0);
  await page.click('[data-site-select="fixture-site"]');await idle();assert.equal(await page.$$eval('[data-activity-load]',e=>e.length),count);
  await load(secondId);await open();await page.$eval('#site-current details',e=>e.open=false);await page.$eval('#site-library-dialog',e=>e.scrollTop=0);
  await page.screenshot({path:join(dir,'site-activities.png')});
  await page.setViewport({width:390,height:844});assert.ok(await page.$eval('#site-library-dialog',e=>e.getBoundingClientRect().width<=innerWidth));await page.screenshot({path:join(dir,'site-activities-mobile.png')});
  // Failed schema upgrades must leave v1 snapshots recoverable.
  const context=await browser.createBrowserContext(),migrationPage=await context.newPage();
  await migrationPage.goto(process.env.NEEDFLEA_URL||'http://127.0.0.1:3002',{waitUntil:'networkidle0'});
  await migrationPage.evaluate(project=>new Promise((resolve,reject)=>{
    const r=indexedDB.open('needflea-site-library',1);r.onupgradeneeded=()=>{for(const n of ['sites','projects'])r.result.createObjectStore(n,{keyPath:'id'});};
    r.onsuccess=()=>{const db=r.result,tx=db.transaction(['sites','projects'],'readwrite');tx.objectStore('sites').put({id:'old',name:'待迁移场地',eventName:'旧活动'});tx.objectStore('projects').put({id:'old',project});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};
  }),project);
  await migrationPage.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='activityProjects')throw new DOMException('模拟升级存储失败','QuotaExceededError');return put.apply(this,args);};});
  await migrationPage.click('#toolbar-tab-files');await migrationPage.click('#site-library-button');await migrationPage.waitForFunction(()=>document.querySelector('#site-library-dialog').getAttribute('aria-busy')==='false');
  assert.match(await migrationPage.$eval('#site-message',e=>e.textContent),/升级或打开失败/);
  const retained=await migrationPage.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('needflea-site-library',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('projects'),q=tx.objectStore('projects').get('old');tx.oncomplete=()=>{const result={version:db.version,project:q.result.project};db.close();resolve(result);};};}));
  assert.equal(retained.version,1);assert.deepEqual(retained.project,project);await context.close();
  assert.deepEqual(errors,[]);console.log('PASS: v1 migration; independent per-venue activities; JSON/base import; scoped update; refresh/load; unsaved cancel; duplicate guard; failed import/storage rollback; full backup; CAD venue creation; mobile layout. Artifacts:',dir);
}finally{await browser.close();}
