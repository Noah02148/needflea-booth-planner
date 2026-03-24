/**
 * renderer.js
 * Renders DXF entities onto a canvas with pan/zoom support
 * Supports two modes:
 *   1. Entity-by-entity rendering (for DXF text files)
 *   2. SVG background image rendering (for DWG files via WASM)
 */

class DXFRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dxfData = null;

    // SVG background image mode
    this.svgImage = null;       // Image object containing the rendered SVG
    this.svgBounds = null;      // { minX, minY, maxX, maxY } in world coordinates
    this.useSvgBackground = false;

    // Raster image background mode (scene photo)
    this.bgImage = null;
    this.imageBounds = null;
    this.useImageBackground = false;

    // Viewport transform
    this.offsetX = 0;
    this.offsetY = 0;
    this.scale = 1; // px per DXF unit

    // Pan state
    this._panning = false;
    this._panStart = null;

    // Color table (AutoCAD ACI colors → hex)
    this.aciColors = {
      1: '#FF0000', 2: '#FFFF00', 3: '#00FF00', 4: '#00FFFF',
      5: '#0000FF', 6: '#FF00FF', 7: '#FFFFFF',
      8: '#808080', 9: '#c0c0c0',
      10: '#FF0000', 11: '#FF7F7F',
      30: '#FF7F00', 40: '#7F3F00',
      50: '#7F7F00', 51: '#BFBF00',
      70: '#007F00', 80: '#00BF00',
      130: '#007F7F', 140: '#007FBF',
      150: '#00007F', 160: '#0000BF',
      190: '#7F007F', 200: '#BF00BF',
      250: '#333333', 251: '#555555', 252: '#777777', 253: '#999999',
      254: '#BBBBBB', 255: '#DDDDDD',
    };
  }

  load(dxfData) {
    this.dxfData = dxfData;
    this.svgImage = null;
    this.svgBounds = null;
    this.useSvgBackground = false;
    this.bgImage = null;
    this.imageBounds = null;
    this.useImageBackground = false;
    this.fitToView();
  }

  /**
   * Load a raster image (photo) as background for scene-based planning.
   * World coordinates = image pixels (origin at bottom-left to match DXF convention).
   * @param {Image} img - loaded Image object
   */
  loadImageBackground(img) {
    this.bgImage = img;
    this.svgImage = null;
    this.svgBounds = null;
    this.useSvgBackground = false;
    this.useImageBackground = true;
    const w = img.naturalWidth, h = img.naturalHeight;
    this.imageBounds = { minX: 0, minY: 0, maxX: w, maxY: h };
    this.dxfData = {
      entities: [],
      layers: {},
      bounds: { minX: 0, minY: 0, maxX: w, maxY: h, width: w, height: h }
    };
    this.fitToView();
  }

  /**
   * Load an SVG background image for DWG rendering.
   * @param {Image} img - loaded Image object from SVG data URL
   * @param {object} bounds - { minX, minY, maxX, maxY } world-space bounds the SVG covers
   */
  loadSvgBackground(img, bounds) {
    this.svgImage = img;
    this.svgBounds = bounds;
    this.useSvgBackground = true;
    // Create a minimal dxfData so fitToView and coordinate transforms work
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    this.dxfData = {
      entities: [],
      layers: {},
      bounds: {
        minX: bounds.minX, minY: bounds.minY,
        maxX: bounds.maxX, maxY: bounds.maxY,
        width, height
      }
    };
    this.fitToView();
  }

  fitToView() {
    if (!this.dxfData || !this.dxfData.bounds) return;
    const b = this.dxfData.bounds;
    const W = this.canvas.width, H = this.canvas.height;
    const pad = 60;
    const scaleX = (W - pad * 2) / (b.width || 1);
    const scaleY = (H - pad * 2) / (b.height || 1);
    this.scale = Math.min(scaleX, scaleY);
    // Center
    this.offsetX = (W - b.width * this.scale) / 2 - b.minX * this.scale;
    this.offsetY = (H + b.height * this.scale) / 2 + b.minY * this.scale;
  }

  // World (DXF) → Screen
  wx(x) { return x * this.scale + this.offsetX; }
  wy(y) { return -y * this.scale + this.offsetY; }

  // Screen → World
  sx(px) { return (px - this.offsetX) / this.scale; }
  sy(py) { return -(py - this.offsetY) / this.scale; }

  zoom(factor, cx, cy) {
    const wx = this.sx(cx), wy = this.sy(cy);
    this.scale *= factor;
    this.scale = Math.max(1e-7, Math.min(1e6, this.scale));
    this.offsetX = cx - wx * this.scale;
    this.offsetY = cy + wy * this.scale;
  }

  pan(dx, dy) {
    this.offsetX += dx;
    this.offsetY += dy;
  }

  render(annotations) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Background — respects theme (darkMode is a global)
    ctx.fillStyle = (typeof darkMode !== 'undefined' && !darkMode) ? '#ffffff' : '#1e1e1e';
    ctx.fillRect(0, 0, W, H);

    if (!this.dxfData) return;

    ctx.save();

    if (this.useImageBackground && this.bgImage && this.imageBounds) {
      // Draw raster image background (scene photo)
      this._drawImageBackground();
    } else if (this.useSvgBackground && this.svgImage && this.svgBounds) {
      // Draw SVG as background image, mapped to world coordinates
      this._drawSvgBackground();
    } else {
      // Entity-by-entity rendering (DXF text file path)
      this.dxfData.entities.forEach(e => this._drawEntity(e));
    }

    ctx.restore();
  }

  _drawImageBackground() {
    const ctx = this.ctx;
    const b = this.imageBounds;
    const screenX = this.wx(b.minX);
    const screenY = this.wy(b.maxY);
    const screenW = (b.maxX - b.minX) * this.scale;
    const screenH = (b.maxY - b.minY) * this.scale;
    ctx.drawImage(this.bgImage, screenX, screenY, screenW, screenH);
  }

  _drawSvgBackground() {
    const ctx = this.ctx;
    const b = this.svgBounds;

    // Map world-space bounds to screen coordinates
    // Top-left in screen: world (minX, maxY) since Y is flipped
    const screenX = this.wx(b.minX);
    const screenY = this.wy(b.maxY);
    const screenW = (b.maxX - b.minX) * this.scale;
    const screenH = (b.maxY - b.minY) * this.scale;

    ctx.drawImage(this.svgImage, screenX, screenY, screenW, screenH);
  }

  _getEntityColor(entity) {
    let color;
    if (entity.color !== null && entity.color !== undefined && entity.color !== 256) {
      color = this.aciColors[entity.color] || '#333333';
    } else if (entity.layer && this.dxfData.layers[entity.layer]) {
      const lc = this.dxfData.layers[entity.layer].color;
      color = this.aciColors[lc] || '#333333';
    } else {
      color = '#333333';
    }
    // In light mode, invert bright colors to dark
    if (typeof darkMode !== 'undefined' && !darkMode) {
      const r = parseInt(color.slice(1,3),16), g = parseInt(color.slice(3,5),16), b = parseInt(color.slice(5,7),16);
      if (r*0.299 + g*0.587 + b*0.114 > 180) return '#333333';
    }
    return color;
  }

  _setupStroke(entity) {
    const ctx = this.ctx;
    const color = this._getEntityColor(entity);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 0.8;
    ctx.setLineDash([]);
    if (entity.lineType) {
      const lt = entity.lineType.trim().toUpperCase();
      if (lt.includes('DASH') && !lt.includes('DOT')) ctx.setLineDash([8, 4]);
      else if (lt.includes('HIDDEN')) ctx.setLineDash([4, 3]);
      else if (lt.includes('CENTER')) ctx.setLineDash([14, 4, 4, 4]);
      else if (lt.includes('DASHDOT')) ctx.setLineDash([8, 3, 2, 3]);
      else if (lt.includes('DOT')) ctx.setLineDash([2, 3]);
    }
  }

  _drawEntity(e) {
    const ctx = this.ctx;
    this._setupStroke(e);

    switch (e.type) {
      case 'LINE':
        ctx.beginPath();
        ctx.moveTo(this.wx(e.x1), this.wy(e.y1));
        ctx.lineTo(this.wx(e.x2), this.wy(e.y2));
        ctx.stroke();
        break;

      case 'LWPOLYLINE':
      case 'POLYLINE':
        if (e.vertices.length < 2) break;
        ctx.beginPath();
        e.vertices.forEach((v, idx) => {
          if (idx === 0) ctx.moveTo(this.wx(v.x), this.wy(v.y));
          else ctx.lineTo(this.wx(v.x), this.wy(v.y));
        });
        if (e.closed) ctx.closePath();
        ctx.stroke();
        break;

      case 'CIRCLE':
        ctx.beginPath();
        ctx.arc(this.wx(e.cx), this.wy(e.cy), e.r * this.scale, 0, Math.PI * 2);
        ctx.stroke();
        break;

      case 'ARC': {
        const startRad = (e.startAngle) * Math.PI / 180;
        const endRad = (e.endAngle) * Math.PI / 180;
        ctx.beginPath();
        ctx.arc(this.wx(e.cx), this.wy(e.cy), e.r * this.scale,
          -startRad, -endRad, true);
        ctx.stroke();
        break;
      }

      case 'TEXT':
      case 'MTEXT': {
        const fontSize = Math.max(8, e.height * this.scale);
        if (fontSize < 3) break;
        ctx.font = `${fontSize}px sans-serif`;
        ctx.fillStyle = this._getEntityColor(e);
        ctx.save();
        ctx.translate(this.wx(e.x), this.wy(e.y));
        if (e.angle) ctx.rotate(-e.angle * Math.PI / 180);
        ctx.fillText(e.text || '', 0, 0);
        ctx.restore();
        break;
      }

      case 'ELLIPSE': {
        const majorLen = Math.sqrt(e.mx * e.mx + e.my * e.my);
        const minorLen = majorLen * e.ratio;
        const angle = Math.atan2(e.my, e.mx);
        ctx.save();
        ctx.translate(this.wx(e.cx), this.wy(e.cy));
        ctx.rotate(-angle);
        ctx.beginPath();
        ctx.ellipse(0, 0, majorLen * this.scale, minorLen * this.scale, 0, -e.startAngle, -e.endAngle, true);
        ctx.stroke();
        ctx.restore();
        break;
      }

      case 'SPLINE': {
        const pts = e.fitPoints.length >= 2 ? e.fitPoints : e.controlPoints;
        if (pts.length < 2) break;
        ctx.beginPath();
        ctx.moveTo(this.wx(pts[0].x), this.wy(pts[0].y));
        if (pts.length === 2) {
          ctx.lineTo(this.wx(pts[1].x), this.wy(pts[1].y));
        } else {
          for (let j = 1; j < pts.length - 1; j++) {
            const mx = (this.wx(pts[j].x) + this.wx(pts[j + 1].x)) / 2;
            const my = (this.wy(pts[j].y) + this.wy(pts[j + 1].y)) / 2;
            ctx.quadraticCurveTo(this.wx(pts[j].x), this.wy(pts[j].y), mx, my);
          }
          ctx.lineTo(this.wx(pts[pts.length - 1].x), this.wy(pts[pts.length - 1].y));
        }
        ctx.stroke();
        break;
      }
    }
    ctx.setLineDash([]);
  }

  _drawBulgeArc(ctx, v1, v2, bulge) {
    // Convert bulge to arc
    const dx = v2.x - v1.x, dy = v2.y - v1.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const alpha = 4 * Math.atan(Math.abs(bulge));
    const r = dist / (2 * Math.sin(alpha / 2));
    const d = r * Math.cos(alpha / 2);
    const mx = (v1.x + v2.x) / 2, my = (v1.y + v2.y) / 2;
    const nx = -dy / dist, ny = dx / dist;
    const sign = bulge > 0 ? 1 : -1;
    const cx = mx + sign * d * nx, cy = my + sign * d * ny;
    const startAngle = Math.atan2(v1.y - cy, v1.x - cx);
    const endAngle = Math.atan2(v2.y - cy, v2.x - cx);
    const ccw = bulge < 0;
    ctx.arc(this.wx(cx), this.wy(cy), r * this.scale, -startAngle, -endAngle, ccw);
  }
}

window.DXFRenderer = DXFRenderer;
