/**
 * dxf-parser.js
 * Lightweight DXF parser for NEED!FLEA booth planner
 * Supports: LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC, TEXT, MTEXT, INSERT
 */

class DXFParser {
  parse(dxfString) {
    const lines = dxfString.split(/\r?\n/).map(l => l.trim());
    const result = {
      entities: [],
      layers: {},
      blocks: {},
      bounds: null
    };

    let i = 0;
    const peek = () => lines[i];
    const next = () => lines[i++];

    const readPair = () => {
      const code = parseInt(next(), 10);
      const value = next();
      return { code, value };
    };

    // Find sections
    while (i < lines.length) {
      const line = next();
      if (line === '0') {
        const type = next();
        if (type === 'SECTION') {
          // Read section name
          const nc = next(); // should be 2
          const sectionName = next();
          if (sectionName === 'ENTITIES') {
            this._parseEntities(lines, i, result.entities, result.layers);
          } else if (sectionName === 'TABLES') {
            this._parseTables(lines, i, result.layers);
          } else if (sectionName === 'BLOCKS') {
            this._parseBlocks(lines, i, result.blocks, result.layers);
          }
        }
      }
    }

    result.bounds = this._calcBounds(result.entities);
    return result;
  }

  _parseEntities(lines, startI, entities, layers) {
    let i = startI;
    while (i < lines.length) {
      if (lines[i] === '0') {
        i++;
        const type = lines[i++];
        if (type === 'ENDSEC') break;

        const entity = this._parseEntity(type, lines, i);
        if (entity) {
          entities.push(entity);
          i = entity._nextI || i;
          // Track layers
          if (entity.layer) {
            if (!layers[entity.layer]) layers[entity.layer] = { name: entity.layer, visible: true, color: entity.color || 7 };
          }
        }
      } else {
        i++;
      }
    }
  }

  _parseTables(lines, startI, layers) {
    let i = startI;
    while (i < lines.length) {
      if (lines[i] === '0') {
        i++;
        const t = lines[i++];
        if (t === 'ENDSEC') break;
        if (t === 'LAYER') {
          let name = '', color = 7, visible = true;
          while (i < lines.length) {
            if (lines[i] === '0') break;
            const code = parseInt(lines[i++], 10);
            const val = lines[i++];
            if (code === 2) name = val;
            if (code === 62) { color = Math.abs(parseInt(val, 10)); visible = parseInt(val, 10) >= 0; }
          }
          if (name) layers[name] = { name, color, visible };
        }
      } else {
        i++;
      }
    }
  }

  _parseBlocks(lines, startI, blocks, layers) {
    let i = startI;
    let currentBlock = null;
    while (i < lines.length) {
      if (lines[i] === '0') {
        i++;
        const t = lines[i++];
        if (t === 'ENDSEC') break;
        if (t === 'BLOCK') {
          currentBlock = { name: '', entities: [] };
          while (i < lines.length) {
            if (lines[i] === '0') break;
            const code = parseInt(lines[i++], 10);
            const val = lines[i++];
            if (code === 2) currentBlock.name = val;
          }
        } else if (t === 'ENDBLK') {
          if (currentBlock) { blocks[currentBlock.name] = currentBlock; currentBlock = null; }
          while (i < lines.length && lines[i] !== '0') i++;
        } else if (currentBlock) {
          const entity = this._parseEntity(t, lines, i);
          if (entity) { currentBlock.entities.push(entity); i = entity._nextI || i; }
        }
      } else {
        i++;
      }
    }
  }

  _parseEntity(type, lines, startI) {
    let i = startI;
    const entity = { type, layer: '0', color: null };

    const handlers = {
      LINE: () => { entity.x1=0; entity.y1=0; entity.x2=0; entity.y2=0; },
      LWPOLYLINE: () => { entity.vertices=[]; entity.closed=false; entity.elevation=0; },
      POLYLINE: () => { entity.vertices=[]; entity.closed=false; },
      CIRCLE: () => { entity.cx=0; entity.cy=0; entity.r=1; },
      ARC: () => { entity.cx=0; entity.cy=0; entity.r=1; entity.startAngle=0; entity.endAngle=360; },
      TEXT: () => { entity.x=0; entity.y=0; entity.height=1; entity.text=''; entity.angle=0; },
      MTEXT: () => { entity.x=0; entity.y=0; entity.height=1; entity.text=''; entity.angle=0; },
      INSERT: () => { entity.block=''; entity.x=0; entity.y=0; entity.scaleX=1; entity.scaleY=1; entity.angle=0; },
      SPLINE: () => { entity.controlPoints=[]; entity.fitPoints=[]; },
      ELLIPSE: () => { entity.cx=0; entity.cy=0; entity.mx=1; entity.my=0; entity.ratio=1; entity.startAngle=0; entity.endAngle=Math.PI*2; },
    };

    if (handlers[type]) handlers[type]();
    else return this._skipToNext(lines, i, entity);

    let vtxBuf = null;

    while (i < lines.length) {
      if (lines[i] === '0') break;
      const code = parseInt(lines[i++], 10);
      const val = lines[i++];

      // Common codes
      if (code === 8) entity.layer = val;
      else if (code === 62) entity.color = Math.abs(parseInt(val, 10));
      else if (code === 6) entity.lineType = val;

      // LINE
      else if (type === 'LINE') {
        if (code === 10) entity.x1 = parseFloat(val);
        else if (code === 20) entity.y1 = parseFloat(val);
        else if (code === 11) entity.x2 = parseFloat(val);
        else if (code === 21) entity.y2 = parseFloat(val);
      }
      // LWPOLYLINE
      else if (type === 'LWPOLYLINE') {
        if (code === 70) entity.closed = (parseInt(val, 10) & 1) === 1;
        else if (code === 10) { vtxBuf = { x: parseFloat(val), y: 0, bulge: 0 }; entity.vertices.push(vtxBuf); }
        else if (code === 20 && vtxBuf) vtxBuf.y = parseFloat(val);
        else if (code === 42 && vtxBuf) vtxBuf.bulge = parseFloat(val);
      }
      // POLYLINE vertices handled separately
      else if (type === 'POLYLINE') {
        if (code === 70) entity.closed = (parseInt(val, 10) & 1) === 1;
      }
      // CIRCLE / ARC
      else if (type === 'CIRCLE' || type === 'ARC') {
        if (code === 10) entity.cx = parseFloat(val);
        else if (code === 20) entity.cy = parseFloat(val);
        else if (code === 40) entity.r = parseFloat(val);
        else if (type === 'ARC') {
          if (code === 50) entity.startAngle = parseFloat(val);
          else if (code === 51) entity.endAngle = parseFloat(val);
        }
      }
      // TEXT / MTEXT
      else if (type === 'TEXT' || type === 'MTEXT') {
        if (code === 10) entity.x = parseFloat(val);
        else if (code === 20) entity.y = parseFloat(val);
        else if (code === 40) entity.height = parseFloat(val);
        else if (code === 1) entity.text = val.replace(/\\P/g, '\n').replace(/\{[^}]*\}/g, '').replace(/\\[a-zA-Z][^;]*;/g, '');
        else if (code === 50) entity.angle = parseFloat(val);
      }
      // INSERT
      else if (type === 'INSERT') {
        if (code === 2) entity.block = val;
        else if (code === 10) entity.x = parseFloat(val);
        else if (code === 20) entity.y = parseFloat(val);
        else if (code === 41) entity.scaleX = parseFloat(val);
        else if (code === 42) entity.scaleY = parseFloat(val);
        else if (code === 50) entity.angle = parseFloat(val);
      }
      // SPLINE
      else if (type === 'SPLINE') {
        if (code === 10) { vtxBuf = {x: parseFloat(val), y: 0}; entity.controlPoints.push(vtxBuf); }
        else if (code === 20 && vtxBuf && entity.controlPoints.length > 0) entity.controlPoints[entity.controlPoints.length-1].y = parseFloat(val);
        else if (code === 11) { vtxBuf = {x: parseFloat(val), y: 0}; entity.fitPoints.push(vtxBuf); }
        else if (code === 21 && entity.fitPoints.length > 0) entity.fitPoints[entity.fitPoints.length-1].y = parseFloat(val);
      }
      // ELLIPSE
      else if (type === 'ELLIPSE') {
        if (code === 10) entity.cx = parseFloat(val);
        else if (code === 20) entity.cy = parseFloat(val);
        else if (code === 11) entity.mx = parseFloat(val);
        else if (code === 21) entity.my = parseFloat(val);
        else if (code === 40) entity.ratio = parseFloat(val);
        else if (code === 41) entity.startAngle = parseFloat(val);
        else if (code === 42) entity.endAngle = parseFloat(val);
      }
    }

    entity._nextI = i;
    return entity;
  }

  _skipToNext(lines, i, entity) {
    while (i < lines.length && lines[i] !== '0') i += 2;
    entity._nextI = i;
    return entity;
  }

  _calcBounds(entities) {
    // Use only LINE and POLYLINE endpoints for bounds — they reliably define
    // the floor plan extent. ARC/CIRCLE/ELLIPSE with large radii and TEXT/INSERT
    // at title-block coordinates would inflate bounds incorrectly.
    const xs = [], ys = [];
    const addPt = (x, y) => {
      if (isFinite(x) && isFinite(y)) { xs.push(x); ys.push(y); }
    };
    entities.forEach(e => {
      if (e.type === 'LINE') { addPt(e.x1, e.y1); addPt(e.x2, e.y2); }
      else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') e.vertices.forEach(v => addPt(v.x, v.y));
    });

    if (xs.length === 0) return { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 };

    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);

    // Find the largest cluster by detecting the biggest gap in sorted X values,
    // then keeping the side with more points. This handles DWG files with
    // duplicate floor plans or title blocks at different coordinates.
    const findMainCluster = (arr) => {
      const n = arr.length;
      if (n < 10) return { lo: arr[0], hi: arr[n - 1] };

      // Find the biggest gap (skip top/bottom 5% to avoid outlier-induced gaps)
      const safeStart = Math.floor(n * 0.05);
      const safeEnd = Math.ceil(n * 0.95);
      let maxGap = 0, gapIdx = -1;
      for (let i = safeStart; i < safeEnd; i++) {
        const gap = arr[i + 1] - arr[i];
        if (gap > maxGap) { maxGap = gap; gapIdx = i; }
      }

      // If the gap is > 20% of total range, split and use larger cluster
      const totalRange = arr[safeEnd] - arr[safeStart];
      if (gapIdx >= 0 && maxGap > totalRange * 0.2) {
        const leftCount = gapIdx - safeStart + 1;
        const rightCount = safeEnd - gapIdx - 1;
        if (leftCount >= rightCount) {
          return { lo: arr[safeStart], hi: arr[gapIdx] };
        } else {
          return { lo: arr[gapIdx + 1], hi: arr[safeEnd] };
        }
      }

      return { lo: arr[safeStart], hi: arr[safeEnd] };
    };

    const cx = findMainCluster(xs);
    const cy = findMainCluster(ys);
    const w = (cx.hi - cx.lo) || 1, h = (cy.hi - cy.lo) || 1;
    const pad = Math.max(w, h) * 0.05;
    return {
      minX: cx.lo - pad, minY: cy.lo - pad,
      maxX: cx.hi + pad, maxY: cy.hi + pad,
      width: w + pad * 2, height: h + pad * 2
    };
  }
}

window.DXFParser = DXFParser;
