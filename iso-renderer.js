/**
 * iso-renderer.js
 * Isometric 3D view for NEED!FLEA booth planner
 * Supports rotation, draws tents/tables/annotations
 */

class IsoRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // View rotation (radians around Z axis, 0 = default iso)
    this.rotation = 0;

    // Viewport
    this.offsetX = 0;
    this.offsetY = 0;
    this.isoScale = 1;

    // Isometric tilt angle (fixed 30°)
    this.tilt = Math.PI / 6;

    // Heights (meters)
    this.TENT_WALL_H = 2.0;  // 雷亚架 frame height

    // Drag rotation state
    this._dragging = false;
    this._dragStartX = 0;
    this._dragStartRot = 0;
    this._bound = false;
  }

  // Bind mouse/touch events for rotation
  _bindEvents() {
    if (this._bound) return;
    this._bound = true;
    const c = this.canvas;

    this._onDown = (e) => {
      if (!this.active) return;
      this._dragging = true;
      this._dragStartX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
      this._dragStartRot = this.rotation;
    };
    this._onMove = (e) => {
      if (!this.active || !this._dragging) return;
      const x = e.clientX || (e.touches && e.touches[0].clientX) || 0;
      const dx = x - this._dragStartX;
      this.rotation = this._dragStartRot + dx * 0.008;
      if (this._renderCb) this._renderCb();
    };
    this._onUp = () => { this._dragging = false; };

    c.addEventListener('mousedown', this._onDown);
    c.addEventListener('mousemove', this._onMove);
    c.addEventListener('mouseup', this._onUp);
    c.addEventListener('mouseleave', this._onUp);
    c.addEventListener('touchstart', this._onDown, { passive: true });
    c.addEventListener('touchmove', this._onMove, { passive: true });
    c.addEventListener('touchend', this._onUp);

    // Zoom with scroll wheel
    this._onWheel = (e) => {
      if (!this.active) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      this._userZoom = (this._userZoom || 1) * factor;
      this._userZoom = Math.max(0.2, Math.min(5, this._userZoom));
      if (this._renderCb) this._renderCb();
    };
    c.addEventListener('wheel', this._onWheel, { passive: false });
  }

  // World (meters) → rotated isometric screen coords
  // Note: negate y to match 2D DXF convention (Y-up → screen Y-down)
  toScreen(x, y, z) {
    const ny = -y; // flip Y to match 2D view orientation
    // Rotate around Z
    const cos = Math.cos(this.rotation);
    const sin = Math.sin(this.rotation);
    const rx = x * cos - ny * sin;
    const ry = x * sin + ny * cos;

    const cosT = Math.cos(this.tilt);
    const sinT = Math.sin(this.tilt);
    const sx = (rx - ry) * cosT * this.isoScale;
    const sy = (rx + ry) * sinT * this.isoScale - z * this.isoScale;
    return { x: sx + this.offsetX, y: sy + this.offsetY };
  }

  /**
   * Render full 3D scene
   */
  render(boothSystem, metersPerUnit, isDark) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = isDark ? '#1e1e1e' : '#f5f4f0';
    ctx.fillRect(0, 0, W, H);

    const mpu = metersPerUnit || 1;
    const allItems = boothSystem.items;
    const boothItems = allItems.filter(i => i.type === 'booth');

    if (boothItems.length === 0 && allItems.length === 0) {
      ctx.fillStyle = isDark ? '#555' : '#999';
      ctx.font = '16px "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('暂无摊位数据', W / 2, H / 2);
      return;
    }

    // Convert booths to meter-space
    const items3d = boothItems.map(b => {
      const mw = b.ww * mpu, mh = b.wh * mpu;
      const cx = (b.wx + b.ww / 2) * mpu;
      const cy = (b.wy + b.wh / 2) * mpu;
      return { ...b, mx: cx, my: cy, mw, mh, style: b.boothStyle || 'tent', _sort: cx + cy };
    });

    // Collect annotation items for autoFit bounds
    const annotations = allItems.filter(i => i.type !== 'booth');

    // Auto-fit
    this._autoFit(items3d, annotations, mpu);

    // Sort by depth (after rotation)
    const cos = Math.cos(this.rotation), sin = Math.sin(this.rotation);
    items3d.sort((a, b) => {
      const da = a.mx * sin + a.my * cos;
      const db = b.mx * sin + b.my * cos;
      return da - db;
    });

    // Draw ground shadows
    this._drawGround(ctx, items3d, isDark, boothSystem);

    // Draw annotations on ground plane (behind booths)
    this._drawAnnotations(ctx, annotations, mpu, isDark, boothSystem);

    // Draw booths
    items3d.forEach(item => {
      if (item.style === 'table') {
        this._drawTableBooth(ctx, item, boothSystem, isDark);
      } else {
        this._drawTent(ctx, item, boothSystem, isDark);
      }
    });

    // HUD
    ctx.fillStyle = isDark ? '#aaa' : '#666';
    ctx.font = '12px "PingFang SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('3D 搭建示意图 · 拖动旋转视角', 16, H - 16);

    const deg = Math.round(this.rotation * 180 / Math.PI) % 360;
    ctx.textAlign = 'right';
    ctx.fillText(`旋转 ${deg >= 0 ? deg : deg + 360}°`, W - 16, H - 16);
  }

  _autoFit(items3d, annotations, mpu) {
    const W = this.canvas.width, H = this.canvas.height;
    this.isoScale = 1;
    this.offsetX = 0;
    this.offsetY = 0;

    let minSx = Infinity, maxSx = -Infinity;
    let minSy = Infinity, maxSy = -Infinity;

    const expand = (x, y, z) => {
      const p = this.toScreen(x, y, z);
      minSx = Math.min(minSx, p.x); maxSx = Math.max(maxSx, p.x);
      minSy = Math.min(minSy, p.y); maxSy = Math.max(maxSy, p.y);
    };

    items3d.forEach(item => {
      const hw = item.mw / 2, hh = item.mh / 2;
      [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].forEach(([dx,dy]) => {
        expand(item.mx + dx, item.my + dy, 0);
        expand(item.mx + dx, item.my + dy, this.TENT_WALL_H);
      });
    });

    // Include annotation positions
    annotations.forEach(a => {
      if (a.type === 'arrow' || a.type === 'dim') {
        expand(a.wx1 * mpu, a.wy1 * mpu, 0);
        expand(a.wx2 * mpu, a.wy2 * mpu, 0);
      } else if (a.type === 'zone' || a.type === 'guard' || a.type === 'fire') {
        expand(a.wx * mpu, a.wy * mpu, 0);
      } else if (a.type === 'line' && a.pts) {
        a.pts.forEach(p => expand(p.wx * mpu, p.wy * mpu, 0));
      }
    });

    if (minSx === Infinity) return; // nothing to fit

    const pad = 60;
    const rangeX = maxSx - minSx || 1;
    const rangeY = maxSy - minSy || 1;
    const baseScale = Math.min((W - pad * 2) / rangeX, (H - pad * 2) / rangeY);
    this.isoScale = baseScale * (this._userZoom || 1);
    const cx = (minSx + maxSx) / 2 * this.isoScale;
    const cy = (minSy + maxSy) / 2 * this.isoScale;
    this.offsetX = W / 2 - cx;
    this.offsetY = H / 2 - cy;
  }

  // ── ANNOTATIONS ──────────────────────────────────────────────

  _drawAnnotations(ctx, annotations, mpu, isDark, boothSystem) {
    annotations.forEach(a => {
      if (a.type === 'arrow') this._drawArrow3D(ctx, a, mpu, isDark);
      else if (a.type === 'zone') this._drawZone3D(ctx, a, mpu, isDark);
      else if (a.type === 'guard') this._drawIcon3D(ctx, a, mpu, '👮');
      else if (a.type === 'fire') this._drawIcon3D(ctx, a, mpu, '🧯');
      else if (a.type === 'dim') this._drawDim3D(ctx, a, mpu, isDark);
      else if (a.type === 'line') this._drawLine3D(ctx, a, mpu, isDark);
    });
  }

  _drawArrow3D(ctx, item, mpu, isDark) {
    const p1 = this.toScreen(item.wx1 * mpu, item.wy1 * mpu, 0);
    const p2 = this.toScreen(item.wx2 * mpu, item.wy2 * mpu, 0);
    const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (len < 3) return;

    ctx.save();
    ctx.strokeStyle = '#4BC98A';
    ctx.fillStyle = '#4BC98A';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.setLineDash([10, 6]);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    ctx.setLineDash([]);

    const hLen = Math.min(14, len * 0.35);
    ctx.beginPath();
    ctx.moveTo(p2.x, p2.y);
    ctx.lineTo(p2.x - hLen * Math.cos(ang - 0.4), p2.y - hLen * Math.sin(ang - 0.4));
    ctx.lineTo(p2.x - hLen * Math.cos(ang + 0.4), p2.y - hLen * Math.sin(ang + 0.4));
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  _drawZone3D(ctx, item, mpu, isDark) {
    const p = this.toScreen(item.wx * mpu, item.wy * mpu, 0);
    const fs = item.fontSize || 14;
    ctx.save();
    ctx.font = `bold ${fs}px 'PingFang SC', sans-serif`;
    ctx.fillStyle = isDark ? '#ffffff' : '#1a1a18';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(item.label || '', p.x, p.y);
    ctx.restore();
  }

  _drawIcon3D(ctx, item, mpu, emoji) {
    const p = this.toScreen(item.wx * mpu, item.wy * mpu, 0);
    ctx.save();
    ctx.font = '20px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, p.x, p.y);
    ctx.restore();
  }

  _drawDim3D(ctx, item, mpu, isDark) {
    const p1 = this.toScreen(item.wx1 * mpu, item.wy1 * mpu, 0);
    const p2 = this.toScreen(item.wx2 * mpu, item.wy2 * mpu, 0);
    const col = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)';

    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    ctx.setLineDash([]);

    // Ticks
    const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const tl = 6;
    const px = Math.cos(ang + Math.PI / 2) * tl, py = Math.sin(ang + Math.PI / 2) * tl;
    ctx.beginPath(); ctx.moveTo(p1.x - px, p1.y - py); ctx.lineTo(p1.x + px, p1.y + py); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p2.x - px, p2.y - py); ctx.lineTo(p2.x + px, p2.y + py); ctx.stroke();

    // Label
    if (item.label) {
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      ctx.font = 'bold 11px "PingFang SC", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      const tw = ctx.measureText(item.label).width + 8;
      ctx.fillStyle = isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.85)';
      ctx.fillRect(mx - tw / 2, my - 15, tw, 14);
      ctx.fillStyle = col;
      ctx.fillText(item.label, mx, my - 2);
    }
    ctx.restore();
  }

  _drawLine3D(ctx, item, mpu, isDark) {
    if (!item.pts || item.pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (item.lineStyle === 'dashed') ctx.setLineDash([8, 5]);

    ctx.beginPath();
    item.pts.forEach((pt, i) => {
      const p = this.toScreen(pt.wx * mpu, pt.wy * mpu, 0);
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    });
    if (item.closed) ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ── GROUND / BOOTHS ──────────────────────────────────────────

  _getColor(item, boothSystem) {
    return boothSystem.CAT_COLORS[item.cat] || boothSystem.CAT_COLORS['其他'];
  }

  _drawGround(ctx, items, isDark) {
    items.forEach(item => {
      const hw = item.mw / 2, hh = item.mh / 2;
      const pts = [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].map(([dx,dy]) =>
        this.toScreen(item.mx + dx, item.my + dy, 0));
      ctx.beginPath();
      pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
      ctx.fill();
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    });
  }

  _drawTent(ctx, item, boothSystem, isDark) {
    const col = this._getColor(item, boothSystem);
    const hw = item.mw / 2, hh = item.mh / 2;
    const H = this.TENT_WALL_H; // full height 2m

    // Corner positions at various heights
    const corners = [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]];
    const at = (dx, dy, z) => this.toScreen(item.mx + dx, item.my + dy, z);

    // Heights for horizontal crossbars (bottom + top only)
    const zGround = 0;
    const zBot = 0.15;   // bottom crossbar
    const zTop = H;      // top frame

    // Collect all pipe segments: [from, to] as screen points
    // We'll sort by depth and draw back-to-front
    const pipes = [];

    // Helper: add a pipe with depth info (avg world y for sorting)
    const addPipe = (x1,y1,z1, x2,y2,z2) => {
      const p1 = at(x1,y1,z1), p2 = at(x2,y2,z2);
      // Depth = rotated y (same as booth sort)
      const cos = Math.cos(this.rotation), sin = Math.sin(this.rotation);
      const wy1 = (item.mx+x1)*sin + (item.my+y1)*cos;
      const wy2 = (item.mx+x2)*sin + (item.my+y2)*cos;
      pipes.push({ p1, p2, depth: (wy1+wy2)/2, z: (z1+z2)/2 });
    };

    // 4 vertical poles
    corners.forEach(([dx,dy]) => addPipe(dx,dy,zGround, dx,dy,zTop));

    // Horizontal bars at bottom and top
    [zBot, zTop].forEach(z => {
      for (let i = 0; i < 4; i++) {
        const [x1,y1] = corners[i];
        const [x2,y2] = corners[(i+1)%4];
        addPipe(x1,y1,z, x2,y2,z);
      }
    });

    // Sort: farther pipes (lower depth) drawn first, lower z first
    pipes.sort((a,b) => (a.depth - b.depth) || (a.z - b.z));

    // Pipe rendering style
    const pipeW = Math.max(2.5, 0.04 * this.isoScale); // pipe thickness in pixels
    const pipeColor = isDark ? '#a0a0a0' : '#777777';
    const pipeHighlight = isDark ? '#c8c8c8' : '#999999';
    const pipeShadow = isDark ? '#686868' : '#555555';

    pipes.forEach(pipe => {
      const {p1, p2} = pipe;
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) return;

      // Draw pipe: shadow line (thicker) + main line + highlight line (thinner, offset)
      ctx.save();
      ctx.lineCap = 'round';

      // Shadow (wider, darker)
      ctx.strokeStyle = pipeShadow;
      ctx.lineWidth = pipeW + 1.5;
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();

      // Main pipe body
      ctx.strokeStyle = pipeColor;
      ctx.lineWidth = pipeW;
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();

      // Highlight (thinner, offset slightly)
      const nx = -dy / len * pipeW * 0.2;
      const ny = dx / len * pipeW * 0.2;
      ctx.strokeStyle = pipeHighlight;
      ctx.lineWidth = pipeW * 0.4;
      ctx.beginPath();
      ctx.moveTo(p1.x + nx, p1.y + ny);
      ctx.lineTo(p2.x + nx, p2.y + ny);
      ctx.stroke();

      ctx.restore();
    });

    // Joint dots at corners (pipe joints)
    const jointR = pipeW * 0.8;
    [zGround, zBot, zTop].forEach(z => {
      corners.forEach(([dx,dy]) => {
        const p = at(dx, dy, z);
        ctx.beginPath();
        ctx.arc(p.x, p.y, jointR, 0, Math.PI*2);
        ctx.fillStyle = pipeShadow;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, p.y, jointR * 0.7, 0, Math.PI*2);
        ctx.fillStyle = pipeColor;
        ctx.fill();
      });
    });

    // Category color indicator: small colored label bar at top front
    const frontMid = this.toScreen(item.mx, item.my + hh, zTop + 0.05);
    const barW = Math.min(30, item.mw * this.isoScale * 0.3);
    ctx.fillStyle = col.fill;
    ctx.globalAlpha = 0.85;
    this._roundRectPath(ctx, frontMid.x - barW, frontMid.y - 4, barW * 2, 8, 3);
    ctx.fill();
    ctx.globalAlpha = 1.0;

    this._drawBoothLabel(ctx, item, isDark, zTop + 0.4);
  }

  _drawTableBooth(ctx, item, boothSystem, isDark) {
    const col = this._getColor(item, boothSystem);
    const hw = item.mw / 2, hh = item.mh / 2;

    const pts = [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].map(([dx,dy]) =>
      this.toScreen(item.mx + dx, item.my + dy, 0));
    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.fillStyle = col.fill + '30';
    ctx.fill();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = col.stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);

    this._drawBoothLabel(ctx, item, isDark, 0.5);
  }

  _drawBoothLabel(ctx, item, isDark, height) {
    const label = item.label || '';
    if (!label) return;
    const p = this.toScreen(item.mx, item.my, height);
    ctx.save();
    ctx.font = 'bold 13px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.85)';
    this._roundRectPath(ctx, p.x - tw / 2, p.y - 18, tw, 20, 4);
    ctx.fill();
    ctx.fillStyle = isDark ? '#fff' : '#1a1a18';
    ctx.fillText(label, p.x, p.y);
    ctx.restore();
  }

  _roundRectPath(ctx, x, y, w, h, r) {
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

  _shade(hex, factor) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.round(Math.min(255, r * factor))},${Math.round(Math.min(255, g * factor))},${Math.round(Math.min(255, b * factor))})`;
  }

  exportPNG(boothSystem, metersPerUnit, isDark) {
    this.render(boothSystem, metersPerUnit, isDark);
    const link = document.createElement('a');
    link.download = `NEEDFLEA_3D_${new Date().toISOString().slice(0, 10)}.png`;
    link.href = this.canvas.toDataURL('image/png');
    link.click();
  }
}

window.IsoRenderer = IsoRenderer;
