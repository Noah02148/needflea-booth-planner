// Optional authenticated OSS service. The local IndexedDB remains independent.
(() => {
  const stores = ['sites', 'projects', 'activities', 'activityProjects'];
  const savedKey = 'needflea_cloud_session_v1';
  let session = null, manifest = null, requestPending = null;
  try { session = JSON.parse(sessionStorage.getItem(savedKey)); } catch {}
  const configURL = () => window.NEEDFLEA_CLOUD_API_URL || localStorage.getItem('needflea_cloud_url') || '';
  function validateURL(value) {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('云端接口需使用 HTTPS；本机调试可使用 localhost。');
    return url.href.replace(/\/$/, '');
  }
  function remember() { if (session) sessionStorage.setItem(savedKey, JSON.stringify(session)); else sessionStorage.removeItem(savedKey); }
  async function request(path, value, authenticated = true) {
    const url = authenticated ? session?.url : configURL();
    if (!url || authenticated && (!session || session.expiresAt <= Date.now())) throw new Error('请先登录云端场地库。');
    const headers = {}, options = { method: value === undefined ? 'GET' : 'POST', headers, cache: 'no-store', credentials: 'omit' };
    if (authenticated) headers.Authorization = 'Bearer ' + session.token;
    if (value !== undefined) {
      headers['Content-Type'] = 'application/json';
      const raw = new Blob([JSON.stringify(value)]);
      if (raw.size > 100*1024*1024) throw new Error('本次数据超过 100 MB，请拆分场地迁移或减少照片。');
      if (raw.size > 4096 && typeof CompressionStream !== 'undefined') {
        options.body = await new Response(raw.stream().pipeThrough(new CompressionStream('gzip'))).blob();
        headers['Content-Encoding'] = 'gzip';
      } else options.body = raw;
      if (options.body.size > 24*1024*1024) throw new Error('上传数据超过 24 MB，请减少照片或分批迁移场地。');
    }
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 120000); options.signal = controller.signal;
    try {
      const response = await fetch(url + path, options);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(data.error || `云端请求失败（${response.status}）`), { status: response.status });
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('云端等待超时，当前画布仍保留。请重试原操作以确认是否保存成功。');
      if (error instanceof TypeError) throw new Error('无法连接云端，请检查接口地址与网络。当前画布和本地库仍保留。');
      throw error;
    } finally { clearTimeout(timer); }
  }
  function accept(value) {
    if (value.schema !== 'needflea-cloud-library/1' || !Number.isSafeInteger(value.revision) || stores.some(key => !Array.isArray(value[key]))) throw new Error('云端返回的场地库格式无效。');
    manifest = value; return value;
  }
  async function refresh() { const next = accept(await request('/library')); requestPending = null; return next; }
  async function commit(changes) {
    // Retain the operation ID after network failure: a retry confirms that exact save.
    const fingerprint = JSON.stringify(changes);
    if (requestPending && requestPending.fingerprint !== fingerprint) throw new Error('上次云端保存结果尚未确认，请先重试保存或刷新云端，再进行其他修改。');
    requestPending ||= { fingerprint, payload: { expectedRevision: manifest.revision, operationId: crypto.randomUUID(), changes } };
    try {
      const next = accept(await request('/commit', requestPending.payload)); requestPending = null; return next;
    } catch (error) {
      if (error.status && error.status < 500) requestPending = null;
      if (requestPending) error.message += ' 保存结果待确认，请点击“确认上次保存”或刷新云端查看。';
      throw error;
    }
  }
  window.venueCloud = {
    configuredURL: configURL,
    connected: () => !!session && session.expiresAt > Date.now(),
    revision: () => manifest?.revision,
    pending: () => !!requestPending,
    async retryPending() {
      if (!requestPending) return;
      const next = accept(await request('/commit', requestPending.payload)); requestPending = null; return next;
    },
    async login(url, password) {
      const target = validateURL(url); localStorage.setItem('needflea_cloud_url', target);
      // Login never sends an old session token to a newly entered URL.
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
      try {
        const res = await fetch(target + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }), signal: controller.signal, credentials: 'omit' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '云端登录失败。');
        if (typeof data.token !== 'string' || !Number.isFinite(data.expiresAt)) throw new Error('云端登录响应无效。');
        session = { url: target, token: data.token, expiresAt: data.expiresAt }; remember();
        try { await refresh(); } catch (error) { session = null; manifest = null; remember(); throw error; }
      } finally { clearTimeout(timer); }
    },
    async reconnect() {
      if (!this.connected()) throw new Error('请先登录云端场地库。');
      return refresh();
    },
    logout() { session = manifest = requestPending = null; remember(); },
    refresh,
    async transaction(names, mode, action) {
      if (!manifest || !this.connected()) throw new Error('云端登录已过期，请重新登录。');
      const changes = {}, revision = manifest.revision;
      const tx = { objectStore(name) {
        if (!names.includes(name) || !stores.includes(name)) throw new Error('无效的场地库操作。');
        return {
          getAll() { return { result: structuredClone(manifest[name]) }; },
          get(id) {
            if (name === 'projects' || name === 'activityProjects') return { promise: request(`/project/${name}/${encodeURIComponent(id)}/${revision}`) };
            return { result: structuredClone(manifest[name].find(row => row.id === id)) };
          },
          put(row) { if (mode !== 'readwrite') throw new Error('场地库当前不可写。'); (changes[name] ||= []).push(structuredClone(row)); },
        };
      } };
      const result = action(tx);
      if (mode === 'readwrite') await commit(changes);
      return result?.promise ? await result.promise : result?.result;
    },
    async importLocal(local) {
      if (!manifest) throw new Error('请先连接云端。');
      const changes = Object.fromEntries(stores.map(key => [key, []]));
      let imported = 0, skipped = 0;
      const usedIds = new Set(stores.flatMap(key => manifest[key].map(row => row.id)));
      const usedNames = new Set(manifest.sites.map(row => row.name.toLocaleLowerCase()));
      for (const site of local.sites) {
        const scoped = local.activities.filter(row => row.siteId === site.id), ids = new Set(scoped.map(row => row.id));
        const content = JSON.stringify({ site, base: local.projects.find(row => row.id === site.id), activities: scoped, layouts: local.activityProjects.filter(row => ids.has(row.id)) });
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))), n => n.toString(16).padStart(2,'0')).join('');
        if (manifest.sites.some(row => row.migrationKey === digest)) { skipped++; continue; }
        const base = local.projects.find(row => row.id === site.id);
        if (!base?.project || scoped.some(row => !local.activityProjects.find(p => p.id === row.id)?.project)) throw new Error(`“${site.name}”的本地记录不完整，本次未上传。`);
        let name = site.name, suffix = 2;
        while (usedNames.has(name.toLocaleLowerCase())) name = `${site.name.slice(0,80)}（本地导入 ${suffix++}）`;
        usedNames.add(name.toLocaleLowerCase());
        const id = usedIds.has(site.id) ? crypto.randomUUID() : site.id; usedIds.add(id);
        changes.sites.push({ ...site, id, name, migrationKey: digest });
        const project = structuredClone(base.project); project.site = { name, eventName: '' };
        changes.projects.push({ id, project });
        for (const activity of scoped) {
          const activityId = usedIds.has(activity.id) ? crypto.randomUUID() : activity.id; usedIds.add(activityId);
          changes.activities.push({ ...activity, id: activityId, siteId: id });
          const project = structuredClone(local.activityProjects.find(row => row.id === activity.id).project); project.site = { name, eventName: activity.name };
          changes.activityProjects.push({ id: activityId, project });
        }
        imported++;
      }
      if (imported) await commit(changes);
      return { imported, skipped };
    },
  };
})();
