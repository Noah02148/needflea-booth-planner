/**
 * app.js
 * Main application controller for NEED!FLEA Booth Planner
 */

// ── GLOBALS ──────────────────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('canvas-wrap');

const parser = new DXFParser();
const renderer = new DXFRenderer(canvas);
const booths = new BoothSystem();

let tool = 'select';
let activeCat = '二手';
let activeSize = '3x3';

// DWG layer visibility system
let _dwgEntitiesByLayer = {};   // { layerName: [entity, ...] }
let _dwgLayerVisibility = {};   // { layerName: true/false }
let _dwgLayerColors = {};       // { layerName: aciColorNumber }
let _dwgBounds = null;          // { minX, minY, maxX, maxY, bx0, bx1, by0, by1 }
let _dwgRasterMode = false;     // true when using rasterized PNG fallback (layers not toggleable)
let _dxfFullData = null;        // stored DXF data for layer toggling in ODA path
let _convertedDxfText = null;   // raw DXF text from ODA conversion (for download)
let _convertedDxfName = null;   // filename for DXF download
let _dwgBlockDefs = {};         // block definitions for INSERT expansion

// Calibration state
let calibState = null; // null | { step: 1|2, p1: {wx,wy}, p2: {wx,wy} }

// Arrow/zone drag state
let drawing = false;
let drawStart = null; // { wx, wy }

// Select/drag state
let dragging = false;
let dragItem = null;
let dragOffset = null; // { dwx, dwy } offset from item origin

// Rotation drag state
let rotating = false;
let rotateItem = null;

// Check if world point is near any corner of a booth, returns the booth or null
function _hitBoothCorner(wx, wy) {
  const hitR = 8 / renderer.scale;
  // Check selected booths first
  const ids = booths.selectedIds.size > 0 ? booths.selectedIds : (booths.selectedId ? new Set([booths.selectedId]) : new Set());
  for (const id of ids) {
    const item = booths.getItem(id);
    if (!item || item.type !== 'booth') continue;
    const cx = item.wx + item.ww / 2, cy = item.wy + item.wh / 2;
    const a = (item.angle || 0) * Math.PI / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    const hw = item.ww / 2, hh = item.wh / 2;
    for (const [dx, dy] of [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]]) {
      const cornerX = cx + dx * cos - dy * sin;
      const cornerY = cy + dx * sin + dy * cos;
      if (Math.hypot(wx - cornerX, wy - cornerY) < hitR) return item;
    }
  }
  return null;
}

// Panning
let panning = false;
let panStart = null;

// Measure tool state
let measureState = null;

// Dim tool state
let dimState = null; // null | { p1: {wx,wy} } // null | { p1: {wx,wy}, p2: {wx,wy} | null }

// Area tool state
let areaState = null; // null | { pts: [{wx,wy}], closed: bool }

// Line drawing state
let lineState = null; // null | { pts: [{wx,wy}] }

// Crop export state — polygon-based
let cropState = null; // null | { pts: [{wx,wy}], closed: bool }

// Clipboard
let _clipboard = null; // [{ ...item }] deep copied items

// Eraser state
let eraserMarks = []; // [{ wx, wy, wr }] — world-coordinate circles
let eraserRadius = 500; // default brush radius in DXF units (adjustable)
let erasing = false;

// Theme
let darkMode = true;

// Raw CAD file data for saving
let _cadFileData = null; // { name, base64 }

// Scale (meters per DXF unit) — set by calibration
let metersPerUnit = null; // null until calibrated
let dxfLoaded = false;

// ── RESIZE ───────────────────────────────────────────────────────────────────
function resize() {
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  render();
}
new ResizeObserver(resize).observe(wrap);

// ── RENDER ───────────────────────────────────────────────────────────────────
function render() {
  renderer.render();
  booths.draw(ctx, renderer);
  // Draw eraser marks (cover with background color)
  if (eraserMarks.length > 0) {
    ctx.save();
    ctx.fillStyle = darkMode ? '#1e1e1e' : '#ffffff';
    eraserMarks.forEach(m => {
      const sx = renderer.wx(m.wx), sy = renderer.wy(m.wy);
      const sr = m.wr * renderer.scale;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }
  // Draw completed measurement
  if (measureState && measureState.p1 && measureState.p2) {
    _drawMeasureLine(measureState.p1, measureState.p2);
  }
  // Draw completed area polygon
  if (areaState && areaState.closed) {
    _drawAreaPolygon(areaState.pts, null);
  }
  updateStatusBar();
  updateStats();
}

function _drawMeasureLine(p1, p2) {
  const sx1 = renderer.wx(p1.wx), sy1 = renderer.wy(p1.wy);
  const sx2 = renderer.wx(p2.wx), sy2 = renderer.wy(p2.wy);
  const dx = p2.wx - p1.wx, dy = p2.wy - p1.wy;
  const dxfDist = Math.sqrt(dx * dx + dy * dy);
  const dist = metersPerUnit ? (dxfDist * metersPerUnit) : dxfDist;
  const label = metersPerUnit ? `${dist.toFixed(2)} m` : `${dxfDist.toFixed(1)} units`;

  ctx.save();
  // Line
  ctx.strokeStyle = '#FF6B35';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(sx1, sy1); ctx.lineTo(sx2, sy2); ctx.stroke();
  ctx.setLineDash([]);
  // Endpoints
  ctx.fillStyle = '#FF6B35';
  ctx.beginPath(); ctx.arc(sx1, sy1, 4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(sx2, sy2, 4, 0, Math.PI * 2); ctx.fill();
  // Label
  const mx = (sx1 + sx2) / 2, my = (sy1 + sy2) / 2;
  ctx.font = 'bold 13px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  // Background
  const tw = ctx.measureText(label).width + 10;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(mx - tw / 2, my - 22, tw, 20);
  ctx.fillStyle = '#FF6B35';
  ctx.fillText(label, mx, my - 6);
  ctx.restore();
}

function _drawAreaPolygon(pts, cursorPt) {
  if (pts.length === 0) return;
  const screenPts = pts.map(p => ({ x: renderer.wx(p.wx), y: renderer.wy(p.wy) }));
  const hasCursor = cursorPt && !areaState.closed;
  if (hasCursor) screenPts.push({ x: renderer.wx(cursorPt.wx), y: renderer.wy(cursorPt.wy) });

  ctx.save();
  // Fill
  ctx.fillStyle = 'rgba(75, 201, 138, 0.15)';
  ctx.beginPath();
  screenPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.fill();
  // Outline
  ctx.strokeStyle = '#4BC98A';
  ctx.lineWidth = 2;
  ctx.setLineDash(areaState.closed ? [] : [6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  // Vertices
  ctx.fillStyle = '#4BC98A';
  pts.forEach(p => {
    const sx = renderer.wx(p.wx), sy = renderer.wy(p.wy);
    ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.fill();
  });
  // Area label
  const allPts = areaState.closed ? pts : (hasCursor ? [...pts, cursorPt] : pts);
  if (allPts.length >= 3) {
    const dxfArea = Math.abs(_shoelace(allPts));
    const area = metersPerUnit ? dxfArea * metersPerUnit * metersPerUnit : dxfArea;
    const label = metersPerUnit ? `${area.toFixed(2)} m²` : `${dxfArea.toFixed(1)} units²`;
    // Centroid
    let cx = 0, cy = 0;
    screenPts.forEach(p => { cx += p.x; cy += p.y; });
    cx /= screenPts.length; cy /= screenPts.length;
    ctx.font = 'bold 14px "PingFang SC", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width + 12;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(cx - tw / 2, cy - 12, tw, 24);
    ctx.fillStyle = '#4BC98A';
    ctx.fillText(label, cx, cy);
  }
  ctx.restore();
}

function _shoelace(pts) {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    sum += pts[i].wx * pts[j].wy - pts[j].wx * pts[i].wy;
  }
  return sum / 2;
}

function _closeAreaPolygon() {
  areaState.closed = true;
  const dxfArea = Math.abs(_shoelace(areaState.pts));
  const area = metersPerUnit ? dxfArea * metersPerUnit * metersPerUnit : dxfArea;
  const label = metersPerUnit ? `${area.toFixed(2)} m²` : `${dxfArea.toFixed(1)} units²`;
  document.getElementById('tool-hint').textContent = `面积: ${label} · 点击开始新测量 · Esc 退出`;
}

// ── THEME ─────────────────────────────────────────────────────────────────────
// ── SNAP ──────────────────────────────────────────────────────────────────────
function _snapBooth(item) {
  const snapDist = 10 / renderer.scale;
  const gap = metersPerUnit ? (0.05 / metersPerUnit) : 50;
  let bestDist = snapDist;
  let bestSnap = null;
  item._snapGuides = null;

  const aCx = item.wx + item.ww / 2, aCy = item.wy + item.wh / 2;

  for (const other of booths.items) {
    if (other.id === item.id || other.type !== 'booth') continue;

    const bCx = other.wx + other.ww / 2, bCy = other.wy + other.wh / 2;
    const bAngle = (other.angle || 0) * Math.PI / 180;
    const cos = Math.cos(bAngle), sin = Math.sin(bAngle);

    // Transform A's center into B's local coordinate system
    const dx = aCx - bCx, dy = aCy - bCy;
    const lx = dx * cos + dy * sin;   // local X (along B's width axis)
    const ly = -dx * sin + dy * cos;  // local Y (along B's height axis)

    // In B's local coords, B spans [-bW/2, bW/2] x [-bH/2, bH/2]
    const bHW = other.ww / 2, bHH = other.wh / 2;
    const aHW = item.ww / 2, aHH = item.wh / 2;

    // Check 4 adjacency snaps (A's edge touches B's edge + gap)
    const snaps = [
      { localX: bHW + gap + aHW,  localY: ly, side: 'right' },   // A to B's right
      { localX: -(bHW + gap + aHW), localY: ly, side: 'left' },  // A to B's left
      { localX: lx, localY: bHH + gap + aHH, side: 'top' },      // A above B
      { localX: lx, localY: -(bHH + gap + aHH), side: 'bottom' },// A below B
    ];

    for (const snap of snaps) {
      // Distance from current local position to snap position
      const sdx = snap.localX - lx, sdy = snap.localY - ly;

      // For side snaps, also align along the other axis
      let alignedY = snap.localY, alignedX = snap.localX;
      if (snap.side === 'right' || snap.side === 'left') {
        // Align Y: snap A's local Y edges to B's local Y edges
        const edgeSnaps = [ly, bHH - aHH, -(bHH - aHH), bHH + aHH, -(bHH + aHH)]; // current, top-align, bottom-align
        let bestAlignY = ly, bestAlignDist = Infinity;
        for (const ey of [bHH - aHH, -(bHH - aHH), 0]) {
          const d = Math.abs(ly - ey);
          if (d < snapDist && d < bestAlignDist) { bestAlignDist = d; bestAlignY = ey; }
        }
        alignedY = bestAlignY;
      } else {
        // Align X
        let bestAlignX = lx, bestAlignDist = Infinity;
        for (const ex of [bHW - aHW, -(bHW - aHW), 0]) {
          const d = Math.abs(lx - ex);
          if (d < snapDist && d < bestAlignDist) { bestAlignDist = d; bestAlignX = ex; }
        }
        alignedX = bestAlignX;
      }

      const finalLx = (snap.side === 'right' || snap.side === 'left') ? snap.localX : alignedX;
      const finalLy = (snap.side === 'right' || snap.side === 'left') ? alignedY : snap.localY;

      const totalDist = Math.hypot(finalLx - lx, finalLy - ly);
      if (totalDist < bestDist) {
        bestDist = totalDist;
        // Transform back to world coords
        const newCx = bCx + finalLx * cos - finalLy * sin;
        const newCy = bCy + finalLx * sin + finalLy * cos;
        bestSnap = {
          wx: newCx - aHW, wy: newCy - aHH,
          angle: (other.angle || 0),
          bCx, bCy, bAngle
        };
      }
    }
  }

  if (bestSnap) {
    item.wx = bestSnap.wx;
    item.wy = bestSnap.wy;
    item.angle = bestSnap.angle;
    item._snapGuides = [{ snapped: true }];
  }
}

function _resolveOverlap(item) {
  const gap = metersPerUnit ? (0.05 / metersPerUnit) : 50;
  let tries = 0;
  while (booths.checkOverlap(item) && tries < 20) {
    const blocker = booths.checkOverlap(item);
    const bAngle = (blocker.angle || 0) * Math.PI / 180;
    const cos = Math.cos(bAngle), sin = Math.sin(bAngle);

    // Centers
    const bCx = blocker.wx + blocker.ww / 2, bCy = blocker.wy + blocker.wh / 2;
    const aCx = item.wx + item.ww / 2, aCy = item.wy + item.wh / 2;

    // Transform A's center into blocker's local coords
    const dx = aCx - bCx, dy = aCy - bCy;
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;

    const bHW = blocker.ww / 2, bHH = blocker.wh / 2;
    const aHW = item.ww / 2, aHH = item.wh / 2;

    // Push to nearest edge in local coords
    const pushes = [
      { nlx: bHW + gap + aHW, nly: ly },    // push to right
      { nlx: -(bHW + gap + aHW), nly: ly },  // push to left
      { nlx: lx, nly: bHH + gap + aHH },    // push up
      { nlx: lx, nly: -(bHH + gap + aHH) }, // push down
    ];

    let bestPush = null, bestD = Infinity;
    for (const p of pushes) {
      const d = Math.hypot(p.nlx - lx, p.nly - ly);
      if (d < bestD) { bestD = d; bestPush = p; }
    }

    // Transform back to world coords
    const newCx = bCx + bestPush.nlx * cos - bestPush.nly * sin;
    const newCy = bCy + bestPush.nlx * sin + bestPush.nly * cos;
    item.wx = newCx - aHW;
    item.wy = newCy - aHH;
    item.angle = blocker.angle || 0;
    tries++;
  }
}

function _drawSnapGuides(guides) {
  // Just highlight the snapped booth with a subtle glow — guides are implicit from alignment
  ctx.save();
  ctx.strokeStyle = '#FFD700';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  // Draw a small indicator
  if (guides && guides[0] && guides[0].snapped && dragItem) {
    const sx = renderer.wx(dragItem.wx + dragItem.ww / 2);
    const sy = renderer.wy(dragItem.wy + dragItem.wh / 2);
    ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function _invertColorForLight(hex) {
  // Convert bright/white CAD colors to dark for white background
  if (!hex) return '#333333';
  const r = parseInt(hex.slice(1,3), 16), g = parseInt(hex.slice(3,5), 16), b = parseInt(hex.slice(5,7), 16);
  const lum = (r * 0.299 + g * 0.587 + b * 0.114);
  // Very bright colors (white, light gray) → dark
  if (lum > 180) return '#333333';
  // Medium brightness → darken slightly
  if (lum > 100) return `#${Math.round(r*0.5).toString(16).padStart(2,'0')}${Math.round(g*0.5).toString(16).padStart(2,'0')}${Math.round(b*0.5).toString(16).padStart(2,'0')}`;
  return hex;
}

function _drawCropPolygon(pts, cursorPt) {
  if (pts.length === 0) return;
  const screenPts = pts.map(p => ({ x: renderer.wx(p.wx), y: renderer.wy(p.wy) }));
  const closed = cropState && cropState.closed;
  if (cursorPt && !closed) screenPts.push({ x: renderer.wx(cursorPt.wx), y: renderer.wy(cursorPt.wy) });

  ctx.save();
  if (screenPts.length >= 3) {
    // Dim everything outside the polygon using composite
    // Draw dark overlay with polygon cut out
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    // Cut out polygon (counter-clockwise for even-odd)
    ctx.moveTo(screenPts[0].x, screenPts[0].y);
    for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i].x, screenPts[i].y);
    ctx.closePath();
    ctx.fill('evenodd');
  }
  // Polygon border
  ctx.strokeStyle = '#4BC98A';
  ctx.lineWidth = 2;
  ctx.setLineDash(closed ? [] : [6, 4]);
  ctx.beginPath();
  screenPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  // Vertices
  ctx.fillStyle = '#4BC98A';
  pts.forEach(p => {
    const sx = renderer.wx(p.wx), sy = renderer.wy(p.wy);
    ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.fill();
  });
  ctx.restore();
}

function _closeCropAndExport() {
  cropState.closed = true;
  render();
  _drawCropPolygon(cropState.pts, null);

  document.getElementById('tool-hint').textContent = '正在导出…';
  // Small delay so user sees the final selection
  setTimeout(() => {
    const pts = cropState.pts;
    const screenPts = pts.map(p => ({ x: renderer.wx(p.wx), y: renderer.wy(p.wy) }));

    // Bounding box of polygon in screen coords
    const xs = screenPts.map(p => p.x), ys = screenPts.map(p => p.y);
    const bx = Math.floor(Math.min(...xs)), by = Math.floor(Math.min(...ys));
    const bw = Math.ceil(Math.max(...xs)) - bx, bh = Math.ceil(Math.max(...ys)) - by;

    // Render clean frame
    const prevSel = booths.selectedId;
    booths.selectedId = null;
    const prevCrop = cropState;
    cropState = null;
    render();

    // Build legend
    const stats = booths.getStats();
    const cats = Object.entries(stats.counts);
    const legendW = cats.length > 0 ? 280 : 0;

    // Export: rectangular image with legend
    const scale = 2;
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = (bw + legendW) * scale;
    exportCanvas.height = bh * scale;
    const ectx = exportCanvas.getContext('2d');
    ectx.scale(scale, scale);

    // Fill entire rect with background
    const bgColor = darkMode ? '#1e1e1e' : '#ffffff';
    ectx.fillStyle = bgColor;
    ectx.fillRect(0, 0, bw + legendW, bh);

    // Clip to polygon, then draw content inside
    ectx.save();
    ectx.beginPath();
    screenPts.forEach((p, i) => i === 0 ? ectx.moveTo(p.x - bx, p.y - by) : ectx.lineTo(p.x - bx, p.y - by));
    ectx.closePath();
    ectx.clip();
    ectx.drawImage(canvas, bx, by, bw, bh, 0, 0, bw, bh);
    ectx.restore();

    // Draw legend
    if (cats.length > 0) {
      _drawExportLegend(ectx, bw + 20, 16, legendW - 40, stats, cats);
    }

    // Download
    const link = document.createElement('a');
    link.download = `NEEDFLEA_crop_${new Date().toISOString().slice(0,10)}.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();

    booths.selectedId = prevSel;
    cropState = prevCrop;
    setTool('select');
    render();
  }, 100);
}

function _drawExportLegend(ectx, lx, ly, w, stats, cats) {
  const isDark = darkMode;
  const textColor = isDark ? '#ffffff' : '#1a1a18';
  const subColor = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)';

  ectx.font = 'bold 16px "PingFang SC", sans-serif';
  ectx.fillStyle = textColor;
  ectx.textAlign = 'left';
  ectx.textBaseline = 'top';
  ectx.fillText('摊位图例', lx, ly);

  ectx.font = '12px "PingFang SC", sans-serif';
  ectx.fillStyle = subColor;
  ectx.fillText(`共 ${stats.total} 个摊位`, lx, ly + 22);

  let y = ly + 46;
  cats.forEach(([cat, count]) => {
    const col = booths.CAT_COLORS[cat];
    if (!col) return;
    ectx.fillStyle = col.fill;
    ectx.fillRect(lx, y + 1, 14, 14);
    ectx.font = '13px "PingFang SC", sans-serif';
    ectx.fillStyle = textColor;
    ectx.fillText(cat, lx + 22, y);
    ectx.fillStyle = subColor;
    ectx.textAlign = 'right';
    ectx.fillText(String(count), lx + w, y);
    ectx.textAlign = 'left';
    y += 26;
  });

  if (stats.guards > 0) {
    ectx.font = '13px "PingFang SC", sans-serif';
    ectx.fillStyle = textColor;
    ectx.fillText('安保点', lx, y);
    ectx.fillStyle = subColor;
    ectx.textAlign = 'right';
    ectx.fillText(String(stats.guards), lx + w, y);
    ectx.textAlign = 'left';
  }
  if (stats.fires > 0) {
    y += 18;
    ectx.font = '13px "PingFang SC", sans-serif';
    ectx.fillStyle = textColor;
    ectx.fillText('灭火器', lx, y);
    ectx.fillStyle = subColor;
    ectx.textAlign = 'right';
    ectx.fillText(String(stats.fires), lx + w, y);
    ectx.textAlign = 'left';
  }
}

function toggleTheme() {
  darkMode = !darkMode;
  const btn = document.getElementById('btn-theme');
  btn.textContent = darkMode ? '☀ 白底' : '☾ 深色';
  // Update canvas background
  wrap.style.background = darkMode ? '#1e1e1e' : '#ffffff';
  // Regenerate SVG with new colors
  if (_dwgBounds) _regenerateSvgBackground();
  else render();
}
window.toggleTheme = toggleTheme;
window.clearEraser = function() {
  eraserMarks = [];
  render();
};

// ── WASM MODULE (libdxfrw for DWG support) ──────────────────────────────────
let libdxfrwModule = null;
let libdxfrwLoading = false;

async function ensureLibDxfrw() {
  if (libdxfrwModule) return libdxfrwModule;
  if (libdxfrwLoading) {
    // Wait for ongoing load
    while (!libdxfrwModule) await new Promise(r => setTimeout(r, 100));
    return libdxfrwModule;
  }
  libdxfrwLoading = true;
  try {
    libdxfrwModule = await createModule();
  } catch (err) {
    libdxfrwLoading = false;
    throw new Error('WASM 模块加载失败: ' + err.message);
  }
  return libdxfrwModule;
}

// ── DWG → SVG CONVERSION ────────────────────────────────────────────────────
// ACI color table for SVG rendering
const _svgAciColors = {1:'#FF0000',2:'#FFFF00',3:'#00FF00',4:'#00FFFF',5:'#0000FF',6:'#FF00FF',7:'#FFFFFF',8:'#808080',9:'#c0c0c0',10:'#FF0000',30:'#FF7F00',40:'#7F3F00',50:'#7F7F00',70:'#007F00',130:'#007F7F',150:'#00007F',190:'#7F007F',250:'#333',251:'#555',252:'#777',253:'#999',254:'#BBB',255:'#DDD'};

function _fixText(s) {
  if (!s) return '';
  try {
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xFF;
    return new TextDecoder('gbk').decode(bytes);
  } catch(e) { return s; }
}

function _sanitizeSvg(s) {
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _getDash(lt) {
  if (!lt) return '';
  const t = lt.trim().toUpperCase();
  if (t.includes('HIDDEN')) return '4,3';
  if (t.includes('DASHDOT')) return '8,3,2,3';
  if (t.includes('DASH')) return '8,4';
  if (t.includes('CENTER')) return '14,4,4,4';
  return '';
}

// Layers HIDDEN by default — comprehensive list to show only architectural elements
const _defaultHiddenPatterns = [
  // ── Reference & Grid ──
  'defpoints',
  'axis', '\u8f74\u7ebf',           // 轴线
  '\u67f1\u7f51',                   // 柱网
  '\u7ea2\u7ebf',                   // 红线

  // ── Ceiling ──
  'rc-', 'ceiling', '000000',
  '\u5929\u82b1',                   // 天花
  '\u5e73\u9876',                   // 平顶

  // ── Dimensions & Annotations ──
  'dim_', 'pub_',
  '\u5c3a\u5bf8',                   // 尺寸
  '\u6807\u6ce8',                   // 标注
  '\u6807\u9ad8',                   // 标高
  '\u7d22\u5f15',                   // 索引
  '\u56fe\u6846',                   // 图框
  '\u56fe\u4f8b',                   // 图例
  '\u9879\u76ee\u4fe1\u606f',       // 项目信息
  '\u56fe\u7eb8\u7591\u95ee',       // 图纸疑问
  '\u516c\u7528',                   // 公用

  // ── Fill & Hatch ──
  'hatch',
  '\u586b\u5145',                   // 填充

  // ── HVAC ──
  '\u6696-',                        // 暖-
  '\u98ce\u7ba1',                   // 风管
  '\u98ce\u53e3',                   // 风口
  '\u6392\u70df',                   // 排烟
  '\u6392\u98ce',                   // 排风
  '\u7a7a\u8c03',                   // 空调

  // ── Fire Protection ──
  '\u6d88\u9632',                   // 消防
  '\u6d88\u706b',                   // 消火
  '\u9632\u706b',                   // 防火
  '\u62a5\u8b66',                   // 报警
  '\u55b7\u5934',                   // 喷头
  '\u55b7\u6dcb',                   // 喷淋
  '\u5377\u5e18',                   // 卷帘

  // ── Electrical & Lighting ──
  '\u5f3a\u7535',                   // 强电
  '\u5f31\u7535',                   // 弱电
  '\u7535\u6c14',                   // 电气
  '\u63d2\u5ea7',                   // 插座
  '\u5f00\u5173',                   // 开关
  '\u7167\u660e',                   // 照明
  '\u706f',                         // 灯
  '\u5e94\u6025',                   // 应急
  '\u52a8\u529b',                   // 动力
  '\u6e29\u611f',                   // 温感
  '\u70df\u611f',                   // 烟感
  '\u58f0\u5149',                   // 声光
  '\u5e7f\u64ad',                   // 广播
  'light', 'luminaire',

  // ── Plumbing ──
  '\u96e8\u6c34',                   // 雨水
  'vpipe',

  // ── Equipment & Devices ──
  'equip',
  '\u8bbe\u5907',                   // 设备

  // ── Security ──
  'cctv',
  '\u5b89\u9632',                   // 安防
  '0a0',

  // ── HVAC Mechanical ──
  'h-dapp', 'h-equp', 'dote',

  // ── Xref / Nested ──
  'bp_b01', '03\u5e73\u9762',      // 03平面
  'acs_', 'iel-', 'f_eop',
  'cp_typ', 'y_ip-',

  // ── Construction / Demolition ──
  '\u62c6\u9664',                   // 拆除
  '\u4fee\u6539',                   // 修改
  '\u7559\u6d1e',                   // 留洞
  '\u94a2\u6750',                   // 钢材
  '\u7ed3\u6784\u7ebf',             // 结构线

  // ── Misc Noise ──
  'elevation-', 'a-200-', 'a-wall-',
  '\u653e\u5927\u56fe',             // 放大图
  '\u5e03\u70b9',                   // 布点
  '\u6807\u7b7e',                   // 标签
  '\u4e2d\u5fc3\u7ebf',             // 中心线
  '\u5939\u5c42',                   // 夹层
  '20200303', '181011',
  '\u5730\u4e0a-',                  // 地上-
  '0e-lt', 'ex-', 'c-',
  '\u770b\u7ebf',                   // 看线
  'prompt', 't-c',
  '\u9762\u79ef',                   // 面积
  '\u7cfb\u7edf',                   // 系统
  'car',
  '\u5145\u7535',                   // 充电
  '\u975e\u8bbe\u8ba1\u8303\u56f4', // 非设计范围
  '\u7ba1\u4e95',                   // 管井
  'epd-', 'window_text',
  '\u91d1\u878d\u8857',             // 金融街 (project-specific)

  // ── Drainage ──
  '\u96c6\u6c34',                   // 集水 (集水井、集水坑)
  '\u6392\u6c34',                   // 排水 (排水沟)
  'lvtry',                          // lavatory
];

function _isDefaultVisibleLayer(layerName) {
  const ln = layerName.trim().toLowerCase();
  // Try decoded name too
  let decoded = ln;
  try { decoded = _fixText(layerName).trim().toLowerCase(); } catch(e) {}
  return !_defaultHiddenPatterns.some(p => ln.includes(p) || decoded.includes(p));
}

function _extractEntityForSvg(lib, e, layerColors, layerLT) {
  const layer = e.layer || '0';

  let color = e.color; if (!color || color === 256) color = layerColors[layer] || 7;
  const hex = _svgAciColors[color] || '#FFFFFF';
  let lt = (e.lineType || '').trim().toLowerCase();
  if (!lt || lt === 'bylayer') lt = (layerLT[layer] || '').toLowerCase();
  if (lt === 'continuous' || lt === 'byblock') lt = '';
  try {
    if (e.eType == lib.DRW_ETYPE.TEXT || e.eType == lib.DRW_ETYPE.MTEXT) {
      const bp = e.basePoint; let text = _fixText(e.text || '');
      text = text.replace(/\\P/g, ' ').replace(/\{[^}]*\}/g, '').replace(/\\[a-zA-Z][^;]*;/g, '').trim();
      if (text) return { t: 'T', x: bp.x, y: bp.y, text, h: e.height || 1, c: hex, layer };
    }
    if (e.eType == lib.DRW_ETYPE.LINE) {
      const bp = e.basePoint, sp = e.secPoint;
      return { t: 'L', x1: bp.x, y1: bp.y, x2: sp.x, y2: sp.y, c: hex, lt, layer };
    }
    if (e.eType == lib.DRW_ETYPE.LWPOLYLINE) {
      const verts = e.getVertexList(); const pts = [];
      for (let j = 0; j < verts.size(); j++) pts.push([verts.get(j).x, verts.get(j).y]);
      if (pts.length >= 2) return { t: 'P', pts, closed: (e.flags & 1) === 1, c: hex, lt, layer };
    }
    if (e.eType == lib.DRW_ETYPE.CIRCLE) {
      const bp = e.basePoint;
      return { t: 'C', cx: bp.x, cy: bp.y, r: e.radius, c: hex, layer };
    }
    if (e.eType == lib.DRW_ETYPE.ARC) {
      const bp = e.basePoint;
      return { t: 'A', cx: bp.x, cy: bp.y, r: e.radius, sa: e.startAngle, ea: e.endAngle, c: hex, layer };
    }
    if (e.eType == lib.DRW_ETYPE.INSERT) {
      const bp = e.basePoint;
      return { t: 'I', block: e.name || '', x: bp.x, y: bp.y, sx: e.xScale || 1, sy: e.yScale || 1, angle: e.angle || 0, c: hex, layer };
    }
  } catch(err) {}
  return null;
}

function _expandInsert(ins, blockDefs, output, depth) {
  if (depth > 3) return;
  const block = blockDefs[ins.block]; if (!block) return;
  const cos = Math.cos(ins.angle), sin = Math.sin(ins.angle);
  const tf = (x, y) => { const tx = x * ins.sx, ty = y * ins.sy; return [ins.x + tx * cos - ty * sin, ins.y + tx * sin + ty * cos]; };
  const il = ins.layer || '0'; // inherit insert's layer
  block.forEach(e => {
    // DWG standard: entities on layer "0" in a block inherit the INSERT's layer
    const rawLayer = (e.layer || '').trim();
    const ly = (!rawLayer || rawLayer === '0') ? il : rawLayer;
    if (e.t === 'L') { const [x1,y1] = tf(e.x1, e.y1), [x2,y2] = tf(e.x2, e.y2); output.push({ t: 'L', x1, y1, x2, y2, c: e.c, lt: e.lt, layer: ly }); }
    if (e.t === 'P') { output.push({ t: 'P', pts: e.pts.map(p => tf(p[0], p[1])), closed: e.closed, c: e.c, lt: e.lt, layer: ly }); }
    if (e.t === 'C') { const [cx,cy] = tf(e.cx, e.cy); output.push({ t: 'C', cx, cy, r: e.r * Math.abs(ins.sx), c: e.c, layer: ly }); }
    if (e.t === 'A') { const [cx,cy] = tf(e.cx, e.cy); output.push({ t: 'A', cx, cy, r: e.r * Math.abs(ins.sx), sa: e.sa + ins.angle, ea: e.ea + ins.angle, c: e.c, layer: ly }); }
    if (e.t === 'T') { const [x,y] = tf(e.x, e.y); output.push({ t: 'T', x, y, text: e.text, h: e.h * Math.abs(ins.sy), c: e.c, layer: ly }); }
    if (e.t === 'I') { const [x,y] = tf(e.x, e.y); _expandInsert({ ...e, x, y, sx: e.sx * ins.sx, sy: e.sy * ins.sy, angle: e.angle + ins.angle, layer: ly }, blockDefs, output, depth + 1); }
  });
}

/**
 * Parse a DWG file: extract entities grouped by layer, compute bounds,
 * and generate an SVG string from all visible layers.
 * Returns { svgString, bounds: { minX, minY, maxX, maxY } }
 */
async function parseDWGtoSVG(arrayBuffer) {
  _dwgRasterMode = false;
  const lib = await ensureLibDxfrw();
  const db = new lib.DRW_Database();
  const fh = new lib.DRW_FileHandler();
  fh.database = db;

  let ok = false;
  try {
    const dwg = new lib.DRW_DwgR(arrayBuffer);
    ok = dwg.read(fh, false);
    dwg.delete();
  } catch (wasmErr) {
    db.delete(); fh.delete();
    console.error('WASM DWG read exception:', wasmErr);
    throw new Error('DWG 文件解析时 WASM 崩溃，文件可能过大或包含不受支持的实体。请尝试在 AutoCAD 中另存为较低版本（如 2013 格式）后重试。');
  }

  if (!ok) {
    db.delete(); fh.delete();
    throw new Error('DWG 文件读取失败，可能格式不受支持。');
  }

  // Read layer info
  const layerColors = {}, layerLT = {};
  for (let i = 0; i < db.layers.size(); i++) {
    const l = db.layers.get(i);
    layerColors[l.name] = Math.abs(l.color);
    layerLT[l.name] = (l.lineType || '').trim();
  }

  // Store layer colors globally for the layer panel
  _dwgLayerColors = {};
  for (const [name, aci] of Object.entries(layerColors)) {
    _dwgLayerColors[name] = aci;
  }

  // Read block definitions
  const blockDefs = {};
  for (let i = 0; i < db.blocks.size(); i++) {
    const b = db.blocks.get(i);
    const ents = [];
    for (let j = 0; j < b.entities.size(); j++) {
      try {
        const raw = _extractEntityForSvg(lib, b.entities.get(j), layerColors, layerLT);
        if (raw) ents.push(raw);
      } catch (e) { /* skip unsupported block entity */ }
    }
    if (ents.length > 0) blockDefs[b.name] = ents;
  }
  _dwgBlockDefs = blockDefs;

  // Read model space entities, compute bounds from LINE/POLY only
  const msEntities = [];
  const bxs = [], bys = [];
  const entities = db.mBlock.entities;
  for (let i = 0; i < entities.size(); i++) {
    try {
      const e = entities.get(i);
      const item = _extractEntityForSvg(lib, e, layerColors, layerLT);
      if (item) {
        msEntities.push(item);
        if (item.t === 'L') { bxs.push(item.x1, item.x2); bys.push(item.y1, item.y2); }
        if (item.t === 'P') item.pts.forEach(p => { bxs.push(p[0]); bys.push(p[1]); });
      }
    } catch (e) { /* skip unsupported entity */ }
  }

  // Read $INSUNITS from header for auto unit detection
  let _dwgInsUnits = 0;
  try {
    const insVar = db.header.getVar('INSUNITS');
    if (insVar) _dwgInsUnits = insVar.getInt();
  } catch(e) {}

  db.delete(); fh.delete();

  // Compute bounds using the clustering approach
  bxs.sort((a, b) => a - b); bys.sort((a, b) => a - b);
  const findC = (arr) => {
    const n = arr.length, s = Math.floor(n * 0.05), e = Math.ceil(n * 0.95);
    let mg = 0, gi = -1;
    for (let i = s; i < e; i++) { const g = arr[i + 1] - arr[i]; if (g > mg) { mg = g; gi = i; } }
    if (gi >= 0 && mg > (arr[e] - arr[s]) * 0.2) {
      return (gi - s + 1) >= (e - gi - 1) ? { lo: arr[s], hi: arr[gi] } : { lo: arr[gi + 1], hi: arr[e] };
    }
    return { lo: arr[s], hi: arr[e] };
  };
  const cx = findC(bxs), cy = findC(bys);
  const pad = Math.max(cx.hi - cx.lo, cy.hi - cy.lo) * 0.08;
  const bx0 = cx.lo - pad, bx1 = cx.hi + pad, by0 = cy.lo - pad, by1 = cy.hi + pad;
  const inB = (x, y) => x >= bx0 && x <= bx1 && y >= by0 && y <= by1;

  console.log(`DWG bounds: X[${bx0.toFixed(0)},${bx1.toFixed(0)}] Y[${by0.toFixed(0)},${by1.toFixed(0)}]`);

  // Store bounds globally
  _dwgBounds = { minX: bx0, minY: by0, maxX: bx1, maxY: by1, bx0, bx1, by0, by1 };

  // Expand block inserts and collect all items, preserving layer info
  const items = [];
  msEntities.forEach(item => {
    if (item.t === 'I') {
      if (inB(item.x, item.y)) {
        const expanded = [];
        _expandInsert(item, blockDefs, expanded, 0);
        // Expanded items inherit the INSERT's layer if they don't have their own
        expanded.forEach(ex => { if (!ex.layer) ex.layer = item.layer; });
        items.push(...expanded);
      }
    } else {
      items.push(item);
    }
  });

  // Filter to bounds
  const filtered = items.filter(it => {
    if (it.t === 'L') return inB(it.x1, it.y1) && inB(it.x2, it.y2);
    if (it.t === 'P') return it.pts.every(p => inB(p[0], p[1]));
    if (it.t === 'C') return inB(it.cx, it.cy) && it.r * 0.006 < 200;
    if (it.t === 'A') return inB(it.cx, it.cy) && it.r * 0.006 < 200;
    if (it.t === 'T') return inB(it.x, it.y);
    return false;
  });

  console.log(`DWG items: ${items.length}, filtered: ${filtered.length}`);

  // Group filtered entities by layer
  _dwgEntitiesByLayer = {};
  _dwgLayerVisibility = {};
  filtered.forEach(it => {
    const layer = it.layer || '0';
    if (!_dwgEntitiesByLayer[layer]) _dwgEntitiesByLayer[layer] = [];
    _dwgEntitiesByLayer[layer].push(it);
    // Default: hide ceiling/MEP/construction layers
    _dwgLayerVisibility[layer] = _isDefaultVisibleLayer(layer);
  });

  // Also ensure layers from the DWG layer table appear (even if empty)
  for (const name of Object.keys(_dwgLayerColors)) {
    if (!(_dwgLayerVisibility.hasOwnProperty(name))) {
      _dwgLayerVisibility[name] = _isDefaultVisibleLayer(name);
    }
  }

  console.log(`DWG layers with entities: ${Object.keys(_dwgEntitiesByLayer).length}`);

  // Generate SVG from all visible layers
  const svgString = generateSVGFromLayers();

  // Populate the layer panel
  populateLayerPanel();

  // Auto-detect units → metersPerUnit
  const _insUnitsToMeters = { 1: 0.0254, 2: 0.3048, 3: 1609.344, 4: 0.001, 5: 0.01, 6: 1.0, 7: 1000.0 };
  let detectedMetersPerUnit = _insUnitsToMeters[_dwgInsUnits] || null;

  if (!detectedMetersPerUnit) {
    // Heuristic: infer from bounding box size
    const maxDim = Math.max(bx1 - bx0, by1 - by0);
    if (maxDim > 10000) detectedMetersPerUnit = 0.001;       // mm
    else if (maxDim > 500) detectedMetersPerUnit = 0.01;     // cm
    else detectedMetersPerUnit = 1.0;                         // m
    console.log(`Units heuristic: maxDim=${maxDim.toFixed(0)} → ${detectedMetersPerUnit === 0.001 ? 'mm' : detectedMetersPerUnit === 0.01 ? 'cm' : 'm'}`);
  } else {
    console.log(`Units from INSUNITS=${_dwgInsUnits} → metersPerUnit=${detectedMetersPerUnit}`);
  }

  return {
    svgString,
    bounds: { minX: bx0, minY: by0, maxX: bx1, maxY: by1 },
    metersPerUnit: detectedMetersPerUnit
  };
}

// ── FALLBACK: ODA DWG→DXF conversion server (port 3001) ──

async function convertDWGtoDXF(arrayBuffer, filename) {
  console.log('Calling ODA DWG→DXF server...');
  document.getElementById('tool-hint').textContent = '正在转换 DWG → DXF（ODA 引擎）…';

  const resp = await fetch('http://localhost:3001/convert', {
    method: 'POST',
    headers: { 'X-Filename': encodeURIComponent(filename || 'input.dwg') },
    body: new Uint8Array(arrayBuffer),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Server error' }));
    throw new Error(err.error || 'DWG→DXF 转换失败');
  }

  const dxfText = await resp.text();
  console.log(`ODA conversion done: ${(dxfText.length / 1024).toFixed(0)} KB DXF`);
  return dxfText;
}

/**
 * Generate SVG string from currently visible layers' entities.
 */
function generateSVGFromLayers() {
  if (!_dwgBounds) return '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>';

  const { bx0, bx1, by0, by1 } = _dwgBounds;
  const bw = bx1 - bx0, bh = by1 - by0;
  const svgPixelW = Math.min(4000, Math.max(2000, Math.ceil(bw * 0.5)));
  const svgPixelH = Math.round(svgPixelW * (bh / bw));
  const sc = Math.min(svgPixelW / bw, svgPixelH / bh);
  const ox = -bx0 * sc, oy = by1 * sc;
  const sxf = x => (x * sc + ox).toFixed(1);
  const syf = y => (-y * sc + oy).toFixed(1);

  // Collect entities from visible layers only
  const visibleEntities = [];
  for (const [layer, entities] of Object.entries(_dwgEntitiesByLayer)) {
    if (_dwgLayerVisibility[layer]) {
      visibleEntities.push(...entities);
    }
  }

  const bgColor = darkMode ? '#1e1e1e' : '#ffffff';
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgPixelW}" height="${svgPixelH}" style="background:${bgColor}">\n`;
  visibleEntities.forEach(it => {
    const c = darkMode ? it.c : _invertColorForLight(it.c);
    const da = _getDash(it.lt), dashA = da ? ` stroke-dasharray="${da}"` : '';
    if (it.t === 'L') svg += `<line x1="${sxf(it.x1)}" y1="${syf(it.y1)}" x2="${sxf(it.x2)}" y2="${syf(it.y2)}" stroke="${c}" stroke-width="0.6"${dashA} fill="none"/>\n`;
    if (it.t === 'P') {
      const d = it.pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${sxf(v[0])},${syf(v[1])}`).join(' ') + (it.closed ? ' Z' : '');
      svg += `<path d="${d}" stroke="${c}" stroke-width="0.6"${dashA} fill="none"/>\n`;
    }
    if (it.t === 'C') svg += `<circle cx="${sxf(it.cx)}" cy="${syf(it.cy)}" r="${(it.r * sc).toFixed(1)}" stroke="${c}" stroke-width="0.5" fill="none"/>\n`;
    if (it.t === 'A') {
      const x1 = it.cx + it.r * Math.cos(it.sa), y1 = it.cy + it.r * Math.sin(it.sa);
      const x2 = it.cx + it.r * Math.cos(it.ea), y2 = it.cy + it.r * Math.sin(it.ea);
      const la = Math.abs(it.ea - it.sa) > Math.PI ? 1 : 0, sw = it.ea > it.sa ? 0 : 1;
      svg += `<path d="M${sxf(x1)},${syf(y1)} A${(it.r * sc).toFixed(1)},${(it.r * sc).toFixed(1)} 0 ${la},${sw} ${sxf(x2)},${syf(y2)}" stroke="${c}" stroke-width="0.5" fill="none"/>\n`;
    }
    if (it.t === 'T') {
      const fs = Math.max(4, Math.min(11, it.h * sc));
      if (fs >= 4) svg += `<text x="${sxf(it.x)}" y="${syf(it.y)}" fill="${c}" font-size="${fs.toFixed(0)}" font-family="sans-serif">${_sanitizeSvg(it.text)}</text>\n`;
    }
  });
  svg += `</svg>`;

  console.log(`DWG SVG generated: ${(svg.length / 1024).toFixed(0)} KB, ${svgPixelW}x${svgPixelH}px, ${visibleEntities.length} entities`);
  return svg;
}

/**
 * Populate the layer panel in the sidebar with checkboxes for each layer.
 */
// Store layer names array for checkbox indexing
let _dwgLayerNamesList = [];

function populateLayerPanel() {
  try {
    const container = document.getElementById('layer-list');
    if (!container) { console.warn('layer-list not found'); return; }

    // Show the layer section
    document.getElementById('layer-section').style.display = 'block';

    // Get all layer names, sorted by decoded name
    _dwgLayerNamesList = Object.keys(_dwgLayerVisibility);
    const decoded = {};
    _dwgLayerNamesList.forEach(n => {
      try { decoded[n] = _fixText(n); } catch(e) { decoded[n] = n; }
    });
    _dwgLayerNamesList.sort((a, b) => {
      // Checked (visible) layers first, then by entity count descending
      const va = _dwgLayerVisibility[a] ? 0 : 1;
      const vb = _dwgLayerVisibility[b] ? 0 : 1;
      if (va !== vb) return va - vb;
      const ca = (_dwgEntitiesByLayer[a] || []).length;
      const cb = (_dwgEntitiesByLayer[b] || []).length;
      if (ca !== cb) return cb - ca;
      try { return decoded[a].localeCompare(decoded[b], 'zh-CN'); } catch(e) { return 0; }
    });

    let html = '';
    _dwgLayerNamesList.forEach((name, idx) => {
      const visible = _dwgLayerVisibility[name];
      const aci = _dwgLayerColors[name] || 7;
      const hex = _svgAciColors[aci] || '#FFFFFF';
      const displayName = decoded[name] || name;
      const entityCount = (_dwgEntitiesByLayer[name] || []).length;
      // Use index-based data attribute to avoid escaping issues with layer names
      html += `<label class="layer-item">
        <input type="checkbox" ${visible ? 'checked' : ''} data-layer-idx="${idx}" onchange="toggleLayerByIdx(${idx}, this.checked)" ${_dwgRasterMode ? 'disabled' : ''}>
        <span class="layer-color" style="background:${hex}"></span>
        <span class="layer-name">${displayName.replace(/</g, '&lt;')}</span>
        <span class="layer-count">${entityCount}</span>
      </label>\n`;
    });

    if (_dwgRasterMode) {
      html = `<div style="font-size:11px;color:var(--text3);padding:4px 0 8px;font-style:italic">备用解析器模式，图层切换不可用</div>` + html;
    }
    container.innerHTML = html;
    // Disable select-all/none buttons in raster mode
    const btnAll = document.getElementById('btn-layer-all');
    const btnNone = document.getElementById('btn-layer-none');
    if (btnAll) btnAll.disabled = _dwgRasterMode;
    if (btnNone) btnNone.disabled = _dwgRasterMode;
    _updateLayerSelectAllState();
    console.log(`Layer panel: ${_dwgLayerNamesList.length} layers${_dwgRasterMode ? ' (raster mode)' : ''}`);
  } catch(err) {
    console.error('populateLayerPanel error:', err);
  }
}

function _updateLayerSelectAllState() {
  const allVisible = Object.values(_dwgLayerVisibility).every(v => v);
  const noneVisible = Object.values(_dwgLayerVisibility).every(v => !v);
  const btnAll = document.getElementById('btn-layer-all');
  const btnNone = document.getElementById('btn-layer-none');
  if (btnAll) btnAll.disabled = allVisible;
  if (btnNone) btnNone.disabled = noneVisible;
}

/**
 * Toggle a single layer's visibility and regenerate SVG.
 */
function toggleLayerByIdx(idx, visible) {
  const name = _dwgLayerNamesList[idx];
  if (name != null) toggleLayer(name, visible);
}

function toggleLayer(layerName, visible) {
  _dwgLayerVisibility[layerName] = visible;
  _updateLayerSelectAllState();
  _regenerateSvgBackground();
}

/**
 * Set all layers visible or hidden.
 */
function setAllLayersVisible(visible) {
  for (const name of Object.keys(_dwgLayerVisibility)) {
    _dwgLayerVisibility[name] = visible;
  }
  // Update checkboxes
  const container = document.getElementById('layer-list');
  if (container) {
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = visible; });
  }
  _updateLayerSelectAllState();
  _regenerateSvgBackground();
}

/**
 * Regenerate SVG from visible layers and reload the canvas background.
 */
function _regenerateSvgBackground() {
  if (_dwgRasterMode) return; // rasterized PNG fallback — layers not toggleable

  // DXF path: re-render with filtered entities
  if (_dxfFullData) {
    const filtered = { ..._dxfFullData, entities: [] };
    if (_dxfFullData.entities) {
      filtered.entities = _dxfFullData.entities.filter(ent => {
        const ln = ent.layer || '0';
        return _dwgLayerVisibility[ln] !== false;
      });
    }
    const savedOx = renderer.offsetX, savedOy = renderer.offsetY, savedScale = renderer.scale;
    renderer.load(filtered);
    renderer.offsetX = savedOx; renderer.offsetY = savedOy; renderer.scale = savedScale;
    render();
    return;
  }

  if (!_dwgBounds) return;

  const svgString = generateSVGFromLayers();
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    // Preserve current viewport transform
    const savedOx = renderer.offsetX, savedOy = renderer.offsetY, savedScale = renderer.scale;
    renderer.loadSvgBackground(img, {
      minX: _dwgBounds.minX, minY: _dwgBounds.minY,
      maxX: _dwgBounds.maxX, maxY: _dwgBounds.maxY
    });
    // Restore viewport (loadSvgBackground calls fitToView which we want to undo)
    renderer.offsetX = savedOx;
    renderer.offsetY = savedOy;
    renderer.scale = savedScale;
    render();
  };
  img.onerror = () => { URL.revokeObjectURL(url); };
  img.src = url;
}

// ── FILE LOADING (DXF + DWG) ─────────────────────────────────────────────────
function getFileExtension(name) {
  return (name || '').split('.').pop().toLowerCase();
}

function onDXFParsed(dxfData) {
  if (!dxfData.entities || dxfData.entities.length === 0) {
    alert('文件解析完成，但未找到任何图形实体。\n请确认文件包含有效的 CAD 图形数据。');
    return;
  }
  renderer.load(dxfData);
  dxfLoaded = true;
  document.getElementById('welcome').classList.add('hidden');
  document.getElementById('btn-calib').disabled = false;
  metersPerUnit = null;
  updateScaleInfo();
  setTool('select');
  render();
}

function onSvgLoaded() {
  dxfLoaded = true;
  document.getElementById('welcome').classList.add('hidden');
  document.getElementById('btn-calib').disabled = false;
  // Don't reset metersPerUnit if already auto-detected from DWG
  if (!metersPerUnit) updateScaleInfo();
  setTool('select');
  render();
}

async function loadDWGFile(file) {
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      // Store raw file for project save
      const bytes = new Uint8Array(e.target.result);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      _cadFileData = { name: file.name || 'file.dwg', base64: btoa(binary) };

      document.getElementById('tool-hint').textContent = '正在解析 DWG 文件，请稍候…';

      // Strategy 1: try libdxfrw WASM (browser-side, fast)
      let parsed = false;
      try {
        const result = await parseDWGtoSVG(e.target.result);
        const { svgString, bounds } = result;
        if (result.metersPerUnit) { metersPerUnit = result.metersPerUnit; updateScaleInfo(); }
        document.getElementById('tool-hint').textContent = '正在渲染背景…';
        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); renderer.loadSvgBackground(img, bounds); onSvgLoaded(); };
        img.onerror = () => { URL.revokeObjectURL(url); alert('SVG 渲染失败'); };
        img.src = url;
        parsed = true;
      } catch (primaryErr) {
        console.warn('libdxfrw failed:', primaryErr);
      }

      // Strategy 2: ODA server DWG→DXF conversion + DXF parser
      if (!parsed) {
        try {
          console.log('Trying ODA DWG→DXF fallback...');
          const dxfText = await convertDWGtoDXF(e.target.result, file.name);
          _convertedDxfText = dxfText;
          _convertedDxfName = file.name.replace(/\.dwg$/i, '.dxf');
          console.log('DXF received, parsing...', dxfText.length, 'chars');
          document.getElementById('tool-hint').textContent = '正在解析 DXF 数据…';
          // Don't store large DXF in cadFileData base64 (can be huge)
          if (dxfText.length < 5 * 1024 * 1024) {
            _cadFileData = { name: file.name.replace(/\.dwg$/i, '.dxf'), base64: btoa(unescape(encodeURIComponent(dxfText))) };
          }
          const dxfData = parser.parse(dxfText);
          console.log('DXF parsed, entities:', dxfData.entities?.length);

          // Populate layer panel from DXF data (layers stored in dxfData.layers)
          const dxfLayers = dxfData.layers || {};
          _dwgLayerColors = {};
          _dwgLayerVisibility = {};
          _dwgEntitiesByLayer = {};
          for (const [name, layer] of Object.entries(dxfLayers)) {
            _dwgLayerColors[name] = Math.abs(layer.color || 7);
            _dwgLayerVisibility[name] = layer.visible !== false;
            _dwgEntitiesByLayer[name] = [];
          }
          if (dxfData.entities) {
            for (const ent of dxfData.entities) {
              const ln = ent.layer || '0';
              if (!_dwgEntitiesByLayer[ln]) {
                _dwgEntitiesByLayer[ln] = [];
                _dwgLayerVisibility[ln] = true;
                _dwgLayerColors[ln] = 7;
              }
              _dwgEntitiesByLayer[ln].push(ent);
            }
          }
          _dwgRasterMode = false;
          _dxfFullData = dxfData; // store for layer toggling
          populateLayerPanel();
          console.log('Layer panel populated:', Object.keys(dxfLayers).length, 'layers');

          onDXFParsed(dxfData);

          // Auto-detect units from DXF header $INSUNITS (must be AFTER onDXFParsed which resets metersPerUnit)
          const insUnitsMap = { 1: 0.0254, 2: 0.3048, 3: 1609.344, 4: 0.001, 5: 0.01, 6: 1.0, 7: 1000.0 };
          const insMatch = dxfText.match(/\$INSUNITS[\s\S]*?70\s*\n\s*(\d+)/);
          if (insMatch) {
            const insVal = parseInt(insMatch[1]);
            if (insUnitsMap[insVal]) {
              metersPerUnit = insUnitsMap[insVal];
              updateScaleInfo();
              console.log('Auto scale from INSUNITS=' + insVal + ' → metersPerUnit=' + metersPerUnit);
            }
          }
          parsed = true;
        } catch (odaErr) {
          console.error('ODA fallback failed:', odaErr);
        }
      }

      if (!parsed) {
        alert('解析 DWG 文件失败，请转化成 DXF 格式上传或联系开发者');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert('DWG 文件处理失败：' + msg);
      console.error('DWG load error:', err);
    }
  };
  reader.readAsArrayBuffer(file);
}

function loadCADFile(input) {
  const file = input.files[0];
  if (!file) return;
  const ext = getFileExtension(file.name);

  if (ext === 'dwg') {
    loadDWGFile(file);
  } else {
    // DXF: read as text, parse directly
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const content = e.target.result;
        // Store raw file for project save
        _cadFileData = { name: file.name || 'file.dxf', base64: btoa(unescape(encodeURIComponent(content))) };
        // Detect mislabeled DWG files (e.g. .dxf extension but actually DWG binary)
        if (content.startsWith('AC10') || content.charCodeAt(0) === 0) {
          loadDWGFile(file);
          return;
        }
        const dxfData = parser.parse(content);
        onDXFParsed(dxfData);
      } catch (err) {
        alert('DXF 解析失败：' + err.message);
        console.error(err);
      }
    };
    reader.readAsText(file, 'UTF-8');
  }
  // Reset input so same file can be reloaded
  input.value = '';
}

// Keep backward compatibility
function loadDXF(input) { loadCADFile(input); }

// Drop support — bind to canvas-wrap so it works before and after loading
const dropHint = document.getElementById('drop-hint');
wrap.addEventListener('dragover', e => { e.preventDefault(); dropHint.classList.add('show'); });
wrap.addEventListener('dragleave', e => {
  // Only hide when leaving the wrap itself, not its children
  if (e.relatedTarget && wrap.contains(e.relatedTarget)) return;
  dropHint.classList.remove('show');
});
wrap.addEventListener('drop', e => {
  e.preventDefault();
  dropHint.classList.remove('show');
  const file = e.dataTransfer.files[0];
  if (file && /\.(dxf|dwg)$/i.test(file.name)) {
    loadCADFile({ files: [file] });
  } else {
    alert('请拖入 .dxf 或 .dwg 文件');
  }
});

// ── CALIBRATION ──────────────────────────────────────────────────────────────
function startCalib() {
  calibState = { step: 1, p1: null, p2: null };
  document.getElementById('calib-overlay').classList.add('show');
  document.getElementById('calib-status').textContent = '请在图上点击第一个参考点…';
  document.getElementById('calib-ok').disabled = true;
  setTool('_calib');
}

function cancelCalib() {
  calibState = null;
  document.getElementById('calib-overlay').classList.remove('show');
  setTool('select');
}

function confirmCalib() {
  if (!calibState || !calibState.p1 || !calibState.p2) return;
  const dist = parseFloat(document.getElementById('calib-dist').value);
  if (!dist || dist <= 0) { alert('请输入有效距离'); return; }
  const dx = calibState.p2.wx - calibState.p1.wx;
  const dy = calibState.p2.wy - calibState.p1.wy;
  const pxDist = Math.sqrt(dx * dx + dy * dy); // in DXF units
  if (pxDist < 0.001) { alert('两点距离太近，请重新选点'); return; }
  metersPerUnit = dist / pxDist;
  document.getElementById('calib-overlay').classList.remove('show');
  calibState = null;
  setTool('select');
  updateScaleInfo();
  render();
}

function updateScaleInfo() {
  const el = document.getElementById('scale-info');
  if (metersPerUnit === null) {
    el.textContent = '比例尺未设定';
    el.style.color = 'rgba(255,255,255,0.4)';
  } else {
    const unitsPerM = 1 / metersPerUnit;
    el.textContent = `比例尺 1m = ${unitsPerM.toFixed(1)} 单位`;
    el.style.color = '#4BC98A';
  }
}

// ── TOOL MANAGEMENT ──────────────────────────────────────────────────────────
function setTool(t) {
  tool = t;
  const hints = {
    select: '点击选择 · Shift多选 · 拖动移动 · R/L旋转 · 右键删除',
    booth: metersPerUnit ? '点击放置帐篷（尺寸精确）' : '点击放置帐篷（请先定比例尺以精确尺寸）',
    guard: '点击放置安保点位',
    fire: '点击放置灭火器',
    arrow: '拖动画动线箭头',
    zone: '点击放置文字标注',
    measure: '点击第一个测量点',
    dim: '点击第一个标距点',
    area: '依次点击多边形顶点，双击或点击起点闭合',
    line: '依次点击画线 · 双击结束 · 点击起点闭合 · Esc 退出',
    eraser: '拖动擦除 · 滚轮调大小 · Cmd+Z 撤销 · Esc 退出',
    crop: '拖动框选要导出的区域',
    _calib: '点击第一个参考点…',
  };
  document.getElementById('tool-hint').textContent = hints[t] || '';
  if (t !== 'measure') measureState = null;
  if (t !== 'dim') dimState = null;
  if (t !== 'area') areaState = null;
  if (t !== 'line') lineState = null;
  if (t !== 'crop') { cropState = null; render(); }
  // Update toolbar active states
  ['select','booth','guard','fire','arrow','zone','line','measure','dim','area','eraser'].forEach(id => {
    const btn = document.getElementById('btn-' + id);
    if (btn) btn.classList.toggle('active', id === t);
  });
  canvas.style.cursor = t === 'select' ? 'default' : 'crosshair';
}

function selectCat(el) {
  document.querySelectorAll('.cat-dot').forEach(d => d.classList.remove('active'));
  el.classList.add('active');
  activeCat = el.dataset.cat;
}

// ── WORLD <-> SCREEN ────────────────────────────────────────────────────────
function screenToWorld(ex, ey) {
  return { wx: renderer.sx(ex), wy: renderer.sy(ey) };
}

// Convert world meters to DXF units
function metersToDXF(m) {
  if (!metersPerUnit) return m * 10; // fallback: assume 1 unit = 0.1m
  return m / metersPerUnit;
}

// ── MOUSE EVENTS ─────────────────────────────────────────────────────────────
canvas.addEventListener('mousedown', e => {
  const { wx, wy } = screenToWorld(e.offsetX, e.offsetY);

  // Middle mouse or space+drag = pan
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    panning = true;
    panStart = { x: e.offsetX, y: e.offsetY };
    canvas.style.cursor = 'grab';
    e.preventDefault(); return;
  }

  if (e.button === 2) return; // handled in contextmenu

  // Eraser mode
  if (tool === 'eraser') {
    erasing = true;
    eraserMarks.push({ wx, wy, wr: eraserRadius });
    render();
    return;
  }

  // Crop mode — polygon selection
  if (tool === 'crop') {
    if (!cropState || cropState.closed) {
      cropState = { pts: [{ wx, wy }], closed: false };
      document.getElementById('tool-hint').textContent = '继续点击添加顶点 · 双击或点击起点闭合 · Esc 退出';
    } else {
      const first = cropState.pts[0];
      const closeDist = Math.hypot(wx - first.wx, wy - first.wy);
      const closeThreshold = 5 / renderer.scale;
      if (cropState.pts.length >= 3 && closeDist < closeThreshold) {
        _closeCropAndExport();
      } else {
        cropState.pts.push({ wx, wy });
        document.getElementById('tool-hint').textContent = `已选 ${cropState.pts.length} 个点 · 双击或点击起点闭合 · Esc 退出`;
      }
    }
    render();
    return;
  }

  // Calibration mode
  if (tool === '_calib' && calibState) {
    if (calibState.step === 1) {
      calibState.p1 = { wx, wy };
      calibState.step = 2;
      document.getElementById('calib-status').textContent = '✓ 第一点已选。点击第二个参考点…';
    } else if (calibState.step === 2) {
      calibState.p2 = { wx, wy };
      const dx = calibState.p2.wx - calibState.p1.wx;
      const dy = calibState.p2.wy - calibState.p1.wy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      document.getElementById('calib-status').textContent = `✓ 两点已选（图上距离 ${dist.toFixed(2)} 单位）`;
      document.getElementById('calib-ok').disabled = false;
    }
    return;
  }

  if (tool === 'select') {
    // Check if clicking a corner of a selected booth → start rotation
    const cornerHit = _hitBoothCorner(wx, wy);
    if (cornerHit) {
      rotating = true;
      rotateItem = cornerHit;
      render();
      return;
    }
    const hit = booths.hitTest(wx, wy, renderer.scale);
    if (hit) {
      if (e.shiftKey) {
        // Shift+click: toggle multi-selection
        if (booths.selectedIds.has(hit.id)) {
          booths.selectedIds.delete(hit.id);
          if (booths.selectedId === hit.id) booths.selectedId = null;
        } else {
          booths.selectedIds.add(hit.id);
          booths.selectedId = hit.id;
        }
      } else if (!booths.selectedIds.has(hit.id)) {
        // Normal click on unselected: single select
        booths.selectedIds.clear();
        booths.selectedIds.add(hit.id);
        booths.selectedId = hit.id;
      }
      // Start dragging (single or group)
      dragging = true;
      dragItem = hit;
      if (hit.type === 'booth' || hit.type === 'zone') {
        dragOffset = { dwx: wx - hit.wx, dwy: wy - hit.wy };
      } else if (hit.type === 'guard' || hit.type === 'fire') {
        dragOffset = { dwx: wx - hit.wx, dwy: wy - hit.wy };
      } else if (hit.type === 'line' && hit.pts) {
        dragOffset = { dwx: wx - hit.pts[0].wx, dwy: wy - hit.pts[0].wy };
      } else if (hit.type === 'arrow' || hit.type === 'dim') {
        dragOffset = { dwx: wx - hit.wx1, dwy: wy - hit.wy1, dx: hit.wx2 - hit.wx1, dy: hit.wy2 - hit.wy1 };
      }
      showProps(hit);
    } else {
      booths.selectedId = null;
      booths.selectedIds.clear();
      hideProps();
    }
    render();
    return;
  }

  if (tool === 'booth') {
    const size = document.getElementById('size-select').value;
    const [mw, mh] = size === 'custom' ? [3, 3] : size.split('x').map(Number);
    const ww = metersToDXF(mw), wh = metersToDXF(mh);
    const item = booths.addBooth(wx, wy, activeCat, size);
    item.ww = ww; item.wh = wh;
    item.wx = wx - ww / 2; item.wy = wy - wh / 2;
    // Snap to nearby booths on placement
    _snapBooth(item);
    // If still overlapping after snap, push to nearest non-overlapping position
    _resolveOverlap(item);
    item._snapGuides = null;
    render();
    return;
  }

  if (tool === 'guard') {
    booths.addGuard(wx, wy);
    render();
    return;
  }

  if (tool === 'fire') {
    booths.addFire(wx, wy);
    render();
    return;
  }

  if (tool === 'measure') {
    if (!measureState || measureState.p2) {
      // Start new measurement
      measureState = { p1: { wx, wy }, p2: null };
      document.getElementById('tool-hint').textContent = '点击第二个测量点 · Esc 退出';
    } else {
      // Complete measurement
      measureState.p2 = { wx, wy };
      const dx = measureState.p2.wx - measureState.p1.wx;
      const dy = measureState.p2.wy - measureState.p1.wy;
      const dxfDist = Math.sqrt(dx * dx + dy * dy);
      const dist = metersPerUnit ? (dxfDist * metersPerUnit) : dxfDist;
      const label = metersPerUnit ? `${dist.toFixed(2)} m` : `${dxfDist.toFixed(1)} 单位`;
      document.getElementById('tool-hint').textContent = `距离: ${label} · 点击开始新测量 · Esc 退出`;
      render();
    }
    return;
  }

  if (tool === 'dim') {
    if (!dimState) {
      dimState = { p1: { wx, wy } };
      document.getElementById('tool-hint').textContent = '点击第二个标距点 · Esc 退出';
    } else {
      const dx = wx - dimState.p1.wx, dy = wy - dimState.p1.wy;
      const dxfDist = Math.sqrt(dx * dx + dy * dy);
      const dist = metersPerUnit ? (dxfDist * metersPerUnit) : dxfDist;
      const label = metersPerUnit ? `${dist.toFixed(2)}m` : `${dxfDist.toFixed(1)}`;
      booths.addDim(dimState.p1.wx, dimState.p1.wy, wx, wy, label);
      dimState = null;
      document.getElementById('tool-hint').textContent = '标距已添加 · 点击继续标距';
      render();
    }
    return;
  }

  if (tool === 'line') {
    if (!lineState) {
      lineState = { pts: [{ wx, wy }] };
      document.getElementById('tool-hint').textContent = '继续点击添加点 · 双击结束 · 点击起点闭合 · Esc 退出';
    } else {
      // Check close to first point
      const first = lineState.pts[0];
      const closeDist = Math.hypot(wx - first.wx, wy - first.wy);
      const closeThreshold = 5 / renderer.scale;
      if (lineState.pts.length >= 3 && closeDist < closeThreshold) {
        // Close and save
        const style = document.getElementById('line-style').value;
        booths.addLine([...lineState.pts], style, true);
        lineState = null;
        document.getElementById('tool-hint').textContent = '线条已闭合保存 · 点击继续画线';
      } else {
        lineState.pts.push({ wx, wy });
        document.getElementById('tool-hint').textContent = `已选 ${lineState.pts.length} 个点 · 双击结束 · 点击起点闭合`;
      }
    }
    render();
    return;
  }

  if (tool === 'area') {
    if (!areaState || areaState.closed) {
      // Start new polygon
      areaState = { pts: [{ wx, wy }], closed: false };
      document.getElementById('tool-hint').textContent = '继续点击添加顶点 · 双击或点击起点闭合 · Esc 退出';
    } else {
      // Check if clicking near first point → close
      const first = areaState.pts[0];
      const closeDist = Math.hypot(wx - first.wx, wy - first.wy);
      const closeThreshold = 5 / renderer.scale; // 5 screen pixels
      if (areaState.pts.length >= 3 && closeDist < closeThreshold) {
        _closeAreaPolygon();
      } else {
        areaState.pts.push({ wx, wy });
        document.getElementById('tool-hint').textContent = `已选 ${areaState.pts.length} 个点 · 双击或点击起点闭合 · Esc 退出`;
      }
    }
    render();
    return;
  }

  if (tool === 'zone') {
    const label = prompt('输入标注文字', '') || '';
    if (label) {
      booths.addZone(wx, wy, 0, 0, label);
      render();
    }
    return;
  }

  if (tool === 'arrow') {
    drawing = true;
    drawStart = { wx, wy };
    return;
  }
});

canvas.addEventListener('mousemove', e => {
  const { wx, wy } = screenToWorld(e.offsetX, e.offsetY);
  document.getElementById('coord-info').textContent =
    metersPerUnit ? `${(wx * metersPerUnit).toFixed(1)}m, ${(wy * metersPerUnit).toFixed(1)}m`
                  : `${wx.toFixed(1)}, ${wy.toFixed(1)} (未定标)`;

  if (rotating && rotateItem) {
    const cx = rotateItem.wx + rotateItem.ww / 2;
    const cy = rotateItem.wy + rotateItem.wh / 2;
    const angle = Math.atan2(wx - cx, wy - cy) * 180 / Math.PI;
    rotateItem.angle = ((Math.round(angle) % 360) + 360) % 360;
    render();
    return;
  }

  if (panning && panStart) {
    renderer.pan(e.offsetX - panStart.x, e.offsetY - panStart.y);
    panStart = { x: e.offsetX, y: e.offsetY };
    render(); return;
  }

  if (dragging && dragItem) {
    // Calculate movement delta from the primary drag item
    const newWx = wx - dragOffset.dwx;
    const newWy = wy - dragOffset.dwy;
    let deltaX, deltaY;

    if (dragItem.type === 'arrow' || dragItem.type === 'dim') {
      const oldWx1 = dragItem.wx1;
      const oldWy1 = dragItem.wy1;
      dragItem.wx1 = wx - dragOffset.dwx;
      dragItem.wy1 = wy - dragOffset.dwy;
      dragItem.wx2 = dragItem.wx1 + dragOffset.dx;
      dragItem.wy2 = dragItem.wy1 + dragOffset.dy;
      deltaX = dragItem.wx1 - oldWx1;
      deltaY = dragItem.wy1 - oldWy1;
    } else if (dragItem.type === 'line' && dragItem.pts) {
      const oldWx = dragItem.pts[0].wx, oldWy = dragItem.pts[0].wy;
      deltaX = newWx - oldWx;
      deltaY = newWy - oldWy;
      dragItem.pts.forEach(p => { p.wx += deltaX; p.wy += deltaY; });
    } else {
      deltaX = newWx - dragItem.wx;
      deltaY = newWy - dragItem.wy;
      dragItem.wx = newWx;
      dragItem.wy = newWy;
    }

    // Move all other selected items by the same delta
    if (booths.selectedIds.size > 1) {
      for (const id of booths.selectedIds) {
        if (id === dragItem.id) continue;
        const other = booths.getItem(id);
        if (!other) continue;
        if (other.type === 'arrow' || other.type === 'dim') {
          other.wx1 += deltaX; other.wy1 += deltaY;
          other.wx2 += deltaX; other.wy2 += deltaY;
        } else if (other.type === 'line' && other.pts) {
          other.pts.forEach(p => { p.wx += deltaX; p.wy += deltaY; });
        } else {
          other.wx += deltaX; other.wy += deltaY;
        }
      }
    }

    // Snap only for single booth drag
    if (dragItem.type === 'booth' && booths.selectedIds.size <= 1) {
      _snapBooth(dragItem);
    }

    render();
    if (dragItem.type === 'booth' && dragItem._snapGuides) {
      _drawSnapGuides(dragItem._snapGuides);
    }
    return;
  }

  if (drawing && drawStart) {
    render();
    // Draw preview
    const sx1 = renderer.wx(drawStart.wx), sy1 = renderer.wy(drawStart.wy);
    const sx2 = renderer.wx(wx), sy2 = renderer.wy(wy);
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#4BC98A';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx1, sy1); ctx.lineTo(sx2, sy2); ctx.stroke();
    ctx.setLineDash([]);
    if (tool === 'zone') {
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.fillRect(Math.min(sx1,sx2), Math.min(sy1,sy2), Math.abs(sx2-sx1), Math.abs(sy2-sy1));
    }
    ctx.restore();
    return;
  }

  // Dim tool: draw preview
  if (tool === 'dim' && dimState && dimState.p1) {
    render();
    _drawMeasureLine(dimState.p1, { wx, wy });
    return;
  }

  // Line tool: draw preview
  if (tool === 'line' && lineState && lineState.pts.length > 0) {
    render();
    const isDark = typeof darkMode !== 'undefined' && darkMode;
    const style = document.getElementById('line-style').value;
    ctx.save();
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (style === 'dashed') ctx.setLineDash([8, 5]);
    ctx.beginPath();
    lineState.pts.forEach((p, i) => {
      const sx = renderer.wx(p.wx), sy = renderer.wy(p.wy);
      i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
    });
    ctx.lineTo(renderer.wx(wx), renderer.wy(wy));
    ctx.stroke();
    ctx.setLineDash([]);
    // Vertices
    ctx.fillStyle = isDark ? '#fff' : '#333';
    lineState.pts.forEach(p => {
      ctx.beginPath(); ctx.arc(renderer.wx(p.wx), renderer.wy(p.wy), 4, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
    return;
  }

  // Eraser tool: draw while dragging + show brush cursor
  if (tool === 'eraser') {
    if (erasing) {
      eraserMarks.push({ wx, wy, wr: eraserRadius });
      render();
    } else {
      render();
    }
    // Draw brush cursor
    const sr = eraserRadius * renderer.scale;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,100,100,0.6)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(renderer.wx(wx), renderer.wy(wy), sr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    return;
  }

  // Crop tool: draw polygon preview
  if (tool === 'crop' && cropState && !cropState.closed && cropState.pts.length > 0) {
    render();
    _drawCropPolygon(cropState.pts, { wx, wy });
    return;
  }

  // Measure tool: draw live preview line + distance
  if (tool === 'measure' && measureState && measureState.p1) {
    render();
    const p2Target = measureState.p2 ? measureState.p2 : { wx, wy };
    _drawMeasureLine(measureState.p1, p2Target);
    return;
  }

  // Area tool: draw live preview polygon
  if (tool === 'area' && areaState && !areaState.closed && areaState.pts.length > 0) {
    render();
    _drawAreaPolygon(areaState.pts, { wx, wy });
    return;
  }

  // Hover cursor
  if (tool === 'select') {
    if (_hitBoothCorner(wx, wy)) {
      canvas.style.cursor = 'grab';
    } else {
      canvas.style.cursor = booths.hitTest(wx, wy, renderer.scale) ? 'move' : 'default';
    }
  }
});

canvas.addEventListener('mouseup', e => {
  const { wx, wy } = screenToWorld(e.offsetX, e.offsetY);


  if (rotating) {
    rotating = false;
    rotateItem = null;
    return;
  }

  if (erasing) {
    erasing = false;
    return;
  }

  if (panning) {
    panning = false; panStart = null;
    canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
    return;
  }

  if (dragging) {
    dragging = false; dragItem = null; dragOffset = null;
    return;
  }

  if (drawing && drawStart) {
    const dist = Math.hypot(wx - drawStart.wx, wy - drawStart.wy);
    if (tool === 'arrow' && dist > metersToDXF(0.5)) {
      booths.addArrow(drawStart.wx, drawStart.wy, wx, wy);
    }
    drawing = false; drawStart = null;
    render();
  }
});

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  const { wx, wy } = screenToWorld(e.offsetX, e.offsetY);
  const hit = booths.hitTest(wx, wy, renderer.scale);
  if (hit) {
    if (confirm(`删除此${hit.type === 'booth' ? '帐篷' : hit.type === 'guard' ? '安保点' : hit.type === 'fire' ? '灭火器' : hit.type === 'arrow' ? '动线' : hit.type === 'zone' ? '功能区' : hit.type}？`)) {
      booths.deleteItem(hit.id);
      hideProps();
      render();
    }
  }
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (tool === 'eraser') {
    // Adjust brush size
    eraserRadius *= e.deltaY < 0 ? 1.2 : 0.83;
    eraserRadius = Math.max(50, Math.min(5000, eraserRadius));
    render();
    // Redraw cursor
    const { wx, wy } = screenToWorld(e.offsetX, e.offsetY);
    const sr = eraserRadius * renderer.scale;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,100,100,0.6)';
    ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.arc(renderer.wx(wx), renderer.wy(wy), sr, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]); ctx.restore();
    return;
  }
  const factor = e.deltaY < 0 ? 1.12 : 0.89;
  renderer.zoom(factor, e.offsetX, e.offsetY);
  render();
}, { passive: false });

// Double-click to fit view
canvas.addEventListener('dblclick', e => {
  if (tool === 'line' && lineState && lineState.pts.length >= 2) {
    e.preventDefault();
    if (lineState.pts.length > 2) lineState.pts.pop(); // remove extra click from dblclick
    const style = document.getElementById('line-style').value;
    booths.addLine([...lineState.pts], style, false);
    lineState = null;
    document.getElementById('tool-hint').textContent = '线条已保存 · 点击继续画线';
    render();
    return;
  }
  if (tool === 'crop' && cropState && !cropState.closed && cropState.pts.length >= 3) {
    e.preventDefault();
    if (cropState.pts.length > 3) cropState.pts.pop();
    _closeCropAndExport();
    render();
    return;
  }
  if (tool === 'area' && areaState && !areaState.closed && areaState.pts.length >= 3) {
    e.preventDefault();
    // Remove last point (added by the second click of dblclick)
    if (areaState.pts.length > 3) areaState.pts.pop();
    _closeAreaPolygon();
    render();
    return;
  }
  if (!dxfLoaded) return;
  renderer.fitToView();
  render();
});

// Esc key to exit measure / calibration
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (tool === 'measure') { measureState = null; setTool('select'); render(); }
    else if (tool === 'dim') { dimState = null; setTool('select'); render(); }
    else if (tool === 'line') { lineState = null; setTool('select'); render(); }
    else if (tool === 'area') { areaState = null; setTool('select'); render(); }
    else if (tool === 'crop') { cropState = null; setTool('select'); render(); }
    else if (tool === 'eraser') { setTool('select'); render(); }
    else if (tool === '_calib') cancelCalib();
  }
  // Delete/Backspace: clear labels on selected booths
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (booths.selectedIds.size > 0 && document.activeElement === document.body) {
      let cleared = 0;
      for (const id of booths.selectedIds) {
        const item = booths.getItem(id);
        if (item && item.type === 'booth' && item.label) { item.label = ''; cleared++; }
      }
      if (cleared > 0) {
        document.getElementById('tool-hint').textContent = `已清除 ${cleared} 个编号`;
        render();
        e.preventDefault();
      }
    }
  }
  // Ctrl+C: copy selected items
  if ((e.metaKey || e.ctrlKey) && e.key === 'c' && booths.selectedIds.size > 0) {
    _clipboard = [...booths.selectedIds].map(id => {
      const item = booths.getItem(id);
      return item ? JSON.parse(JSON.stringify(item)) : null;
    }).filter(Boolean);
    document.getElementById('tool-hint').textContent = `已复制 ${_clipboard.length} 个物体`;
    e.preventDefault();
  }
  // Ctrl+V: paste
  if ((e.metaKey || e.ctrlKey) && e.key === 'v' && _clipboard && _clipboard.length > 0) {
    e.preventDefault();
    // Offset paste position
    const gap = metersPerUnit ? (0.5 / metersPerUnit) : 500;
    booths.selectedIds.clear();
    booths.selectedId = null;
    _clipboard.forEach(src => {
      const newId = booths.nextId++;
      const item = { ...JSON.parse(JSON.stringify(src)), id: newId };
      // Offset position
      if (item.type === 'arrow') {
        item.wx1 += gap; item.wy1 -= gap;
        item.wx2 += gap; item.wy2 -= gap;
      } else if (item.type === 'line' && item.pts) {
        item.pts.forEach(p => { p.wx += gap; p.wy -= gap; });
      } else {
        item.wx += gap; item.wy -= gap;
      }
      booths.items.push(item);
      booths.selectedIds.add(newId);
      booths.selectedId = newId;
    });
    document.getElementById('tool-hint').textContent = `已粘贴 ${_clipboard.length} 个物体`;
    render();
  }
  // R key: rotate selected booth(s) clockwise 15°, L key: counter-clockwise
  if (e.key === 'r' || e.key === 'R' || e.key === 'l' || e.key === 'L') {
    const delta = (e.key === 'r' || e.key === 'R') ? 15 : -15;
    const ids = booths.selectedIds.size > 0 ? booths.selectedIds : (booths.selectedId ? new Set([booths.selectedId]) : new Set());
    const items = [...ids].map(id => booths.getItem(id)).filter(i => i && i.type === 'booth');
    if (items.length === 1) {
      // Single: rotate in place
      items[0].angle = (((items[0].angle || 0) + delta) % 360 + 360) % 360;
    } else if (items.length > 1) {
      // Multi: rotate all around group center
      const rad = delta * Math.PI / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      // Compute group center
      let gcx = 0, gcy = 0;
      items.forEach(it => { gcx += it.wx + it.ww / 2; gcy += it.wy + it.wh / 2; });
      gcx /= items.length; gcy /= items.length;
      items.forEach(it => {
        const cx = it.wx + it.ww / 2 - gcx;
        const cy = it.wy + it.wh / 2 - gcy;
        const nx = cx * cos - cy * sin;
        const ny = cx * sin + cy * cos;
        it.wx = gcx + nx - it.ww / 2;
        it.wy = gcy + ny - it.wh / 2;
        it.angle = (((it.angle || 0) + delta) % 360 + 360) % 360;
      });
    }
    if (items.length > 0) render();
  }
  // Ctrl+Z: undo last eraser stroke batch
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && eraserMarks.length > 0) {
    // Remove marks from the last stroke (find last gap or remove last ~20)
    const removeCount = Math.min(20, eraserMarks.length);
    eraserMarks.splice(-removeCount);
    render();
  }
});

// ── PROPERTIES PANEL ─────────────────────────────────────────────────────────
function showProps(item) {
  const panel = document.getElementById('prop-panel');
  const content = document.getElementById('prop-content');
  panel.style.display = 'block';

  const CAT_OPTS = Object.keys(booths.CAT_COLORS).map(c =>
    `<option value="${c}" ${c === item.cat ? 'selected' : ''}>${c}</option>`
  ).join('');

  if (item.type === 'booth') {
    const sizes = ['2x2','2x4','3x3','1x1'];
    const sizeOpts = sizes.map(s => `<option value="${s}" ${s === item.size ? 'selected' : ''}>${s}m</option>`).join('');
    content.innerHTML = `
      <div class="prop-row"><label>摊位类型</label>
        <select onchange="updateItem(${item.id},'cat',this.value)">${CAT_OPTS}</select>
      </div>
      <div class="prop-row"><label>帐篷尺寸</label>
        <select onchange="resizeBooth(${item.id},this.value)">${sizeOpts}</select>
      </div>
      <div class="prop-row"><label>旋转角度</label>
        <div style="display:flex;align-items:center;gap:6px">
          <input type="range" min="0" max="360" step="15" value="${item.angle || 0}" style="flex:1"
            oninput="updateItem(${item.id},'angle',+this.value);this.nextElementSibling.textContent=this.value+'°'">
          <span style="font-size:12px;min-width:30px">${item.angle || 0}°</span>
        </div>
      </div>
      ${metersPerUnit ? `<div style="font-size:11px;color:var(--text3);margin-bottom:6px">
        实际尺寸：${item.ww ? (item.ww * metersPerUnit).toFixed(1) : '—'} × ${item.wh ? (item.wh * metersPerUnit).toFixed(1) : '—'} m
      </div>` : ''}
      <div class="prop-row"><label>标注</label>
        <textarea rows="2" onchange="updateItem(${item.id},'label',this.value)">${item.label || ''}</textarea>
      </div>
      <button class="del-btn" onclick="deleteItemAndRender(${item.id})">删除</button>`;

  } else if (item.type === 'zone') {
    const fs = item.fontSize || 14;
    content.innerHTML = `
      <div class="prop-row"><label>文字内容</label>
        <input value="${item.label}" onchange="updateItem(${item.id},'label',this.value)">
      </div>
      <div class="prop-row"><label>字体大小</label>
        <div style="display:flex;align-items:center;gap:6px">
          <input type="range" min="8" max="60" step="1" value="${fs}" style="flex:1"
            oninput="updateItem(${item.id},'fontSize',+this.value);this.nextElementSibling.textContent=this.value+'px'">
          <span style="font-size:12px;min-width:36px">${fs}px</span>
        </div>
      </div>
      <button class="del-btn" onclick="deleteItemAndRender(${item.id})">删除</button>`;

  } else {
    content.innerHTML = `<button class="del-btn" onclick="deleteItemAndRender(${item.id})">删除</button>`;
  }
}

function hideProps() {
  document.getElementById('prop-panel').style.display = 'none';
}

window.updateItem = function(id, key, val) {
  booths.updateItem(id, { [key]: val });
  const item = booths.getItem(id);
  if (item) showProps(item);
  render();
};

window.resizeBooth = function(id, size) {
  const item = booths.getItem(id);
  if (!item) return;
  const [mw, mh] = size.split('x').map(Number);
  const cx = item.wx + item.ww / 2, cy = item.wy + item.wh / 2;
  const ww = metersToDXF(mw), wh = metersToDXF(mh);
  booths.updateItem(id, { size, ww, wh, wx: cx - ww / 2, wy: cy - wh / 2 });
  showProps(booths.getItem(id));
  render();
};

window.deleteItemAndRender = function(id) {
  booths.deleteItem(id);
  hideProps();
  render();
};

// ── STATS ─────────────────────────────────────────────────────────────────────
function updateStats() {
  const s = booths.getStats();
  const el = document.getElementById('stats-content');
  if (s.total === 0 && s.guards === 0 && s.fires === 0) {
    el.innerHTML = '<div class="stat-row" style="color:var(--text3);font-style:italic">暂无标注</div>';
    return;
  }
  const CAT_COLORS = booths.CAT_COLORS;
  let html = `<div class="stat-row"><span>总摊位</span><span class="num">${s.total}</span></div>`;
  Object.entries(s.counts).forEach(([cat, n]) => {
    const color = CAT_COLORS[cat]?.fill || '#888';
    html += `<div class="stat-row"><span style="color:${color}">${cat}</span><span class="num" style="color:${color}">${n}</span></div>`;
  });
  html += `<div class="stat-row" style="margin-top:4px"><span>安保点</span><span class="num">${s.guards}</span></div>`;
  html += `<div class="stat-row"><span>灭火器</span><span class="num">${s.fires}</span></div>`;
  el.innerHTML = html;
}

// ── STATUS BAR ───────────────────────────────────────────────────────────────
function updateStatusBar() {
  const s = renderer.scale;
  const label = s >= 1 ? s.toFixed(1) : s >= 0.01 ? s.toFixed(3) : s.toExponential(1);
  document.getElementById('zoom-info').textContent = `缩放 ${label}x`;
}

// ── EXPORT ───────────────────────────────────────────────────────────────────
function exportPNG() {
  // Render clean (no selection highlights)
  const prevSel = booths.selectedId;
  const prevSelIds = new Set(booths.selectedIds);
  booths.selectedId = null;
  booths.selectedIds.clear();
  render();

  // Build legend
  const stats = booths.getStats();
  const cats = Object.entries(stats.counts);
  const legendW = cats.length > 0 ? 280 : 0;

  // Create export canvas with legend panel on right
  const srcW = canvas.width, srcH = canvas.height;
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = srcW + legendW;
  exportCanvas.height = srcH;
  const ectx = exportCanvas.getContext('2d');

  // Fill background
  ectx.fillStyle = darkMode ? '#1e1e1e' : '#ffffff';
  ectx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

  // Draw main canvas
  ectx.drawImage(canvas, 0, 0);

  // Draw legend
  if (cats.length > 0) {
    _drawExportLegend(ectx, srcW + 20, 16, legendW - 40, stats, cats);
  }

  const link = document.createElement('a');
  link.download = `NEEDFLEA_booth_plan_${new Date().toISOString().slice(0,10)}.png`;
  link.href = exportCanvas.toDataURL('image/png');
  link.click();

  booths.selectedId = prevSel;
  booths.selectedIds = prevSelIds;
  render();
}

function exportDXF() {
  const dxfStr = booths.toDXF(renderer.dxfData);
  const blob = new Blob([dxfStr], { type: 'application/dxf' });
  const link = document.createElement('a');
  link.download = `NEEDFLEA_booth_plan_${new Date().toISOString().slice(0,10)}.dxf`;
  link.href = URL.createObjectURL(blob);
  link.click();
}

function clearAnnotations() {
  if (booths.items.length === 0 && eraserMarks.length === 0) return;
  if (confirm('清空所有摊位标注和橡皮擦？CAD底图不受影响。')) {
    booths.clearAll();
    eraserMarks = [];
    hideProps();
    render();
  }
}

// ── SAVE / LOAD PROJECT ───────────────────────────────────────────────────────
function saveProject() {
  const data = {
    version: 2,
    cadFile: _cadFileData,
    categories: booths.CAT_COLORS,
    items: booths.items,
    nextId: booths.nextId,
    eraserMarks,
    metersPerUnit,
    darkMode,
    layerVisibility: _dwgLayerVisibility,
    viewport: { offsetX: renderer.offsetX, offsetY: renderer.offsetY, scale: renderer.scale },
  };
  const json = JSON.stringify(data);
  const blob = new Blob([json], { type: 'application/json' });
  const link = document.createElement('a');
  link.download = `NEEDFLEA_project_${new Date().toISOString().slice(0,10)}.json`;
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
  document.getElementById('tool-hint').textContent = '项目已保存';
}

function loadProject(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.version || !data.items) { alert('无效的项目文件'); return; }

      document.getElementById('tool-hint').textContent = '正在载入项目…';

      // Restore CAD file first (if included)
      if (data.cadFile && data.cadFile.base64) {
        _cadFileData = data.cadFile;
        const binary = atob(data.cadFile.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const ext = (data.cadFile.name || '').split('.').pop().toLowerCase();

        if (ext === 'dwg') {
          // Parse DWG: try libdxfrw first, then ODA fallback
          const ab = bytes.buffer;
          let dwgLoaded = false;
          try {
            const result = await parseDWGtoSVG(ab);
            if (result.metersPerUnit) metersPerUnit = result.metersPerUnit;
            const blob = new Blob([result.svgString], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            await new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = () => { URL.revokeObjectURL(url); renderer.loadSvgBackground(img, result.bounds); resolve(); };
              img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG fail')); };
              img.src = url;
            });
            dwgLoaded = true;
          } catch (e) {
            console.warn('Project DWG libdxfrw failed:', e);
          }
          if (!dwgLoaded) {
            try {
              const dxfText = await convertDWGtoDXF(ab, data.cadFile.name);
              const dxfData = parser.parse(dxfText);
              renderer.load(dxfData);
              dwgLoaded = true;
            } catch (e2) {
              console.warn('Project DWG ODA failed:', e2);
              alert('底图 DWG 加载失败，标注数据已恢复。\n请手动重新导入 CAD 文件。');
            }
          }
          if (dwgLoaded) {
            dxfLoaded = true;
            document.getElementById('welcome').classList.add('hidden');
            document.getElementById('btn-calib').disabled = false;
          }
        } else {
          // Parse DXF
          const content = new TextDecoder().decode(bytes);
          const dxfData = parser.parse(content);
          renderer.load(dxfData);
          dxfLoaded = true;
          document.getElementById('welcome').classList.add('hidden');
          document.getElementById('btn-calib').disabled = false;
        }
      }

      // Restore categories
      if (data.categories) {
        booths.CAT_COLORS = data.categories;
        renderLegend();
      }
      // Restore annotations
      booths.items = data.items || [];
      booths.nextId = data.nextId || (booths.items.length ? Math.max(...booths.items.map(i => i.id)) + 1 : 1);
      booths.selectedId = null;
      booths.selectedIds = new Set();
      eraserMarks = data.eraserMarks || [];
      if (data.metersPerUnit) { metersPerUnit = data.metersPerUnit; updateScaleInfo(); }
      if (typeof data.darkMode === 'boolean' && data.darkMode !== darkMode) toggleTheme();

      // Restore layer visibility (after CAD is loaded)
      if (data.layerVisibility && Object.keys(_dwgLayerVisibility).length > 0) {
        for (const [name, vis] of Object.entries(data.layerVisibility)) {
          if (_dwgLayerVisibility.hasOwnProperty(name)) _dwgLayerVisibility[name] = vis;
        }
        populateLayerPanel();
        _regenerateSvgBackground();
      }

      // Restore viewport
      if (data.viewport) {
        renderer.offsetX = data.viewport.offsetX;
        renderer.offsetY = data.viewport.offsetY;
        renderer.scale = data.viewport.scale;
      }
      hideProps();
      render();
      document.getElementById('tool-hint').textContent = `项目已载入：${booths.items.length} 个标注`;
    } catch (err) {
      alert('项目文件读取失败：' + err.message);
      console.error(err);
    }
  };
  reader.readAsText(file);
  input.value = '';
}
window.saveProject = saveProject;
window.loadProject = loadProject;

// ── BATCH NUMBERING ──────────────────────────────────────────────────────────
let _batchItems = []; // booths to number

function batchNumber() {
  // Collect target booths:
  // If user multi-selected (shift+click, >1), use only those
  // If single selected, use all booths of that category
  // If nothing selected, use all booths of active category
  let items = [];
  if (booths.selectedIds.size > 1) {
    items = [...booths.selectedIds].map(id => booths.getItem(id)).filter(i => i && i.type === 'booth');
  } else {
    // Find category: from selected booth or active picker
    let cat = activeCat;
    if (booths.selectedId) {
      const sel = booths.getItem(booths.selectedId);
      if (sel && sel.type === 'booth') cat = sel.cat;
    }
    items = booths.items.filter(i => i.type === 'booth' && i.cat === cat);
  }
  if (items.length < 1) {
    alert('请先放置或选择帐篷');
    return;
  }

  // Snake-order sorting: top-to-bottom rows, alternating left-right direction
  // 1. Compute center Y for each item
  const centers = items.map(item => ({
    item,
    cx: item.wx + item.ww / 2,
    cy: item.wy + item.wh / 2
  }));

  // 2. Cluster into rows by Y position
  const avgShortSide = items.reduce((s, i) => s + Math.min(i.ww, i.wh), 0) / items.length;
  const rowThreshold = avgShortSide * 0.7;
  centers.sort((a, b) => a.cy - b.cy);

  const rows = [];
  let currentRow = [centers[0]];
  for (let i = 1; i < centers.length; i++) {
    // Compare to running average Y of current row
    const rowAvgY = currentRow.reduce((s, c) => s + c.cy, 0) / currentRow.length;
    if (Math.abs(centers[i].cy - rowAvgY) < rowThreshold) {
      currentRow.push(centers[i]);
    } else {
      rows.push(currentRow);
      currentRow = [centers[i]];
    }
  }
  rows.push(currentRow);

  // 3. Reverse rows so numbering starts from top
  rows.reverse();

  // 4. Sort each row by X, alternating direction (snake/boustrophedon)
  items = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    row.sort((a, b) => a.cx - b.cx);
    if (r % 2 === 1) row.reverse();
    for (const c of row) items.push(c.item);
  }

  _batchItems = items;

  // Populate letter dropdown
  const sel = document.getElementById('batch-letter');
  sel.innerHTML = '';
  for (let c = 65; c <= 90; c++) {
    sel.innerHTML += `<option value="${String.fromCharCode(c)}">${String.fromCharCode(c)}</option>`;
  }

  // Info & preview
  const catName = items[0].cat;
  document.getElementById('batch-info').textContent = `将为 ${items.length} 个「${catName}」帐篷编号`;
  _updateBatchPreview();

  // Show dialog
  const overlay = document.getElementById('batch-overlay');
  overlay.style.display = 'flex';

  // Update preview on input change
  document.getElementById('batch-letter').onchange = _updateBatchPreview;
  document.getElementById('batch-start').oninput = _updateBatchPreview;
}

function _updateBatchPreview() {
  const letter = document.getElementById('batch-letter').value;
  const start = parseInt(document.getElementById('batch-start').value) || 1;
  const n = _batchItems.length;
  const first = letter + start;
  const last = letter + (start + n - 1);
  document.getElementById('batch-preview').textContent = `预览: ${first}, ${letter}${start+1}, ... ${last}（共 ${n} 个）`;
}

function cancelBatchNumber() {
  document.getElementById('batch-overlay').style.display = 'none';
  _batchItems = [];
}

function confirmBatchNumber() {
  const letter = document.getElementById('batch-letter').value;
  const start = parseInt(document.getElementById('batch-start').value) || 1;
  _batchItems.forEach((item, i) => {
    item.label = letter + (start + i);
  });
  document.getElementById('batch-overlay').style.display = 'none';
  _batchItems = [];
  render();
  document.getElementById('tool-hint').textContent = '批量编号已完成';
}

function clearBatchNumber() {
  if (_batchItems.length === 0) return;
  const catName = _batchItems[0].cat;
  _batchItems.forEach(item => { item.label = ''; });
  document.getElementById('batch-overlay').style.display = 'none';
  _batchItems = [];
  render();
  document.getElementById('tool-hint').textContent = `已清除「${catName}」的编号`;
}

window.batchNumber = batchNumber;
window.cancelBatchNumber = cancelBatchNumber;
window.confirmBatchNumber = confirmBatchNumber;
window.clearBatchNumber = clearBatchNumber;

// ── LEGEND / CATEGORY MANAGEMENT ─────────────────────────────────────────────
function renderLegend() {
  const container = document.getElementById('legend-list');
  if (!container) return;
  let html = '';
  for (const [cat, col] of Object.entries(booths.CAT_COLORS)) {
    html += `<div class="legend-item" style="cursor:pointer;" ondblclick="renameCategory('${cat.replace(/'/g, "\\'")}')">
      <div class="legend-dot" style="background:${col.fill}"></div>
      <span>${cat}</span>
    </div>\n`;
  }
  container.innerHTML = html;
  // Also update toolbar cat picker
  _updateCatPicker();
}

function _updateCatPicker() {
  const picker = document.getElementById('cat-picker');
  if (!picker) return;
  let html = '';
  for (const [cat, col] of Object.entries(booths.CAT_COLORS)) {
    const isActive = cat === activeCat;
    html += `<div class="cat-dot${isActive ? ' active' : ''}" style="background:${col.fill}" data-cat="${cat}" title="${cat}" onclick="selectCat(this)"></div>`;
  }
  picker.innerHTML = html;
}

function addCategory() {
  const name = prompt('新类型名称', '');
  if (!name || !name.trim()) return;
  if (booths.CAT_COLORS[name.trim()]) { alert('该类型已存在'); return; }
  const hex = document.getElementById('new-cat-color').value;
  // Darken for stroke
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  const stroke = '#' + Math.round(r*0.7).toString(16).padStart(2,'0') + Math.round(g*0.7).toString(16).padStart(2,'0') + Math.round(b*0.7).toString(16).padStart(2,'0');
  booths.CAT_COLORS[name.trim()] = { fill: hex, stroke };
  activeCat = name.trim();
  renderLegend();
  render();
}

function renameCategory(oldName) {
  const newName = prompt('修改类型名称', oldName);
  if (!newName || !newName.trim() || newName.trim() === oldName) return;
  const trimmed = newName.trim();
  // Update CAT_COLORS
  const col = booths.CAT_COLORS[oldName];
  if (!col) return;
  delete booths.CAT_COLORS[oldName];
  booths.CAT_COLORS[trimmed] = col;
  // Update all booths with this category
  booths.items.forEach(item => {
    if (item.type === 'booth' && item.cat === oldName) item.cat = trimmed;
  });
  if (activeCat === oldName) activeCat = trimmed;
  renderLegend();
  render();
}

window.addCategory = addCategory;
window.renameCategory = renameCategory;

// ── AUTO-SAVE (localStorage) ─────────────────────────────────────────────────
function _autoSave() {
  try {
    const data = {
      categories: booths.CAT_COLORS,
      items: booths.items,
      nextId: booths.nextId,
      eraserMarks,
      metersPerUnit,
      darkMode,
    };
    localStorage.setItem('needflea_autosave', JSON.stringify(data));
  } catch(e) {}
}

function _autoRestore() {
  try {
    const raw = localStorage.getItem('needflea_autosave');
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.items && data.items.length > 0) {
      if (data.categories) { booths.CAT_COLORS = data.categories; renderLegend(); }
      booths.items = data.items;
      booths.nextId = data.nextId || 1;
      eraserMarks = data.eraserMarks || [];
      if (data.metersPerUnit) { metersPerUnit = data.metersPerUnit; updateScaleInfo(); }
      if (typeof data.darkMode === 'boolean' && data.darkMode !== darkMode) toggleTheme();
      render();
      document.getElementById('tool-hint').textContent = `已恢复上次标注（${booths.items.length} 个）`;
    }
  } catch(e) {}
}

// Auto-save every 30 seconds
setInterval(_autoSave, 30000);

// ── GLOBAL EXPORTS ────────────────────────────────────────────────────────────
window.loadDXF = loadDXF;

window.downloadConvertedDXF = function() {
  if (!_convertedDxfText) { alert('没有可下载的 DXF 文件（仅 DWG→DXF 转换后可用）'); return; }
  const blob = new Blob([_convertedDxfText], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = _convertedDxfName || 'converted.dxf';
  a.click();
  URL.revokeObjectURL(url);
};
window.loadCADFile = loadCADFile;
window.setTool = setTool;
window.selectCat = selectCat;
window.startCalib = startCalib;
window.cancelCalib = cancelCalib;
window.confirmCalib = confirmCalib;
window.exportPNG = exportPNG;
window.exportDXF = exportDXF;
window.clearAnnotations = clearAnnotations;
window.toggleLayer = toggleLayer;
window.toggleLayerByIdx = toggleLayerByIdx;
window.setAllLayersVisible = setAllLayersVisible;

// ── INIT ─────────────────────────────────────────────────────────────────────
resize();
setTool('select');
renderLegend();
_autoRestore();

