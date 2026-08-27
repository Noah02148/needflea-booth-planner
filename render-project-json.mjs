/**
 * render-project-json.mjs — reference consumer for NEEDFLEA project JSON (v3+).
 *
 * Demonstrates that a project JSON is self-contained: it rebuilds the booth
 * plan purely from `venue.entities` (portable CAD geometry) + `items` (booth
 * annotations), with no CAD parser and no access to the planner app.
 *
 * Usage:  node render-project-json.mjs <project.json> [out.png]
 *
 * Venue schema (`venue.schema === 'needflea-venue/1'`):
 *   coordinates: CAD world units, Y-up; meters = units × metersPerUnit
 *   venue.layers   [{name, color, visible}]
 *   venue.entities [
 *     {type:'line',     layer, color, lineType, x1,y1,x2,y2}
 *     {type:'polyline', layer, color, lineType, closed, points:[[x,y],…]}
 *     {type:'circle',   layer, color, cx,cy,r}
 *     {type:'arc',      layer, color, cx,cy,r, startAngle,endAngle}   // degrees CCW
 *     {type:'text',     layer, color, x,y, height, angle, text}
 *   ]
 *   items: booth = {type:'booth', wx,wy (top-left), ww,wh, angle (deg CCW,
 *          about center), cat, label}; colors per cat in top-level `categories`.
 */
import { readFileSync, writeFileSync } from 'fs';
import sharp from 'sharp';

const [, , jsonPath, outPath] = process.argv;
if (!jsonPath) {
  console.error('Usage: node render-project-json.mjs <project.json> [out.png]');
  process.exit(1);
}
const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
const venue = data.venue;
if (!venue || venue.schema !== 'needflea-venue/1') {
  console.error('该 JSON 不含 venue 数据（需要用新版规划工具重新保存项目）。');
  process.exit(1);
}

const { bounds } = venue;
const bw = bounds.maxX - bounds.minX, bh = bounds.maxY - bounds.minY;
const W = 3000, H = Math.round(W * bh / bw);
const scale = W / bw;
const px = x => (x * scale - bounds.minX * scale).toFixed(1);
const py = y => (-y * scale + bounds.maxY * scale).toFixed(1);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const visible = new Set(venue.layers.filter(l => l.visible).map(l => l.name));
// base map drawn in light theme: flip near-white CAD colors to dark
const ink = c => {
  const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
  return (r * 0.299 + g * 0.587 + b * 0.114 > 180) ? '#555555' : c;
};
const dash = lt => {
  if (!lt) return '';
  if (lt.includes('DASH') && !lt.includes('DOT')) return ' stroke-dasharray="8 4"';
  if (lt.includes('HIDDEN')) return ' stroke-dasharray="4 3"';
  if (lt.includes('CENTER')) return ' stroke-dasharray="14 4 4 4"';
  if (lt.includes('DOT')) return ' stroke-dasharray="2 3"';
  return '';
};

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">\n<rect width="${W}" height="${H}" fill="#ffffff"/>\n`;

// ── CAD base map ──
for (const e of venue.entities) {
  if (!visible.has(e.layer)) continue;
  const c = ink(e.color), da = dash((e.lineType || '').toUpperCase());
  if (e.type === 'line')
    svg += `<line x1="${px(e.x1)}" y1="${py(e.y1)}" x2="${px(e.x2)}" y2="${py(e.y2)}" stroke="${c}" stroke-width="0.6"${da}/>\n`;
  else if (e.type === 'polyline')
    svg += `<path d="${e.points.map((p, i) => `${i ? 'L' : 'M'}${px(p[0])},${py(p[1])}`).join(' ')}${e.closed ? ' Z' : ''}" stroke="${c}" stroke-width="0.6" fill="none"${da}/>\n`;
  else if (e.type === 'circle')
    svg += `<circle cx="${px(e.cx)}" cy="${py(e.cy)}" r="${(e.r * scale).toFixed(1)}" stroke="${c}" stroke-width="0.5" fill="none"/>\n`;
  else if (e.type === 'arc') {
    const sa = e.startAngle * Math.PI / 180, ea = e.endAngle * Math.PI / 180;
    const large = Math.abs(ea - sa) > Math.PI ? 1 : 0, sweep = ea > sa ? 0 : 1;
    svg += `<path d="M${px(e.cx + e.r * Math.cos(sa))},${py(e.cy + e.r * Math.sin(sa))} A${(e.r * scale).toFixed(1)},${(e.r * scale).toFixed(1)} 0 ${large},${sweep} ${px(e.cx + e.r * Math.cos(ea))},${py(e.cy + e.r * Math.sin(ea))}" stroke="${c}" stroke-width="0.5" fill="none"/>\n`;
  } else if (e.type === 'text') {
    const fs = Math.max(4, Math.min(11, e.height * scale));
    svg += `<text x="${px(e.x)}" y="${py(e.y)}" fill="${c}" font-size="${fs.toFixed(0)}" font-family="sans-serif">${esc(e.text)}</text>\n`;
  }
}

// ── booth overlay ──
const cats = data.categories || {};
for (const item of data.items || []) {
  if (item.type !== 'booth') continue;
  const col = cats[item.cat] || { fill: '#9B7FD4', stroke: '#7055b0' };
  const cx = item.wx + item.ww / 2, cy = item.wy + item.wh / 2;
  const sw = item.ww * scale, sh = item.wh * scale;
  svg += `<g transform="translate(${px(cx)},${py(cy)}) rotate(${-(item.angle || 0)})">` +
    `<rect x="${-sw / 2}" y="${-sh / 2}" width="${sw}" height="${sh}" rx="${Math.min(sw, sh) * 0.12}" fill="${col.fill}" fill-opacity="0.85" stroke="${col.stroke}" stroke-width="1.2"/>`;
  if (item.label) {
    const fs = Math.max(6, Math.min(sw * 0.36, sh * 0.4, (sw * 0.92) / Math.max(1, item.label.length) * 1.6, 16));
    svg += `<text transform="rotate(${item.angle || 0})" text-anchor="middle" dominant-baseline="central" fill="#1a1a1a" stroke="#ffffff" stroke-width="${fs * 0.25}" paint-order="stroke" font-weight="bold" font-size="${fs.toFixed(1)}" font-family="sans-serif">${esc(item.label)}</text>`;
  }
  svg += `</g>\n`;
}
svg += `</svg>`;

const out = outPath || jsonPath.replace(/\.json$/i, '') + '.png';
await sharp(Buffer.from(svg)).png().toFile(out);
console.log(`rendered ${out}  (${W}x${H}, ${venue.entities.length} CAD entities, ${(data.items || []).filter(i => i.type === 'booth').length} booths)`);
