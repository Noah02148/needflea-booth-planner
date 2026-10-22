import { validateMarbleAsset, estimateMarbleCost, solveMarbleAlignment } from './marble-contract.mjs';
import { readAnalysisResponse } from './environment-progress.mjs';

export function createMarbleUI({ panel, getState, getAsset, isPreview, isBusy, preview, cancelLoad, fitScene, enterScene, edit, apply, discard, pickScene, pickCAD, cancelPick, message, getBounds, getMpu }) {
  const $ = id => document.getElementById(id);
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const apiURL = window.NEEDFLEA_MARBLE_API_URL || (local ? 'http://127.0.0.1:3004' : '/marble-api');
  const section = document.createElement('div'); section.className = 'env-section env-marble-section';
  section.innerHTML = `
    <h3>02 · 生成与任务</h3>
    <p>从照片生成实景外观；结果可能包含推测结构，不能替代实测。先预览、对齐 CAD，再应用。</p>
    <div class="env-row"><label>输入方式<select id="marble-mode"><option value="reconstruct">同一空间多图重建（最多 8 张）</option><option value="directions">按标注朝向组合（最多 4 张）</option><option value="pano">完整 360° 全景（单张 2:1）</option></select></label></div>
    <p>多图尺寸不同会自动等比缩放并补边，不裁切照片；原照片保留。</p>
    <label>模型<select id="marble-model"><option value="marble-1.1">Marble 1.1 · 正式</option><option value="marble-1.0-draft">Marble Draft · 草稿</option><option value="marble-1.1-plus">Marble 1.1 Plus · 更大空间</option></select></label>
    <p id="marble-cost"></p>
    <label class="env-check"><input id="marble-consent" type="checkbox"> 将上方照片发送至 World Labs，按显示费用生成</label>
    <div class="env-row"><button id="marble-generate">用 Marble 生成</button><button id="marble-check">检查余额</button></div>
    <p id="marble-status" role="status">正在检查 Marble 服务…</p>
    <div id="marble-progress" hidden aria-label="Marble 生成进度">
      <strong id="marble-elapsed"></strong><span id="marble-activity"></span>
      <ol id="marble-steps"><li>整理照片</li><li>检查额度</li><li>提交任务</li><li>生成环境</li><li>生成完成</li></ol>
      <p id="marble-progress-note"></p>
      <details><summary>查看阶段记录</summary><ol id="marble-progress-log"></ol></details>
    </div>
    <p id="marble-render-status" role="status"></p>
    <button id="marble-preview-cancel" hidden>取消加载 · 保留生成结果</button>
    <div id="marble-job" hidden><p id="marble-job-status"></p><div class="env-row"><button id="marble-refresh">查询任务</button><button id="marble-preview" hidden>加载生成预览</button></div>
    <p>任务提交后会继续在 World Labs 执行，关闭面板不会取消计费。刷新页面后可继续查询。</p></div>
    <details><summary>历史任务 / 恢复任务</summary><button id="marble-history-refresh">刷新任务列表</button><div id="marble-history"></div>
      <div id="marble-recovery" hidden><label>控制台中的 Operation ID<input id="marble-operation" type="text" autocomplete="off"></label><button id="marble-recover">关联已有任务</button><button id="marble-resolve">已确认没有生成任务</button></div>
    </details>
    <div id="marble-controls" hidden>
      <strong id="marble-preview-label"></strong>
      <div class="env-row"><button id="marble-apply">应用 Marble 环境</button><button id="marble-discard">放弃预览</button></div>
      <label class="env-check"><input id="marble-visible" type="checkbox"> 显示 Marble 环境</label>
      <label>场景精度<select id="marble-resolution"></select></label>
      <div class="env-row"><button id="marble-enter">进入场景</button><button id="marble-fit">俯视校准</button></div>
      <p>进入场景：隐藏摊位与 CAD，拖动环顾，滚轮前后移动；点击画面后可用 WASD 移动、R/F 升降。俯视校准恢复叠加。轻量版只供快速检查，细节请切换标准或完整精度；切换不重新生成、不增加生成费用。</p>
      <p>先选场景中的地面墙角 / 柱脚，再点 CAD 中同一位置；至少两组，建议三组以上。</p>
      <div class="env-row"><button id="marble-pair">添加对应点</button><button id="marble-align">计算对齐</button><button id="marble-pairs-clear">清空点</button></div>
      <p id="marble-pairs"></p>
      <details><summary>手动微调位置、角度和比例</summary><div class="env-row"><label>中心 X（CAD）<input id="marble-x" type="number" step="any"></label><label>中心 Y（CAD）<input id="marble-y" type="number" step="any"></label></div>
      <div class="env-row"><label>旋转（度）<input id="marble-angle" type="number" step="1"></label><label>校准比例<input id="marble-scale" type="number" min="0.0001" step="0.01"></label><label>地面高度（米）<input id="marble-height" type="number" step="0.05"></label></div></details>
      <button id="marble-remove">移除 Marble 环境</button>
      <p>项目 JSON 保存场景引用和校准；本地生成资源保存在 Marble 服务的数据目录，换电脑时需同时迁移该目录。</p>
    </div>`;
  document.getElementById('env-marble-panel').append(section);
  let job = null, timer = null, submitting = false, loadingPreview = false, pairs = [], assetIdentity = '', picking = false, consentPhotos = [];
  let progress = null, progressTimer = null, previewAttempt = 0;
  const storageKey = `needflea-marble-job:${apiURL}`;
  const status = (text, error = false) => { $('marble-status').textContent = text; $('marble-status').classList.toggle('marble-error', error); };
  function drawProgress() {
    if (!progress) return;
    const elapsed = Math.max(0, Math.floor(((progress.finished || Date.now()) - progress.started) / 1000));
    $('marble-elapsed').textContent = `已用 ${Math.floor(elapsed / 60)} 分 ${elapsed % 60} 秒`;
    $('marble-activity').textContent = progress.finished ? progress.outcome : `最近通信 ${Math.floor((Date.now() - progress.activity) / 1000)} 秒前`;
    $('marble-steps').querySelectorAll('li').forEach((li, i) => { li.className = progress.outcome === '已完成' || i < progress.step ? 'done' : i === progress.step ? (progress.finished ? 'failed' : 'active') : ''; });
    $('marble-progress-note').textContent = progress.finished ? progress.outcome : '显示实际处理阶段与耗时；仅在 Marble 返回完成百分比时显示百分比。';
  }
  function startProgress(started = Date.now()) {
    clearInterval(progressTimer); progress = { started, activity: Date.now(), step: 0, last: '' };
    $('marble-progress').hidden = false; $('marble-progress-log').replaceChildren();
    progressTimer = setInterval(drawProgress, 1000); drawProgress();
  }
  function stopProgress(outcome, finished = Date.now()) {
    clearInterval(progressTimer);
    if (progress) { progress.finished = finished; progress.outcome = outcome; drawProgress(); }
  }
  function progressEvent(event) {
    if (!progress) startProgress();
    progress.activity = Date.now();
    if (event.type === 'heartbeat') { drawProgress(); return; }
    const step = { preparing: 0, credits: 1, submitting: 2, generating: 3, complete: 4 }[event.stage];
    if (step !== undefined) progress.step = Math.max(progress.step, step);
    if (event.jobId) { progress.jobId = event.jobId; try { localStorage.setItem(storageKey, event.jobId); } catch { /* optional */ } }
    if (event.message && event.message !== progress.last) {
      status(event.message);
      const li = document.createElement('li'); li.textContent = `${Math.max(0, Math.floor((Date.now() - progress.started) / 1000))} 秒 · ${event.message}`;
      $('marble-progress-log').append(li); progress.last = event.message;
      if ($('marble-progress-log').children.length > 30) $('marble-progress-log').firstChild.remove();
    }
    drawProgress();
  }
  async function request(path, body, onEvent) {
    const response = await fetch(`${apiURL}${path}`, { ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...(onEvent ? { Accept: 'application/x-ndjson' } : {}) }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(body ? 150000 : 15000) });
    const data = onEvent ? await readAnalysisResponse(response, onEvent) : await response.json();
    if (!response.ok || data.error || data.httpStatus >= 400) {
      const err = new Error(data.error || 'Marble 服务未响应'); err.submission = data.submission; throw err;
    }
    return data;
  }
  function cost() {
    const estimate = estimateMarbleCost($('marble-model').value, $('marble-mode').value, getState().photos.length);
    const range = estimate.min === estimate.max ? `${estimate.min}` : `${estimate.min}～${estimate.max}`;
    $('marble-cost').textContent = `本次预计 ${range} credits（约 $${(estimate.min / 1250).toFixed(2)}${estimate.max !== estimate.min ? '～$' + (estimate.max / 1250).toFixed(2) : ''}）。网页 Pro 不含 API 额度；不自动导出另收费的高质量网格。`;
  }
  function sync() {
    cost();
    const photos = getState().photos;
    if (photos.length !== consentPhotos.length || photos.some((p, i) => p.dataUrl !== consentPhotos[i])) {
      $('marble-consent').checked = false; consentPhotos = photos.map(p => p.dataUrl);
    }
    const asset = getAsset();
    if ((asset?.worldId || '') !== assetIdentity) { pairs = []; assetIdentity = asset?.worldId || ''; }
    const previewing = isPreview();
    const active = job && ['submitting', 'generating', 'unknown'].includes(job.status);
    $('marble-generate').disabled = submitting || !!active || isBusy() || previewing;
    $('marble-mode').disabled = $('marble-model').disabled = $('marble-consent').disabled = submitting || !!active || isBusy() || previewing;
    $('marble-generate').textContent = submitting ? '正在提交…' : active ? '已有任务 · 请查询' : '用 Marble 生成';
    $('marble-controls').hidden = !asset;
    $('marble-job').hidden = !job;
    $('marble-preview').hidden = job?.status !== 'complete';
    $('marble-preview').disabled = submitting || isBusy() || previewing || loadingPreview;
    $('marble-recovery').hidden = job?.status !== 'unknown';
    $('marble-preview-cancel').hidden = !loadingPreview;
    $('marble-preview-cancel').disabled = false;
    if (job) {
      const elapsed = Math.floor((Date.now() - job.createdAt) / 1000);
      $('marble-job-status').textContent = `${job.message} · ${job.model} · ${elapsed} 秒${job.percent != null ? ` · ${job.percent}%` : ''}${job.costCredits != null ? ` · 实际 ${job.costCredits} credits` : ''}`;
    }
    if (!asset) return;
    // These controls intentionally remain available while a Marble preview is locked.
    $('marble-controls').querySelectorAll('button,input,select').forEach(e => { e.disabled = isBusy() || loadingPreview; });
    $('marble-apply').hidden = $('marble-discard').hidden = !previewing;
    $('marble-preview-label').textContent = previewing ? 'Marble 预览 · 尚未应用' : '当前 Marble 环境';
    $('marble-visible').checked = asset.visible;
    const select = $('marble-resolution'); select.replaceChildren();
    for (const key of Object.keys(asset.spzUrls)) { const option = document.createElement('option'); option.value = key; option.textContent = ({ '100k': '轻量 · 100k', '500k': '标准 · 500k', full_res: '高清 · 完整' })[key]; select.append(option); }
    select.value = asset.resolution;
    for (const key of ['x', 'y', 'angle', 'scale', 'height']) $('marble-' + key).value = asset.transform[key];
    $('marble-pairs').textContent = picking ? '正在选点，Esc 取消本组。' : `已选 ${pairs.length} 组${pairs.length ? ' · ' + pairs.map((_, i) => i + 1).join('、') : ''}`;
  }
  function setJob(next) {
    if (!progress || (progress.jobId && progress.jobId !== next.id) || (progress.finished && ['submitting', 'generating'].includes(next.status))) startProgress(next.createdAt);
    progress.jobId = next.id;
    job = next;
    progressEvent({ stage: next.status === 'complete' ? 'complete' : next.status === 'generating' ? 'generating' : 'submitting', message: next.message });
    if (next.status === 'complete') stopProgress('已完成', next.updatedAt || Date.now());
    else if (next.status === 'failed' || next.status === 'unknown') stopProgress(next.status === 'unknown' ? '提交结果待确认，请核对原任务' : '生成未完成');
    try { localStorage.setItem(storageKey, next.id); } catch { /* A private browser can disable storage. */ }
    sync();
    clearTimeout(timer);
    if (['submitting', 'generating'].includes(job.status)) timer = setTimeout(poll, 5000);
  }
  async function poll() {
    if (!job) return;
    try { setJob(await request(`/jobs/${encodeURIComponent(job.id)}`)); }
    catch (err) { status(`${err.message || '连接中断'}。现有任务不会重新提交；服务恢复后点击查询。`); clearTimeout(timer); }
  }
  async function check() {
    try {
      const health = await request('/health');
      if (!health.configured) { status(health.message); return; }
      const credits = await request('/credits'); status(`已连接 Marble · 余额 ${credits.remaining_credits} credits（查询不消耗生成额度）`);
      return credits;
    } catch (err) { status(local ? `${err instanceof TypeError ? '无法连接 Marble 本地服务' : err.message}。请启动 node marble-server.mjs，再检查余额。` : '线上 Marble 生成服务尚未配置。当前可在本地运行 Marble 服务后使用。'); }
  }
  async function history() {
    try {
      const result = await request('/jobs'), list = $('marble-history'); list.replaceChildren();
      if (!result.jobs.length) list.textContent = '暂无生成任务';
      for (const previous of result.jobs) { const button = document.createElement('button'); button.textContent = `${new Date(previous.createdAt).toLocaleString()} · ${previous.model} · ${previous.status}`; button.onclick = () => { setJob(previous); poll(); }; list.append(button); }
    } catch (err) { status(err.message); }
  }
  $('marble-model').onchange = $('marble-mode').onchange = () => { $('marble-consent').checked = false; cost(); };
  $('marble-check').onclick = check;
  $('marble-history-refresh').onclick = history;
  $('marble-refresh').onclick = poll;
  $('marble-generate').onclick = async () => {
    if (submitting || isBusy() || isPreview() || (job && ['submitting', 'generating', 'unknown'].includes(job.status))) return;
    const state = getState(), mode = $('marble-mode').value, model = $('marble-model').value;
    if (!state.photos.length) { status('请先上传场地照片，再用 Marble 生成。', true); message('请先上传场地照片，再用 Marble 生成。'); return; }
    if (!$('marble-consent').checked) { status('请先确认本次照片上传和 Marble API 费用。', true); message('请先确认本次照片上传和 Marble API 费用。'); return; }
    submitting = true; startProgress(); progressEvent({ stage: 'preparing', message: `正在上传并整理 ${state.photos.length} 张照片…` }); sync();
    const requestId = crypto.randomUUID();
    // Remember an uncertain POST before sending, so a lost response can be recovered from history.
    try { localStorage.setItem(storageKey + ':request', requestId); } catch { /* optional */ }
    try {
      const next = await request('/jobs', { requestId, model, mode, photos: state.photos, notes: state.notes, instruction: state.generationPrompt }, progressEvent);
      setJob(next); status(next.status === 'unknown' || next.status === 'failed' ? next.message : '任务已提交。可继续查询进度；完成后点击加载预览。'); $('marble-consent').checked = false;
    } catch (err) {
      if (err.submission === 'not_submitted') {
        status(`${err.message}。本次尚未提交给 Marble，未产生生成费用。`, true);
        stopProgress('未提交 · 请按提示修正后重试');
        return;
      }
      status(`${err instanceof TypeError ? '未收到服务回复' : err.message}。请从历史任务核对提交结果，避免重复生成。`, true);
      stopProgress('连接中断 · 正在核对任务');
      // Reconcile a possibly accepted paid POST before allowing another submission.
      try { const result = await request('/jobs'); const existing = result.jobs.find(j => j.requestId === requestId); if (existing) setJob(existing); } catch { /* request ID is retained across refresh */ }
    } finally { submitting = false; sync(); }
  };
  $('marble-preview').onclick = async () => {
    if (!job?.asset || isBusy() || isPreview() || loadingPreview) return;
    const attempt = ++previewAttempt;
    loadingPreview = true; sync(); status('正在加载已有生成结果，请查看下方加载阶段。');
    try {
      const b = getBounds();
      const asset = validateMarbleAsset({ ...job.asset, resolution: job.asset.spzUrls['100k'] ? '100k' : undefined, transform: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, angle: 0, height: 0, scale: 1 } });
      await preview(asset);
      if (attempt === previewAttempt) status('Marble 场景已加载为预览，请校准后应用。');
    } catch (err) { if (attempt === previewAttempt) { status(`Marble 预览加载失败：${err.message}。请重试原任务，无需重新生成。`, true); message(`Marble 预览失败：${err.message}`); } }
    finally { if (attempt === previewAttempt) { loadingPreview = false; sync(); } }
  };
  $('marble-preview-cancel').onclick = () => { previewAttempt++; loadingPreview = false; cancelLoad(); sync(); status('已取消预览加载，原项目和已生成任务保留。可以重新加载，不会重复生成。'); };
  $('marble-fit').onclick = fitScene;
  $('marble-enter').onclick = enterScene;
  const update = async value => {
    const attempt = ++previewAttempt;
    const previous = getAsset();
    loadingPreview = true; sync();
    try { const updating = edit(validateMarbleAsset(value)); sync(); await updating; }
    catch (err) {
      if (attempt === previewAttempt) {
        let restored = false;
        try { await edit(previous); restored = true; } catch { /* Keep retry controls available even if restoration fails. */ }
        if (attempt === previewAttempt) { status(`场景更新失败：${err.message}。${restored ? '已恢复之前的精度，可重试已有高清结果。' : '请切回轻量或标准精度重试。'}`, true); message(err.message); }
      }
    }
    finally { if (attempt === previewAttempt) { loadingPreview = false; sync(); } }
  };
  $('marble-visible').onchange = () => update({ ...getAsset(), visible: $('marble-visible').checked });
  $('marble-resolution').onchange = () => update({ ...getAsset(), resolution: $('marble-resolution').value });
  for (const key of ['x', 'y', 'angle', 'scale', 'height']) $('marble-' + key).onchange = () => update({ ...getAsset(), transform: { ...getAsset().transform, [key]: Number($('marble-' + key).value) } });
  $('marble-apply').onclick = () => { cancel(); apply(); sync(); };
  $('marble-discard').onclick = () => { cancel(); discard(); sync(); };
  $('marble-remove').onclick = () => { cancel(); if (isPreview()) discard(); else edit(null); sync(); };
  function cancel() { picking = false; cancelPick(); sync(); }
  $('marble-pair').onclick = () => {
    cancel(); if (!getAsset()?.visible) { message('请先显示 Marble 场景再选择对应点。'); return; }
    picking = true; sync(); message('在三维场景中点击清楚可见的地面墙角或柱脚。');
    pickScene(source => {
      if (!picking) return;
      message('现在在二维 CAD 中点击同一位置。');
      pickCAD(target => {
        if (!picking) return;
        pairs.push({ sourceX: source.x, sourceY: -source.z, targetX: target.x * getMpu(), targetY: target.y * getMpu() });
        picking = false; sync(); message(`已记录 ${pairs.length} 组对应点。至少两组，建议三组以上。`);
      });
    });
  };
  $('marble-pairs-clear').onclick = () => { cancel(); pairs = []; sync(); };
  $('marble-align').onclick = () => {
    try {
      const solved = solveMarbleAlignment(pairs), asset = getAsset();
      update({ ...asset, transform: { ...asset.transform, x: solved.x / getMpu(), y: solved.y / getMpu(), angle: solved.angle, scale: solved.scale } });
      message(`对齐完成：${pairs.length} 组点，平面均方根误差 ${solved.residual.toFixed(3)} 米。请另用未参与计算的柱位检查；高度仍需手动确认。`);
    } catch (err) { message(err.message); }
  };
  $('marble-recover').onclick = async () => { try { setJob(await request(`/jobs/${job.id}/recover`, { operationId: $('marble-operation').value.trim() })); } catch (err) { status(err.message); } };
  $('marble-resolve').onclick = async () => {
    if (!confirm('请先在 World Labs 控制台确认此请求没有正在运行或已完成的任务。继续会允许再次付费生成，是否已核对？')) return;
    try { setJob(await request(`/jobs/${job.id}/recover`, { confirmNoOperation: true })); } catch (err) { status(err.message); }
  };
  async function restoreJob() {
    try {
      const id = localStorage.getItem(storageKey), requestId = localStorage.getItem(storageKey + ':request');
      if (id) setJob(await request(`/jobs/${encodeURIComponent(id)}`));
      const result = await request('/jobs');
      const existing = result.jobs.find(j => j.requestId === requestId) || result.jobs.find(j => ['submitting', 'generating', 'unknown'].includes(j.status));
      if (existing) setJob(existing);
    } catch { /* Check connection reports actionable setup instructions. */ }
  }
  sync(); check(); restoreJob();
  return { sync, cancel, isBusy: () => submitting, isLoading: () => loadingPreview, renderStatus: text => { $('marble-render-status').textContent = text; } };
}
