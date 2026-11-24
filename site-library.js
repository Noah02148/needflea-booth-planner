// Browser-local venues contain independent activity layouts. IDs never travel in JSON.
(() => {
  const $ = id => document.getElementById(id);
  let activeSiteId = null, activeActivityId = null, selectedSiteId = null, baseline = '', busy = false;
  let records = [], activities = [];
  let storage = 'local', cloudView = false, firstOpen = true;
  const dialog = document.createElement('dialog'); dialog.id = 'site-library-dialog';
  dialog.innerHTML = `
    <div class="site-heading"><div><small>VENUES & ACTIVITIES</small><h2>场地与活动</h2></div><button id="site-close" aria-label="关闭场地库">×</button></div>
    <p class="site-note">选择场地，载入活动，继续布置。</p>
    <div class="site-library-tools"><p id="site-storage-status" class="site-note"></p><div class="site-actions"><button id="site-storage-cloud" hidden>返回云端</button><details id="site-cloud-more" class="site-more"><summary>更多管理</summary><p class="site-note">本机场地仅保存在此浏览器，可用于离线布置，或上传到云端共享。</p><button id="site-storage-local">浏览本机场地</button><div id="site-cloud-tools" hidden><div class="site-actions"><button id="site-cloud-import">上传本机场地库</button><button id="site-cloud-logout">退出云端登录</button></div></div></details></div></div>
    <div id="site-cloud-actions" class="site-actions" hidden><button id="site-cloud-refresh">刷新列表</button><button id="site-cloud-retry" hidden>确认上次保存</button></div>
    <section id="site-cloud-section" hidden>
      <form id="site-cloud-form"><details id="site-cloud-settings"><summary>云端连接设置</summary><label>云端接口地址<input id="site-cloud-url" type="url" placeholder="https://你的云端接口域名" autocomplete="url" required></label><p class="site-note">连接你自己的阿里云场地库服务，不填写 OSS AccessKey。</p></details><label>云端访问密码<input id="site-cloud-password" type="password" autocomplete="current-password" required maxlength="256"></label><button id="site-cloud-login" type="submit">登录云端场地库</button></form>

    </section>
    <div id="site-library-content">
    <section id="site-current" hidden><div class="site-current-main"><div><small class="site-eyebrow">正在编辑</small><h3 id="site-current-title">当前画布</h3><p id="site-save-note" class="site-note"></p></div><button id="site-update">保存当前活动</button><button id="site-final">标为定稿</button></div><details id="site-current-settings"><summary>备份与设置</summary><label>定稿修改原因（选填）<input id="site-final-reason" maxlength="1000"></label><button id="site-export-current">下载当前项目 JSON</button><label>所属场地<input id="site-current-name" maxlength="100"></label><label id="site-current-event-label">当前活动名称<input id="site-current-event" maxlength="200"></label><p id="site-current-kind" class="site-note"></p><button id="site-update-base">保存场地基础（不含摊位）</button></details></section>
    <div class="site-workspace"><section class="site-venues"><div class="site-section-heading"><h3>场地</h3><button id="site-new-button">＋ 新建场地</button></div><label class="site-search-label">搜索场地 / 活动<input id="site-search" type="search" placeholder="场地或活动名称"></label><label class="site-mobile-picker">选择场地<select id="site-mobile-select" aria-label="选择场地"></select></label><div id="site-list"></div></section>
    <section id="site-activities" hidden><small class="site-eyebrow">活动布局</small><h3 id="site-activities-title"></h3><p class="site-note">载入一份活动，继续编辑或布置。</p><div id="site-activity-list"></div>
      <details id="activity-create-details"><summary>＋ 为此场地新建活动</summary><form id="activity-create-form"><label>活动名称<input id="activity-name" required maxlength="200" placeholder="如：NEED! FLEA 2027"></label><label>活动布局来源<select id="activity-source"><option value="base">从空白场地开始</option><option value="current">复制当前画布布局</option><option value="file">导入项目 JSON</option></select></label><label id="activity-file-label" hidden>活动项目 JSON<input id="activity-file" type="file" accept=".json"></label><p class="site-note">JSON 自带底图时使用其底图；没有底图时继承此场地基础。新建活动后，修改只保存到该活动。</p><button id="activity-create" type="submit">保存并载入新活动</button></form></details>
      <details id="site-base-settings"><summary>场地底图与基础</summary><p class="site-note">复用底图、比例尺和固定结构；不含活动摊位。</p><div class="site-actions"><button id="site-load-base">载入空白场地</button><button id="site-export-base">下载场地基础 JSON</button></div></details>
    </section></div>
    <details id="site-create-details"><summary>＋ 新建场地</summary><form id="site-create-form"><label>场地名称<input id="site-name" required maxlength="100" placeholder="如：深圳 ING 创意社区"></label><label>首个活动名称（选填）<input id="site-event" maxlength="200" placeholder="如：NEED! FLEA 2026"></label><label>场地来源<select id="site-source"><option value="file">导入 CAD / 已有项目 JSON</option><option value="current">使用当前画布</option></select></label><label id="site-file-label">选择文件<input id="site-file" type="file" accept=".dxf,.dwg,.json"></label><p class="site-note">场地基础不含摊位；导入 JSON 中的已有布局会单独保存为首个活动。</p><button id="site-create" type="submit">保存并载入新场地</button></form></details>
    </div><p id="site-message" role="status" aria-live="polite"></p>`;
  document.body.append(dialog);
  function message(text, error = false) { $('site-message').textContent = text; $('site-message').classList.toggle('site-error', error); }
  function lock(value) {
    busy = value; dialog.querySelectorAll('button,input,select').forEach(e => { e.disabled = value; });
    dialog.setAttribute('aria-busy', String(value));
    if (!value) renderStorage();
  }
  function unbind() { activeSiteId = activeActivityId = selectedSiteId = null; baseline = ''; records = []; activities = []; }
  function renderStorage() {
    const connected = storage === 'cloud' && window.venueCloud?.connected();
    $('site-storage-local').setAttribute('aria-pressed', String(!cloudView));
    $('site-storage-cloud').setAttribute('aria-pressed', String(cloudView));
    $('site-cloud-section').hidden = !cloudView;
    $('site-cloud-form').hidden = !!connected;
    $('site-cloud-tools').hidden = !connected;
    $('site-cloud-actions').hidden = !connected;
    $('site-storage-cloud').hidden = cloudView;
    $('site-storage-local').hidden = !cloudView;
    $('site-cloud-retry').hidden = !window.venueCloud?.pending();
    $('site-library-content').hidden = cloudView && !connected;
    $('site-save-note').textContent = storage === 'cloud' ? '保存到云端，团队成员刷新后可载入。' : '保存在此浏览器，可下载 JSON 备份。';
    $('site-storage-status').textContent = !cloudView ? '本机场地 · 离线模式，仅当前浏览器可用' : connected ? '云端已连接 · 团队共享' : '云端场地库 · 登录后可与团队共享';
  }
  const snapshot = () => window.projectIO.capture(false);
  const fingerprint = project => JSON.stringify({ ...project, viewport: undefined, darkMode: undefined, venue: undefined });
  const hasContent = project => !!project.cadFile || project.items.length > 0 || project.environment?.objects?.length > 0 || !!project.environment?.sitePlan;
  function baseProject(project, name) {
    const base = structuredClone(project);
    Object.assign(base, { version: 3, items: [], nextId: 1, eraserMarks: [], venue: null, site: { name, eventName: '' } });
    if (base.planning) {
      for (const key of ['origin','demands','routes','finalReason']) delete base.planning[key];
    }
    if (base.environment) { base.environment.objects = (base.environment.objects || []).filter(o => !['stage','truss','counter','sign','table','fence'].includes(o.type)); base.environment.views = []; }
    return base;
  }
  function activityProject(project, site, name, base) {
    const result = structuredClone(project);
    if (!result.cadFile?.base64 && !result.environment?.sitePlan && base) {
      result.cadFile = structuredClone(base.cadFile);
      if (result.metersPerUnit == null) result.metersPerUnit = base.metersPerUnit;
    }
    if (!result.environment && base?.environment) result.environment = structuredClone(base.environment);
    if (!result.cadFile?.base64 && !result.environment?.sitePlan && base?.environment?.sitePlan) { result.environment = { ...(result.environment || {}), sitePlan: structuredClone(base.environment.sitePlan) }; result.metersPerUnit = 1; }
    result.version = 3; result.site = { name: site.name, eventName: name };
    return result;
  }
  function database() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('浏览器不支持场地存储，请使用项目 JSON 保存。')); return; }
      const request = indexedDB.open('needflea-site-library', 2); let blocked = false;
      request.onupgradeneeded = event => {
        const db = request.result, tx = request.transaction;
        for (const store of ['sites', 'projects', 'activities', 'activityProjects']) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' });
        if (event.oldVersion === 1) {
          // Upgrade and all copies commit together, or v1 stays intact. Preserve original layout.
          const cursor = tx.objectStore('sites').openCursor();
          cursor.onsuccess = () => {
            const row = cursor.result; if (!row) return;
            const site = row.value, read = tx.objectStore('projects').get(site.id);
            read.onsuccess = () => {
              if (!read.result?.project) { tx.abort(); return; }
              const project = read.result.project, name = String(site.eventName || project.site?.eventName || '初始活动').trim() || '初始活动';
              const id = `${site.id}:initial`;
              tx.objectStore('activities').put({ id, siteId: site.id, name, createdAt: site.createdAt, updatedAt: site.updatedAt, itemCount: project.items?.length || 0 });
              tx.objectStore('activityProjects').put({ id, project: activityProject(project, site, name) });
              tx.objectStore('projects').put({ id: site.id, project: baseProject(project, site.name) });
              const { eventName, itemCount, ...metadata } = site; row.update(metadata); row.continue();
            };
          };
        }
      };
      request.onblocked = () => { blocked = true; reject(new Error('另一个旧页面正在使用场地库，请保存该页面并关闭后重试。')); };
      request.onerror = () => reject(new Error('场地库升级或打开失败，原有数据未覆盖。请检查存储权限后重试。'));
      request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
    });
  }
  async function transaction(stores, mode, action) {
    return storage === 'cloud' ? window.venueCloud.transaction(stores, mode, action) : localTransaction(stores, mode, action);
  }
  async function localTransaction(stores, mode, action) {
    const db = await database();
    try { return await new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode); let result;
      tx.oncomplete = () => resolve(result?.result);
      tx.onabort = () => reject(new Error(tx.error?.name === 'QuotaExceededError' ? '浏览器空间不足，本次未保存。请导出项目备份。' : '存储失败，本次未保存，请重试或导出备份。'));
      tx.onerror = () => {};
      try { result = action(tx); } catch (err) { tx.abort(); reject(err); }
    }); } finally { db.close(); }
  }
  function validateProject(project) {
    if (!project || ![1,2,3].includes(project.version) || !Array.isArray(project.items)) throw new Error('请选择本工具保存的项目 JSON。');
    if (project.metersPerUnit != null && (!Number.isFinite(project.metersPerUnit) || project.metersPerUnit <= 0)) throw new Error('项目比例尺无效。');
    const environment = window.environmentUI?.validate(project.environment);
    if (environment?.sitePlan && !project.cadFile?.base64 && project.metersPerUnit !== 1) throw new Error('实测场地必须使用米制比例尺。');
    if (project.cadFile?.base64) {
      const binary = atob(project.cadFile.base64);
      if (!project.cadFile.isImage && !/\.dwg$/i.test(project.cadFile.name)) {
        const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        if (!new DXFParser().parse(CADText.readBytes(bytes)).entities?.length) throw new Error('CAD 中没有可读取的图形。');
      }
    }
    return project;
  }
  async function projectFromFile(file) {
    if (!file) throw new Error('请先选择 CAD 或项目 JSON。');
    if (file.size > 100 * 1024 * 1024) throw new Error('场地文件请小于 100 MB。');
    const extension = file.name.split('.').pop().toLowerCase();
    if (extension === 'json') return validateProject(JSON.parse(await file.text()));
    if (!['dxf', 'dwg'].includes(extension)) throw new Error('请选择 DXF、DWG 或项目 JSON。');
    const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    let scale = null;
    if (extension === 'dwg') {
      if (!/^AC10\d\d/.test(binary)) throw new Error('文件不是有效的 DWG 格式。');
    } else {
      const content = CADText.readBytes(bytes);
      const units = content.match(/\$INSUNITS[\s\S]*?70\s*\n\s*(\d+)/);
      scale = ({1:.0254,2:.3048,3:1609.344,4:.001,5:.01,6:1,7:1000})[Number(units?.[1])] || null;
    }
    return validateProject({ version: 3, cadFile: { name: file.name, base64: btoa(binary) }, items: [], nextId: 1, metersPerUnit: scale });
  }
  function exportProject(project, name) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(window.projectIO.portable(project))], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function confirmReplace() {
    const current = snapshot(), site = records.find(r => r.id === activeSiteId), activity = activities.find(a => a.id === activeActivityId);
    const editedName = site && ($('site-current-name').value.trim() !== site.name || activity && $('site-current-event').value.trim() !== activity.name);
    return !hasContent(current) && !editedName || fingerprint(current) === baseline && !editedName || confirm('当前画布或名称有尚未保存的修改。载入其他布局将替换当前画布，是否继续？\n可取消后先保存当前活动或导出项目 JSON。');
  }
  function names(name, limit, kind) { name = name.trim(); if (!name || name.length > limit) throw new Error(`请填写 1～${limit} 字的${kind}。`); return name; }
  function checkSiteName(name, id) { name = names(name, 100, '场地名称'); if (records.some(r => r.id !== id && r.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('已有同名场地，请选择该场地并新建活动。'); return name; }
  function checkActivityName(name, siteId, id) { name = names(name, 200, '活动名称'); if (activities.some(a => a.siteId === siteId && a.id !== id && a.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('此场地已有同名活动，请更换名称或载入原活动更新。'); return name; }
  async function loadSafely(project) {
    if (!window.environmentUI) throw new Error('场地组件尚未加载完成，请稍后重试。');
    validateProject(project);
    const previous = snapshot(), binding = [activeSiteId, activeActivityId, baseline];
    try { await window.projectIO.load(project); }
    catch (err) { try { await window.projectIO.load(previous); } catch {} [activeSiteId, activeActivityId, baseline] = binding; renderCurrent(); throw err; }
  }
  async function changeAndSave(project, save, siteId, activityId) {
    const previous = snapshot(), binding = [activeSiteId, activeActivityId, baseline];
    await loadSafely(project);
    try { const parsed = snapshot(); project.cadFile = parsed.cadFile; project.metersPerUnit = parsed.metersPerUnit; await save(); }
    catch (err) { try { await window.projectIO.load(previous); } catch {} [activeSiteId, activeActivityId, baseline] = binding; renderCurrent(); throw err; }
    activeSiteId = siteId; activeActivityId = activityId; selectedSiteId = siteId; baseline = fingerprint(snapshot());
    await refreshList();
  }
  async function refreshList() {
    records = (await transaction(['sites'], 'readonly', tx => tx.objectStore('sites').getAll())).sort((a,b) => b.updatedAt - a.updatedAt);
    activities = (await transaction(['activities'], 'readonly', tx => tx.objectStore('activities').getAll())).sort((a,b) => b.updatedAt - a.updatedAt);
    if (!records.some(r => r.id === selectedSiteId)) selectedSiteId = records.some(r => r.id === activeSiteId) ? activeSiteId : records[0]?.id || null;
    $('site-create-details').open = !records.length;
    renderList(); renderCurrent(); renderActivities();
  }
  function renderCurrent() {
    const site = records.find(r => r.id === activeSiteId), activity = activities.find(a => a.id === activeActivityId);
    $('site-current').hidden = !site;
    if (site) {
      $('site-current-title').textContent = `${activity?.name || site.name} · ${activity ? site.name : '场地基础'}`;
      $('site-current-name').value = site.name; $('site-current-event').value = activity?.name || '';
      $('site-final').hidden = $('site-current-event-label').hidden = $('site-update').hidden = !activity;
      $('site-current-kind').textContent = activity ? '保存当前活动只更新这份布局，其他活动不变。保存场地基础仅更新可复用的底图与环境。' : '当前是场地基础，不含活动布局。可在下方新建活动。';
    }
    $('site-library-button').textContent = site ? `场地：${site.name}` : '🏛 选择场地';
    $('site-library-button').title = site ? `${site.name}${activity ? ' · ' + activity.name : ' · 场地基础'}` : '选择场地与活动布局';
  }
  function button(text, action, attribute, id) {
    const b = document.createElement('button'); b.textContent = text; if (attribute) b.dataset[attribute] = id;
    b.onclick = () => run(action); return b;
  }
  function renderList() {
    const list = $('site-list'); list.replaceChildren(); list.scrollTop = 0; const query = $('site-search').value.trim().toLocaleLowerCase();
    const picker = $('site-mobile-select'); picker.replaceChildren();
    for (const site of records) { const option = document.createElement('option'); option.value = site.id; option.textContent = site.name; option.selected = site.id === selectedSiteId; picker.append(option); }
    if (!records.length) { const option = document.createElement('option'); option.textContent = '暂无场地，请先新建'; picker.append(option); }
    const visible = records.filter(r => `${r.name} ${activities.filter(a => a.siteId === r.id).map(a => a.name).join(' ')}`.toLocaleLowerCase().includes(query));
    if (!visible.length) { const p = document.createElement('p'); p.className = 'site-note'; p.textContent = records.length ? '没有匹配的场地或活动。' : '还没有场地，请在下方新建。'; list.append(p); }
    for (const site of visible) {
      const row = document.createElement('div'); row.className = 'site-record'; row.classList.toggle('site-record-selected', site.id === selectedSiteId);
      const title = document.createElement('strong'); title.textContent = site.name;
      const note = document.createElement('p'); note.textContent = `${activities.filter(a => a.siteId === site.id).length} 个活动`;
      const choose = button(site.id === selectedSiteId ? '已选择' : '查看活动', () => { selectedSiteId = site.id; renderList(); renderActivities(); $('site-activities-title').scrollIntoView({ block: 'nearest' }); }, 'siteSelect', site.id);
      row.append(title, note, choose); list.append(row);
    }
  }
  function renderActivities() {
    const site = records.find(r => r.id === selectedSiteId); $('site-activities').hidden = !site;
    if (!site) return;
    $('site-activities-title').textContent = site.name;
    const list = $('site-activity-list'); list.replaceChildren(); list.scrollTop = 0;
    const scoped = activities.filter(a => a.siteId === site.id).sort((a, b) => Number(b.id === activeActivityId) - Number(a.id === activeActivityId));
    if (!scoped.length) { const empty = document.createElement('p'); empty.className = 'site-note'; empty.textContent = '此场地还没有活动，使用下方入口创建第一份布局。'; list.append(empty); }
    for (const activity of scoped) {
      const row = document.createElement('div'); row.className = 'site-record';
      const title = document.createElement('strong'); title.textContent = activity.name + (activity.id === activeActivityId ? ' · 当前活动' : '');
      const meta = document.createElement('p'); meta.textContent = `${activity.status==='final'?'定稿 · ':''}${activity.itemCount} 个标注 · ${new Date(activity.updatedAt).toLocaleString()}`;
      const actions = document.createElement('div'); actions.className = 'site-actions';
      actions.append(button('载入编辑', () => loadActivity(activity.id), 'activityLoad', activity.id), button('导出活动 JSON', async () => {
        const saved = await transaction(['activityProjects'], 'readonly', tx => tx.objectStore('activityProjects').get(activity.id));
        if (!saved) throw new Error('活动数据不存在。'); exportProject(activityProject(saved.project, site, activity.name), `${site.name}_${activity.name}`); message('活动完整项目已导出，包含底图和环境。');
      }, 'activityExport', activity.id));
      const more = document.createElement('details'); more.className = 'site-activity-more';
      const summary = document.createElement('summary'); summary.textContent = '备份'; more.append(summary, actions.lastChild); actions.append(more);
      row.append(title, meta, actions); list.append(row);
    }
  }
  async function loadActivity(id) {
    const activity = activities.find(a => a.id === id), site = records.find(r => r.id === activity?.siteId);
    if (!activity || !site) throw new Error('活动不存在，请重新打开场地库。');
    if (!confirmReplace()) return;
    const saved = await transaction(['activityProjects'], 'readonly', tx => tx.objectStore('activityProjects').get(id));
    if (!saved) throw new Error('活动布局不存在。');
    await loadSafely(activityProject(saved.project, site, activity.name));
    activeSiteId = site.id; activeActivityId = id; selectedSiteId = site.id; baseline = fingerprint(snapshot()); renderCurrent(); dialog.close();
    $('tool-hint').textContent = `已载入：${site.name} · ${activity.name}`;
  }
  async function run(action) { if (busy) return; lock(true); try { await action(); } catch (err) { message(err.message || '操作失败，请重试。', true); } finally { lock(false); } }
  $('site-mobile-select').onchange = () => { selectedSiteId = $('site-mobile-select').value; renderList(); renderActivities(); };
  $('site-new-button').onclick = () => { $('site-create-details').open = !$('site-create-details').open; if ($('site-create-details').open) { $('site-create-details').scrollIntoView({ block: 'nearest' }); $('site-name').focus(); } };
  $('site-search').oninput = renderList;
  $('site-source').onchange = () => { $('site-file-label').hidden = $('site-source').value !== 'file'; };
  $('activity-source').onchange = () => { $('activity-file-label').hidden = $('activity-source').value !== 'file'; };
  $('site-close').onclick = () => { if (!busy) dialog.close(); };
  dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  $('site-create-form').onsubmit = e => {
    e.preventDefault(); const name = $('site-name').value, event = $('site-event').value, source = $('site-source').value, file = $('site-file').files[0];
    run(async () => {
      const title = checkSiteName(name), raw = source === 'current' ? window.projectIO.captureForLibrary() : await projectFromFile(file);
      if (!hasContent(raw)) throw new Error('当前画布为空，请先导入 CAD 或项目。');
      if (source !== 'current' && !confirmReplace()) return;
      const id = crypto.randomUUID(), now = Date.now(), firstName = event.trim() || String(raw.site?.eventName || '').trim() || (raw.items.length || raw.environment?.objects?.some(o => ['stage','truss','counter','sign','table','fence'].includes(o.type)) || raw.environment?.views?.length ? '初始活动' : '');
      const site = { id, name: title, createdAt: now, updatedAt: now, sourceName: raw.cadFile?.name || '项目 JSON' }, base = baseProject(raw, title);
      const activityId = firstName ? crypto.randomUUID() : null;
      const project = activityId ? activityProject(raw, site, names(firstName, 200, '活动名称')) : base;
      await changeAndSave(project, () => transaction(['sites','projects','activities','activityProjects'], 'readwrite', tx => {
        base.cadFile = project.cadFile; base.metersPerUnit = project.metersPerUnit;
        tx.objectStore('sites').put(site); tx.objectStore('projects').put({ id, project: base });
        if (activityId) { tx.objectStore('activities').put({ id: activityId, siteId: id, name: firstName, createdAt: now, updatedAt: now, itemCount: raw.items.length }); tx.objectStore('activityProjects').put({ id: activityId, project }); }
      }), id, activityId);
      $('site-create-form').reset(); $('site-file-label').hidden = false; message('场地已保存；已有布局已作为独立活动保留。');
    });
  };
  $('activity-create-form').onsubmit = e => {
    e.preventDefault(); const siteId = selectedSiteId, name = $('activity-name').value, source = $('activity-source').value, file = $('activity-file').files[0];
    run(async () => {
      const site = records.find(r => r.id === siteId); if (!site) throw new Error('请先选择场地。');
      const title = checkActivityName(name, siteId), stored = await transaction(['projects'], 'readonly', tx => tx.objectStore('projects').get(siteId));
      if (!stored) throw new Error('场地基础不存在。');
      if (source === 'file' && !/\.json$/i.test(file?.name || '')) throw new Error('请选择活动项目 JSON。');
      const raw = source === 'current' ? window.projectIO.captureForLibrary() : source === 'base' ? stored.project : await projectFromFile(file);
      const project = validateProject(activityProject(raw, site, title, stored.project));
      if (source !== 'current' && !confirmReplace()) return;
      const id = crypto.randomUUID(), now = Date.now();
      await changeAndSave(project, () => transaction(['activities','activityProjects'], 'readwrite', tx => {
        tx.objectStore('activities').put({ id, siteId, name: title, createdAt: now, updatedAt: now, itemCount: project.items.length });
        tx.objectStore('activityProjects').put({ id, project });
      }), siteId, id);
      $('activity-create-form').reset(); $('activity-file-label').hidden = true; $('activity-create-details').open = false; message('新活动已保存并载入，其他活动布局保持不变。');
    });
  };
  function saveActivity(final) {
    const siteId = activeSiteId, id = activeActivityId, name = $('site-current-event').value, siteName = $('site-current-name').value;
    run(async () => {
      const old = activities.find(a => a.id === id && a.siteId === siteId), site = records.find(r => r.id === siteId);
      if (!old || !site) throw new Error('请先载入活动，或在此场地下新建活动。');
      const title = checkActivityName(name, siteId, id), venueName = checkSiteName(siteName, siteId), now = Date.now();
      const project = activityProject(window.projectIO.captureForLibrary(), { ...site, name: venueName }, title);
      if (final) project.planning = { ...project.planning, finalReason: $('site-final-reason').value.trim() };
      await transaction(['sites','activities','activityProjects'], 'readwrite', tx => {
        tx.objectStore('sites').put({ ...site, name: venueName, updatedAt: now });
        tx.objectStore('activities').put({ ...old, name: title, status: final ? 'final' : 'draft', finalToken: final ? crypto.randomUUID() : null, updatedAt: now, itemCount: project.items.length });
        tx.objectStore('activityProjects').put({ id, project });
      });
      planningData = project.planning; $('site-final-reason').value = '';
      window.projectIO.setSite(project.site); baseline = fingerprint(snapshot()); await refreshList(); message(final ? '已保存定稿版本。' : '当前活动布局已保存。');
    });
  }
  $('site-update').onclick = () => saveActivity(false);
  $('site-final').onclick = () => saveActivity(true);
  window.savePlanningDraft = async (project, original) => {
    if (busy) throw new Error('场地库正在保存，请稍后重试。');
    lock(true);
    try {
      if (!activeSiteId && window.venueCloud?.connected()) {
        await window.venueCloud.reconnect(); storage = 'cloud'; cloudView = true; firstOpen = false;
      }
      await refreshList();
      const bound = records.find(r=>r.id===activeSiteId);
      const now=Date.now(), id=crypto.randomUUID(), source=activities.find(a=>a.id===activeActivityId);
      let name=(original.site?.name || original.cadFile?.name || '实测场地').slice(0,90);
      if (!bound) { let n=1; const base=name; while(records.some(s=>s.name===name)) name=base+' · '+(++n); }
      const site=bound || {id:crypto.randomUUID(),name,sourceName:original.cadFile?.name || '实测场地',createdAt:now,updatedAt:now};
      const prefix=(source?.name || original.site?.eventName || site.name).slice(0,170);
      let number=1,title;
      do { title=prefix+' · 草案 '+number++; } while(activities.some(a=>a.siteId===site.id && a.name===title));
      project.site={name:site.name,eventName:title};
      const originalId=crypto.randomUUID(), saveOriginal=!source || baseline!==fingerprint(original);
      const record=(id,name,project)=>({id,siteId:site.id,name,status:'draft',itemCount:project.items.length,createdAt:now,updatedAt:now});
      await changeAndSave(project,()=>transaction(['sites','projects','activities','activityProjects'],'readwrite',tx=>{
        if(!bound) {
          tx.objectStore('sites').put(site); tx.objectStore('projects').put({id:site.id,project:baseProject(original,site.name)});
        }
        // Preserve unbound or manually edited source layouts as their own snapshot.
        if(saveOriginal) {
          const originalName='原始布局 · '+originalId.slice(0,8);
          tx.objectStore('activities').put(record(originalId,originalName,original));
          tx.objectStore('activityProjects').put({id:originalId,project:activityProject(original,site,originalName)});
        }
        tx.objectStore('activities').put({...record(id,title,project),parentActivityId:saveOriginal?originalId:source.id});
        tx.objectStore('activityProjects').put({id,project});
      }),site.id,id);
      return title;
    } finally { lock(false); }
  };
  $('site-update-base').onclick = () => {
    const id = activeSiteId, name = $('site-current-name').value;
    run(async () => {
      const site = records.find(r => r.id === id); if (!site) throw new Error('请先载入场地或活动。');
      const title = checkSiteName(name, id), base = baseProject(window.projectIO.captureForLibrary(), title);
      await transaction(['sites','projects'], 'readwrite', tx => { tx.objectStore('sites').put({ ...site, name: title, updatedAt: Date.now(), sourceName: base.cadFile?.name || '项目 JSON' }); tx.objectStore('projects').put({ id, project: base }); });
      window.projectIO.setSite({ name: title, eventName: activities.find(a => a.id === activeActivityId)?.name || '' });
      if (!activeActivityId) baseline = fingerprint(snapshot());
      await refreshList(); message('场地基础已保存（不含摊位），已有活动布局没有修改。');
    });
  };
  $('site-load-base').onclick = () => run(async () => {
    if (!confirmReplace()) return;
    const id = selectedSiteId, site = records.find(r => r.id === id), data = await transaction(['projects'], 'readonly', tx => tx.objectStore('projects').get(id));
    if (!site || !data) throw new Error('场地基础不存在。');
    await loadSafely(baseProject(data.project, site.name)); activeSiteId = id; activeActivityId = null; baseline = fingerprint(snapshot()); renderCurrent(); dialog.close();
  });
  $('site-export-base').onclick = () => run(async () => {
    const site = records.find(r => r.id === selectedSiteId), data = await transaction(['projects'], 'readonly', tx => tx.objectStore('projects').get(selectedSiteId));
    if (!site || !data) throw new Error('场地基础不存在。'); exportProject(baseProject(data.project, site.name), `${site.name}_场地基础`); message('场地基础已导出。每个活动请另行导出活动 JSON 备份。');
  });
  $('site-export-current').onclick = () => window.saveProject();
  $('site-cloud-url').value = window.venueCloud?.configuredURL() || '';
  // A deployed team endpoint is configured once, not by each colleague.
  $('site-cloud-settings').hidden = !!window.NEEDFLEA_CLOUD_API_URL;
  $('site-cloud-url').readOnly = !!window.NEEDFLEA_CLOUD_API_URL;
  $('site-cloud-settings').open = !$('site-cloud-url').value;
  $('site-storage-local').onclick = () => run(async () => {
    if (storage !== 'local') unbind();
    $('site-cloud-more').open = false;
    storage = 'local'; cloudView = false; localStorage.setItem('needflea_library_mode', 'local');
    await refreshList(); message('已切换到本地库，当前画布保留。');
  });
  $('site-storage-cloud').onclick = () => run(async () => {
    cloudView = true; $('site-cloud-more').open = false;
    if (window.venueCloud?.connected()) {
      const before = window.venueCloud.revision();
      await window.venueCloud.reconnect(); if (storage !== 'cloud' || before !== window.venueCloud.revision()) unbind();
      storage = 'cloud'; localStorage.setItem('needflea_library_mode', 'cloud'); await refreshList();
    }
    renderStorage();
  });
  $('site-cloud-form').onsubmit = event => {
    event.preventDefault(); const url = $('site-cloud-url').value, password = $('site-cloud-password').value;
    run(async () => {
      try { await window.venueCloud.login(url, password); }
      finally { $('site-cloud-password').value = ''; }
      unbind(); storage = 'cloud'; cloudView = true; localStorage.setItem('needflea_library_mode', 'cloud');
      await refreshList(); message('已连接云端场地库，当前画布保留。可载入云端活动，或上传本机场地库。');
    });
  };
  $('site-cloud-refresh').onclick = () => run(async () => {
    await window.venueCloud.refresh(); unbind(); await refreshList();
    message('云端列表已刷新，当前画布保留。请载入活动后继续编辑；未保存画布也可作为新活动保存。');
  });
  $('site-cloud-retry').onclick = () => run(async () => {
    await window.venueCloud.retryPending(); unbind(); await refreshList(); message('上次保存已确认，请载入对应活动继续编辑。当前画布保留。');
  });
  $('site-cloud-logout').onclick = () => run(async () => {
    window.venueCloud.logout(); unbind(); storage = 'local'; cloudView = true; localStorage.removeItem('needflea_library_mode');
    await refreshList(); message('已退出云端登录，当前画布和本地记录保留。');
  });
  $('site-cloud-import').onclick = () => run(async () => {
    message('正在整理本机场地与活动，请稍候…');
    const stores = ['sites','projects','activities','activityProjects'];
    const local = await localTransaction(stores, 'readonly', tx => {
      const requests = stores.map(name => tx.objectStore(name).getAll());
      return { get result() { return Object.fromEntries(stores.map((name, i) => [name, requests[i].result])); } };
    });
    for (const name of ['projects','activityProjects']) for (const row of local[name]) validateProject(row.project);
    const result = await window.venueCloud.importLocal(local);
    await refreshList(); message(`已上传 ${result.imported} 个场地及其活动，跳过 ${result.skipped} 个已迁移场地。本地原记录保留。`);
  });
  window.addEventListener('needflea-project-loaded', () => { activeSiteId = activeActivityId = null; baseline = ''; renderCurrent(); });
  window.openSiteLibrary = () => {
    if (window.environmentUI?.hasPendingPreview()) { $('tool-hint').textContent = '请先应用、放弃或取消环境预览，再选择场地。'; return; }
    if (!dialog.open) {
      for (const id of ['site-current-settings', 'site-base-settings', 'activity-create-details', 'site-cloud-more']) $(id).open = false;
      dialog.showModal();
    }
    dialog.scrollTop = 0; message('');
    run(async () => {
      if (firstOpen) {
        firstOpen = false;
        const preferred = localStorage.getItem('needflea_library_mode');
        if (window.NEEDFLEA_CLOUD_API_URL || preferred === 'cloud') {
          cloudView = true;
          if (window.venueCloud?.connected()) { await window.venueCloud.reconnect(); storage = 'cloud'; }
        }
      } else if (storage === 'cloud' && (!activeSiteId || fingerprint(snapshot()) === baseline)) {
        const before = window.venueCloud.revision(); await window.venueCloud.refresh();
        if (before !== window.venueCloud.revision()) { unbind(); message('云端列表已更新，当前画布保留，请重新载入活动后编辑。'); }
      }
      await refreshList();
    });
  };
})();
