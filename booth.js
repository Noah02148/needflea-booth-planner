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

  // ── CRUD ──────────────────────────────────────────────────
  addBooth(worldX, worldY, cat, size) {
    const [w, h] = this._sizeToWorld(size);
    const item = {
      id: this.nextId++, type: 'booth',
      cat, size,
      wx: worldX - w / 2,  // top-left in world coords
      wy: worldY - h / 2,
      ww: w, wh: h,
      label: '', angle: 0
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
    // Recalc size if changed
    if (props.size && props.size !== item.size) {
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
    if (item.type === 'guard') {
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

  _drawItem(ctx, R, item) {
    const sel = item.id === this.selectedId || this.selectedIds.has(item.id);

    if (item.type === 'booth') {
      const cx = R.wx(item.wx + item.ww / 2);
      const cy = R.wy(item.wy + item.wh / 2);
      const sw = item.ww * R.scale, sh = item.wh * R.scale;
      const col = this.CAT_COLORS[item.cat] || this.CAT_COLORS['其他'];
      const angle = (item.angle || 0) * Math.PI / 180;
      const hasOverlap = this.checkOverlap(item);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-angle); // screen Y is flipped

      if (sel) { ctx.shadowColor = col.fill + '99'; ctx.shadowBlur = 10; }

      // Solid fill
      ctx.fillStyle = hasOverlap ? '#FF4444' : col.fill;
      ctx.strokeStyle = hasOverlap ? '#CC0000' : col.stroke;
      ctx.lineWidth = sel ? 2.5 : 1.2;
      this._roundRect(ctx, -sw/2, -sh/2, sw, sh, 3);
      ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;

      // Label (only if user set one) — always upright
      if (item.label) {
        ctx.save();
        ctx.rotate(angle); // counter-rotate so text stays upright
        const fontSize = Math.max(8, Math.min(sw * 0.3, sh * 0.35, 16));
        ctx.font = `bold ${fontSize}px 'PingFang SC', sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.label, 0, 0);
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
      const fontSize = 14;
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
    return { total: booths.length, guards: this.items.filter(i => i.type === 'guard').length, counts };
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
