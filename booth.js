/**
 * booth.js
 * Annotation system for NEED!FLEA booth planner
 * Manages booths, guards, arrows, zones on top of DXF layer
 */

class BoothSystem {
  constructor() {
    this.items = [];
    this.nextId = 1;
    this.autoNum = {};
    this.selectedId = null;      // primary selection (for props panel)
    this.selectedIds = new Set(); // multi-selection

    this.CAT_COLORS = {
      '二手':     { fill: '#5B8FE8', stroke: '#3a6ec4' },
      'HAOCHI':   { fill: '#4BC98A', stroke: '#2ea86c' },
      'VINTAGE':  { fill: '#F07A4A', stroke: '#d05530' },
      '原创设计': { fill: '#E85FA3', stroke: '#c0387e' },
      'WORKSHOP': { fill: '#F5C842', stroke: '#c9970a' },
      '其他':     { fill: '#9B7FD4', stroke: '#7055b0' },
    };
  }

  // Never-null color lookup — a booth's cat may not exist in CAT_COLORS
  // (e.g. after loading a project with a different category set).
  catColor(cat) {
    return this.CAT_COLORS[cat] || this.CAT_COLORS['其他'] || { fill: '#9B7FD4', stroke: '#7055b0' };
  }

  // ── CRUD ──────────────────────────────────────────────────
  addBooth(worldX, worldY, cat, size) {
    const [w, h] = this._sizeToWorld(size);
    const item = {
      id: this.nextId++, type: 'booth',
      cat, size,
      wx: worldX - w / 2,  // top-left in world coords
      wy: worldY - h / 2,
      ww: w, wh: h,
      label: '', angle: 0,
      boothStyle: 'tent',  // 'tent' = 帐篷, 'table' = 空地+桌椅
      sizeClass: 'standard' // 迷你/标准/特大 — semantic label only, no effect on dimensions
    };
    this.items.push(item);
    return item;
  }

  // ── OVERLAP DETECTION ──────────────────────────────────────
  // Get the four corners of a booth in world coords (respecting rotation)
  _boothCorners(item) {
    const cx = item.wx + item.ww / 2, cy = item.wy + item.wh / 2;
    const hw = item.ww / 2, hh = item.wh / 2;
    const a = (item.angle || 0) * Math.PI / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    const corners = [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]];
    return corners.map(([dx,dy]) => ({
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos
    }));
  }

  // Separating Axis Theorem for two convex polygons
  _polygonsOverlap(a, b) {
    const polys = [a, b];
    for (const poly of polys) {
      for (let i = 0; i < poly.length; i++) {
        const j = (i + 1) % poly.length;
        const nx = poly[j].y - poly[i].y, ny = poly[i].x - poly[j].x;
        let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
        for (const p of a) { const d = nx * p.x + ny * p.y; minA = Math.min(minA, d); maxA = Math.max(maxA, d); }
        for (const p of b) { const d = nx * p.x + ny * p.y; minB = Math.min(minB, d); maxB = Math.max(maxB, d); }
        const EPS = 1; // tolerance: 1 DXF unit (~1mm) — touching edges don't count as overlap
        if (maxA <= minB + EPS || maxB <= minA + EPS) return false;
      }
    }
    return true;
  }

  checkOverlap(item) {
    const cornersA = this._boothCorners(item);
    for (const other of this.items) {
      if (other.id === item.id || other.type !== 'booth') continue;
      if (this._polygonsOverlap(cornersA, this._boothCorners(other))) return other;
    }
    return null;
  }

  addGuard(worldX, worldY) {
    const item = { id: this.nextId++, type: 'guard', wx: worldX, wy: worldY };
    this.items.push(item);
    return item;
  }

  addFire(worldX, worldY) {
    const item = { id: this.nextId++, type: 'fire', wx: worldX, wy: worldY };
    this.items.push(item);
    return item;
  }

  addArrow(wx1, wy1, wx2, wy2) {
    const item = { id: this.nextId++, type: 'arrow', wx1, wy1, wx2, wy2 };
    this.items.push(item);
    return item;
  }

  addDim(wx1, wy1, wx2, wy2, label) {
    const item = { id: this.nextId++, type: 'dim', wx1, wy1, wx2, wy2, label };
    this.items.push(item);
    return item;
  }

  addLine(pts, style, closed) {
    const item = { id: this.nextId++, type: 'line', pts, lineStyle: style || 'solid', closed: !!closed };
    this.items.push(item);
    return item;
  }

  addZone(wx, wy, ww, wh, label) {
    const item = { id: this.nextId++, type: 'zone', wx, wy, ww, wh, label };
    this.items.push(item);
    return item;
  }

  deleteItem(id) {
    this.items = this.items.filter(i => i.id !== id);
    if (this.selectedId === id) this.selectedId = null;
    this.selectedIds.delete(id);
  }

  updateItem(id, props) {
    const item = this.items.find(i => i.id === id);
    if (!item) return;
    // Recalc size if changed — but honor explicit ww/wh from caller
    // (app.js converts meters→DXF units, which _sizeToWorld can't do)
    if (props.size && props.size !== item.size && props.ww == null && props.wh == null) {
      const [w, h] = this._sizeToWorld(props.size);
      props.ww = w; props.wh = h;
    }
    Object.assign(item, props);
  }

  getItem(id) { return this.items.find(i => i.id === id); }

  // ── HIT TEST ──────────────────────────────────────────────
  hitTest(worldX, worldY, scale) {
    // scale = renderer.scale (pixels per DXF unit), used for screen-aware tolerance
    const tol = scale ? (8 / scale) : 200; // 8 screen pixels → world units
    // Reverse order so top items get selected first
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      if (this._hit(item, worldX, worldY, tol)) return item;
    }
    return null;
  }

  _hit(item, wx, wy, TOL) {
    if (item.type === 'booth') {
      // Transform click point into booth's local coords (undo rotation)
      const cx = item.wx + item.ww / 2, cy = item.wy + item.wh / 2;
      const a = -(item.angle || 0) * Math.PI / 180;
      const cos = Math.cos(a), sin = Math.sin(a);
      const dx = wx - cx, dy = wy - cy;
      const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
      return lx >= -item.ww/2 - TOL && lx <= item.ww/2 + TOL &&
             ly >= -item.wh/2 - TOL && ly <= item.wh/2 + TOL;
    }
    if (item.type === 'guard' || item.type === 'fire') {
      return Math.hypot(wx - item.wx, wy - item.wy) < TOL * 3;
    }
    if (item.type === 'arrow') {
      return this._ptLineDistSq(wx, wy, item.wx1, item.wy1, item.wx2, item.wy2) < TOL * TOL;
    }
    if (item.type === 'zone') {
      return Math.hypot(wx - item.wx, wy - item.wy) < TOL * 3;
    }
    if (item.type === 'dim') {
      return this._ptLineDistSq(wx, wy, item.wx1, item.wy1, item.wx2, item.wy2) < TOL * TOL;
    }
    if (item.type === 'line' && item.pts && item.pts.length >= 2) {
      for (let i = 0; i < item.pts.length - 1; i++) {
        if (this._ptLineDistSq(wx, wy, item.pts[i].wx, item.pts[i].wy, item.pts[i+1].wx, item.pts[i+1].wy) < TOL * TOL) return true;
      }
      if (item.closed && item.pts.length >= 3) {
        const last = item.pts.length - 1;
        if (this._ptLineDistSq(wx, wy, item.pts[last].wx, item.pts[last].wy, item.pts[0].wx, item.pts[0].wy) < TOL * TOL) return true;
      }
      return false;
    }
    return false;
  }

  _ptLineDistSq(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return (px - x1) ** 2 + (py - y1) ** 2;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    return (px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2;
  }

  // ── DRAW ──────────────────────────────────────────────────
  draw(ctx, renderer) {
    this.items.forEach(item => this._drawItem(ctx, renderer, item));
  }

  // ── ZONE PLAN (区域规划图) ─────────────────────────────────
  // Merge each category's booths into one contiguous region so the exact
  // booth count is obscured, while real size/orientation/angle are preserved.
  // Non-booth annotations (guards/arrows/text/lines/dims) draw normally on top.
  drawZonePlan(ctx, R) {
    this._drawZoneRegions(ctx, R);
    this.items.forEach(item => {
      if (item.type !== 'booth') this._drawItem(ctx, R, item);
    });
  }

  _drawZoneRegions(ctx, R) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const byCat = {};
    this.items.forEach(b => {
      if (b.type === 'booth') (byCat[b.cat] = byCat[b.cat] || []).push(b);
    });
    // Merge ALONG WIDTH ONLY, and only toward an actual same-category neighbour
    // in the same row. A width-end with no neighbour (row end) isn't expanded,
    // and the depth axis is never grown — so the region stays at the true
    // footprint toward the aisle and the rear split between two rows shows.
    const borderPx = 1.5; // hairline outline

    for (const cat in byCat) {
      const items = byCat[cat];
      const col = this.catColor(cat);
      const exp = this._computeWidthExpansions(items); // Map<item, {l,r}> in world units
      const maskFill = this._zoneMask(R, items, exp, 0, W, H);
      const fillC = this._recolorMask(maskFill, col.fill, W, H);
      // Thin outer ring = (region + borderPx) minus the region
      const ringC = this._recolorMask(this._zoneMask(R, items, exp, borderPx, W, H), col.stroke, W, H);
      const rc = ringC.getContext('2d');
      rc.globalCompositeOperation = 'destination-out';
      rc.drawImage(maskFill, 0, 0);

      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.drawImage(fillC, 0, 0);
      ctx.globalAlpha = 0.9;
      ctx.drawImage(ringC, 0, 0);
      ctx.restore();
    }
  }

  // For each booth, how far to stretch each end of its WIDTH axis so it just
  // reaches a same-row same-category neighbour (0 = no neighbour on that side).
  _computeWidthExpansions(items) {
    const mppu = (typeof metersPerUnit !== 'undefined' && metersPerUnit) ? metersPerUnit : null;
    const m2w = m => mppu ? m / mppu : m * 10;
    const maxBridge = m2w(1.2); // only bridge gaps up to ~1.2m
    const overlap = m2w(0.15);  // small overlap so neighbours fuse seamlessly
    const maxExpand = m2w(0.8);
    const rowPerpFrac = 0.5;    // neighbour must sit within ~half a depth (same row)

    const g = items.map(b => {
      const a = (b.angle || 0) * Math.PI / 180;
      return {
        b,
        cx: b.wx + b.ww / 2, cy: b.wy + b.wh / 2,
        ux: Math.cos(a), uy: Math.sin(a),  // width axis (world)
        vx: -Math.sin(a), vy: Math.cos(a), // depth axis (world)
        hw: b.ww / 2, hh: b.wh / 2
      };
    });

    const result = new Map();
    for (let i = 0; i < g.length; i++) {
      const bi = g[i];
      let bestL = null, bestR = null; // nearest edge gap on each width end
      for (let j = 0; j < g.length; j++) {
        if (i === j) continue;
        const bj = g[j];
        const dx = bj.cx - bi.cx, dy = bj.cy - bi.cy;
        const along = dx * bi.ux + dy * bi.uy;
        const perp = dx * bi.vx + dy * bi.vy;
        // j's footprint projected onto i's axes
        const jAlong = Math.abs(bj.hw * (bj.ux * bi.ux + bj.uy * bi.uy)) + Math.abs(bj.hh * (bj.vx * bi.ux + bj.vy * bi.uy));
        const jPerp = Math.abs(bj.hw * (bj.ux * bi.vx + bj.uy * bi.vy)) + Math.abs(bj.hh * (bj.vx * bi.vx + bj.vy * bi.vy));
        // must be in the same row (depth-aligned), not the row in front/behind
        if (Math.abs(perp) > (bi.hh + jPerp) * rowPerpFrac) continue;
        const gap = Math.abs(along) - bi.hw - jAlong;
        if (gap > maxBridge) continue;
        if (along >= 0) { if (bestR === null || gap < bestR) bestR = gap; }
        else { if (bestL === null || gap < bestL) bestL = gap; }
      }
      const amt = s => s === null ? 0 : (s <= 0 ? overlap : Math.min(maxExpand, s / 2 + overlap));
      result.set(bi.b, { l: amt(bestL), r: amt(bestR) });
    }
    return result;
  }

  // Black silhouette of a category's booths, each stretched along its width per
  // `exp` (Map<item,{l,r}> in world units). `fattenPx` (border only) grows the
  // edge uniformly by that small amount.
  _zoneMask(R, items, exp, fattenPx, W, H) {
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const o = off.getContext('2d');
    o.fillStyle = '#000'; o.strokeStyle = '#000';
    o.lineJoin = 'miter';
    // One combined path filled once → no per-rectangle anti-alias seams,
    // so width-overlapping booths in a row merge into a single clean strip.
    o.beginPath();
    items.forEach(b => this._addBoothSubpath(o, R, b, exp.get(b)));
    o.fill();
    if (fattenPx > 0) {
      o.lineWidth = fattenPx * 2;
      o.beginPath();
      items.forEach(b => this._addBoothSubpath(o, R, b, exp.get(b)));
      o.stroke();
    }
    return off;
  }

  _recolorMask(mask, color, W, H) {
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const o = off.getContext('2d');
    o.drawImage(mask, 0, 0);
    o.globalCompositeOperation = 'source-in';
    o.fillStyle = color;
    o.fillRect(0, 0, W, H);
    return off;
  }

  // Add a booth's rotated rectangle as a subpath of the current path (no
  // beginPath) so a whole category fills in one pass. The rect is stretched
  // along its local WIDTH (ww) axis by `exp.l`/`exp.r` (world units) toward
  // each neighbour; the DEPTH (wh) axis is left exact so the region never grows
  // toward the aisle.
  _addBoothSubpath(o, R, item, exp) {
    const lPx = (exp ? exp.l : 0) * R.scale;
    const rPx = (exp ? exp.r : 0) * R.scale;
    const cx = R.wx(item.wx + item.ww / 2), cy = R.wy(item.wy + item.wh / 2);
    const sw = item.ww * R.scale, sh = item.wh * R.scale;
    const a = (item.angle || 0) * Math.PI / 180;
    o.save();
    o.translate(cx, cy);
    o.rotate(-a); // screen Y is flipped
    o.rect(-sw / 2 - lPx, -sh / 2, sw + lPx + rPx, sh);
    o.restore();
  }

  _drawItem(ctx, R, item) {
    const sel = item.id === this.selectedId || this.selectedIds.has(item.id);

    if (item.type === 'booth') {
      const cx = R.wx(item.wx + item.ww / 2);
      const cy = R.wy(item.wy + item.wh / 2);
      const sw = item.ww * R.scale, sh = item.wh * R.scale;
      const col = this.catColor(item.cat);
      const angle = (item.angle || 0) * Math.PI / 180;
      const hasOverlap = this.checkOverlap(item);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-angle); // screen Y is flipped

      const bStyle = item.boothStyle || 'tent';
      const isComposite = bStyle === 'tent-yard' || bStyle === 'canopy-yard';
      const isTable = bStyle === 'table';

      if (sel) { ctx.shadowColor = col.fill + '99'; ctx.shadowBlur = 10; }

      // Draw one base style (tent/canopy/table) into a local-space rect.
      const drawShape = (baseStyle, x, y, w, h) => {
        if (baseStyle === 'table') {
          // 空地: light fill + dashed border + diagonal hatching
          ctx.fillStyle = hasOverlap ? '#FF444430' : col.fill + '30';
          ctx.strokeStyle = hasOverlap ? '#CC0000' : col.stroke;
          ctx.lineWidth = sel ? 2.5 : 1.2;
          ctx.setLineDash([6, 4]);
          this._roundRect(ctx, x, y, w, h, 3);
          ctx.fill(); ctx.stroke();
          ctx.setLineDash([]);
          // Diagonal lines
          ctx.save();
          ctx.beginPath();
          this._roundRect(ctx, x, y, w, h, 3);
          ctx.clip();
          ctx.strokeStyle = hasOverlap ? '#CC000040' : col.fill + '50';
          ctx.lineWidth = 1;
          const step = Math.max(6, Math.min(12, w * 0.12));
          for (let d = -w - h; d < w + h; d += step) {
            ctx.beginPath();
            ctx.moveTo(x + d, y);
            ctx.lineTo(x + d + h, y + h);
            ctx.stroke();
          }
          ctx.restore();
        } else if (baseStyle === 'canopy') {
          // 四角帐篷: lighter fill with X cross lines
          ctx.fillStyle = hasOverlap ? '#FF444480' : col.fill + '70';
          ctx.strokeStyle = hasOverlap ? '#CC0000' : col.stroke;
          ctx.lineWidth = sel ? 2.5 : 1.2;
          this._roundRect(ctx, x, y, w, h, 3);
          ctx.fill(); ctx.stroke();
          // X cross to indicate canopy
          ctx.strokeStyle = hasOverlap ? '#CC000060' : 'rgba(255,255,255,0.35)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, y); ctx.lineTo(x + w, y + h);
          ctx.moveTo(x + w, y); ctx.lineTo(x, y + h);
          ctx.stroke();
        } else {
          // 盘扣架帐篷: solid fill
          ctx.fillStyle = hasOverlap ? '#FF4444' : col.fill;
          ctx.strokeStyle = hasOverlap ? '#CC0000' : col.stroke;
          ctx.lineWidth = sel ? 2.5 : 1.2;
          this._roundRect(ctx, x, y, w, h, 3);
          ctx.fill(); ctx.stroke();
        }
      };

      if (isComposite) {
        // Whole footprint = 空地, with a 2×2m booth pinned to one corner.
        // tentCorner is stored in booth-local, Y-up (DXF) coords; screen Y is
        // flipped, so sy>0 (up) draws at the top (-sh/2).
        const [mw, mh] = (item.size || '2x2').split('x').map(Number);
        const tw = Math.min(sw, sw * (2 / mw));
        const th = Math.min(sh, sh * (2 / mh));
        const tc = item.tentCorner || { sx: -1, sy: 1 };
        const tx = tc.sx < 0 ? -sw/2 : sw/2 - tw;
        const ty = tc.sy > 0 ? -sh/2 : sh/2 - th;
        drawShape('table', -sw/2, -sh/2, sw, sh);
        drawShape(bStyle === 'canopy-yard' ? 'canopy' : 'tent', tx, ty, tw, th);
      } else {
        drawShape(bStyle, -sw/2, -sh/2, sw, sh);
      }
      ctx.shadowBlur = 0;

      // Label (only if user set one) — always upright
      if (item.label) {
        ctx.save();
        ctx.rotate(angle); // counter-rotate so text stays upright
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Shrink font until label fits within booth width
        const maxW = sw * 0.92;
        const minSize = 6;
        let fontSize = Math.max(minSize, Math.min(sw * 0.36, sh * 0.4, 16));
        ctx.font = `bold ${fontSize}px 'PingFang SC', sans-serif`;
        let tw = ctx.measureText(item.label).width;
        while (tw > maxW && fontSize > minSize) {
          fontSize -= 0.5;
          ctx.font = `bold ${fontSize}px 'PingFang SC', sans-serif`;
          tw = ctx.measureText(item.label).width;
        }

        {
          const pad = Math.max(1, fontSize * 0.15);
          const pillW = tw + pad * 2, pillH = fontSize + pad * 2;
          ctx.fillStyle = 'rgba(255,255,255,0.82)';
          ctx.beginPath();
          ctx.roundRect(-pillW/2, -pillH/2, pillW, pillH, 2);
          ctx.fill();
          ctx.fillStyle = hasOverlap ? '#CC0000' : (isTable ? col.stroke : '#1a1a1a');
          ctx.fillText(item.label, 0, 0);
        }
        ctx.restore();
      }

      // Selection indicator
      if (sel) {
        ctx.strokeStyle = col.stroke;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(-sw/2 - 3, -sh/2 - 3, sw + 6, sh + 6);
        ctx.setLineDash([]);
        // Corner dots for rotation
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = col.stroke;
        ctx.lineWidth = 1;
        [[-1,-1],[1,-1],[1,1],[-1,1]].forEach(([dx,dy]) => {
          ctx.beginPath(); ctx.arc(dx*sw/2, dy*sh/2, 4, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        });
      }
      ctx.restore();

    } else if (item.type === 'guard') {
      const sx = R.wx(item.wx), sy = R.wy(item.wy);
      ctx.save();
      ctx.font = '20px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('👮', sx, sy);
      if (sel) {
        ctx.strokeStyle = '#5B8FE8';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(sx, sy, 16, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();

    } else if (item.type === 'fire') {
      const sx = R.wx(item.wx), sy = R.wy(item.wy);
      ctx.save();
      ctx.font = '20px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🧯', sx, sy);
      if (sel) {
        ctx.strokeStyle = '#E85B5B';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(sx, sy, 16, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();

    } else if (item.type === 'arrow') {
      const sx1 = R.wx(item.wx1), sy1 = R.wy(item.wy1);
      const sx2 = R.wx(item.wx2), sy2 = R.wy(item.wy2);
      const ang = Math.atan2(sy2 - sy1, sx2 - sx1);
      const len = Math.hypot(sx2 - sx1, sy2 - sy1);
      if (len < 5) return;

      ctx.save();
      ctx.strokeStyle = sel ? '#3ab87a' : '#4BC98A';
      ctx.fillStyle = sel ? '#3ab87a' : '#4BC98A';
      ctx.lineWidth = sel ? 3 : 2.5;
      ctx.lineCap = 'round';
      ctx.setLineDash([10, 6]);

      ctx.beginPath(); ctx.moveTo(sx1, sy1); ctx.lineTo(sx2, sy2); ctx.stroke();
      ctx.setLineDash([]);
      // Arrowhead
      const hLen = Math.min(16, len * 0.35);
      ctx.beginPath();
      ctx.moveTo(sx2, sy2);
      ctx.lineTo(sx2 - hLen * Math.cos(ang - 0.4), sy2 - hLen * Math.sin(ang - 0.4));
      ctx.lineTo(sx2 - hLen * Math.cos(ang + 0.4), sy2 - hLen * Math.sin(ang + 0.4));
      ctx.closePath(); ctx.fill();

      if (sel) {
        ctx.strokeStyle = '#4BC98A';
        ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(sx1, sy1, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(sx2, sy2, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();

    } else if (item.type === 'dim') {
      const sx1 = R.wx(item.wx1), sy1 = R.wy(item.wy1);
      const sx2 = R.wx(item.wx2), sy2 = R.wy(item.wy2);
      const isDark = typeof darkMode !== 'undefined' && darkMode;
      const col = sel ? '#FF6B35' : (isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)');
      ctx.save();
      // Dashed line
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(sx1, sy1); ctx.lineTo(sx2, sy2); ctx.stroke();
      ctx.setLineDash([]);
      // Endpoints (perpendicular ticks)
      const ang = Math.atan2(sy2 - sy1, sx2 - sx1);
      const tickLen = 6;
      const px = Math.cos(ang + Math.PI/2) * tickLen, py = Math.sin(ang + Math.PI/2) * tickLen;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sx1 - px, sy1 - py); ctx.lineTo(sx1 + px, sy1 + py); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx2 - px, sy2 - py); ctx.lineTo(sx2 + px, sy2 + py); ctx.stroke();
      // Label
      const mx = (sx1 + sx2) / 2, my = (sy1 + sy2) / 2;
      ctx.font = 'bold 12px "PingFang SC", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      const tw = ctx.measureText(item.label).width + 8;
      ctx.fillStyle = isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.85)';
      ctx.fillRect(mx - tw/2, my - 16, tw, 15);
      ctx.fillStyle = col;
      ctx.fillText(item.label, mx, my - 3);
      ctx.restore();

    } else if (item.type === 'zone') {
      const sx = R.wx(item.wx), sy = R.wy(item.wy);
      const isDark = typeof darkMode !== 'undefined' && darkMode;
      ctx.save();
      const fontSize = item.fontSize || 14;
      ctx.font = `bold ${fontSize}px 'PingFang SC', sans-serif`;
      ctx.fillStyle = isDark ? '#ffffff' : '#1a1a18';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.label, sx, sy);
      if (sel) {
        const tw = ctx.measureText(item.label).width + 8;
        ctx.strokeStyle = '#5B8FE8';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(sx - tw / 2, sy - fontSize / 2 - 2, tw, fontSize + 4);
        ctx.setLineDash([]);
      }
      ctx.restore();

    } else if (item.type === 'line' && item.pts && item.pts.length >= 2) {
      const isDark = typeof darkMode !== 'undefined' && darkMode;
      ctx.save();
      ctx.strokeStyle = sel ? '#5B8FE8' : (isDark ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.7)');
      ctx.lineWidth = sel ? 2.5 : 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (item.lineStyle === 'dashed') ctx.setLineDash([8, 5]);
      ctx.beginPath();
      item.pts.forEach((p, i) => {
        const sx = R.wx(p.wx), sy = R.wy(p.wy);
        i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
      });
      if (item.closed) ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      // Draw vertices when selected
      if (sel) {
        ctx.fillStyle = '#5B8FE8';
        item.pts.forEach(p => {
          ctx.beginPath(); ctx.arc(R.wx(p.wx), R.wy(p.wy), 4, 0, Math.PI * 2); ctx.fill();
        });
      }
      ctx.restore();
    }
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ── STATS ─────────────────────────────────────────────────
  getStats() {
    const booths = this.items.filter(i => i.type === 'booth');
    const counts = {};
    booths.forEach(b => { counts[b.cat] = (counts[b.cat] || 0) + 1; });
    return { total: booths.length, guards: this.items.filter(i => i.type === 'guard').length, fires: this.items.filter(i => i.type === 'fire').length, counts };
  }

  // ── HELPERS ───────────────────────────────────────────────
  _sizeToWorld(sizeStr) {
    if (sizeStr === 'custom') return [3, 3];
    const [w, h] = sizeStr.split('x').map(Number);
    return [w, h];
  }

  _nextNum(cat) {
    this.autoNum[cat] = (this.autoNum[cat] || 0) + 1;
    return this.autoNum[cat];
  }

  clearAll() {
    this.items = []; this.autoNum = {}; this.nextId = 1; this.selectedId = null; this.selectedIds = new Set();
  }

  // ── EXPORT DXF ────────────────────────────────────────────
  toDXF(sourceDXF) {
    let out = '';
    // Header
    out += '  0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n';
    // Entities section
    out += '  0\nSECTION\n  2\nENTITIES\n';

    this.items.forEach(item => {
      if (item.type === 'booth') {
        const col = this._catToACI(item.cat);
        // Draw as LWPOLYLINE rectangle
        const x1 = item.wx, y1 = item.wy;
        const x2 = item.wx + item.ww, y2 = item.wy + item.wh;
        out += `  0\nLWPOLYLINE\n  8\nNEEDFLEA_BOOTHS\n 62\n${col}\n 70\n1\n 90\n4\n`;
        out += ` 10\n${x1.toFixed(4)}\n 20\n${y1.toFixed(4)}\n`;
        out += ` 10\n${x2.toFixed(4)}\n 20\n${y1.toFixed(4)}\n`;
        out += ` 10\n${x2.toFixed(4)}\n 20\n${y2.toFixed(4)}\n`;
        out += ` 10\n${x1.toFixed(4)}\n 20\n${y2.toFixed(4)}\n`;
        // Booth number as TEXT
        out += `  0\nTEXT\n  8\nNEEDFLEA_LABELS\n 62\n${col}\n`;
        out += ` 10\n${(x1 + item.ww/2).toFixed(4)}\n 20\n${(y1 + item.wh/2).toFixed(4)}\n`;
        out += ` 40\n${(Math.min(item.ww, item.wh) * 0.4).toFixed(4)}\n`;
        out += `  1\n${item.num}\n 72\n1\n 73\n2\n`;

      } else if (item.type === 'guard') {
        out += `  0\nTEXT\n  8\nNEEDFLEA_GUARDS\n 62\n1\n`;
        out += ` 10\n${item.wx.toFixed(4)}\n 20\n${item.wy.toFixed(4)}\n 40\n2\n  1\n[安保]\n`;

      } else if (item.type === 'arrow') {
        out += `  0\nLINE\n  8\nNEEDFLEA_ARROWS\n 62\n1\n`;
        out += ` 10\n${item.wx1.toFixed(4)}\n 20\n${item.wy1.toFixed(4)}\n`;
        out += ` 11\n${item.wx2.toFixed(4)}\n 21\n${item.wy2.toFixed(4)}\n`;

      } else if (item.type === 'zone') {
        out += `  0\nLWPOLYLINE\n  8\nNEEDFLEA_ZONES\n 62\n8\n 70\n1\n 90\n4\n`;
        out += ` 10\n${item.wx.toFixed(4)}\n 20\n${item.wy.toFixed(4)}\n`;
        out += ` 10\n${(item.wx+item.ww).toFixed(4)}\n 20\n${item.wy.toFixed(4)}\n`;
        out += ` 10\n${(item.wx+item.ww).toFixed(4)}\n 20\n${(item.wy+item.wh).toFixed(4)}\n`;
        out += ` 10\n${item.wx.toFixed(4)}\n 20\n${(item.wy+item.wh).toFixed(4)}\n`;
        out += `  0\nTEXT\n  8\nNEEDFLEA_ZONES\n 62\n8\n`;
        out += ` 10\n${(item.wx + item.ww/2).toFixed(4)}\n 20\n${(item.wy + item.wh - 1).toFixed(4)}\n 40\n1.5\n  1\n${item.label}\n 72\n1\n`;
      }
    });

    out += '  0\nENDSEC\n  0\nEOF\n';
    return out;
  }

  _catToACI(cat) {
    const map = { '二手': 5, 'HAOCHI': 3, 'VINTAGE': 30, '原创设计': 6, 'WORKSHOP': 2, '其他': 190 };
    return map[cat] || 7;
  }
}

window.BoothSystem = BoothSystem;
