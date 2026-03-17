/**
 * Local DWG conversion server.
 * Uses libredwg-web to parse DWG, computes bounds from model-space entities
 * using histogram clustering, inverts white strokes, rasterizes to PNG via sharp.
 */
import { createServer } from 'http';
import { LibreDwg } from '@mlightcad/libredwg-web';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmDir = join(__dirname, 'node_modules/@mlightcad/libredwg-web/wasm');
const PORT = 3001;

let libInstance = null;
async function getLib() {
  if (!libInstance) libInstance = await LibreDwg.create(wasmDir);
  return libInstance;
}

function invertWhiteStrokes(svg) {
  return svg
    .replace(/stroke="rgb\(255,255,255\)"/g, 'stroke="rgb(40,40,40)"')
    .replace(/fill="rgb\(255,255,255\)"/g, 'fill="rgb(40,40,40)"')
    .replace(/stroke="rgb\(214,214,214\)"/g, 'stroke="rgb(80,80,80)"')
    .replace(/fill="rgb\(214,214,214\)"/g, 'fill="rgb(80,80,80)"')
    .replace(/stroke="rgb\(192,192,192\)"/g, 'stroke="rgb(100,100,100)"')
    .replace(/fill="rgb\(192,192,192\)"/g, 'fill="rgb(100,100,100)"')
    .replace(/stroke="rgb\(91,91,91\)"/g, 'stroke="rgb(120,120,120)"')
    .replace(/fill="rgb\(91,91,91\)"/g, 'fill="rgb(120,120,120)"')
    .replace(/stroke="rgb\(128,128,128\)"/g, 'stroke="rgb(110,110,110)"')
    .replace(/fill="rgb\(128,128,128\)"/g, 'fill="rgb(110,110,110)"');
}

function getEntityPoints(entity) {
  const points = [];
  const t = entity.type;
  if (t === 'LINE' && entity.startPoint && entity.endPoint) {
    points.push(entity.startPoint, entity.endPoint);
  } else if ((t === 'CIRCLE' || t === 'ARC') && entity.center) {
    const r = entity.radius || 0;
    points.push({ x: entity.center.x - r, y: entity.center.y - r },
                { x: entity.center.x + r, y: entity.center.y + r });
  } else if ((t === 'LWPOLYLINE' || t === 'POLYLINE_2D') && entity.points) {
    for (const p of entity.points) points.push(p);
  } else if ((t === 'TEXT' || t === 'MTEXT') && entity.insertionPoint) {
    points.push(entity.insertionPoint);
  } else if (t === 'INSERT' && entity.insertionPoint) {
    points.push(entity.insertionPoint);
  } else if (t === 'ELLIPSE' && entity.center) {
    points.push(entity.center);
  } else if (t === 'SPLINE' && entity.controlPoints) {
    for (const p of entity.controlPoints) points.push(p);
  } else if (t === 'HATCH' && entity.seedPoints) {
    for (const p of entity.seedPoints) points.push(p);
  }
  return points;
}

function findClusterBounds(entities) {
  const allPairs = [];
  for (const ent of entities) {
    for (const p of getEntityPoints(ent)) {
      if (p && isFinite(p.x) && isFinite(p.y)) allPairs.push(p);
    }
  }
  if (allPairs.length === 0) return null;

  const xs = allPairs.map(p => p.x).sort((a, b) => a - b);
  const globalMin = xs[0], globalMax = xs[xs.length - 1];
  const totalRange = globalMax - globalMin;
  if (totalRange < 1) return { minX: globalMin - 500, minY: -500, maxX: globalMax + 500, maxY: 500 };

  // Histogram clustering on X axis
  const nBins = 200;
  const binW = totalRange / nBins;
  const bins = new Int32Array(nBins);
  for (const x of xs) bins[Math.min(Math.floor((x - globalMin) / binW), nBins - 1)]++;

  // Find ALL clusters (contiguous runs separated by gaps > 3 empty bins)
  const clusters = [];
  let curStart = -1, curCount = 0, gapCount = 0;
  for (let i = 0; i < nBins; i++) {
    if (bins[i] > 0) {
      if (curStart < 0) curStart = i;
      curCount += bins[i];
      gapCount = 0;
    } else {
      gapCount++;
      if (gapCount > 3) {
        if (curCount > 0) clusters.push({ start: curStart, end: i - gapCount, count: curCount });
        curStart = -1; curCount = 0; gapCount = 0;
      }
    }
  }
  if (curCount > 0) clusters.push({ start: curStart, end: nBins - 1, count: curCount });

  // Pick the rightmost SIGNIFICANT cluster (>1% of total points)
  // Block definitions cluster near origin; actual drawing is offset
  const minCount = allPairs.length * 0.01;
  const significant = clusters.filter(c => c.count >= minCount);
  const chosen = significant.length > 0 ? significant[significant.length - 1] : clusters[clusters.length - 1];

  const clusterXMin = globalMin + chosen.start * binW;
  const clusterXMax = globalMin + (chosen.end + 1) * binW;
  console.log(`  Clusters: ${clusters.length}, significant: ${significant.length}`);
  console.log(`  Chosen: bins [${chosen.start}-${chosen.end}] count=${chosen.count}/${allPairs.length} X=[${clusterXMin.toFixed(0)},${clusterXMax.toFixed(0)}]`);

  const inCluster = allPairs.filter(p => p.x >= clusterXMin && p.x <= clusterXMax);
  const cxs = inCluster.map(p => p.x).sort((a, b) => a - b);
  const cys = inCluster.map(p => p.y).sort((a, b) => a - b);
  const cn = cxs.length;

  return {
    minX: cxs[Math.floor(cn * 0.01)],
    maxX: cxs[Math.floor(cn * 0.99)],
    minY: cys[Math.floor(cn * 0.01)],
    maxY: cys[Math.floor(cn * 0.99)]
  };
}

function findClusterBoundsFromPairs(pairs) {
  if (pairs.length === 0) return null;
  const xs = pairs.map(p => p.x).filter(isFinite).sort((a, b) => a - b);
  if (xs.length < 2) return null;
  const globalMin = xs[0], globalMax = xs[xs.length - 1];
  const totalRange = globalMax - globalMin;
  if (totalRange < 1) return { minX: globalMin - 500, minY: -500, maxX: globalMax + 500, maxY: 500 };

  const nBins = 200;
  const binW = totalRange / nBins;
  const bins = new Int32Array(nBins);
  for (const x of xs) bins[Math.min(Math.floor((x - globalMin) / binW), nBins - 1)]++;

  const clusters = [];
  let curStart = -1, curCount = 0, gapCount = 0;
  for (let i = 0; i < nBins; i++) {
    if (bins[i] > 0) {
      if (curStart < 0) curStart = i;
      curCount += bins[i];
      gapCount = 0;
    } else {
      gapCount++;
      if (gapCount > 3) {
        if (curCount > 0) clusters.push({ start: curStart, end: i - gapCount, count: curCount });
        curStart = -1; curCount = 0; gapCount = 0;
      }
    }
  }
  if (curCount > 0) clusters.push({ start: curStart, end: nBins - 1, count: curCount });

  // Pick the densest cluster (most points)
  let chosen = clusters[0];
  for (const c of clusters) { if (c.count > chosen.count) chosen = c; }

  const clusterXMin = globalMin + chosen.start * binW;
  const clusterXMax = globalMin + (chosen.end + 1) * binW;
  console.log(`  SVG clusters: ${clusters.length}`);
  console.log(`  Chosen: count=${chosen.count}/${pairs.length} X=[${clusterXMin.toFixed(0)},${clusterXMax.toFixed(0)}]`);

  const inCluster = pairs.filter(p => isFinite(p.x) && isFinite(p.y) && p.x >= clusterXMin && p.x <= clusterXMax);
  const cxs = inCluster.map(p => p.x).sort((a, b) => a - b);
  const cys = inCluster.map(p => p.y).sort((a, b) => a - b);
  const cn = cxs.length;

  // Use IQR on Y to remove vertical outliers within the X cluster
  const yQ1 = cys[Math.floor(cn * 0.25)], yQ3 = cys[Math.floor(cn * 0.75)];
  const yIQR = yQ3 - yQ1;
  const yLo = yQ1 - 1.5 * yIQR, yHi = yQ3 + 1.5 * yIQR;
  const filteredY = cys.filter(y => y >= yLo && y <= yHi);

  return {
    minX: cxs[Math.floor(cn * 0.02)], maxX: cxs[Math.floor(cn * 0.98)],
    minY: filteredY[0] || cys[Math.floor(cn * 0.05)],
    maxY: filteredY[filteredY.length - 1] || cys[Math.floor(cn * 0.95)]
  };
}

const _insUnitsToMeters = { 1: 0.0254, 2: 0.3048, 3: 1609.344, 4: 0.001, 5: 0.01, 6: 1.0, 7: 1000.0 };

async function convertDWG(buffer) {
  const lib = await getLib();
  const dataPtr = lib.dwg_read_data(buffer, 0);
  if (!dataPtr) throw new Error('Cannot read DWG file');

  const db = lib.convert(dataPtr);
  lib.dwg_free(dataPtr);

  console.log(`  Entities: ${db.entities?.length}, INSUNITS: ${db.header.INSUNITS}`);

  // Extract layer info from database
  const layers = {};
  if (db.tables && db.tables.LAYER && db.tables.LAYER.entries) {
    for (const layer of db.tables.LAYER.entries) {
      if (layer.name) {
        layers[layer.name] = {
          color: layer.color != null ? Math.abs(layer.color) : 7,
          entityCount: 0
        };
      }
    }
  }
  // Count entities per layer
  if (db.entities) {
    for (const ent of db.entities) {
      const ln = ent.layer || '0';
      if (!layers[ln]) layers[ln] = { color: 7, entityCount: 0 };
      layers[ln].entityCount++;
    }
  }
  console.log(`  Layers: ${Object.keys(layers).length}`);

  // Generate SVG first, then fix missing <use> references
  let rawSvg = lib.dwg_to_svg(db);
  if (!rawSvg || rawSvg.length < 100) throw new Error('Empty SVG');
  console.log(`  Raw SVG: ${(rawSvg.length / 1024).toFixed(0)} KB`);

  // Fix: inject <use> for unreferenced blocks in <defs>
  // libredwg sometimes puts block content in <defs> but forgets to <use> them
  const defsEnd = rawSvg.indexOf('</defs>');
  if (defsEnd > 0) {
    const defsSection = rawSvg.substring(0, defsEnd);
    const mainSection = rawSvg.substring(defsEnd);
    // Find all group IDs in defs
    const allIds = [...defsSection.matchAll(/<g id="([^"]+)"/g)].map(m => m[1]);
    // Find which are referenced by <use href="#...">
    const usedIds = new Set([...mainSection.matchAll(/href="#([^"]+)"/g)].map(m => m[1]));
    // Find large unreferenced blocks (likely floor plan content)
    // A block ID that looks like a GUID or has many child elements
    const unreferenced = allIds.filter(id => !usedIds.has(id) && /[a-f0-9]{8}-/i.test(id));
    if (unreferenced.length > 0) {
      console.log(`  Injecting ${unreferenced.length} unreferenced block(s): ${unreferenced.join(', ').slice(0, 80)}`);
      const useElements = unreferenced.map(id => `<use href="#${id}" />`).join('\n');
      rawSvg = rawSvg.replace('</svg>', useElements + '</svg>');
    }
  }

  // Extract SVG coordinates (x,y pairs) including <use> transform translate
  const svgPairs = [];
  let sm;
  const lineRe2 = /x1="([^"]+)"[^>]*?y1="([^"]+)"[^>]*?x2="([^"]+)"[^>]*?y2="([^"]+)"/g;
  while ((sm = lineRe2.exec(rawSvg))) {
    svgPairs.push({ x: parseFloat(sm[1]), y: parseFloat(sm[2]) });
    svgPairs.push({ x: parseFloat(sm[3]), y: parseFloat(sm[4]) });
  }
  const pathRe2 = /\bd="([^"]+)"/g;
  while ((sm = pathRe2.exec(rawSvg))) {
    const cRe = /[ML]\s*(-?[\d.]+)[,\s]+(-?[\d.]+)/gi;
    let cm2;
    while ((cm2 = cRe.exec(sm[1]))) svgPairs.push({ x: parseFloat(cm2[1]), y: parseFloat(cm2[2]) });
  }
  const circRe2 = /<circle[^>]*?cx="([^"]+)"[^>]*?cy="([^"]+)"/g;
  while ((sm = circRe2.exec(rawSvg))) svgPairs.push({ x: parseFloat(sm[1]), y: parseFloat(sm[2]) });
  // <use> elements with transform="translate(x,y)"
  const useRe = /translate\((-?[\d.eE+-]+)[,\s]+(-?[\d.eE+-]+)\)/g;
  while ((sm = useRe.exec(rawSvg))) svgPairs.push({ x: parseFloat(sm[1]), y: parseFloat(sm[2]) });
  console.log(`  SVG coord pairs: ${svgPairs.length}`);

  // Histogram clustering on SVG X coordinates — pick rightmost significant cluster
  const bounds = findClusterBoundsFromPairs(svgPairs);
  if (!bounds) throw new Error('No SVG coordinates found');

  // Padding 5%
  const padX = (bounds.maxX - bounds.minX) * 0.05;
  const padY = (bounds.maxY - bounds.minY) * 0.05;
  bounds.minX -= padX; bounds.minY -= padY;
  bounds.maxX += padX; bounds.maxY += padY;
  console.log(`  Final bounds: [${bounds.minX.toFixed(0)},${bounds.minY.toFixed(0)}]-[${bounds.maxX.toFixed(0)},${bounds.maxY.toFixed(0)}]`);

  const vbW = bounds.maxX - bounds.minX;
  const vbH = bounds.maxY - bounds.minY;

  // Add dark background rect and keep original colors (like CAD viewers)
  let svg = rawSvg.replace(/viewBox="[^"]*"/, `viewBox="${bounds.minX} ${bounds.minY} ${vbW} ${vbH}"`);
  svg = svg.replace(/(<svg\s[^>]*?)width="[^"]*"/, `$1width="${vbW}"`);
  svg = svg.replace(/(<svg\s[^>]*?)height="[^"]*"/, `$1height="${vbH}"`);
  // Insert dark background rect right after <svg ...>
  svg = svg.replace(/(<svg[^>]*>)/, `$1<rect x="${bounds.minX}" y="${bounds.minY}" width="${vbW}" height="${vbH}" fill="#2d2d2d"/>`);

  // Units
  let metersPerUnit = _insUnitsToMeters[db.header.INSUNITS] || null;
  if (!metersPerUnit) {
    const maxDim = Math.max(vbW, vbH);
    if (maxDim > 10000) metersPerUnit = 0.001;
    else if (maxDim > 500) metersPerUnit = 0.01;
    else metersPerUnit = 1.0;
  }

  // Rasterize
  const MAX_PX = 8192;
  const aspect = vbW / vbH;
  let pngW, pngH;
  if (aspect >= 1) { pngW = MAX_PX; pngH = Math.round(MAX_PX / aspect); }
  else { pngH = MAX_PX; pngW = Math.round(MAX_PX * aspect); }

  console.log(`  Rasterizing ${pngW}x${pngH}px...`);
  const pngBuffer = await sharp(Buffer.from(svg), {
    density: 300,
    limitInputPixels: false,
    unlimited: true
  })
    .resize(pngW, pngH, { fit: 'fill' })
    .flatten({ background: { r: 45, g: 45, b: 45 } })
    .png()
    .toBuffer();

  console.log(`  PNG: ${(pngBuffer.length / 1024).toFixed(0)} KB`);

  const pngBase64 = pngBuffer.toString('base64');
  const optimizedSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" `
    + `width="${pngW}" height="${pngH}" viewBox="${bounds.minX} ${bounds.minY} ${vbW} ${vbH}">`
    + `<image href="data:image/png;base64,${pngBase64}" x="${bounds.minX}" y="${bounds.minY}" `
    + `width="${vbW}" height="${vbH}" preserveAspectRatio="none"/>`
    + `</svg>`;

  return { svg: optimizedSvg, bounds, metersPerUnit, layers };
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/convert') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);
        console.log(`Converting DWG: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
        const result = await convertDWG(buffer.buffer);
        const json = JSON.stringify({ svg: result.svg, bounds: result.bounds, metersPerUnit: result.metersPerUnit, layers: result.layers });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(json);
        console.log(`  Done! ${(json.length / 1024).toFixed(0)} KB`);
      } catch (err) {
        console.error('  Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else { res.writeHead(404); res.end('Not found'); }
});

server.listen(PORT, () => console.log(`DWG server on http://localhost:${PORT}`));
