/**
 * test-render.js — Renders DWG to PNG for verification without browser
 */
const fs = require('fs');
const { createCanvas } = require('canvas');

// Load WASM module
global.document = undefined;
eval(fs.readFileSync(__dirname + '/libdxfrw.js', 'utf-8'));

const DWG_PATH = "/Users/jianan/Desktop/2025.08.11地下一层平面图(1).dwg";
const OUT_PATH = __dirname + "/test-output.png";
const W = 1400, H = 800;

(async () => {
  console.log("Loading WASM...");
  const lib = await createModule();

  console.log("Reading DWG...");
  const buf = fs.readFileSync(DWG_PATH);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const database = new lib.DRW_Database();
  const fh = new lib.DRW_FileHandler();
  fh.database = database;
  const dwg = new lib.DRW_DwgR(ab);
  dwg.read(fh, false);
  dwg.delete();

  // ── STEP 1: Extract only LINE and LWPOLYLINE (no bulge) ──
  const entities = database.mBlock.entities;
  const lines = [];     // { x1, y1, x2, y2 }
  const polylines = [];  // { vertices: [{x,y}], closed }

  for (let i = 0; i < entities.size(); i++) {
    const e = entities.get(i);
    if (e.eType == lib.DRW_ETYPE.LINE) {
      const bp = e.basePoint, sp = e.secPoint;
      lines.push({ x1: bp.x, y1: bp.y, x2: sp.x, y2: sp.y });
    }
    if (e.eType == lib.DRW_ETYPE.LWPOLYLINE) {
      const verts = e.getVertexList();
      const vertices = [];
      for (let j = 0; j < verts.size(); j++) {
        const v = verts.get(j);
        vertices.push({ x: v.x, y: v.y });
      }
      if (vertices.length >= 2) {
        polylines.push({ vertices, closed: (e.flags & 1) === 1 });
      }
    }
  }
  console.log(`Extracted: ${lines.length} lines, ${polylines.length} polylines`);

  database.delete(); fh.delete();

  // ── STEP 2: Compute bounds using LINE endpoints only ──
  const xs = [], ys = [];
  lines.forEach(l => { xs.push(l.x1, l.x2); ys.push(l.y1, l.y2); });
  polylines.forEach(p => p.vertices.forEach(v => { xs.push(v.x); ys.push(v.y); }));
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);

  // Gap-based cluster detection on X
  const findMainCluster = (arr) => {
    const n = arr.length;
    const s = Math.floor(n * 0.05), e = Math.ceil(n * 0.95);
    let maxGap = 0, gapIdx = -1;
    for (let i = s; i < e; i++) {
      const gap = arr[i + 1] - arr[i];
      if (gap > maxGap) { maxGap = gap; gapIdx = i; }
    }
    const totalRange = arr[e] - arr[s];
    if (gapIdx >= 0 && maxGap > totalRange * 0.2) {
      const leftCount = gapIdx - s + 1, rightCount = e - gapIdx - 1;
      return leftCount >= rightCount
        ? { lo: arr[s], hi: arr[gapIdx] }
        : { lo: arr[gapIdx + 1], hi: arr[e] };
    }
    return { lo: arr[s], hi: arr[e] };
  };

  const cx = findMainCluster(xs);
  const cy = findMainCluster(ys);
  const pad = Math.max(cx.hi - cx.lo, cy.hi - cy.lo) * 0.05;
  const bounds = {
    minX: cx.lo - pad, maxX: cx.hi + pad,
    minY: cy.lo - pad, maxY: cy.hi + pad,
    width: cx.hi - cx.lo + pad * 2,
    height: cy.hi - cy.lo + pad * 2
  };
  console.log(`Bounds: X[${bounds.minX.toFixed(0)}, ${bounds.maxX.toFixed(0)}] Y[${bounds.minY.toFixed(0)}, ${bounds.maxY.toFixed(0)}]`);
  console.log(`Size: ${bounds.width.toFixed(0)} x ${bounds.height.toFixed(0)}`);

  // ── STEP 3: Filter entities to bounds (both endpoints in bounds) ──
  // Use generous padding (30%) for entity filter
  const filterPadX = bounds.width * 0.3, filterPadY = bounds.height * 0.3;
  const fMinX = bounds.minX - filterPadX, fMaxX = bounds.maxX + filterPadX;
  const fMinY = bounds.minY - filterPadY, fMaxY = bounds.maxY + filterPadY;
  const inB = (x, y) => x >= fMinX && x <= fMaxX && y >= fMinY && y <= fMaxY;

  const filteredLines = lines.filter(l => inB(l.x1, l.y1) && inB(l.x2, l.y2));
  const filteredPolys = polylines.filter(p => p.vertices.every(v => inB(v.x, v.y)));
  console.log(`After filter: ${filteredLines.length} lines, ${filteredPolys.length} polylines`);

  // ── STEP 4: Render to canvas ──
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // White background for visibility
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Compute scale and offset (fit to view with padding)
  const viewPad = 40;
  const scaleX = (W - viewPad * 2) / bounds.width;
  const scaleY = (H - viewPad * 2) / bounds.height;
  const scale = Math.min(scaleX, scaleY);
  const offsetX = (W - bounds.width * scale) / 2 - bounds.minX * scale;
  const offsetY = (H + bounds.height * scale) / 2 + bounds.minY * scale;

  const wx = (x) => x * scale + offsetX;
  const wy = (y) => -y * scale + offsetY;

  console.log(`Scale: ${scale.toFixed(6)}, offset: (${offsetX.toFixed(0)}, ${offsetY.toFixed(0)})`);
  if (filteredLines.length > 0) {
    const l = filteredLines[0];
    console.log(`Sample: (${wx(l.x1).toFixed(0)},${wy(l.y1).toFixed(0)})→(${wx(l.x2).toFixed(0)},${wy(l.y2).toFixed(0)})`);
  }

  // Draw
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;

  // Lines
  filteredLines.forEach(l => {
    ctx.beginPath();
    ctx.moveTo(wx(l.x1), wy(l.y1));
    ctx.lineTo(wx(l.x2), wy(l.y2));
    ctx.stroke();
  });

  // Polylines (no bulge — straight segments only)
  filteredPolys.forEach(p => {
    ctx.beginPath();
    p.vertices.forEach((v, i) => {
      if (i === 0) ctx.moveTo(wx(v.x), wy(v.y));
      else ctx.lineTo(wx(v.x), wy(v.y));
    });
    if (p.closed) ctx.closePath();
    ctx.stroke();
  });

  // ── STEP 5: Save PNG ──
  const pngBuf = canvas.toBuffer('image/png');
  fs.writeFileSync(OUT_PATH, pngBuf);
  console.log(`\nRendered to ${OUT_PATH} (${(pngBuf.length/1024).toFixed(0)} KB)`);
  console.log(`Scale: ${scale.toFixed(6)}, entities drawn: ${filteredLines.length + filteredPolys.length}`);

  process.exit(0);
})();
