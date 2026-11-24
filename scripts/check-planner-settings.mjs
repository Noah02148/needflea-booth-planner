import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import puppeteer from 'puppeteer';
const dir=await mkdtemp(join(tmpdir(),'needflea-settings-'));
const browser=await puppeteer.launch({args:['--no-sandbox']});
const base={version:3,metersPerUnit:1,items:[],planning:{
  regions:[{id:'r',points:[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}]}],
  zones:[{points:[{x:4,y:4},{x:5,y:4},{x:5,y:5},{x:4,y:5}],passable:true}],
  entrances:[{center:{x:10,y:0},a:{x:9,y:0},b:{x:11,y:0}}],
  exits:[{center:{x:10,y:20},a:{x:9,y:20},b:{x:11,y:20}}],
  demands:[{id:'a',cat:'衣物',style:'tent-yard',width:3,depth:2,min:40,max:50},
    {id:'b',cat:'特大',style:'canopy-yard',width:5,depth:2,min:10,max:20}],
  demandsEdited:true,zoneAccess:{'cad-3':false}
}};
try {
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:3005');
  await page.waitForFunction(()=>window.plannerUI);
  await page.evaluate(p=>projectIO.load(p),base);
  await page.click('#btn-planner');
  const defaultMin=await page.$eval('#plan-min',e=>Number(e.value));
  assert.equal(await page.evaluate(()=>projectIO.capture(false).planning.aisles.min),defaultMin);
  await page.$eval('#plan-min',e=>{e.value='2.5';e.dispatchEvent(new Event('input',{bubbles:true}));});
  // Save while the last field is still focused; no blur or generation needed.
  await page.$eval('#plan-demands fieldset input[type=number]',e=>{e.focus();e.value='3.5';e.dispatchEvent(new Event('input',{bubbles:true}));});
  const expected=await page.evaluate(()=>projectIO.capture(false).planning);
  const cdp=await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir});
  await page.evaluate(()=>saveProject());
  let file;
  for(let i=0;i<100;i++) {
    file=(await readdir(dir)).find(n=>n.endsWith('.json'));
    if(file) break;
    await new Promise(r=>setTimeout(r,50));
  }
  assert.ok(file,'JSON download');
  const saved=JSON.parse(await readFile(join(dir,file),'utf8'));
  assert.deepEqual(saved.planning,expected);
  assert.equal(saved.items.length,0);
  const fresh=await browser.newPage();
  await fresh.goto('http://127.0.0.1:3005');
  await fresh.waitForFunction(()=>window.plannerUI);
  await (await fresh.$('#load-input')).uploadFile(join(dir,file));
  await fresh.waitForFunction(()=>planningData?.demands?.[0]?.width===3.5);
  await fresh.click('#btn-planner');
  assert.equal(await fresh.$eval('#plan-min',e=>e.value),'2.5');
  assert.deepEqual(await fresh.evaluate(()=>projectIO.capture(false).planning),expected);
  assert.equal(await fresh.$$eval('#plan-demands fieldset',els=>els.length),2);
  // Blank fields and explicitly deleted demand rows must survive reopening.
  await fresh.$eval('#plan-demands input[type=number]',e=>{e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));});
  const partial=await fresh.evaluate(()=>projectIO.capture(false));
  await fresh.evaluate(p=>projectIO.load(p),partial);
  assert.equal(await fresh.$eval('#plan-demands input[type=number]',e=>e.value),'');
  await fresh.evaluate(()=>{planningData.demands=[];planningData.demandsEdited=true;planningData.zones=[];planningData.noZones=true;});
  const empty=await fresh.evaluate(()=>projectIO.capture(false));
  await fresh.evaluate(p=>projectIO.load(p),empty);
  assert.equal(await fresh.$$eval('#plan-demands fieldset',els=>els.length),0);
  assert.equal(await fresh.evaluate(()=>planningData.noZones),true);
  await fresh.evaluate(()=>projectIO.load({version:3,items:[]}));
  assert.equal(await fresh.evaluate(()=>projectIO.capture(false).planning),undefined);
  assert.deepEqual(errors,[]);
  console.log('PASS JSON download/new-page import: regions, zone access, gates, demands, effective aisle default, unblurred edits, partial/empty settings, legacy isolation');
} finally {await browser.close();}
