// Uses the real OSS adapter with an atomic fake OSS client; no Aliyun credentials/cost.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { createCloudServer, hashPassword } from '../cloud/server.mjs';
import { ossStore } from '../cloud/oss-store.mjs';

const pageURL = process.env.NEEDFLEA_URL || 'http://127.0.0.1:3002';
const objects = new Map();
let versionStatus = '', writes = 0;
const fake = {
  options: { bucket: 'test-bucket' },
  async getBucketVersioning(name) { assert.equal(name, 'test-bucket'); return { versionStatus }; },
  async get(name) { if (!objects.has(name)) throw Object.assign(new Error('missing'), {code:'NoSuchKey'}); return {content:Buffer.from(objects.get(name))}; },
  async put(name, bytes, opts) {
    assert.equal(opts.headers['x-oss-forbid-overwrite'], 'true'); assert.equal(opts.headers['x-oss-object-acl'], 'private');
    if (objects.has(name)) throw Object.assign(new Error('exists'), {code:'FileAlreadyExists',status:409});
    objects.set(name, Buffer.from(bytes)); writes++; return {};
  },
  async listV2(options) {
    const keys = [...objects.keys()].filter(key => key.startsWith(options.prefix)).sort();
    const start = Number(options['continuation-token'] || 0), batch = keys.slice(start,start+2);
    return {objects:batch.map(name=>({name})),isTruncated:start+2<keys.length,nextContinuationToken:String(start+2)};
  },
};
const store = ossStore(fake), password = 'test-only-cloud-password-1234', secret = 'test-only-session-secret-'.repeat(3);
const passwordHash = await hashPassword(password);
const server = createCloudServer({store,passwordHash,secret,origins:[new URL(pageURL).origin,'http://localhost:3002']});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const api = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  assert.equal((await fetch(api+'/library')).status,401);
  assert.equal((await fetch(api+'/session',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://untrusted.invalid'},body:JSON.stringify({password})})).status,403);
  assert.equal((await fetch(api+'/session',{method:'POST',body:JSON.stringify({password:'wrong'})})).status,401);
  const auth = await (await fetch(api+'/session',{method:'POST',body:JSON.stringify({password})})).json();
  const headers = {Authorization:'Bearer '+auth.token,'Content-Type':'application/json'};
  const send = async payload => {
    const res = await fetch(api+'/commit',{method:'POST',headers:{...headers,'Content-Encoding':'gzip'},body:gzipSync(JSON.stringify(payload))});
    return {status:res.status,data:await res.json()};
  };
  const project = {version:3,items:[],cadFile:{name:'huge.dxf',base64:'A'.repeat(24000)},environment:{photos:[{dataUrl:'data:image/jpeg;base64,'+'B'.repeat(18000)}]}};
  const digest = await store.writeProject(project), count = objects.size;
  const updated = structuredClone(project); updated.items=[{id:1,type:'booth',label:'A1'}];
  await store.writeProject(updated);
  assert.equal(objects.size,count+1,'CAD/photo blobs are deduplicated between project revisions');
  assert.deepEqual(await store.readProject(digest),project);
  const now = Date.now(), first={expectedRevision:0,operationId:randomUUID(),changes:{sites:[{id:'http-test',name:'HTTP 测试',createdAt:now,updatedAt:now}],projects:[{id:'http-test',project}]}};
  const result = await send(first); assert.equal(result.status,200); assert.equal(result.data.revision,1);
  assert.equal((await send(first)).data.revision,1,'Same operation is idempotent');
  const changed=structuredClone(first);changed.changes.sites[0].name='different';assert.equal((await send(changed)).status,409);
  const a={expectedRevision:1,operationId:randomUUID(),changes:{sites:[{...first.changes.sites[0],name:'设备 A'}]}},b={expectedRevision:1,operationId:randomUUID(),changes:{sites:[{...first.changes.sites[0],name:'设备 B'}]}};
  assert.deepEqual((await Promise.all([send(a),send(b)])).map(r=>r.status).sort(),[200,409],'Concurrent writers cannot overwrite each other');
  const before = writes, invalid={expectedRevision:2,operationId:randomUUID(),changes:{activities:[{id:'orphan',siteId:'missing',name:'孤立活动',createdAt:now,updatedAt:now}]}};
  assert.equal((await send(invalid)).status,400); assert.equal(writes,before);
  const reopened=ossStore(fake); assert.equal((await reopened.latest()).revision,2,'State survives backend restart');
  versionStatus='Enabled';await assert.rejects(()=>ossStore(fake).latest(),/版本控制/);versionStatus='';
  objects.clear();
  const errors = [], dir = await mkdtemp(join(tmpdir(),'needflea-cloud-library-'));
  browser = await puppeteer.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const ctx1 = await browser.createBrowserContext(), ctx2 = await browser.createBrowserContext();
  const makePage = async context => {
    const p=await context.newPage();p.setDefaultTimeout(60000);await p.setViewport({width:1440,height:1100});
    p.on('pageerror',e=>errors.push(e.message));p.on('dialog',async d=>d.accept());
    await p.goto(pageURL,{waitUntil:'networkidle0'});await p.waitForFunction(()=>!!window.environmentUI);return p;
  };
  const p1=await makePage(ctx1),p2=await makePage(ctx2);
  const idle = p => p.waitForFunction(()=>document.querySelector('#site-library-dialog').getAttribute('aria-busy')==='false');
  const open = async p => {await p.click('#toolbar-tab-files');await p.click('#site-library-button');await idle(p);};
  const login = async p => {await open(p);await p.click('#site-storage-cloud');await idle(p);await p.type('#site-cloud-url',api);await p.type('#site-cloud-password',password);await p.click('#site-cloud-login');await idle(p);assert.equal(await p.$eval('#site-cloud-form',e=>e.hidden),true);};
  const dxf=['0','SECTION','2','ENTITIES','0','LINE','8','Walls','10','0','20','0','11','20','21','0','0','LINE','8','Walls','10','20','20','0','11','20','21','15','0','ENDSEC','0','EOF'].join('\n');
  const base={version:3,items:[],nextId:1,metersPerUnit:1,cadFile:{name:'venue.dxf',base64:Buffer.from(dxf).toString('base64')},environment:{schema:'needflea-environment/1',objects:[{id:1,type:'column',name:'实测柱',x:4,y:5,width:.6,depth:.6,height:4.2,angle:0}],photos:[],notes:'实测记录'}};
  const layout=structuredClone(base);layout.items=[{id:1,type:'booth',wx:2,wy:3,ww:2,wh:2,cat:'二手',label:'A1'}];layout.nextId=2;
  const seed = async (page, suffix='') => page.evaluate(({base,layout,now,suffix})=>new Promise((resolve,reject)=>{
    const r=indexedDB.open('needflea-site-library',2);r.onupgradeneeded=()=>{for(const s of ['sites','projects','activities','activityProjects'])r.result.createObjectStore(s,{keyPath:'id'});};
    r.onsuccess=()=>{const db=r.result,tx=db.transaction(['sites','projects','activities','activityProjects'],'readwrite');
      tx.objectStore('sites').put({id:'local-site'+suffix,name:'深圳 ING',createdAt:now,updatedAt:now,sourceName:'venue.dxf'});
      tx.objectStore('projects').put({id:'local-site'+suffix,project:base});
      for(const n of [1,2]){const p=structuredClone(layout);p.items[0].label=n===1?'A1':'B1';tx.objectStore('activities').put({id:'local-event-'+n+suffix,siteId:'local-site'+suffix,name:'市集 '+n,createdAt:now,updatedAt:now,itemCount:1});tx.objectStore('activityProjects').put({id:'local-event-'+n+suffix,project:p});}
      tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};r.onerror=()=>reject(r.error);
  }),{base,layout,now,suffix});
  await seed(p1);await login(p1);await p1.click('#site-cloud-import');await idle(p1);
  assert.ok((await p1.$eval('#site-message',e=>e.textContent)).includes('已上传 1'));
  assert.equal(await p1.$$eval('[data-activity-load]',es=>es.length),2);
  const beforeRevision=await p1.evaluate(()=>venueCloud.revision());
  await p1.click('#site-cloud-import');await idle(p1);assert.equal(await p1.evaluate(()=>venueCloud.revision()),beforeRevision,'Repeated migration skips unchanged local data');
  await login(p2);assert.equal(await p2.$$eval('[data-activity-load]',es=>es.length),2,'Second device sees both activities');
  const load=async(p,id)=>{await p.click(`[data-activity-load="${id}"]`);await p.waitForFunction(()=>!document.querySelector('#site-library-dialog').open);};
  await load(p1,'local-event-1');await load(p2,'local-event-1');
  assert.equal(await p2.evaluate(()=>booths.items[0].label),'A1');assert.equal(await p2.evaluate(()=>environmentUI.snapshot().objects[0].height),4.2);
  await p1.evaluate(()=>{booths.items[0].label='设备一未保存';render();});
  await p2.evaluate(()=>{booths.items[0].label='设备二已保存';render();});await open(p2);await p2.click('#site-update');await idle(p2);
  await open(p1);await p1.click('#site-update');await idle(p1);
  assert.ok((await p1.$eval('#site-message',e=>e.textContent)).includes('其他设备更新'));assert.equal(await p1.evaluate(()=>booths.items[0].label),'设备一未保存');
  await p1.click('#site-cloud-refresh');await idle(p1);assert.equal(await p1.evaluate(()=>booths.items[0].label),'设备一未保存');await load(p1,'local-event-1');assert.equal(await p1.evaluate(()=>booths.items[0].label),'设备二已保存');
  await open(p1);await p1.click('#site-storage-local');await idle(p1);await load(p1,'local-event-1');assert.equal(await p1.evaluate(()=>booths.items[0].label),'A1','Migration and cloud edits preserve local originals');
  // Simulate a lost response after the server has committed; retry must reuse the exact operation.
  await open(p2);await p2.evaluate(()=>{booths.items[0].label='已提交但响应丢失';render();});
  await p2.evaluate(()=>{const original=window.fetch;let once=true;window.fetch=async(...args)=>{const response=await original(...args);if(once&&String(args[0]).endsWith('/commit')){once=false;throw new TypeError('test response lost');}return response;};});
  await p2.click('#site-update');await idle(p2);assert.equal(await p2.$eval('#site-cloud-retry',e=>e.hidden),false);
  const pendingRevision=await p2.evaluate(()=>venueCloud.revision());await p2.click('#site-cloud-retry');await idle(p2);assert.equal(await p2.evaluate(()=>venueCloud.revision()),pendingRevision+1);
  await load(p2,'local-event-1');assert.equal(await p2.evaluate(()=>booths.items[0].label),'已提交但响应丢失');
  await p2.reload({waitUntil:'networkidle0'});await open(p2);assert.equal(await p2.$eval('#site-storage-cloud',e=>e.getAttribute('aria-pressed')),'true');
  await p2.screenshot({path:join(dir,'cloud-desktop.png')});await p2.setViewport({width:390,height:900});await p2.screenshot({path:join(dir,'cloud-mobile.png')});
  assert.deepEqual(errors,[]);console.log('PASS: OSS private immutable writes, blob dedup, restart, auth/CORS, concurrent conflict, idempotent retry, local migration, two-device load/save, local preservation, refresh, mobile. Artifacts:',dir);
} finally { if(browser)await browser.close();await new Promise(resolve=>server.close(resolve)); }
