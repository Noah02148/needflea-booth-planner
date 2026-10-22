/**
 * dxf-parser.js
 * Lightweight DXF parser for NEED!FLEA booth planner
 * Supports: LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC, TEXT, MTEXT, INSERT
 */

class DXFParser {
  parse(dxfString) {
    const sourceLines = dxfString.split(/\r?\n/);
    const lines = sourceLines.map(l => l.trim());
    for (let i = 1; i < lines.length; i += 2) {
      if (lines[i-1] === '1' || lines[i-1] === '3') lines[i] = sourceLines[i];
    }
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

    result.entities = this._expandBlocks(result.entities, result.blocks, result.layers);
    result.bounds = this._calcBounds(result.entities.filter(e => e.visible !== false && (e.sourceLayers || [e.layer]).every(layer => result.layers[layer]?.visible !== false)));
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
          let name = '', color = 7, visible = true, flags = 0;
          while (i < lines.length) {
            if (lines[i] === '0') break;
            const code = parseInt(lines[i++], 10);
            const val = lines[i++];
            if (code === 2) name = val;
            if (code === 62) { color = Math.abs(parseInt(val, 10)); visible = parseInt(val, 10) >= 0; }
            if (code === 70) flags = parseInt(val, 10);
          }
          if (name) layers[name] = { name, color, visible: visible && !(flags & 1) };
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
          currentBlock = { name: '', x: 0, y: 0, entities: [] };
          while (i < lines.length) {
            if (lines[i] === '0') break;
            const code = parseInt(lines[i++], 10);
            const val = lines[i++];
            if (code === 2) currentBlock.name = val;
            if (code === 10) currentBlock.x = parseFloat(val);
            if (code === 20) currentBlock.y = parseFloat(val);
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
      TEXT: () => { entity.x=0; entity.y=0; entity.height=1; entity.text=''; entity.angle=0; entity.widthScale=1; },
      MTEXT: () => { entity.x=0; entity.y=0; entity.height=1; entity.text=''; entity.angle=0; entity.attachment=1; },
      ATTRIB: () => { entity.x=0; entity.y=0; entity.height=1; entity.text=''; entity.angle=0; entity.widthScale=1; },
      DIMENSION: () => { entity.block=''; },
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
      else if (code === 60) entity.visible = parseInt(val, 10) !== 1;
      else if (code === 67) entity.paperSpace = parseInt(val, 10) === 1;
      else if ([210, 220, 230].includes(code)) {
        entity.extrusion ||= { x: 0, y: 0, z: 1 };
        entity.extrusion[{ 210: 'x', 220: 'y', 230: 'z' }[code]] = parseFloat(val);
      }
      else if (code === 30 && ['INSERT', 'TEXT', 'ATTRIB', 'CIRCLE', 'ARC'].includes(type)) entity.elevation = parseFloat(val);

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
        else if (code === 38) entity.elevation = parseFloat(val);
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
      else if (type === 'TEXT' || type === 'MTEXT' || type === 'ATTRIB') {
        if (code === 10) entity.x = parseFloat(val);
        else if (code === 20) entity.y = parseFloat(val);
        else if (code === 40) entity.height = parseFloat(val);
        else if (code === 1 || (type === 'MTEXT' && code === 3)) entity.text += val;
        else if (code === 50) entity.angle = parseFloat(val);
        else if (code === 11) entity.alignX = parseFloat(val);
        else if (code === 21) entity.alignY = parseFloat(val);
        else if (code === 41) { if (type === 'MTEXT') entity.textWidth = parseFloat(val); else entity.widthScale = parseFloat(val); }
        else if (code === 71) { if (type === 'MTEXT') entity.attachment = parseInt(val, 10); else entity.textGen = parseInt(val, 10); }
        else if (code === 72 && type !== 'MTEXT') entity.hAlign = parseInt(val, 10);
        else if (code === 73 && type !== 'MTEXT') entity.vAlign = parseInt(val, 10);
        else if (code === 74 && type === 'ATTRIB') entity.vAlign = parseInt(val, 10);
        else if (code === 44 && type === 'MTEXT') entity.lineSpacing = parseFloat(val);
        else if (code === 70 && type === 'ATTRIB' && (parseInt(val, 10) & 1)) entity.visible = false;
      }
      // INSERT
      else if (type === 'INSERT') {
        if (code === 2) entity.block = val;
        else if (code === 10) entity.x = parseFloat(val);
        else if (code === 20) entity.y = parseFloat(val);
        else if (code === 41) entity.scaleX = parseFloat(val);
        else if (code === 42) entity.scaleY = parseFloat(val);
        else if (code === 50) entity.angle = parseFloat(val);
        else if (code === 70) entity.columns = parseInt(val, 10);
        else if (code === 71) entity.rows = parseInt(val, 10);
        else if (code === 44) entity.columnSpacing = parseFloat(val);
        else if (code === 45) entity.rowSpacing = parseFloat(val);
      }
      else if (type === 'DIMENSION' && code === 2) entity.block = val;
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

    if (['TEXT', 'MTEXT', 'ATTRIB'].includes(type)) {
      entity.rawText = entity.text;
      const width = entity.rawText.match(/\\W([\d.]+);/i);
      if (width && type === 'MTEXT') entity.widthScale = parseFloat(width[1]);
      entity.text = CADText.plain(entity.rawText);
      if (type === 'MTEXT' && entity.alignX !== undefined && entity.alignY !== undefined) {
        entity.angle = Math.atan2(entity.alignY, entity.alignX) * 180 / Math.PI;
        delete entity.alignX; delete entity.alignY;
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

  _expandBlocks(entities, blocks, layers) {
    const output = [];
    const identity = [1, 0, 0, 1, 0, 0];
    const point = (m, x, y) => ({ x: m[0]*x + m[2]*y + m[4], y: m[1]*x + m[3]*y + m[5] });
    const multiply = (a, b) => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
    const ocs = e => {
      const n = e.extrusion || { x: 0, y: 0, z: 1 };
      const norm = Math.hypot(n.x, n.y, n.z) || 1;
      const nx = n.x/norm, ny = n.y/norm, nz = n.z/norm;
      let ax = Math.abs(nx) < 1/64 && Math.abs(ny) < 1/64 ? [nz, 0, -nx] : [-ny, nx, 0];
      const length = Math.hypot(...ax) || 1; ax = ax.map(v => v/length);
      const ay = [ny*ax[2]-nz*ax[1], nz*ax[0]-nx*ax[2]];
      return [ax[0], ax[1], ay[0], ay[1], nx*(e.elevation || 0), ny*(e.elevation || 0)];
    };
    const visit = (list, matrix, parent, ancestry) => {
      for (const original of list) {
        if (original.visible === false || original.paperSpace) continue;
        const e = { ...original };
        let m = matrix;
        if (e.extrusion && ['INSERT', 'LWPOLYLINE', 'CIRCLE', 'ARC', 'TEXT', 'ATTRIB'].includes(e.type)) m = multiply(matrix, ocs(e));
        e.layer = parent && e.layer === '0' ? parent.layer : e.layer;
        e.sourceLayers = [...new Set([...(parent?.sourceLayers || []), e.layer])];
        if (e.color === 0) e.color = parent?.color ?? null;
        if ((!e.lineType || e.lineType.toLowerCase() === 'byblock') && parent) e.lineType = parent.lineType;
        if (!layers[e.layer]) layers[e.layer] = { name: e.layer, visible: true, color: 7 };
        if (e.type === 'INSERT' || e.type === 'DIMENSION') {
          const block = blocks[e.block];
          if (!block || ancestry.includes(e.block) || ancestry.length >= 32) continue;
          const angle = (e.angle || 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
          const sx = e.scaleX ?? 1, sy = e.scaleY ?? 1;
          // Dimension anonymous blocks already contain world coordinates.
          const rows = Math.min(Math.max(e.rows || 1, 1), 1000), columns = Math.min(Math.max(e.columns || 1, 1), 1000);
          for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
            const a = cos*sx, b = sin*sx, c = -sin*sy, d = cos*sy;
            const dx = col*(e.columnSpacing || 0), dy = row*(e.rowSpacing || 0);
            const local = e.type === 'DIMENSION' ? identity : [a, b, c, d, (e.x || 0)-a*block.x-c*block.y+cos*dx-sin*dy, (e.y || 0)-b*block.x-d*block.y+sin*dx+cos*dy];
            const inherited = { ...e, color: e.color == null || e.color === 256 ? layers[e.layer].color : e.color };
            visit(block.entities, multiply(m, local), inherited, [...ancestry, e.block]);
          }
          continue;
        }
        if (e.type === 'LINE') {
          const p = point(m, e.x1, e.y1), q = point(m, e.x2, e.y2);
          Object.assign(e, { x1: p.x, y1: p.y, x2: q.x, y2: q.y });
        } else if (['LWPOLYLINE', 'POLYLINE'].includes(e.type)) {
          const det = m[0]*m[3]-m[1]*m[2];
          e.vertices = e.vertices.map(v => ({ ...v, ...point(m, v.x, v.y), bulge: (v.bulge || 0)*(det < 0 ? -1 : 1) }));
        } else if (['CIRCLE', 'ARC', 'ELLIPSE'].includes(e.type)) {
          if (ancestry.length || e.extrusion) {
            const pts = [], ellipse = e.type === 'ELLIPSE';
            const start = e.type === 'CIRCLE' ? 0 : ellipse ? e.startAngle : e.startAngle*Math.PI/180;
            let end = e.type === 'CIRCLE' ? 2*Math.PI : ellipse ? e.endAngle : e.endAngle*Math.PI/180;
            if (end <= start) end += 2*Math.PI;
            const steps = Math.max(8, Math.ceil((end-start)*24));
            for (let i = 0; i <= steps; i++) {
              const t = start+(end-start)*i/steps;
              pts.push(point(m, e.cx+(ellipse ? e.mx*Math.cos(t)-e.my*e.ratio*Math.sin(t) : e.r*Math.cos(t)), e.cy+(ellipse ? e.my*Math.cos(t)+e.mx*e.ratio*Math.sin(t) : e.r*Math.sin(t))));
            }
            e.type = 'LWPOLYLINE'; e.vertices = pts; e.closed = original.type === 'CIRCLE';
          }
        } else if (['TEXT', 'MTEXT', 'ATTRIB'].includes(e.type)) {
          const angle = (e.angle || 0)*Math.PI/180;
          const textMatrix = multiply(m, [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0]);
          e.textTransform = textMatrix.slice(0, 4);
          const p = point(m, e.x, e.y);
          if (e.alignX !== undefined && e.alignY !== undefined) {
            const q = point(m, e.alignX, e.alignY); e.alignX = q.x; e.alignY = q.y;
          }
          e.x = p.x; e.y = p.y;
          e.angle = Math.atan2(textMatrix[1], textMatrix[0])*180/Math.PI;
        } else if (e.type === 'SPLINE') {
          e.controlPoints = e.controlPoints.map(p => point(m, p.x, p.y));
          e.fitPoints = e.fitPoints.map(p => point(m, p.x, p.y));
        }
        output.push(e);
      }
    };
    visit(entities, identity, null, []);
    return output;
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
      // Small drawings do not have enough samples for percentile clustering.
      // In particular ceil(n * .95) may equal n and produce NaN bounds.
      if (n < 20) return { lo: arr[0], hi: arr[n - 1] };

      // Find the biggest gap (skip top/bottom 5% to avoid outlier-induced gaps)
      const safeStart = Math.floor(n * 0.05);
      const safeEnd = Math.min(n - 1, Math.ceil(n * 0.95));
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
