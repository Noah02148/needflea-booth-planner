import { generate, validate } from "./cloud/planning-geometry.mjs";
import { draftProblems } from "./local-draft-input.mjs";

function rowGaps(items, scale) {
  const gaps = [];
  for (let i = 0; i < items.length; i++) {
    const a = items[i],
      rad = (a.angle * Math.PI) / 180,
      cos = Math.cos(rad),
      sin = Math.sin(rad);
    let nearest = Infinity,
      nearestRow = Infinity;
    for (const b of items) {
      if (
        b === a ||
        Math.abs(Math.sin(((a.angle - b.angle) * Math.PI) / 180)) > 1e-6
      )
        continue;
      const dx = b.wx + b.ww / 2 - a.wx - a.ww / 2,
        dy = b.wy + b.wh / 2 - a.wy - a.wh / 2;
      const gap =
        ((dy * cos - dx * sin) * a.frontSide - (a.wh + b.wh) / 2) * scale;
      if (gap > 1e-6) {
        nearestRow = Math.min(nearestRow, gap);
        if (Math.abs(dx * cos + dy * sin) < (a.ww + b.ww) / 2 - 1e-6)
          nearest = Math.min(nearest, gap);
      }
    }
    // An unfinished row end opens onto a plaza, not a wider row aisle.
    if (Number.isFinite(nearest) && nearest <= nearestRow + 1e-5)
      gaps.push(nearest);
  }
  return gaps;
}
function describe(s, d) {
  const gaps = rowGaps(d.items, s.scale);
  if (gaps.some((g) => g + 1e-5 < s.min)) return false;
  const main = d.lanes.find((l) => l.kind === "main");
  const routeLength = main.points
    .slice(1)
    .reduce(
      (sum, p, i) =>
        sum +
        Math.hypot(p.x - main.points[i].x, p.y - main.points[i].y) * s.scale,
      0,
    );
  const quantities = d.report.quantities;
  const entranceSpace = Math.min(
    ...s.gates.entrance.flatMap((g) =>
      d.items.map((i) => {
        const r = (-i.angle * Math.PI) / 180,
          dx = g.center.x - i.wx - i.ww / 2,
          dy = g.center.y - i.wy - i.wh / 2;
        return (
          Math.hypot(
            Math.max(
              0,
              Math.abs(dx * Math.cos(r) - dy * Math.sin(r)) - i.ww / 2,
            ),
            Math.max(
              0,
              Math.abs(dx * Math.sin(r) + dy * Math.cos(r)) - i.wh / 2,
            ),
          ) * s.scale
        );
      }),
    ),
  );
  const wallItems = d.items.filter((i) => i.wallBack);
  d.metrics = {
    wallLength: wallItems.reduce((n,i) => n+i.ww*s.scale,0),
    total: quantities.reduce((n, q) => n + q.actual, 0),
    missing: quantities.reduce((n, q) => n + q.short, 0),
    gap: gaps.length ? Math.min(...gaps) : null,
    main: d.report.net.main,
    routeLength,
    entranceSpace,
  };
  return true;
}
function pick(pool) {
  const scoreA = (a, b) =>
    b.metrics.wallLength - a.metrics.wallLength ||
    a.metrics.missing - b.metrics.missing ||
    b.metrics.total - a.metrics.total ||
    b.metrics.main - a.metrics.main ||
    a.metrics.routeLength - b.metrics.routeLength;
  const edge = pool.filter((d) => d.strategy === "edge");
  const a = (edge.length ? edge : pool).slice().sort(scoreA)[0];
  if (!a) return [];
  const improved = pool.filter(
    (b) =>
      b.metrics.missing === a.metrics.missing &&
      b !== a &&
      ((b.metrics.gap != null &&
        a.metrics.gap != null &&
        b.metrics.gap > a.metrics.gap + 0.05) ||
        b.metrics.main > a.metrics.main + 0.05 ||
        b.metrics.routeLength < a.metrics.routeLength - 0.1 ||
        b.metrics.entranceSpace > a.metrics.entranceSpace + 0.2),
  );
  const sameCount = improved.filter((b) => b.metrics.total === a.metrics.total);
  const flow = sameCount.length ? sameCount : improved;
  flow.sort(
    (a, b) =>
      b.metrics.main - a.metrics.main ||
      a.metrics.routeLength - b.metrics.routeLength ||
      b.metrics.total - a.metrics.total ||
      b.metrics.entranceSpace - a.metrics.entranceSpace,
  );
  return flow.length ? [a, flow[0]] : [a];
}

export function searchDrafts(s, onResult) {
  const issues = draftProblems(s);
  if (issues.length) throw new Error(issues.join("；"));
  const pool = [],
    signatures = new Set(),
    failures = new Set();
  let remaining = 450000;
  const exhausted = new Error("本次候选搜索预算已用完");
  function consume(cost) {
    remaining -= cost;
    if (remaining < 0) throw exhausted;
  }
  const directions = s.regions.map(({ points }) => {
    const width =
      Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
    const height =
      Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y));
    return height > 2 * width
      ? "vertical"
      : width > 2 * height
        ? "horizontal"
        : null;
  });
  const axes =
    directions[0] && directions.every((d) => d === directions[0])
      ? [directions[0]]
      : ["horizontal", "vertical"];
  search: for (const variant of [0, 1])
    for (const axis of axes)
      for (const width of [s.min, s.min * 1.5])
        for (const strategy of ["edge", "island"]) {
          try {
            const model = {
              ...s,
              consume,
              presets: { main: width, secondary: width },
            };
            const d = generate(model, {
              strategy,
              axis,
              variant,
              wallFirst: true,
            });
            if (!d.items.length) continue;
            const key = JSON.stringify(
              d.items
                .map((i) => [i.wx, i.wy, i.angle, i.frontSide, i.demandId])
                .sort(),
            );
            if (signatures.has(key)) continue;
            d.report = validate(model, d);
            if (!d.report.ok || !describe(s, d)) continue;
            signatures.add(key);
            pool.push(d);
            onResult({ candidates: pick(pool) });
          } catch (error) {
            if (error === exhausted) break search;
            failures.add(error.message);
          }
        }
  const result = {
    done: true,
    candidates: pick(pool),
    error: pool.length
      ? ""
      : [...failures][0] ||
        "请核对可摆边界、禁摆区、营业面和排间净宽，本轮未找到可采用的排法。",
  };
  onResult(result);
  return result;
}
