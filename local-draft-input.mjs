import { readPlan, problems } from './cloud/planning-input.mjs';

export function draftInput(project) {
  const plan = project.planning || {};
  const spec = readPlan(project);
  const zones = plan.zones || [];
  const legacy = (plan.obstacles || []).map((points) => ({ points, passable: false }));
  const importedZones = spec.importedZones.map((z) => ({ ...z, passable: plan.zoneAccess?.[z.key] ?? true }));
  const walkableImports = new Set(importedZones.filter((z) => z.passable).map((z) => z.points));
  const imported = spec.obstacles.slice(legacy.length).filter((p) => !walkableImports.has(p));
  const gates = {};
  for (const kind of ['entrance', 'exit']) {
    const saved = plan[kind + 's'];
    const original = [
      ...spec.gates[kind].filter((g) => g.a),
      ...(plan[kind] ? [plan[kind]] : []),
      ...spec.gates[kind].filter((g) => !g.a)
    ];
    gates[kind] =
      saved ??
      original
        .filter((p, i) => !original.slice(0, i).some((q) => q.x === p.x && q.y === p.y))
        .map((p) => ({ center: { x: p.x, y: p.y }, ...(p.a && p.b ? { a: p.a, b: p.b } : {}) }));
  }
  const min = plan.aisles ? plan.aisles.min : (spec.presets.secondary ?? 1.5);
  return {
    ...spec,
    localDraft: true,
    zones: [...legacy, ...zones],
    importedZones,
    gates,
    min,
    openings: [...gates.entrance, ...gates.exit],
    entrance: gates.entrance[0]?.center,
    exit: gates.exit[0]?.center,
    zoneConfirmed: !!(legacy.length || zones.length || importedZones.length || plan.noZones),
    obstacles: [
      ...imported,
      ...legacy.map((z) => z.points),
      ...zones.filter((z) => !z.passable).map((z) => z.points)
    ],
    walkable: [...zones, ...importedZones].filter((z) => z.passable).map((z) => z.points),
    boundary: null,
    presets: { main: min, secondary: min }
  };
}

export function draftProblems(s) {
  const issues = problems(s);
  if (!s.zoneConfirmed) issues.push('请圈禁摆区域或确认无禁摆区');
  if (!Number.isFinite(s.min) || s.min <= 0)
    issues.push('请检查过道最小净宽');
  return [...new Set(issues)];
}
