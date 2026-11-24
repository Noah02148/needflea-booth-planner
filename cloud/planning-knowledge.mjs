import { studyFinal } from './planning-model.mjs';
import { createHash } from 'node:crypto';
import { generate, validate } from './planning-geometry.mjs';
import { readPlan } from './planning-input.mjs';

export const digest = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const initial = () => ({
  schema: 'NEED! 排布知识 v1',
  revision: 0,
  records: [],
  policy: 'rows',
  evidence: [],
  versions: []
});
const normalize = (s) =>
  String(s || '')
    .trim()
    .toLocaleLowerCase();
const boothFields = [
  'id',
  'label',
  'cat',
  'boothStyle',
  'size',
  'wx',
  'wy',
  'ww',
  'wh',
  'angle',
  'regionId',
  'demandId'
];
function booth(i) {
  return Object.fromEntries(boothFields.filter((k) => i[k] != null).map((k) => [k, i[k]]));
}
export function rowAt(items, target, scale) {
  const rad = ((target.angle || 0) * Math.PI) / 180,
    c = Math.cos(rad),
    s = Math.sin(rad);
  const center = (i) => ({ x: i.wx + i.ww / 2, y: i.wy + i.wh / 2 });
  const a = center(target);
  const row = items
    .flatMap((i) => {
      const b = center(i),
        dx = b.x - a.x,
        dy = b.y - a.y;
      if (
        Math.abs(Math.sin((((i.angle || 0) - (target.angle || 0)) * Math.PI) / 180)) > 0.12 ||
        Math.abs(dy * c - dx * s) > 0.28 * Math.min(i.wh, target.wh) ||
        i.regionId !== target.regionId
      )
        return [];
      return [{ item: i, along: dx * c + dy * s }];
    })
    .sort((x, y) => x.along - y.along);
  const ix = row.findIndex((x) => x.item.id === target.id);
  let l = ix,
    r = ix;
  const gap = (i, j) => row[j].along - row[i].along - (row[j].item.ww + row[i].item.ww) / 2;
  while (l > 0 && gap(l - 1, l) < Math.max(target.ww * 0.8, 0.5 / (scale || 1))) l--;
  while (r < row.length - 1 && gap(r, r + 1) < Math.max(target.ww * 0.8, 0.5 / (scale || 1))) r++;
  return row.slice(l, r + 1).map((x) => x.item);
}
function differences(before, after) {
  const old = new Map(before.map((i) => [i.id, i])),
    next = new Map(after.map((i) => [i.id, i]));
  const diff = { added: [], removed: [], moved: [], rotated: [], spec: [] };
  for (const i of after) {
    const b = old.get(i.id);
    if (!b) {
      diff.added.push(i.id);
      continue;
    }
    if (b.wx !== i.wx || b.wy !== i.wy) diff.moved.push(i.id);
    if ((b.angle || 0) !== (i.angle || 0)) diff.rotated.push(i.id);
    if (['cat', 'ww', 'wh', 'boothStyle'].some((k) => b[k] !== i[k])) diff.spec.push(i.id);
  }
  diff.removed = before.filter((i) => !next.has(i.id)).map((i) => i.id);
  return diff;
}
export function extract(project, final) {
  const spec = readPlan(project),
    booths = spec.existing.map(booth),
    lineage = project.planning?.origin;
  const facts = {
    scale: spec.scale,
    base: spec.baseName,
    boundary: spec.boundary || project.venue?.bounds || project.cadFile?.renderData?.bounds,
    layers: Object.keys(project.layerVisibility || {}),
    cadEntities: project.venue?.entities?.length ?? null,
    regions: spec.regions,
    entrance: spec.entrance,
    exit: spec.exit,
    gateSources: spec.gates,
    fixed: project.environment?.objects || [],
    obstacles: project.planning?.obstacles || [],
    lanes: spec.lanes,
    demands: spec.demands,
    presets: spec.presets
  };
  const record = {
    facts,
    booths,
    itemCount: project.items.length,
    annotations: project.items.filter((i) => i.type !== 'booth'),
    regions: spec.regions.map((r) => ({ id: r.id, name: r.name })),
    final
  };
  if (final) {
    record.examples = [];
    const seen = new Set();
    for (const b of booths) {
      if (seen.has(b.id)) continue;
      const row = rowAt(booths, b, spec.scale);
      row.forEach((i) => seen.add(i.id));
      record.examples.push({
        region: b.regionId,
        angle: b.angle || 0,
        objects: row.map((i) => i.id),
        observation: row.length > 1 ? '同向连续成排' : '独立点位'
      });
    }
    if (lineage?.items) {
      record.edits = differences(lineage.items, booths);
      record.edits.lanesChanged = digest(lineage.lanes || []) !== digest(project.planning?.routes || []);
      if (lineage.net && lineage.spec && project.planning.routes) {
        const originalFixed = new Set(lineage.spec.existing.map((i) => i.id));
        const finalSpec = readPlan({
          ...project,
          items: project.items.filter((i) => i.type !== 'booth' || originalFixed.has(i.id))
        });
        finalSpec.presets = { ...lineage.presets, ...finalSpec.presets };
        try {
          const current = validate(finalSpec, {
            items: booths.filter((i) => !originalFixed.has(i.id)),
            lanes: project.planning.routes
          });
          record.edits.clearance = {
            initial: lineage.net,
            final: current.ok ? current.net : null,
            issues: current.issues
          };
        } catch {
          record.edits.clearance = {
            initial: lineage.net,
            final: null,
            issues: ['定稿通道资料不足，未取得可比净宽']
          };
        }
      }
      record.reason = String(project.planning?.finalReason || '').slice(0, 1000);
      record.replay = lineage.spec;
      record.strategy = lineage.strategy;
    }
  }
  return record;
}
async function evaluate(store, index, candidate, env) {
  if (!candidate || candidate === index.policy) return;
  // One most recent replayable final per venue. Every representative must pass.
  const seen = new Set(),
    evidence = [];
  let improved = false;
  for (const r of [...index.records].reverse()) {
    if (!r.final || !index.visible.includes(r.siteId) || !index.activities.includes(r.id) || seen.has(r.siteId))
      continue;
    const data = await store.knowledgeGet('records/' + r.key);
    if (!data?.replay) continue;
    seen.add(r.siteId);
    const test = (strategy) => {
      const draft = generate(data.replay, { strategy }, null, env);
      return validate(data.replay, draft, env);
    };
    let old, next;
    try {
      old = test(index.policy);
      next = test(candidate);
    } catch {
      return;
    }
    if (!old.ok || !next.ok || next.quantities.some((q, i) => q.short > old.quantities[i].short)) return;
    if (next.quantities.some((q, i) => q.short < old.quantities[i].short) || next.net.main > old.net.main + 0.01)
      improved = true;
    evidence.push({
      source: r.key,
      old: old.quantities.map((q) => q.short),
      next: next.quantities.map((q) => q.short),
      width: [old.net.main, next.net.main]
    });
  }
  if (seen.size >= 2 && improved) {
    index.versions.push({ revision: index.revision, from: index.policy, to: candidate, evidence });
    index.policy = candidate;
  }
}
async function advance(store, current, manifest, env) {
  const index = structuredClone(current);
  index.revision = manifest.revision;
  const known = new Map(index.records.map((r) => [r.kind + '/' + r.id, r]));
  let candidate;
  for (const kind of ['projects', 'activityProjects'])
    for (const row of manifest[kind]) {
      const activity = kind === 'activityProjects' ? manifest.activities.find((a) => a.id === row.id) : null;
      const site = manifest.sites.find((s) => s.id === (activity?.siteId || row.id));
      const final = activity?.status === 'final';
      const meta = {
        siteId: site.id,
        site: site.name,
        aliases: [...(site.aliases || []), ...(activity?.aliases || [])],
        activity: activity?.name || '',
        id: row.id,
        kind,
        final,
        hash: row.hash
      };
      const key = digest(meta);
      if (known.get(kind + '/' + row.id)?.key === key) continue;
      let data = await store.knowledgeGet('records/' + key);
      if (!data) {
        if (final && env.OPENAI_API_KEY && env.PLANNER_STUDY_MODEL !== 'off') {
          // Conditional OSS creation leases the expensive model call across FC instances.
          const period = Math.floor(Date.now() / 120000);
          const acquired = await store.knowledgePut('jobs/' + key + '/' + period, { revision: manifest.revision });
          if (acquired === false) throw new Error('定稿学习正在进行，可稍后重试');
        }
        data =
          (await store.knowledgeGet('seeds/' + row.hash + (final ? '-final' : '-observation'))) ||
          extract(await store.readProject(row.hash), final);
        if (final) await studyFinal(data, env);
        await store.knowledgePut('records/' + key, data);
      }
      index.records.push({ ...meta, key, revision: manifest.revision });
      if (final && data.strategy) candidate = data.strategy;
    }
  index.visible = manifest.sites.map((s) => s.id);
  index.activities = manifest.activities.map((a) => a.id);
  await evaluate(store, index, candidate, env);
  await store.knowledgePut('indices/' + manifest.revision, index);
  return await store.knowledgeGet('indices/' + manifest.revision);
}
export async function syncKnowledge(store, env = {}, allowPrevious = false) {
  const head = await store.latest();
  let rev = head.revision,
    index;
  while (rev > 0 && !(index = await store.knowledgeGet('indices/' + rev))) rev--;
  index ||= initial();
  for (let n = rev + 1; n <= head.revision; n++) {
    const manifest = n === head.revision ? head : await store.revision(n);
    if (!manifest) throw new Error('缺少云端版本 ' + n);
    try {
      index = await advance(store, index, manifest, env);
    } catch (error) {
      if (!allowPrevious || !index.revision) throw error;
      // Use only currently visible records even when an incremental job is pending.
      index = {
        ...index,
        visible: head.sites.map((s) => s.id),
        activities: head.activities.map((a) => a.id),
        pending: n
      };
      break;
    }
  }
  const rollback = Number(env.PLANNER_POLICY_REVISION);
  if (Number.isSafeInteger(rollback) && rollback >= 0 && rollback < index.revision) {
    const previous = rollback ? await store.knowledgeGet('indices/' + rollback) : initial();
    if (previous) return { ...index, policy: previous.policy, policyRevision: rollback };
  }
  return index;
}
export async function findHistory(store, index, query) {
  const match = (a, b) => !b || normalize(a).includes(normalize(b));
  let rows = index.records.filter(
    (r) =>
      r.kind === 'activityProjects' &&
      index.visible.includes(r.siteId) &&
      index.activities.includes(r.id) &&
      (!query.finalOnly || r.final) &&
      match(r.site + ' ' + r.aliases.join(' '), query.site) &&
      match(r.activity + ' ' + r.aliases.join(' '), query.activity) &&
      (!query.revision || r.revision === query.revision)
  );
  rows = rows.reverse().sort((a, b) => Number(b.final) - Number(a.final));
  const matches = [];
  for (const r of rows) {
    const rec = await store.knowledgeGet('records/' + r.key);
    const region = rec.regions.filter((g) => match(g.name + ' ' + g.id, query.region));
    if (query.region && !region.length) continue;
    const bs = query.region ? rec.booths.filter((b) => region.some((g) => g.id === b.regionId)) : rec.booths;
    const hits = query.booth ? bs.filter((b) => normalize(b.label) === normalize(query.booth)) : bs.slice(0, 1);
    if (query.booth && !hits.length) continue;
    const targets = hits.length ? hits : [null];
    for (const hit of targets) {
      const row = hit ? rowAt(bs, hit, rec.facts.scale) : [];
      matches.push({
        site: r.site,
        activity: r.activity,
        revision: r.revision,
        final: r.final,
        caseId: r.key,
        object: hit?.id,
        scale: rec.facts.scale,
        row,
        examples: rec.examples?.slice(0, 8),
        lessons: rec.lessons?.slice(0, 8),
        facts: { presets: rec.facts.presets, regions: rec.regions }
      });
    }
  }
  return matches;
}
