// Canvas coordinates stay in CAD units; dimensions and clearances are always metres.
export const strategies = {
  edge: "沿边单排",
  island: "中岛背靠背",
  rows: "分区成排",
};
export const styles = [
  "tent",
  "canopy",
  "roofed",
  "table",
  "tent-yard",
  "canopy-yard",
];
export const emptyPlan = () => ({
  regions: [],
  entrance: null,
  exit: null,
  demands: [],
});
const xy = (p) => ({ x: p.x ?? p.wx, y: p.y ?? p.wy });
export function rectangle(cx, cy, width, depth, angle = 0) {
  const rad = (angle * Math.PI) / 180,
    c = Math.abs(Math.cos(rad)) < 1e-12 ? 0 : Math.cos(rad),
    s = Math.abs(Math.sin(rad)) < 1e-12 ? 0 : Math.sin(rad);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([i, j]) => {
    const x = (i * width) / 2,
      y = (j * depth) / 2;
    return { x: cx + c * x - s * y, y: cy + s * x + c * y };
  });
}
export function footprint(item) {
  return rectangle(
    item.wx + item.ww / 2,
    item.wy + item.wh / 2,
    item.ww,
    item.wh,
    item.angle,
  );
}
export function readPlan(project) {
  const plan = { ...emptyPlan(), ...structuredClone(project.planning) };
  plan.regions ||= [];
  plan.demands ||= [];
  const objects = project.environment?.objects || [],
    scale = project.metersPerUnit;
  const obstacles = [...(plan.obstacles || [])],
    lanes = [...(plan.lockedLanes || [])];
  for (const obj of objects)
    obstacles.push(
      rectangle(obj.x, obj.y, obj.width / scale, obj.depth / scale, obj.angle),
    );
  const importedZones = [];
  const gates = { entrance: [], exit: [] };
  function gate(kind, p, source) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    if (!gates[kind].some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-8))
      gates[kind].push({ ...p, source });
  }
  let cadBoundary = null;
  for (const [index, e] of (project.venue?.entities || []).entries()) {
    const layer = String(e.layer || "").trim();
    if (
      e.type === "text" &&
      ["入口", "出口", "出入口"].includes(String(e.text).trim())
    ) {
      const p = { x: e.x, y: e.y };
      if (e.text.trim() !== "出口") gate("entrance", p, "CAD " + index);
      if (e.text.trim() !== "入口") gate("exit", p, "CAD " + index);
    }
    if (e.type === "line" && ["入口", "出口", "出入口"].includes(layer)) {
      const a = { x: e.x1, y: e.y1 },
        b = { x: e.x2, y: e.y2 };
      const p = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, a, b };
      if (layer !== "出口") gate("entrance", p, "CAD " + index);
      if (layer !== "入口") gate("exit", p, "CAD " + index);
    }
    if (
      !/^(可摆区域|禁摆区|障碍物|固定点位|柱子|墙体|锁定通道|主通道|次通道|场地边界)$/.test(
        layer,
      )
    )
      continue;
    const points =
      e.type === "polyline"
        ? e.points.map(([x, y]) => ({ x, y }))
        : e.type === "line"
          ? [
              { x: e.x1, y: e.y1 },
              { x: e.x2, y: e.y2 },
            ]
          : null;
    if (!points) continue;
    if (
      points.length > 2 &&
      points[0].x === points.at(-1).x &&
      points[0].y === points.at(-1).y
    )
      points.pop();
    if (["主通道", "次通道", "锁定通道"].includes(layer) && !e.closed)
      lanes.push({ points, kind: layer === "主通道" ? "main" : "secondary" });
    if (!e.closed || points.length < 3) continue;
    if (layer === "场地边界") cadBoundary ||= points;
    else if (layer === "可摆区域")
      plan.regions.push({
        id: "cad-" + index,
        name: "CAD 可摆区域 " + (index + 1),
        points,
      });
    else {
      obstacles.push(points);
      if (layer === "禁摆区")
        importedZones.push({ key: "cad-" + index, points });
    }
  }
  const existing = [];
  for (const item of project.items || []) {
    const role = item.planningRole || item.label;
    const points = item.points || item.pts;
    if (item.type === "booth") {
      existing.push(item);
      obstacles.push(footprint(item));
      continue;
    }
    const poly =
      points?.map(xy) || (item.ww && item.wh ? footprint(item) : null);
    if (
      ["可摆区域", "allowed"].includes(role) &&
      poly &&
      !plan.regions.some((r) => r.id === "item-" + item.id)
    )
      plan.regions.push({
        id: "item-" + item.id,
        name: "可摆区域 " + item.id,
        points: poly,
      });
    if (
      ["入口", "entrance", "出口", "exit", "出入口"].includes(role) &&
      (Number.isFinite(item.wx) || poly?.length === 2)
    ) {
      const center =
        poly?.length === 2
          ? {
              a: poly[0],
              b: poly[1],
              x: (poly[0].x + poly[1].x) / 2,
              y: (poly[0].y + poly[1].y) / 2,
            }
          : {
              x: item.wx + (item.ww || 0) / 2,
              y: item.wy + (item.wh || 0) / 2,
            };
      if (["入口", "entrance", "出入口"].includes(role))
        gate("entrance", center, "标注 " + item.id);
      if (["出口", "exit", "出入口"].includes(role))
        gate("exit", center, "标注 " + item.id);
    }
    if (
      poly &&
      (["禁摆区", "障碍物", "固定点位", "obstacle", "forbidden"].includes(
        role,
      ) ||
        (item.locked && (!points || item.closed)))
    ) {
      obstacles.push(poly);
      if (["禁摆区", "forbidden"].includes(role))
        importedZones.push({ key: "item-" + item.id, points: poly });
    }
    if (
      points &&
      ((item.locked && !item.closed) ||
        ["锁定通道", "主通道", "次通道", "aisle"].includes(role))
    )
      lanes.push({
        points: points.map(xy),
        width: item.widthMeters,
        kind: role === "主通道" ? "main" : "secondary",
      });
    if (["guard", "fire"].includes(item.type))
      obstacles.push(rectangle(item.wx, item.wy, 0.5 / scale, 0.5 / scale));
  }
  for (const key of ["entrance", "exit"])
    if (!plan[key] && gates[key].length === 1) {
      const { x, y } = gates[key][0];
      plan[key] = { x, y };
    }
  let boundary = project.environment?.sitePlan?.points || cadBoundary;
  let boundarySource = project.environment?.sitePlan?.points
    ? "实测边界"
    : cadBoundary
      ? "CAD 场地边界"
      : "可摆区域范围";
  const bounds =
    project.canvasBounds ||
    project.venue?.bounds ||
    project.cadFile?.renderData?.bounds;
  if (
    !boundary &&
    bounds &&
    [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(Number.isFinite)
  ) {
    boundary = rectangle(
      (bounds.minX + bounds.maxX) / 2,
      (bounds.minY + bounds.maxY) / 2,
      bounds.maxX - bounds.minX,
      bounds.maxY - bounds.minY,
    );
    boundarySource = "底图范围与已标障碍";
  }
  const { origin, routes, finalReason, ...inputs } = plan;
  return {
    ...inputs,
    nextId: (project.items || []).reduce(
      (n, i) => Math.max(n, Number(i.id) + 1 || 1),
      project.nextId || 1,
    ),
    obstacles,
    lanes,
    existing,
    importedZones,
    scale,
    boundary,
    boundarySource,
    gates,
    cad: {
      entityCount: project.venue?.entities?.length ?? null,
      layers: Object.keys(project.layerVisibility || {}),
    },
    presets: plan.presets || project.aislePresets || {},
    site: project.site || {},
    baseName: project.cadFile?.name || "实测场地",
  };
}
export function problems(s) {
  const errors = [],
    pt = (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y);
  if (!s.regions?.length) errors.push("请圈出可摆区域");
  if (!pt(s.entrance))
    errors.push(
      s.gates?.entrance.length > 1
        ? "发现多个入口，请点击本场入口"
        : "请标记入口",
    );
  if (!pt(s.exit))
    errors.push(
      s.gates?.exit.length > 1 ? "发现多个出口，请点击本场出口" : "请标记出口",
    );
  if (!(s.scale > 0 && Number.isFinite(s.scale)))
    errors.push("底图缺少已保存的比例尺");
  if (!Array.isArray(s.demands) || !s.demands.length)
    errors.push("请添加摊位需求");
  else {
    const ids = new Set(),
      types = new Set();
    for (const [i, d] of s.demands.entries()) {
      if (
        !d ||
        !d.id ||
        ids.has(d.id) ||
        !styles.includes(d.style) ||
        typeof d.cat !== "string" ||
        !d.cat.trim() ||
        ![d.width, d.depth].every(
          (n) => Number.isFinite(n) && n > 0 && n <= 100,
        ) ||
        ![d.min, d.max].every(
          (n) => Number.isSafeInteger(n) && n >= 0 && n <= 5000,
        ) ||
        d.min > d.max
      )
        errors.push("请检查第 " + (i + 1) + " 类摊位的尺寸和数量范围");
      const type = JSON.stringify([d?.cat, d?.style, d?.width, d?.depth]);
      if (types.has(type)) errors.push("相同摊位类型和尺寸请合并为一项需求");
      types.add(type);
      ids.add(d?.id);
    }
  }
  return errors;
}
