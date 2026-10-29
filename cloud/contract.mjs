export const stores = ['sites', 'projects', 'activities', 'activityProjects'];
export const emptyLibrary = () => ({ schema: 'needflea-cloud-library/1', revision: 0, sites: [], projects: [], activities: [], activityProjects: [] });
export function fail(status, message) { throw Object.assign(new Error(message), { status, expose: true }); }
export function validId(value) { return typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,160}$/.test(value); }
export function validateProject(project) {
  if (!project || ![1, 2, 3].includes(project.version) || !Array.isArray(project.items) || project.items.length > 100000) fail(400, '项目格式无效。');
  if (project.metersPerUnit != null && (!Number.isFinite(project.metersPerUnit) || project.metersPerUnit <= 0)) fail(400, '项目比例尺无效。');
  if (project.cadFile && (typeof project.cadFile.base64 !== 'string' || typeof project.cadFile.name !== 'string')) fail(400, '项目底图无效。');
  return project;
}
export function validateChange(change) {
  if (!change || !Number.isSafeInteger(change.expectedRevision) || change.expectedRevision < 0 || !/^[a-f0-9-]{36}$/i.test(change.operationId || '')) fail(400, '提交版本无效，请刷新云端场地库。');
  if (!change.changes || Object.keys(change.changes).some(key => !stores.includes(key))) fail(400, '场地变更格式无效。');
  for (const store of stores) {
    const rows = change.changes[store] || [];
    if (!Array.isArray(rows) || rows.length > 10000) fail(400, '一次提交的记录过多。');
    const ids = new Set();
    for (const row of rows) {
      if (!validId(row?.id) || ids.has(row.id)) fail(400, '记录编号无效或重复。');
      ids.add(row.id);
      if (store === 'projects' || store === 'activityProjects') {
        validateProject(row.project);
        if (store === 'projects' && row.project.items.length) fail(400, '场地基础不能包含活动摊位，请分开保存。');
      }
      else {
        const max = store === 'sites' ? 100 : 200;
        if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > max || !Number.isFinite(row.updatedAt) || !Number.isFinite(row.createdAt)) fail(400, '场地或活动资料无效。');
        if (store === 'activities' && !validId(row.siteId)) fail(400, '活动所属场地无效。');
      }
    }
  }
}
export function applyChange(current, change, projectRows) {
  const next = { ...current, revision: current.revision + 1, operationId: change.operationId, updatedAt: new Date().toISOString() };
  for (const store of stores) {
    const map = new Map(current[store].map(row => [row.id, row]));
    for (const row of projectRows[store] || change.changes[store] || []) map.set(row.id, row);
    next[store] = [...map.values()];
  }
  const sites = new Set(next.sites.map(row => row.id)), activityIds = new Set(next.activities.map(row => row.id));
  if (next.activities.some(row => !sites.has(row.siteId)) || next.projects.some(row => !sites.has(row.id)) || next.activityProjects.some(row => !activityIds.has(row.id))) fail(400, '场地与活动的归属关系无效。');
  const bases = new Set(next.projects.map(row => row.id)), layouts = new Set(next.activityProjects.map(row => row.id));
  if (next.sites.some(row => !bases.has(row.id)) || next.activities.some(row => !layouts.has(row.id))) fail(400, '场地基础或活动布局缺失，本次未保存。');
  for (const group of [next.sites, ...next.sites.map(site => next.activities.filter(row => row.siteId === site.id))]) {
    const names = group.map(row => row.name.trim().toLocaleLowerCase());
    if (new Set(names).size !== names.length) fail(409, '云端已有同名场地或活动，请刷新后更换名称。');
  }
  if (!stores.some(store => change.changes[store]?.length)) fail(400, '没有需要保存的修改。');
  return next;
}
