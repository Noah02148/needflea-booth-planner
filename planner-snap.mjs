// Keep the original world coordinates. The portable venue export rounds coordinates for JSON.
export function buildSnapIndex(layers, rings) {
  const segments = [];
  function add(a, b, layers = []) {
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite) || (a.x === b.x && a.y === b.y)) return;
    segments.push({
      a,
      b,
      layers,
      left: Math.min(a.x, b.x),
      right: Math.max(a.x, b.x),
      bottom: Math.min(a.y, b.y),
      top: Math.max(a.y, b.y)
    });
  }
  function polyline(points, closed, layers) {
    for (let i = 0; i < points.length - (closed ? 0 : 1); i++) {
      if (!points[i].bulge) add(points[i], points[(i + 1) % points.length], layers);
    }
  }
  for (const [name, entities] of Object.entries(layers)) {
    for (const e of entities) {
      if (e.visible === false) continue;
      const parents = e.sourceLayers?.length ? [name, ...e.sourceLayers] : [name];
      if (e.type === 'LINE' || e.t === 'L') add({ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }, parents);
      else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') polyline(e.vertices || [], e.closed, parents);
      else if (e.t === 'P')
        polyline(
          e.pts.map(([x, y]) => ({ x, y })),
          e.closed,
          parents
        );
    }
  }
  for (const ring of rings) polyline(ring, true, []);
  // Query only branches under the cursor, including on large campus plans.
  function tree(list) {
    if (!list.length) return null;
    const node = { left: Infinity, right: -Infinity, bottom: Infinity, top: -Infinity };
    for (const s of list) {
      node.left = Math.min(node.left, s.left);
      node.right = Math.max(node.right, s.right);
      node.bottom = Math.min(node.bottom, s.bottom);
      node.top = Math.max(node.top, s.top);
    }
    if (list.length <= 16) node.segments = list;
    else {
      if (node.right - node.left >= node.top - node.bottom)
        list.sort((a, b) => a.left + a.right - b.left - b.right);
      else list.sort((a, b) => a.bottom + a.top - b.bottom - b.top);
      const mid = Math.floor(list.length / 2);
      node.children = [tree(list.slice(0, mid)), tree(list.slice(mid))];
    }
    return node;
  }
  return tree(segments);
}

function project(p, s) {
  const dx = s.b.x - s.a.x,
    dy = s.b.y - s.a.y;
  const t = Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / (dx * dx + dy * dy)));
  return { x: s.a.x + t * dx, y: s.a.y + t * dy };
}
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function crossing(s, t) {
  const dx = s.b.x - s.a.x,
    dy = s.b.y - s.a.y,
    ex = t.b.x - t.a.x,
    ey = t.b.y - t.a.y;
  const det = dx * ey - dy * ex;
  if (Math.abs(det) <= 1e-12 * Math.hypot(dx, dy) * Math.hypot(ex, ey)) return;
  const x = t.a.x - s.a.x,
    y = t.a.y - s.a.y,
    u = (x * ey - y * ex) / det,
    v = (x * dy - y * dx) / det;
  if (u >= 0 && u <= 1 && v >= 0 && v <= 1) return { x: s.a.x + u * dx, y: s.a.y + u * dy };
}

export function snapPoint(index, p, radius, previous, visibility) {
  const near = [];
  function visit(node) {
    if (
      !node ||
      p.x + radius < node.left ||
      p.x - radius > node.right ||
      p.y + radius < node.bottom ||
      p.y - radius > node.top
    )
      return;
    if (node.children) {
      node.children.forEach(visit);
      return;
    }
    for (const s of node.segments) {
      if (s.layers.some((l) => visibility[l] === false)) continue;
      const q = project(p, s),
        d = distance(p, q);
      if (d <= radius) near.push({ s, q, d });
    }
  }
  visit(index);
  if (!near.length) return { point: p };
  near.sort((a, b) => a.d - b.d);
  // If the previous vertex lies on a nearby wall, keep tracing that wall through small cursor errors.
  const tolerance = Math.max(radius * 1e-6, Number.EPSILON * Math.max(Math.abs(p.x), Math.abs(p.y)) * 8);
  const anchored = previous && near.find((v) => distance(previous, project(previous, v.s)) <= tolerance);
  const edge = anchored || near[0];
  let corner,
    best = radius;
  function consider(q) {
    if (!q) return;
    if (anchored && distance(q, project(q, edge.s)) > tolerance) return;
    const d = distance(p, q);
    if (d <= best) {
      best = d;
      corner = q;
    }
  }
  for (const { s } of near) {
    consider(s.a);
    consider(s.b);
    consider(crossing(edge.s, s));
  }
  return { point: corner ? { x: corner.x, y: corner.y } : edge.q, segment: edge.s, corner: !!corner };
}
