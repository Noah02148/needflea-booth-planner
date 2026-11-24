import assert from 'node:assert/strict';
import fs from 'node:fs';
import { draftInput } from '../local-draft-input.mjs';
import { searchDrafts } from '../local-drafts.mjs';
import { validate } from '../cloud/planning-geometry.mjs';
import { rectangle } from '../cloud/planning-input.mjs';

function continuity(d, scale) {
  const rows = Object.values(Object.groupBy(d.items, (i) => i.rowId));
  let adjacent = 0, gaps = 0;
  for (const row of rows) {
    const rad = row[0].angle * Math.PI / 180;
    const positions = row.map((i) => ({
      u: (i.wx + i.ww / 2) * Math.cos(rad) + (i.wy + i.wh / 2) * Math.sin(rad), w: i.ww
    })).sort((a,b) => a.u-b.u);
    for (let k = 1; k < positions.length; k++) {
      const a = positions[k-1], b = positions[k];
      const gap = (b.u-a.u-(a.w+b.w)/2)*scale;
      assert.ok(gap >= -1e-6, 'row overlaps');
      if (gap > .001) gaps++; else adjacent++;
    }
  }
  return { total: d.items.length, longest: Math.max(...rows.map(r=>r.length)), adjacent, gaps };
}
// Slightly skew walls with large CAD coordinates reproduce the failing joins.
for (const scale of [1, .001]) {
  const origin = {x: 6000/scale, y: 1000/scale};
  const points = rectangle(origin.x, origin.y, 8/scale, 36/scale, .12);
  const p = {metersPerUnit: scale, items: [], planning: {
    regions:[{id:'r', points}], noZones:true,
    entrances:[{center:{x:origin.x,y:origin.y-18/scale}}],
    exits:[{center:{x:origin.x,y:origin.y+18/scale}}],
    demands:[{id:'d',cat:'test',style:'tent',width:3,depth:2,min:12,max:20}],
    aisles:{min:2,max:4}
  }};
  const s = draftInput(p), result = searchDrafts(s,()=>{});
  assert.ok(result.candidates.length, result.error);
  for (const d of result.candidates) {
    assert.ok(validate({...s,presets:d.presets},d).ok);
    const stats=continuity(d,scale);
    // The alternate cross-aisle may deliberately split rows; the longitudinal
    // candidate must remain continuous. Both still pass full lane validation.
    if (d === result.candidates[0]) assert.equal(stats.gaps,0);
    assert.ok(stats.longest>=6);
    console.log('skew CAD',scale,stats);
  }
}
if (process.env.NEEDFLEA_CONTINUITY_PROJECT) {
  const p=JSON.parse(fs.readFileSync(process.env.NEEDFLEA_CONTINUITY_PROJECT));
  const s=draftInput(p), result=searchDrafts(s,()=>{});
  assert.ok(result.candidates.length,result.error);
  for(const d of result.candidates) {
    assert.ok(validate({...s,presets:d.presets},d).ok);
    const stats=continuity(d,s.scale);
    assert.equal(stats.gaps,0,'unexpected gaps on current Water Cube wall rows');
    assert.ok(stats.longest>=11);
    assert.ok(stats.total>35);
    console.log('current Water Cube',stats,d.report.quantities,d.report.net);
  }
}
console.log('PASS shared frontage, continuous skew rows, full geometry validation');
