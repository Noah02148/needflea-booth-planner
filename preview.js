const fs = require('fs');
global.document = undefined;
eval(fs.readFileSync(__dirname + '/libdxfrw.js', 'utf-8'));

const aciColors = {1:'#FF0000',2:'#FFFF00',3:'#00FF00',4:'#00FFFF',5:'#0000FF',6:'#FF00FF',7:'#FFFFFF',8:'#808080',9:'#c0c0c0',10:'#FF0000',30:'#FF7F00',40:'#7F3F00',50:'#7F7F00',70:'#007F00',130:'#007F7F',150:'#00007F',190:'#7F007F',250:'#333',251:'#555',252:'#777',253:'#999',254:'#BBB',255:'#DDD'};

function fixText(s) {
  if (!s) return '';
  try {
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xFF;
    return new TextDecoder('gbk').decode(bytes);
  } catch(e) { return s; }
}
function sanitize(s) { return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function getDash(lt) {
  if (!lt) return '';
  const t = lt.trim().toUpperCase();
  if (t.includes('HIDDEN')) return '4,3';
  if (t.includes('DASHDOT')) return '8,3,2,3';
  if (t.includes('DASH')) return '8,4';
  if (t.includes('CENTER')) return '14,4,4,4';
  return '';
}

// Copy hidden patterns from app.js
const _defaultHiddenPatterns = [
  'defpoints', 'axis', '轴线', '柱网', '红线',
  'rc-', 'ceiling', '000000', '天花', '平顶',
  'dim_', 'pub_', '尺寸', '标注', '标高', '索引', '图框', '图例', '项目信息', '图纸疑问', '公用',
  'hatch', '填充',
  '暖-', '风管', '风口', '排烟', '排风', '空调',
  '消防', '消火', '防火', '报警', '喷头', '喷淋', '卷帘',
  '强电', '弱电', '电气', '插座', '开关', '照明', '灯', '应急', '动力', '温感', '烟感', '声光', '广播', 'light', 'luminaire',
  '雨水', 'vpipe',
  'equip', '设备',
  'cctv', '安防', '0a0',
  'h-dapp', 'h-equp', 'dote',
  'bp_b01', '03平面', 'acs_', 'iel-', 'f_eop', 'cp_typ', 'y_ip-',
  '拆除', '修改', '留洞', '钢材', '结构线',
  'elevation-', 'a-200-', 'a-wall-', '放大图', '布点', '标签', '中心线', '夹层', '20200303', '181011', '地上-', '0e-lt', 'ex-', 'c-',
  '看线', 'prompt', 't-c', '面积', '系统', 'car', '充电', '非设计范围', '管井', 'epd-', 'window_text', '金融街',
  '集水', '排水', 'lvtry',
  '1-text',                         // ST block insert layer
];

function isVisible(layerName) {
  const ln = layerName.trim().toLowerCase();
  let decoded = ln;
  try { decoded = fixText(layerName).trim().toLowerCase(); } catch(e) {}
  return !_defaultHiddenPatterns.some(p => ln.includes(p) || decoded.includes(p));
}

function extractEntity(lib, e, layerColors, layerLT) {
  const layer = e.layer || '0';
  let color = e.color; if (!color || color === 256) color = layerColors[layer] || 7;
  const hex = aciColors[color] || '#FFFFFF';
  let lt = (e.lineType || '').trim().toLowerCase();
  if (!lt || lt === 'bylayer') lt = (layerLT[layer] || '').toLowerCase();
  if (lt === 'continuous' || lt === 'byblock') lt = '';
  try {
    if (e.eType == lib.DRW_ETYPE.TEXT || e.eType == lib.DRW_ETYPE.MTEXT) {
      const bp = e.basePoint; let text = fixText(e.text || '');
      text = text.replace(/\\P/g, ' ').replace(/\{[^}]*\}/g, '').replace(/\\[a-zA-Z][^;]*;/g, '').trim();
      if (text) return { t: 'T', x: bp.x, y: bp.y, text, h: e.height || 1, c: hex, lt, layer };
    }
    if (e.eType == lib.DRW_ETYPE.LINE) { const bp = e.basePoint, sp = e.secPoint; return { t: 'L', x1: bp.x, y1: bp.y, x2: sp.x, y2: sp.y, c: hex, lt, layer }; }
    if (e.eType == lib.DRW_ETYPE.LWPOLYLINE) { const verts = e.getVertexList(); const pts = []; for (let j = 0; j < verts.size(); j++) pts.push([verts.get(j).x, verts.get(j).y]); if (pts.length >= 2) return { t: 'P', pts, closed: (e.flags & 1) === 1, c: hex, lt, layer }; }
    if (e.eType == lib.DRW_ETYPE.CIRCLE) { const bp = e.basePoint; return { t: 'C', cx: bp.x, cy: bp.y, r: e.radius, c: hex, layer }; }
    if (e.eType == lib.DRW_ETYPE.ARC) { const bp = e.basePoint; return { t: 'A', cx: bp.x, cy: bp.y, r: e.radius, sa: e.startAngle, ea: e.endAngle, c: hex, layer }; }
    if (e.eType == lib.DRW_ETYPE.INSERT) { const bp = e.basePoint; return { t: 'I', block: e.name || '', x: bp.x, y: bp.y, sx: e.xScale || 1, sy: e.yScale || 1, angle: e.angle || 0, c: hex, layer }; }
  } catch(err) {}
  return null;
}

function expandInsert(ins, blockDefs, output, depth) {
  if (depth > 3) return;
  const block = blockDefs[ins.block]; if (!block) return;
  const cos = Math.cos(ins.angle), sin = Math.sin(ins.angle);
  const tf = (x, y) => { const tx = x * ins.sx, ty = y * ins.sy; return [ins.x + tx * cos - ty * sin, ins.y + tx * sin + ty * cos]; };
  const il = ins.layer || '0';
  block.forEach(e => {
    const rawLayer = (e.layer || '').trim();
    const ly = (!rawLayer || rawLayer === '0') ? il : rawLayer;
    if (e.t === 'L') { const [x1,y1] = tf(e.x1, e.y1), [x2,y2] = tf(e.x2, e.y2); output.push({ t: 'L', x1, y1, x2, y2, c: e.c, lt: e.lt, layer: ly }); }
    if (e.t === 'P') { output.push({ t: 'P', pts: e.pts.map(p => tf(p[0], p[1])), closed: e.closed, c: e.c, lt: e.lt, layer: ly }); }
    if (e.t === 'C') { const [cx,cy] = tf(e.cx, e.cy); output.push({ t: 'C', cx, cy, r: e.r * Math.abs(ins.sx), c: e.c, layer: ly }); }
    if (e.t === 'A') { const [cx,cy] = tf(e.cx, e.cy); output.push({ t: 'A', cx, cy, r: e.r * Math.abs(ins.sx), sa: e.sa + ins.angle, ea: e.ea + ins.angle, c: e.c, layer: ly }); }
    if (e.t === 'T') { const [x,y] = tf(e.x, e.y); output.push({ t: 'T', x, y, text: e.text, h: e.h * Math.abs(ins.sy), c: e.c, layer: ly }); }
    if (e.t === 'I') { const [x,y] = tf(e.x, e.y); expandInsert({ ...e, x, y, sx: e.sx * ins.sx, sy: e.sy * ins.sy, angle: e.angle + ins.angle, layer: ly }, blockDefs, output, depth + 1); }
  });
}

(async () => {
  const lib = await createModule();
  const buf = fs.readFileSync("/Users/jianan/Desktop/2025.08.11地下一层平面图(1).dwg");
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const db = new lib.DRW_Database(); const fh = new lib.DRW_FileHandler();
  fh.database = db;
  const dwg = new lib.DRW_DwgR(ab); dwg.read(fh, false); dwg.delete();

  const layerColors = {}, layerLT = {};
  for (let i = 0; i < db.layers.size(); i++) {
    const l = db.layers.get(i);
    layerColors[l.name] = Math.abs(l.color);
    layerLT[l.name] = (l.lineType || '').trim();
  }

  const blockDefs = {};
  for (let i = 0; i < db.blocks.size(); i++) {
    const b = db.blocks.get(i);
    const ents = [];
    for (let j = 0; j < b.entities.size(); j++) {
      const raw = extractEntity(lib, b.entities.get(j), layerColors, layerLT);
      if (raw) ents.push(raw);
    }
    if (ents.length > 0) blockDefs[b.name] = ents;
  }

  const msEntities = [];
  const bxs = [], bys = [];
  const entities = db.mBlock.entities;
  for (let i = 0; i < entities.size(); i++) {
    const e = entities.get(i);
    const item = extractEntity(lib, e, layerColors, layerLT);
    if (item) {
      msEntities.push(item);
      if (item.t === 'L') { bxs.push(item.x1, item.x2); bys.push(item.y1, item.y2); }
      if (item.t === 'P') item.pts.forEach(p => { bxs.push(p[0]); bys.push(p[1]); });
    }
  }
  db.delete(); fh.delete();

  bxs.sort((a,b) => a-b); bys.sort((a,b) => a-b);
  const findC = (arr) => {
    const n=arr.length, s=Math.floor(n*0.05), e=Math.ceil(n*0.95);
    let mg=0,gi=-1;
    for(let i=s;i<e;i++){const g=arr[i+1]-arr[i];if(g>mg){mg=g;gi=i;}}
    if(gi>=0&&mg>(arr[e]-arr[s])*0.2){
      return(gi-s+1)>=(e-gi-1)?{lo:arr[s],hi:arr[gi]}:{lo:arr[gi+1],hi:arr[e]};
    }
    return{lo:arr[s],hi:arr[e]};
  };
  const cx=findC(bxs), cy=findC(bys);
  const pad=Math.max(cx.hi-cx.lo, cy.hi-cy.lo)*0.08;
  const bx0=cx.lo-pad, bx1=cx.hi+pad, by0=cy.lo-pad, by1=cy.hi+pad;
  const inB = (x,y) => x>=bx0 && x<=bx1 && y>=by0 && y<=by1;

  const items = [];
  msEntities.forEach(item => {
    if (item.t === 'I') {
      if (inB(item.x, item.y)) {
        const expanded = [];
        expandInsert(item, blockDefs, expanded, 0);
        expanded.forEach(ex => { if (!ex.layer) ex.layer = item.layer; });
        items.push(...expanded);
      }
    } else {
      items.push(item);
    }
  });

  const filtered = items.filter(it => {
    if (it.t==='L') return inB(it.x1,it.y1) && inB(it.x2,it.y2);
    if (it.t==='P') return it.pts.every(p => inB(p[0],p[1]));
    if (it.t==='C') return inB(it.cx,it.cy) && it.r*0.006<200;
    if (it.t==='A') return inB(it.cx,it.cy) && it.r*0.006<200;
    if (it.t==='T') return inB(it.x,it.y);
    return false;
  });

  // Apply layer visibility
  const visible = filtered.filter(it => isVisible(it.layer || '0'));

  console.log(`Total: ${filtered.length}, Visible: ${visible.length}, Hidden: ${filtered.length - visible.length}`);

  // SVG
  const bw=bx1-bx0, bh=by1-by0;
  const svgW = Math.min(4000, Math.max(2000, Math.ceil(bw * 0.5)));
  const svgH = Math.round(svgW * (bh / bw));
  const sc=Math.min(svgW/bw, svgH/bh);
  const ox=-bx0*sc, oy=by1*sc;
  const sx=x=>(x*sc+ox).toFixed(1), sy=y=>(-y*sc+oy).toFixed(1);

  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}">\n<rect width="100%" height="100%" fill="#1e1e1e"/>\n`;
  visible.forEach(it => {
    const da=getDash(it.lt), dashA=da?` stroke-dasharray="${da}"`:'';
    if(it.t==='L') svg+=`<line x1="${sx(it.x1)}" y1="${sy(it.y1)}" x2="${sx(it.x2)}" y2="${sy(it.y2)}" stroke="${it.c}" stroke-width="0.6"${dashA} fill="none"/>\n`;
    if(it.t==='P'){const d=it.pts.map((v,i)=>`${i===0?'M':'L'}${sx(v[0])},${sy(v[1])}`).join(' ')+(it.closed?' Z':'');svg+=`<path d="${d}" stroke="${it.c}" stroke-width="0.6"${dashA} fill="none"/>\n`;}
    if(it.t==='C') svg+=`<circle cx="${sx(it.cx)}" cy="${sy(it.cy)}" r="${(it.r*sc).toFixed(1)}" stroke="${it.c}" stroke-width="0.5" fill="none"/>\n`;
    if(it.t==='A'){
      const x1=it.cx+it.r*Math.cos(it.sa),y1=it.cy+it.r*Math.sin(it.sa);
      const x2=it.cx+it.r*Math.cos(it.ea),y2=it.cy+it.r*Math.sin(it.ea);
      const la=Math.abs(it.ea-it.sa)>Math.PI?1:0, sw=it.ea>it.sa?0:1;
      svg+=`<path d="M${sx(x1)},${sy(y1)} A${(it.r*sc).toFixed(1)},${(it.r*sc).toFixed(1)} 0 ${la},${sw} ${sx(x2)},${sy(y2)}" stroke="${it.c}" stroke-width="0.5" fill="none"/>\n`;
    }
    if(it.t==='T'){const fs=Math.max(4,Math.min(11,it.h*sc));if(fs>=4)svg+=`<text x="${sx(it.x)}" y="${sy(it.y)}" fill="${it.c}" font-size="${fs.toFixed(0)}" font-family="sans-serif">${sanitize(it.text)}</text>\n`;}
  });
  svg+=`</svg>`;
  fs.writeFileSync(__dirname + '/preview.svg', svg);
  console.log(`SVG saved: preview.svg (${(svg.length/1024).toFixed(0)} KB, ${svgW}x${svgH}px)`);
  process.exit(0);
})();
