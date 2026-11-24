import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const file=process.env.NEEDFLEA_CONTINUITY_PROJECT;
assert.ok(file,'Set NEEDFLEA_CONTINUITY_PROJECT to a full project JSON');
const browser=await puppeteer.launch({args:['--no-sandbox']});
try {
  const page=await browser.newPage();
  await page.setViewport({width:1500,height:1100});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.accept());
  await page.goto('http://127.0.0.1:3005');
  await page.waitForFunction(()=>window.plannerUI);
  await (await page.$('#load-input')).uploadFile(file);
  await page.waitForFunction(()=>typeof dxfLoaded!=='undefined' && dxfLoaded && planningData.regions.length>0,{timeout:120000});
  await page.click('#btn-planner');
  assert.equal(await page.$('#plan-max'),null);
  assert.equal(await page.$eval('#plan-min',e=>e.value),'2');
  const before=await page.evaluate(()=>JSON.stringify(booths.items));
  await page.click('#plan-generate');
  await page.waitForFunction(()=>!document.querySelector('#plan-generate').disabled,{timeout:30000});
  assert.ok(await page.$('#plan-cards article'),await page.$eval('#plan-status',e=>e.textContent));
  assert.match(await page.$eval('#plan-cards',e=>e.textContent),/A 两侧连续/);
  assert.equal(await page.evaluate(()=>JSON.stringify(booths.items)),before);
  await page.evaluate(()=>{
    renderer.scale=.018;
    renderer.offsetX=450-6010000*renderer.scale;
    renderer.offsetY=550+1030000*renderer.scale;
    render();
  });
  await page.screenshot({path:'/tmp/needflea-current-continuous.png'});
  console.log(await page.$eval('#plan-cards',e=>e.textContent));
  assert.deepEqual(errors,[]);
  console.log('PASS current CAD, minimum-only UI, continuous preview, original items preserved');
} finally {await browser.close();}
