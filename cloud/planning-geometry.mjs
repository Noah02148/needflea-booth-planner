const clipping =
  globalThis.polygonClipping || (await import("polygon-clipping")).default;
import {
  footprint,
  problems,
  rectangle,
  strategies,
} from "./planning-input.mjs";

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const ring = (points) => [points.map((p) => [p.x, p.y])];
const validPoint = (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y);
const check = (ok, msg) => {
  if (!ok) throw new Error(msg);
};
function bounds(p) {
  return {
    l: Math.min(...p.map((q) => q.x)),
    r: Math.max(...p.map((q) => q.x)),
    b: Math.min(...p.map((q) => q.y)),
    t: Math.max(...p.map((q) => q.y)),
  };
}
function polygon(points) {
  check(
    Array.isArray(points) &&
      points.length >= 3 &&
      points.length <= 1024 &&
      points.every(validPoint),
    "轮廓坐标无效",
  );
  // Stable CAD precision prevents almost coincident sweep edges from
  // producing invalid boolean rings at large world-coordinate offsets.
  points = points.map((p) => ({x:Math.round(p.x*1e6)/1e6,y:Math.round(p.y*1e6)/1e6}));
  return { points, box: bounds(points), ring: ring(points) };
}
function overlap(a, b) {
  if (
    a.box.r <= b.box.l ||
    b.box.r <= a.box.l ||
    a.box.t <= b.box.b ||
    b.box.t <= a.box.b
  )
    return false;
  return significantArea(clipping.intersection(a.ring, b.ring), Math.min(ringArea(a.ring), ringArea(b.ring)));
}
function simple(p) {
  const cross = (a, b, c) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i < p.length; i++) {
    const a = p[i],
      b = p[(i + 1) % p.length];
    if (!dist(a, b)) return false;
    for (let j = i + 2; j < p.length; j++) {
      if (!i && j === p.length - 1) continue;
      const c = p[j],
        d = p[(j + 1) % p.length];
      if (
        Math.max(a.x, b.x) < Math.min(c.x, d.x) ||
        Math.max(c.x, d.x) < Math.min(a.x, b.x) ||
        Math.max(a.y, b.y) < Math.min(c.y, d.y) ||
        Math.max(c.y, d.y) < Math.min(a.y, b.y)
      )
        continue;
      if (
        cross(a, b, c) * cross(a, b, d) <= 0 &&
        cross(c, d, a) * cross(c, d, b) <= 0
      )
        return false;
    }
  }
  return true;
}
// Measure with a translated origin: large CAD coordinates otherwise turn
// touching edges into numerical slivers. Tolerance is an area ratio, not a
// planning clearance, and remains identical in metres and millimetres.
function ringArea(rings) {
  return rings.reduce((sum, points, i) => {
    const [ox, oy] = points[0];
    const area = Math.abs(points.reduce((a, p, j) => {
      const q = points[(j + 1) % points.length];
      return a + (p[0] - ox) * (q[1] - oy) - (q[0] - ox) * (p[1] - oy);
    }, 0)) / 2;
    return sum + (i ? -area : area);
  }, 0);
}
function significantArea(polygons, reference) {
  return polygons.reduce((a, p) => a + ringArea(p), 0) > reference * 1e-6;
}
function within(poly, domain) {
  return !significantArea(clipping.difference(poly.ring, domain), ringArea(poly.ring));
}
function corridor(points, width) {
  const strips = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      len = dist(a, b);
    if (!len) continue;
    const x = (((b.y - a.y) / len) * width) / 2,
      y = (((a.x - b.x) / len) * width) / 2;
    strips.push(
      polygon([
        { x: a.x + x, y: a.y + y },
        { x: b.x + x, y: b.y + y },
        { x: b.x - x, y: b.y - y },
        { x: a.x - x, y: a.y - y },
      ]),
    );
    if (i < points.length - 1) {
      // A swept turn has a round join, not an axis-aligned square. Include
      // exact segment normals in the tangent polygon so an oblique frontage
      // is never clipped by a corner of the join's approximation.
      const next = points[i + 1];
      const angles = Array.from({length: 24}, (_, k) => k * Math.PI / 12);
      for (const heading of [Math.atan2(b.y-a.y,b.x-a.x), Math.atan2(next.y-b.y,next.x-b.x)])
        for (const sign of [-1, 1]) angles.push((heading + sign*Math.PI/2 + 2*Math.PI) % (2*Math.PI));
      angles.sort((x,y) => x-y);
      const unique = angles.filter((x,k) => !k || x-angles[k-1] > 1e-10);
      const join = unique.map((angle,k) => {
        const end = k+1 < unique.length ? unique[k+1] : unique[0]+2*Math.PI;
        const mid = (angle+end)/2, radius = width/2/Math.cos((end-angle)/2);
        return {x:b.x+radius*Math.cos(mid),y:b.y+radius*Math.sin(mid)};
      });
      strips.push(polygon(join));
    }
  }
  return strips;
}
export function planningContext(s, env) {
  const issues = problems(s);
  check(!issues.length, issues.join("；"));
  check(
    s.regions.length <= 100 &&
      new Set(s.regions.map((r) => r.id)).size === s.regions.length,
    "区域编号重复或一次区域过多",
  );
  check(
    s.demands.length <= 128 &&
      Array.isArray(s.existing) &&
      s.existing.length <= 10000,
    "一次排布的摊位类型或现有摊位过多",
  );
  const regions = s.regions.map((r) => {
    const p = polygon(r.points);
    check(
      simple(r.points) && clipping.union(p.ring).length,
      "可摆区域自交或面积为零",
    );
    return { ...p, id: r.id, name: r.name };
  });
  const domain = s.localDraft
    ? clipping.union(
        ...regions.map((r) => r.ring),
        ...(s.walkable || []).map(ring),
      )
    : s.boundary
      ? polygon(s.boundary).ring
      : clipping.union(...regions.map((r) => r.ring));
  const defaults = {
    main: Number(env.PLANNER_MAIN_METERS || 3),
    secondary: Number(env.PLANNER_SECONDARY_METERS || 1.5),
  };
  const widths = {},
    sources = {};
  for (const key of Object.keys(defaults)) {
    widths[key] = s.presets?.[key] ?? defaults[key];
    sources[key] = s.presets?.[key] != null ? "项目预设" : "后台规划默认";
    check(Number.isFinite(widths[key]) && widths[key] > 0, "通道净宽预设无效");
  }
  check(
    Array.isArray(s.obstacles) &&
      s.obstacles.length <= 10000 &&
      Array.isArray(s.lanes) &&
      s.lanes.length <= 512,
    "障碍或已有通道数据无效",
  );
  if (s.localDraft)
    for (const z of [...s.zones, ...s.importedZones]) {
      const poly = polygon(z.points);
      check(
        simple(poly.points) && clipping.union(poly.ring).length,
        "禁摆轮廓自交或没有面积，请修改该区域",
      );
    }
  const fixed = s.obstacles.map(polygon);
  const lanes = s.lanes.map((l) => {
    check(
      Array.isArray(l.points) &&
        l.points.length >= 2 &&
        l.points.length <= 1024 &&
        l.points.every(validPoint),
      "锁定通道坐标无效",
    );
    const width = Math.max(
      l.width ?? 0,
      widths[l.kind === "main" ? "main" : "secondary"],
    );
    check(Number.isFinite(width) && width > 0, "锁定通道宽度无效");
    return { ...l, width, kind: "locked" };
  });
  return { s, regions, domain, widths, sources, fixed, lanes };
}
const distinct = (pts) =>
  pts.filter((p, i) => !i || dist(p, pts[i - 1]) > 1e-8);
function clear(c, path, width, blocks) {
  c.s.consume?.(1 + Math.ceil(blocks.length / 16));
  const strips = corridor(path, width / c.s.scale);
  return (
    strips.length &&
    strips.every(
      (p) => within(p, c.domain) && !blocks.some((b) => overlap(p, b)),
    )
  );
}
function gateFootprint(g, scale) {
  return g.a && g.b
    ? corridor([g.a, g.b], 0.02 / scale)
    : [polygon(rectangle(g.center.x, g.center.y, 0.02 / scale, 0.02 / scale))];
}
function mainRoute(c, wide, variant, useOpenings = true) {
  const { s } = c,
    a = s.entrance,
    width = c.widths.main + wide;
  let b = s.exit;
  if (dist(a, b) < 1e-8) {
    const box = c.regions[0].box;
    b = { x: (box.l + box.r) / 2, y: (box.b + box.t) / 2 };
    if (dist(a, b) < 1e-8) b = { x: (a.x + box.r) / 2, y: a.y };
  }
  if (s.localDraft && useOpenings) {
    // Pick an internal aisle in the direction indicated by the entrance/exit.
    // Gate annotations reserve space but do not constrain the aisle endpoints.
    const vertical = Math.abs(b.y - a.y) >= Math.abs(b.x - a.x);
    const candidates = [];
    for (const area of c.regions) {
      const box = area.box,
        inset = width / (2 * s.scale);
      for (const f of [0.5, 0.25, 0.75]) {
        const x = box.l + (box.r - box.l) * f,
          y = box.b + (box.t - box.b) * f;
        for (const fraction of [1, 0.75, 0.5, 0.25]) {
          const halfX = Math.max(0, (box.r - box.l) / 2 - inset) * fraction;
          const halfY = Math.max(0, (box.t - box.b) / 2 - inset) * fraction;
          const cx = (box.l + box.r) / 2,
            cy = (box.b + box.t) / 2;
          const paths = vertical
            ? [
                [
                  { x, y: cy - halfY },
                  { x, y: cy + halfY },
                ],
                [
                  { x: cx - halfX, y },
                  { x: cx + halfX, y },
                ],
              ]
            : [
                [
                  { x: cx - halfX, y },
                  { x: cx + halfX, y },
                ],
                [
                  { x, y: cy - halfY },
                  { x, y: cy + halfY },
                ],
              ];
          for (const path of paths)
            if (dist(...path) > 1e-8 && clear(c, path, width, c.fixed))
              candidates.push(path);
        }
      }
    }
    check(
      candidates.length,
      "场内未找到满足过道净宽的排布空间，请检查可摆区和禁摆区。",
    );
    const points = candidates[variant % candidates.length];
    if (dist(points[0], a) > dist(points[1], a)) points.reverse();
    return { kind: "main", points, width };
  }
  const paths = [
    [a, b],
    [a, { x: a.x, y: b.y }, b],
    [a, { x: b.x, y: a.y }, b],
  ];
  for (const f of [0.25, 0.5, 0.75])
    for (const area of c.regions) {
      const { l, r, t, b: bottom } = area.box,
        x = l + (r - l) * f,
        y = bottom + (t - bottom) * f;
      paths.push(
        [a, { x, y: a.y }, { x, y: b.y }, b],
        [a, { x: a.x, y }, { x: b.x, y }, b],
      );
    }
  for (let k = 0; k < paths.length; k++) {
    const path = distinct(paths[(k + variant) % paths.length]);
    if (clear(c, path, width, c.fixed))
      return { kind: "main", points: path, width };
  }
  throw new Error(
    "本次路线未能按主通道净宽连通入口和出口，请换路线或核对通行边界",
  );
}
function projectOn(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t = Math.max(
      0,
      Math.min(
        1,
        ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
      ),
    );
  return { x: a.x + t * dx, y: a.y + t * dy };
}
function attachments(p, main, horizontal) {
  const paths = [];
  for (let i = 1; i < main.length; i++) {
    const a = main[i - 1],
      b = main[i],
      k = horizontal ? "y" : "x",
      j = horizontal ? "x" : "y";
    if ((p[k] - a[k]) * (p[k] - b[k]) <= 0 && a[k] !== b[k])
      paths.push([
        p,
        {
          [k]: p[k],
          [j]: a[j] + ((p[k] - a[k]) / (b[k] - a[k])) * (b[j] - a[j]),
        },
      ]);
    const q = projectOn(p, a, b);
    paths.push([p, { [k]: p[k], [j]: q[j] }, q], [p, q]);
  }
  return paths.map(distinct).sort((a, b) => length(a) - length(b));
}
const length = (p) => p.slice(1).reduce((n, v, i) => n + dist(v, p[i]), 0);
function counts(c, items) {
  const { s } = c;
  const result = new Map(s.demands.map((d) => [d.id, 0]));
  for (const i of s.existing || []) {
    const d = s.demands.find(
      (d) =>
        i.cat === d.cat &&
        (i.boothStyle || "tent") === d.style &&
        Math.abs(i.ww * s.scale - d.width) < 0.001 &&
        Math.abs(i.wh * s.scale - d.depth) < 0.001,
    );
    if (d) result.set(d.id, result.get(d.id) + 1);
  }
  for (const i of items)
    result.set(i.demandId, (result.get(i.demandId) || 0) + 1);
  return result;
}
function rowSweeps(area, strategy, options, depth, gap) {
  if (options.wallFirst) {
    const rowAngle = options.axis === "vertical" ? 90 : 0;
    const perimeter = rowSweeps(
      area,
      "edge",
      { ...options, wallFirst: false, rowAngle },
      depth,
      gap,
    );
    if (strategy === "edge") return perimeter;
    const interior = rowSweeps(
      area,
      "island",
      { ...options, wallFirst: false, perimeterInset: true },
      depth,
      gap,
    );
    return [...perimeter, ...interior];
  }
  const vertical =
    options.axis === "vertical" ||
    (options.axis !== "horizontal" &&
      area.box.t - area.box.b > area.box.r - area.box.l);
  const preferred = Number.isFinite(options.rowAngle)
    ? options.rowAngle
    : vertical
      ? 90
      : 0;
  const frame = (origin, angle) => {
    const rad = (angle * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad)) < 1e-12 ? 0 : Math.cos(rad),
      sin = Math.abs(Math.sin(rad)) < 1e-12 ? 0 : Math.sin(rad);
    return {
      angle,
      vertical: Math.abs(sin) > Math.abs(cos),
      world: (u, v) => ({
        x: origin.x + u * cos - v * sin,
        y: origin.y + u * sin + v * cos,
      }),
      local: (p) => ({
        x: (p.x - origin.x) * cos + (p.y - origin.y) * sin,
        y: -(p.x - origin.x) * sin + (p.y - origin.y) * cos,
      }),
    };
  };
  if (strategy === "edge") {
    const points = area.points;
    const ccw =
      points.reduce((sum, a, i) => {
        const b = points[(i + 1) % points.length];
        return sum + a.x * b.y - b.x * a.y;
      }, 0) > 0;
    return points
      .map((p, i) => {
        const q = points[(i + 1) % points.length],
          a = ccw ? p : q,
          b = ccw ? q : p;
        const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        return {
          ...frame(a, angle),
          start: 0,
          end: dist(a, b),
          v: 0,
          side: 1,
          wallBack: true,
        };
      })
      .filter(
        (r) =>
          !Number.isFinite(options.rowAngle) ||
          Math.abs(Math.sin(((r.angle - preferred) * Math.PI) / 180)) < 0.12,
      )
      .sort((a, b) => b.end - a.end);
  }
  const axis = frame(area.points[0], preferred),
    box = bounds(area.points.map(axis.local)),
    rows = [];
  for (
    let row = box.b + (options.perimeterInset ? depth + gap : 0);
    row + (options.perimeterInset ? 3 * depth + gap : depth) <= box.t + 1e-8 &&
    rows.length < 3000;
    row += strategy === "island" ? 2 * depth + gap : depth + gap
  ) {
    const line = { ...axis, start: box.l, end: box.r, v: row, side: 1 };
    if (strategy === "island")
      rows.push({ ...line, side: -1 }, { ...line, v: row + depth });
    else rows.push(line);
  }
  return rows;
}
function onScope(i, scope, c) {
  if (scope === "left" || scope === "right") {
    const boxes = c.regions.map((r) => r.box),
      mid =
        (Math.min(...boxes.map((b) => b.l)) +
          Math.max(...boxes.map((b) => b.r))) /
        2;
    const b = bounds(footprint(i));
    return scope === "left" ? b.r <= mid : b.l >= mid;
  }
  return scope === "all" || scope === i.regionId;
}
function lanePolygons(lane, scale) {
  const width = lane.width / scale;
  const result = corridor(lane.points, width);
  if (lane.port)
    result.push(
      polygon(rectangle(lane.port.x, lane.port.y, width, width, lane.angle)),
    );
  return result;
}
function editableRegion(c, scope) {
  const area = c.regions.find((r) => r.id === scope);
  if (area) return area.ring;
  const b = bounds(c.regions.flatMap((r) => r.points)),
    mid = (b.l + b.r) / 2;
  const left = scope === "left" ? b.l : mid,
    right = scope === "left" ? mid : b.r;
  return ring(
    rectangle((left + right) / 2, (b.b + b.t) / 2, right - left, b.t - b.b),
  );
}
function assertLanes(c, lanes, blocks) {
  for (const l of lanes)
    check(clear(c, l.points, l.width, blocks), "通道受阻、越界或净宽不足");
}
export function generate(s, options = {}, prior = null, env = {}) {
  const c = planningContext(s, env),
    strategy = options.strategy || "rows",
    scope = options.scope || "all";
  check(Object.hasOwn(strategies, strategy), "未知排法");
  check(
    !prior ||
      scope === "all" ||
      ["left", "right"].includes(scope) ||
      c.regions.some((r) => r.id === scope),
    "选区不存在",
  );
  const variant = Number(options.variant || 0),
    wide = Number(options.extraWidth || 0);
  check(
    Number.isInteger(variant) &&
      variant >= 0 &&
      variant <= 8 &&
      wide >= 0 &&
      wide <= 5,
    "路线或加宽参数无效",
  );
  const local = prior && scope !== "all";
  const main = local
    ? prior.lanes.find((l) => l.kind === "main")
    : mainRoute(c, wide, variant);
  const items = local ? prior.items.filter((i) => !onScope(i, scope, c)) : [];
  const keep = new Set(items.map((i) => i.id));
  const editable = local ? editableRegion(c, scope) : null;
  const protectedLane = (l) =>
    keep.has(l.owner) ||
    lanePolygons(l, s.scale).some((p) => !within(p, editable));
  const lanes = [
    main,
    ...c.lanes,
    ...(local
      ? prior.lanes.filter((l) => l.kind === "secondary" && protectedLane(l))
      : []),
  ];
  const blocks = [...c.fixed, ...items.map((i) => polygon(footprint(i)))];
  assertLanes(
    c,
    lanes.filter((l) => l.points.length > 1),
    blocks,
  );
  const reserved = lanes.flatMap((l) => lanePolygons(l, s.scale));
  if (s.localDraft) {
    reserved.push(...s.walkable.map(polygon));
    for (const g of s.openings) reserved.push(...gateFootprint(g, s.scale));
  }
  const permittedLanes = local
    ? clipping.union(editable, ...reserved.map((p) => p.ring))
    : null;
  const tally = counts(c, items),
    demandList = [...s.demands];
  let serial =
      Math.max(
        (s.nextId || 1) - 1,
        ...(prior?.items || []).map((i) => i.id),
        ...(s.existing || []).map((i) => i.id),
      ) + 1,
    probes = 0;
  const depth = Math.max(...demandList.map((d) => d.depth)) / s.scale,
    gap = c.widths.secondary / s.scale;
  const rejected = { boundary: 0, occupied: 0, access: 0 };
  for (const area of c.regions) {
    if (!["all", "left", "right", area.id].includes(scope)) continue;
    const sweeps = rowSweeps(area, strategy, options, depth, gap);
    // Fill boundary rows together before adding interior islands. A small
    // requested count must not be exhausted on just the first wall.
    const groups = options.wallFirst
      ? [sweeps.filter((r) => r.wallBack), sweeps.filter((r) => !r.wallBack)]
      : sweeps.map((r) => [r]);
    for (const group of groups) {
      const queue = group.map((r, index) => ({
        ...r,
        id: area.id + ":" + (r.wallBack ? "wall:" : "island:") + index,
        cursor:
          r.start +
          ((variant % 2) * Math.min(...demandList.map((d) => d.width))) /
            s.scale /
            2,
      }));
      while (queue.length && probes++ < 18000) {
        const row = queue.shift();
        const { world, angle, vertical, start, end, v, side, wallBack } = row;
        let u = row.cursor;
        if (u >= end) continue;
        s.consume?.(1);
        const available = demandList
          .filter((d) => tally.get(d.id) < d.max)
          .sort(
            (a, b) =>
              Number(tally.get(b.id) < b.min) - Number(tally.get(a.id) < a.min),
          );
        if (!available.length) break;
        let advance = Math.min(...available.map((d) => d.width)) / s.scale / 2;
        for (const d of available) {
          const w = d.width / s.scale,
            h = d.depth / s.scale,
            cy = v + (wallBack ? h / 2 : side > 0 ? depth - h / 2 : h / 2),
            cx =
              wallBack &&
              (vertical
                ? Math.sin((angle * Math.PI) / 180) < 0
                : Math.cos((angle * Math.PI) / 180) < 0)
                ? end - (u - start) - w / 2
                : u + w / 2;
          const center = world(cx, cy);
          const item = {
            id: serial,
            type: "booth",
            height: 2.5,
            cat: d.cat,
            boothStyle: d.style,
            size: d.width + "x" + d.depth,
            ww: w,
            wh: h,
            wx: center.x - w / 2,
            wy: center.y - h / 2,
            angle,
            frontSide: side,
            wallBack: !!wallBack,
            label: "",
            sizeClass: "standard",
            regionId: area.id,
            demandId: d.id,
          };
          const p = polygon(footprint(item));
          if (
            !onScope(item, scope, c) ||
            !within(p, area.ring) ||
            !within(p, c.domain)
          ) {
            rejected.boundary++;
            continue;
          }
          if ([...blocks, ...reserved].some((b) => overlap(p, b))) {
            rejected.occupied++;
            continue;
          }
          const port = world(cx, cy + (side * (h + gap)) / 2);
          const spine = world((start + end) / 2, cy + (side * (h + gap)) / 2);
          const shared = attachments(spine, main.points, !vertical).map(
            (path) => distinct([port, ...path]),
          );
          const candidates = [
            ...(row.access ? [distinct([port, ...row.access])] : []),
            ...shared,
            ...attachments(port, main.points, !vertical),
          ];
          const portBox = polygon(rectangle(port.x, port.y, gap, gap, angle));
          if (
            !within(portBox, c.domain) ||
            (local && !within(portBox, permittedLanes)) ||
            blocks.some((b) => overlap(portBox, b))
          ) {
            rejected.access++;
            continue;
          }
          const path = candidates.find(
            (path) =>
              path.length === 1 ||
              (clear(c, path, c.widths.secondary, [...blocks, p]) &&
                (!local ||
                  corridor(path, gap).every((strip) =>
                    within(strip, permittedLanes),
                  ))),
          );
          if (!path) {
            rejected.access++;
            continue;
          }
          const l = {
            kind: "secondary",
            points: path,
            width: c.widths.secondary,
            owner: serial,
            port,
            angle,
          };
          // Subsequent booths join the same frontage and reuse its connection.
          // Keep the anchor fixed so extending a row does not reserve new
          // diagonal cross-aisles through its remaining booth positions.
          if (!row.access) row.access = path;
          item.rowId = row.id;
          items.push(item);
          serial++;
          blocks.push(p);
          lanes.push(l);
          reserved.push(portBox, ...corridor(path, gap));
          tally.set(d.id, tally.get(d.id) + 1);
          advance = w + Math.max(0, options.spacing || 0) / s.scale;
          break;
        }
        row.cursor = u + advance;
        if (row.cursor < end) queue.push(row);
      }
    }
  }
  return {
    items,
    lanes,
    strategy,
    scope,
    rejected,
    boundarySource: s.boundarySource,
    parameters: { ...options },
    presets: c.widths,
    sources: c.sources,
  };
}
function connected(p, main) {
  return main.slice(1).some((b, i) => dist(p, projectOn(p, main[i], b)) < 1e-6);
}
export function validate(s, draft, env = {}, prior = null, scope = "all") {
  const c = planningContext(s, env),
    issues = [],
    blocks = [...c.fixed],
    ids = new Set();
  const main = draft.lanes.find((l) => l.kind === "main");
  check(main && main.points.length >= 2, "缺少主通道");
  if (
    !s.localDraft &&
    (dist(main.points[0], s.entrance) > 1e-6 ||
      (dist(s.entrance, s.exit) > 1e-6 &&
        dist(main.points.at(-1), s.exit) > 1e-6))
  )
    issues.push("出入口不连通");
  if (prior && scope !== "all") {
    const editable = editableRegion(c, scope);
    const oldLanes = prior.lanes.flatMap((l) => lanePolygons(l, s.scale));
    const newLanes = draft.lanes.flatMap((l) => lanePolygons(l, s.scale));
    const oldSpace = clipping.union(editable, ...oldLanes.map((p) => p.ring));
    const newSpace = clipping.union(editable, ...newLanes.map((p) => p.ring));
    if (clipping.xor(oldSpace, newSpace).length)
      issues.push("锁定区域的通道有变动");
    for (const i of prior.items.filter((i) => !onScope(i, scope, c)))
      if (
        JSON.stringify(i) !==
        JSON.stringify(draft.items.find((b) => b.id === i.id))
      )
        issues.push("锁定区域已变动");
    for (const i of draft.items.filter((i) => !onScope(i, scope, c)))
      if (!prior.items.some((b) => b.id === i.id))
        issues.push("新增摊位跨入锁定区域");
  }
  const gateBlocks = s.localDraft
    ? s.openings.flatMap((g) => gateFootprint(g, s.scale))
    : [];
  for (const item of draft.items) {
    const p = polygon(footprint(item)),
      d = s.demands.find((d) => d.id === item.demandId),
      area = c.regions.find((r) => r.id === item.regionId);
    if (
      ids.has(item.id) ||
      !d ||
      item.cat !== d.cat ||
      item.boothStyle !== d.style ||
      Math.abs(d.width - item.ww * s.scale) > 1e-6 ||
      Math.abs(d.depth - item.wh * s.scale) > 1e-6
    )
      issues.push("摊位类型、尺寸或编号不符");
    ids.add(item.id);
    if (!area || !within(p, area.ring) || !within(p, c.domain))
      issues.push("摊位越界");
    if (gateBlocks.some((b) => overlap(p, b)))
      issues.push("摊位覆盖出入口标注");
    if (blocks.some((b) => overlap(p, b)))
      issues.push("摊位碰撞或占用禁摆区域");
    blocks.push(p);
  }
  for (const l of c.lanes)
    if (!draft.lanes.some((k) => JSON.stringify(k) === JSON.stringify(l)))
      issues.push("锁定通道有改动");
  let secondaryMin = Infinity,
    mainMin = Infinity;
  for (const lane of draft.lanes) {
    const pts = lane.points,
      min = c.widths[lane.kind === "main" ? "main" : "secondary"];
    const fits = (w) => {
      if (lane.port) {
        const q = polygon(
          rectangle(
            lane.port.x,
            lane.port.y,
            w / s.scale,
            w / s.scale,
            lane.angle,
          ),
        );
        if (!within(q, c.domain) || blocks.some((b) => overlap(q, b)))
          return false;
      }
      return pts.length === 1 ? !!lane.port : clear(c, pts, w, blocks);
    };
    if (lane.width < min || !fits(lane.width)) {
      issues.push("通道净宽不足或不连通");
      continue;
    }
    if (lane.kind === "secondary" && !connected(pts.at(-1), main.points))
      issues.push("次通道未连通主通道");
    // Widen the entire swept corridor; report the conservative minimum to centimetres.
    let lo = lane.width,
      hi = lo;
    while (hi < 256 && fits(hi * 2)) {
      lo = hi * 2;
      hi *= 2;
    }
    hi *= 2;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    if (lane.kind === "main") mainMin = Math.min(mainMin, lo);
    else secondaryMin = Math.min(secondaryMin, lo);
  }
  for (const i of draft.items) {
    const l = draft.lanes.find(
      (l) => l.owner === i.id && l.kind === "secondary",
    );
    if (!l || !l.port || dist(l.points[0], l.port) > 1e-6) {
      issues.push("摊位缺少连通通道");
      continue;
    }
    const corners = footprint(i),
      distance = Math.min(
        ...corners.map((a, k) =>
          dist(l.port, projectOn(l.port, a, corners[(k + 1) % 4])),
        ),
      );
    if (distance * s.scale > l.width / 2 + 0.001)
      issues.push("摊位与次通道分离");
  }
  const tally = counts(c, draft.items);
  const quantities = s.demands.map((d) => ({
    name: d.cat,
    id: d.id,
    min: d.min,
    max: d.max,
    actual: tally.get(d.id),
    short: Math.max(0, d.min - tally.get(d.id)),
  }));
  if (quantities.some((d) => d.actual > d.max)) issues.push("数量超出上限");
  const metres = (n) => (Number.isFinite(n) ? Math.floor(n * 100) / 100 : null);
  return {
    ok: !issues.length,
    issues: [...new Set(issues)],
    quantities,
    net: { main: metres(mainMin), secondary: metres(secondaryMin) },
  };
}
