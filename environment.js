import { validateMarbleAsset } from './marble-contract.mjs';
import { createMarbleUI } from './marble-ui.mjs?v=6';
// Optional Three.js viewer and portable, photo-assisted environment data.
(() => {
  const defaults = () => ({ schema: 'needflea-environment/1', marble: null, floorColor: '#d4cbbd', wallColor: '#deddd5', floorPattern: 'plain', floorTileMeters: 1, showPlan: true, showStructures: true, floorTexture: null, textureMeters: 2, photos: [], notes: '', generationPrompt: '', objects: [], analysis: null });
  let state = defaults(), scene = null, loading = null, mode = null, firstPoint = null, selected = null;
  let proposalPreview = null;
  let inputMethod = 'manual';
  let photoPlacement = null, marbleUI = null;
  const $ = id => document.getElementById(id);
  const host = document.createElement('div'); host.id = 'scene-three'; host.hidden = true; wrap.appendChild(host);
  const panel = document.createElement('aside'); panel.id = 'environment-panel'; panel.hidden = true;
  panel.innerHTML = `
    <div class="env-heading"><div><small>VENUE ENVIRONMENT</small><h2>场地环境</h2></div><button id="env-close" aria-label="关闭环境面板">×</button></div>
    <p class="env-intro">按实测手动搭建，或用 Marble 从照片生成实景。两种环境可叠加，位置与尺寸以 CAD 和实测为准。</p>
    <div class="env-methods" role="tablist" aria-label="环境添加方式"><button id="env-method-manual" role="tab" aria-selected="true" aria-controls="env-manual-panel">手动增加环境</button><button id="env-method-marble" role="tab" aria-selected="false" aria-controls="env-marble-panel" tabindex="-1">Marble 生成</button></div>
    <section id="env-marble-panel" role="tabpanel" aria-labelledby="env-method-marble" hidden>
    <div class="env-section"><h3>01 · 场地照片</h3><p>上传同一区域、视角重叠的清晰照片。可在底图上标注拍摄位置和朝向，P 编号与照片对应。当前支持照片输入。</p>
      <label class="env-file">＋ 添加场地照片<input id="env-photos" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden></label>
      <div id="env-photo-list"></div>
      <label>场地说明 / 生成要求<textarea id="env-notes" rows="3" placeholder="描述本次区域、需保留的墙柱和材质；填写已知层高、柱距等实测记录。"></textarea></label>
    </div>
    </section>
    <section id="env-manual-panel" role="tabpanel" aria-labelledby="env-method-manual">
    <p class="env-method-note">先设置地面，再按实测尺寸添加墙体、柱子和台面。手动内容会与已应用的 Marble 环境一起显示。</p>
    <div class="env-section"><h3>01 · 地面与材质</h3>
      <div class="env-row"><label>地面颜色<input id="env-floor" type="color"></label><label>默认墙柱颜色<input id="env-wall" type="color"></label></div>
      <div class="env-row"><label>地面纹理<select id="env-pattern"><option value="plain">纯色</option><option value="tile">瓷砖</option><option value="wood">木地板</option><option value="concrete">水泥</option></select></label><label>纹理单元（米）<input id="env-pattern-size" type="number" min="0.1" max="20" step="0.1"></label></div>
      <label class="env-check"><input id="env-plan" type="checkbox"> 显示 CAD / 图片地面底图</label>
      <label class="env-file">上传地面材质近照<input id="env-texture" type="file" accept="image/jpeg,image/png,image/webp" hidden></label>
      <p>使用正对地面的材质近照。关闭底图后可看完整材质；普通透视场景照片仅作参考。</p>
      <div class="env-row"><label>每块贴图宽度（米）<input id="env-tile" type="number" min="0.1" max="100" step="0.1"></label><button id="env-texture-remove">移除材质</button></div>
    </div>
    <div class="env-section"><h3>02 · 添加墙柱与台面</h3>
      <p>先填写实测尺寸，再点击下方类型进入放置。墙体点起点和终点，厚度取“厚 / 宽”；柱子和台面点中心，使用“厚 / 宽”和“深度”。</p>
      <div class="env-row"><label>高度（米）<input id="env-height" type="number" value="3" min="0.01" max="100" step="0.1"></label><label>厚 / 宽（米）<input id="env-width" type="number" value="0.3" min="0.01" max="1000" step="0.1"></label><label>深度（米）<input id="env-depth" type="number" value="0.5" min="0.01" max="1000" step="0.1"></label></div>
      <div class="env-row"><button data-env-add="wall">＋ 墙体</button><button data-env-add="column">＋ 柱子</button><button data-env-add="platform">＋ 台面</button></div>
      <button id="env-cancel" hidden>取消放置（Esc）</button>
      <label class="env-check"><input id="env-structures" type="checkbox"> 显示墙柱 / 台面</label>
      <div id="env-object-list"></div><div id="env-object-editor" hidden></div>
    </div>
    <details class="env-section env-data-tools"><summary>环境数据导入 / 导出</summary><p>导入环境 JSON 会替换同名环境字段；完整场地请使用底部“保存完整项目”。</p>
      <div class="env-row"><button id="env-brief">导出场地资料</button><label class="env-file">导入环境 JSON<input id="env-import" type="file" accept=".json" hidden></label></div>
      <button id="env-export">导出环境 JSON</button>
    </details>
    </section>
    <p id="env-message" role="status" aria-live="polite"></p>
    <div class="env-footer"><button id="env-fit">适合视图</button><button id="env-png">导出 3D 图片</button><button id="env-save">保存完整项目</button></div>`;
  document.body.appendChild(panel);
  function setInputMethod(method) {
    if (proposalPreview || marbleUI?.isLoading()) { message('请先应用、放弃或取消当前预览，再切换添加方式。'); return; }
    marbleUI?.cancel(); finishPhotoPlacement(); cancel();
    inputMethod = method;
    for (const name of ['manual', 'marble']) {
      const active = method === name, tab = $('env-method-' + name);
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      $('env-' + name + '-panel').hidden = !active;
    }
    if (method === 'manual' && scene && _3dMode) scene.fit();
    message(method === 'manual' ? '按 CAD 和实测添加环境；已有照片和 Marble 场景保留。' : '上传场地照片，确认费用后生成，校准后再应用。');
  }
  for (const name of ['manual', 'marble']) {
    const tab = $('env-method-' + name);
    tab.onclick = () => setInputMethod(name);
    tab.onkeydown = e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); const next = e.key === 'Home' ? 'manual' : e.key === 'End' ? 'marble' : name === 'manual' ? 'marble' : 'manual';
      setInputMethod(next); if (inputMethod === next) $('env-method-' + next).focus();
    };
  }
  const hud = document.createElement('div'); hud.id = 'environment-hud'; hud.hidden = true;
  hud.innerHTML = '<strong>场地三维预览</strong><span id="env-hud-tip">拖动旋转 · 滚轮缩放 · 右键平移</span><button id="env-hud-fit">适合视图</button><button id="env-photo-cancel" hidden>取消标注（Esc）</button>';
  wrap.appendChild(hud);

  function message(text) { $('env-message').textContent = text; }
  const validColor = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
  const validImage = value => typeof value === 'string' && value.length < 4000000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
  function number(value, name, min, max) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${name} 必须在 ${min}～${max} 之间`);
    return value;
  }
  function validate(input) {
    if (!input || input.schema !== 'needflea-environment/1') throw new Error('环境格式应为 needflea-environment/1');
    if (!Array.isArray(input.objects) || input.objects.length > 1000) throw new Error('objects 必须为数组，最多 1000 项');
    const result = defaults();
    result.marble = validateMarbleAsset(input.marble);
    result.generationPrompt = String(input.generationPrompt || '').slice(0, 4000);
    if (input.floorPattern !== undefined) {
      if (!['plain', 'tile', 'wood', 'concrete'].includes(input.floorPattern)) throw new Error('地面纹理类型无效');
      result.floorPattern = input.floorPattern;
    }
    if (input.floorTileMeters !== undefined) result.floorTileMeters = number(input.floorTileMeters, '地面纹理尺寸', 0.1, 20);
    if (input.analysis != null) {
      const a = input.analysis;
      if (typeof a !== 'object' || Array.isArray(a)) throw new Error('照片分析记录无效');
      result.analysis = { summary: String(a.summary || '').slice(0, 2000), model: String(a.model || '').slice(0, 200) };
      for (const key of ['observations', 'assumptions', 'questions']) {
        if (!Array.isArray(a[key]) || a[key].length > 50) throw new Error('照片分析记录无效');
        result.analysis[key] = a[key].map(v => String(v).slice(0, 2000));
      }
    }
    for (const key of ['floorColor', 'wallColor']) {
      if (input[key] !== undefined && !validColor(input[key])) throw new Error(`${key} 应为 #RRGGBB 颜色`);
      if (input[key]) result[key] = input[key];
    }
    for (const key of ['showPlan', 'showStructures']) if (typeof input[key] === 'boolean') result[key] = input[key];
    if (input.floorTexture != null) {
      if (!validImage(input.floorTexture)) throw new Error('地面材质不是有效的内嵌图片');
      result.floorTexture = input.floorTexture;
    }
    if (input.textureMeters !== undefined) result.textureMeters = number(input.textureMeters, '贴图宽度', 0.1, 100);
    result.notes = String(input.notes || '').slice(0, 10000);
    if (input.photos !== undefined && (!Array.isArray(input.photos) || input.photos.length > 12)) throw new Error('参考照片最多 12 张');
    result.photos = (input.photos || []).map(p => {
      if (!p || !validImage(p.dataUrl)) throw new Error('参考照片不是有效的内嵌图片');
      let camera;
      if (p.camera != null) {
        camera = Object.fromEntries(['x', 'y', 'targetX', 'targetY'].map(key => [key, number(p.camera[key], '拍摄位置/朝向坐标', -1e12, 1e12)]));
        if (Math.hypot(camera.targetX - camera.x, camera.targetY - camera.y) < 1e-9) throw new Error('拍摄朝向参考点不能与拍摄位置重合');
      }
      return { name: String(p.name || '照片').slice(0, 200), note: String(p.note || '').slice(0, 2000), dataUrl: p.dataUrl, ...(camera ? { camera } : {}) };
    });
    result.objects = input.objects.map((o, i) => {
      if (!o || !['wall', 'column', 'platform'].includes(o.type)) throw new Error(`第 ${i + 1} 项类型应为 wall / column / platform`);
      if (o.color !== undefined && !validColor(o.color)) throw new Error(`第 ${i + 1} 项颜色无效`);
      return { id: i + 1, type: o.type, name: String(o.name || '').slice(0, 100), x: number(o.x, 'X 世界坐标', -1e12, 1e12), y: number(o.y, 'Y 世界坐标', -1e12, 1e12), width: number(o.width, '宽度（米）', 0.01, 1000), depth: number(o.depth, '深度（米）', 0.01, 1000), height: number(o.height, '高度（米）', 0.01, 100), angle: number(o.angle ?? 0, '角度', -360, 360), ...(o.color ? { color: o.color } : {}), ...(typeof o.estimated === 'boolean' ? { estimated: o.estimated, source: String(o.source || '').slice(0, 2000) } : {}) };
    });
    return result;
  }

  function bounds() {
    const b = renderer.useImageBackground ? renderer.imageBounds : renderer.useSvgBackground ? renderer.svgBounds : renderer.dxfData?.bounds;
    if (b && [b.minX, b.minY, b.maxX, b.maxY].every(Number.isFinite) && b.maxX > b.minX && b.maxY > b.minY) return { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY };
    const pts = booths.items.filter(i => i.type === 'booth').flatMap(i => [[i.wx, i.wy], [i.wx + i.ww, i.wy + i.wh]]);
    if (!pts.length) return { minX: 0, minY: 0, maxX: 20 / metersPerUnit, maxY: 20 / metersPerUnit };
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { minX: Math.min(...xs) - 2 / metersPerUnit, minY: Math.min(...ys) - 2 / metersPerUnit, maxX: Math.max(...xs) + 2 / metersPerUnit, maxY: Math.max(...ys) + 2 / metersPerUnit };
  }

  // Render only the base map into a bounded texture; never bake booths twice.
  function floorImage(b) {
    if (renderer.useImageBackground) return renderer.bgImage;
    if (renderer.useSvgBackground) return renderer.svgImage;
    if (!renderer.dxfData) return null;
    const c = document.createElement('canvas'), ratio = (b.maxY - b.minY) / (b.maxX - b.minX);
    c.width = Math.max(1, Math.round(2048 / Math.max(1, ratio))); c.height = Math.max(1, Math.round(c.width * ratio));
    const r = new DXFRenderer(c); r.dxfData = renderer.dxfData;
    r.scale = Math.min(c.width / (b.maxX - b.minX), c.height / (b.maxY - b.minY));
    r.offsetX = -b.minX * r.scale; r.offsetY = b.maxY * r.scale;
    r.darkMode = false;
    r.lineWidth = 2;
    r.render();
    return c;
  }

  function changed() { window.environmentUI.render(); }
  async function refresh(fit = false) {
    if (!scene || !_3dMode) return;
    const b = bounds();
    await scene.update({ bounds: b, mpu: metersPerUnit, environment: proposalPreview?.environment || state, booths, dark: darkMode, floorImage: floorImage(b) }, fit);
  }
  function cancel() {
    mode = null; firstPoint = null; $('env-cancel').hidden = true;
    host.style.cursor = ''; if (scene) scene.controls.enabled = scene.marbleView !== 'inside';
    $('env-hud-tip').textContent = '拖动旋转 · 滚轮缩放 · 右键平移';
  }
  function groundClick(point) {
    if (!mode || proposalPreview) return;
    try {
      const b = bounds();
      if (point.x < b.minX || point.x > b.maxX || point.y < b.minY || point.y > b.maxY) {
        message('请在场地底图范围内点击定位。'); return;
      }
      const height = number(Number($('env-height').value), '高度', 0.01, 100);
      const width = number(Number($('env-width').value), '厚 / 宽', 0.01, 1000);
      const depth = number(Number($('env-depth').value), '深度', 0.01, 1000);
      if (mode === 'wall' && !firstPoint) {
        firstPoint = point; $('env-hud-tip').textContent = '已记录墙体起点，请点击终点'; return;
      }
      let object = { id: Date.now(), type: mode, x: point.x, y: point.y, width, depth, height, angle: 0 };
      if (mode === 'wall') {
        const dx = point.x - firstPoint.x, dy = point.y - firstPoint.y;
        object = { ...object, x: (point.x + firstPoint.x) / 2, y: (point.y + firstPoint.y) / 2, width: Math.hypot(dx, dy) * metersPerUnit, depth: width, angle: Math.atan2(dy, dx) * 180 / Math.PI };
        number(object.width, '墙长', 0.01, 1000);
      }
      if (state.objects.length >= 1000) throw new Error('环境对象最多 1000 项');
      state.objects.push(object); selected = object.id; cancel(); syncObjects(); changed(); message('已添加，可在下方精确调整尺寸和位置。');
    } catch (err) { message(err.message); }
  }

  function syncObjects() {
    const list = $('env-object-list'); list.replaceChildren();
    for (const o of state.objects) {
      const row = document.createElement('div'); row.className = 'env-object';
      const edit = document.createElement('button'); edit.textContent = `${o.name || ({ wall: '墙体', column: '柱子', platform: '台面' }[o.type])} · ${o.width.toFixed(2)} × ${o.depth.toFixed(2)} × ${o.height.toFixed(2)} m`;
      edit.onclick = () => { selected = o.id; syncObjects(); };
      if (o.estimated) edit.textContent += ' · 估计';
      if (o.source) edit.title = o.source;
      const remove = document.createElement('button'); remove.textContent = '删除';
      remove.onclick = () => { state.objects = state.objects.filter(x => x !== o); if (selected === o.id) selected = null; syncObjects(); changed(); };
      row.append(edit, remove); list.append(row);
    }
    const editor = $('env-object-editor'), object = state.objects.find(o => o.id === selected);
    editor.hidden = !object; editor.replaceChildren();
    if (!object) return;
    for (const [key, title, step] of [['x', '中心 X（CAD 世界坐标）', 'any'], ['y', '中心 Y（CAD 世界坐标）', 'any'], ['width', '宽 / 墙长（米）', '.1'], ['depth', '深 / 墙厚（米）', '.1'], ['height', '高度（米）', '.1'], ['angle', '逆时针角度（度）', '1']]) {
      const label = document.createElement('label'); label.textContent = title;
      const input = document.createElement('input'); input.type = 'number'; input.step = step; input.value = object[key];
      input.onchange = () => {
        try {
          const selectedIndex = state.objects.indexOf(object);
          const next = validate({ ...state, objects: state.objects.map(o => o === object ? { ...o, [key]: Number(input.value) } : o) });
          state = next; selected = next.objects[selectedIndex]?.id || null;
          syncObjects(); changed();
        } catch (err) { input.value = object[key]; message(err.message); }
      };
      label.append(input); editor.append(label);
    }
  }
  function syncPhotos() {
    const list = $('env-photo-list'); list.replaceChildren();
    state.photos.forEach((p, i) => {
      const row = document.createElement('div'); row.className = 'env-photo';
      const img = document.createElement('img'); img.src = p.dataUrl; img.alt = p.name;
      const text = document.createElement('textarea'); text.rows = 2; text.placeholder = `${i + 1}. ${p.name}：拍摄方向 / 对应柱位`;
      text.value = p.note; text.onchange = () => { p.note = text.value.slice(0, 2000); };
      const remove = document.createElement('button'); remove.textContent = '移除'; remove.onclick = () => { state.photos.splice(i, 1); syncPhotos(); };
      const title = document.createElement('strong'); title.className = 'env-photo-title'; title.textContent = `P${i + 1} · ${p.name}`;
      const pose = document.createElement('div'); pose.className = 'env-photo-pose';
      pose.textContent = p.camera ? `已标注 · 朝向 ${cameraAngle(p.camera).toFixed(0)}°（图纸右侧 0°，上方 90°）` : '未标注拍摄位置和朝向';
      if (p.camera) pose.title = `拍摄坐标：X ${p.camera.x.toFixed(2)}，Y ${p.camera.y.toFixed(2)}（CAD 世界坐标）`;
      const actions = document.createElement('div'); actions.className = 'env-photo-actions';
      const place = document.createElement('button'); place.dataset.photoPlace = i; place.textContent = p.camera ? '重新标注' : '在图上标注';
      place.onclick = () => startPhotoPlacement(p);
      const clear = document.createElement('button'); clear.dataset.photoClear = i; clear.textContent = '清除位置'; clear.hidden = !p.camera;
      clear.onclick = () => { if (photoPlacement) finishPhotoPlacement(); delete p.camera; syncPhotos(); render(); };
      remove.onclick = () => { if (photoPlacement) finishPhotoPlacement(); state.photos.splice(i, 1); syncPhotos(); render(); };
      for (const button of [place, clear, remove]) button.disabled = !!proposalPreview;
      actions.append(place, clear, remove);
      row.append(title, img, text, pose, actions); list.append(row);
    });
    marbleUI?.sync();
  }

  function cameraAngle(camera) { return (Math.atan2(camera.targetY - camera.y, camera.targetX - camera.x) * 180 / Math.PI + 360) % 360; }
  function startPhotoPlacement(photo) {
    if (proposalPreview) { message('请先取消生成或应用 / 放弃预览，再标注拍摄位置。'); return; }
    if (!renderer.dxfData) { message('请先导入 CAD 或图片底图。'); return; }
    if (photoPlacement) finishPhotoPlacement();
    cancel();
    photoPlacement = { photo, first: null, cursor: null, return3D: _3dMode };
    _3dMode = false; canvas.style.visibility = ''; host.hidden = true;
    $('btn-3d').style.background = ''; $('btn-3d').style.color = '';
    setTool('photo-camera'); canvas.style.cursor = 'crosshair';
    hud.hidden = false; $('env-photo-cancel').hidden = false;
    hud.querySelector('strong').textContent = `照片 P${state.photos.indexOf(photo) + 1} · 标注拍摄位置`;
    $('env-hud-tip').textContent = '① 点击拍摄位置 → ② 点击镜头朝向 · Alt 拖动平移 · 滚轮缩放';
    message('请在二维底图上点击拍摄位置，再点击镜头看向的位置。Esc 可取消，原标注会保留。');
    render();
  }
  function finishPhotoPlacement(returnToView = true) {
    if (!photoPlacement) return;
    const restore3D = returnToView && photoPlacement.return3D;
    photoPlacement = null; $('env-photo-cancel').hidden = true;
    hud.querySelector('strong').textContent = '场地三维预览';
    $('env-hud-tip').textContent = '拖动旋转 · 滚轮缩放 · 右键平移';
    setTool('select');
    if (restore3D && scene) {
      _3dMode = true; canvas.style.visibility = 'hidden'; host.hidden = false; hud.hidden = false;
      $('btn-3d').style.background = 'var(--green)'; $('btn-3d').style.color = '#fff';
    } else hud.hidden = true;
    render();
  }
  function photoPointerDown(x, y) {
    if (!photoPlacement) return false;
    if (photoPlacement.kind === 'marble') {
      const callback = photoPlacement.callback;
      finishPhotoPlacement(); callback({ x, y }); return true;
    }
    if (!photoPlacement.first) {
      photoPlacement.first = { x, y }; photoPlacement.cursor = { x, y };
      $('env-hud-tip').textContent = '② 移动鼠标预览朝向，再点击确认 · Esc 取消';
    } else {
      const first = photoPlacement.first;
      if (Math.hypot(x - first.x, y - first.y) * renderer.scale < 8) { message('请点击离拍摄位置稍远的点，确定镜头朝向。'); return true; }
      photoPlacement.photo.camera = { x: first.x, y: first.y, targetX: x, targetY: y };
      finishPhotoPlacement(); syncPhotos();
      message('拍摄位置与朝向已保存。图上的 P 编号与照片对应，并会用于生成环境。');
    }
    render(); return true;
  }
  function drawPhotoMarkers(context, view) {
    const draw = (camera, label, pending = false) => {
      const x = view.wx(camera.x), y = view.wy(camera.y);
      const dx = view.wx(camera.targetX) - x, dy = view.wy(camera.targetY) - y;
      const angle = Math.atan2(dy, dx), length = 65;
      context.save(); context.translate(x, y); context.rotate(angle);
      context.fillStyle = pending ? '#f39b3730' : '#168aab28';
      context.beginPath(); context.moveTo(0, 0); context.arc(0, 0, length, -Math.PI / 9, Math.PI / 9); context.closePath(); context.fill();
      context.strokeStyle = pending ? '#cf7d19' : '#087a99'; context.lineWidth = 2;
      context.beginPath(); context.moveTo(0, 0); context.lineTo(length, 0); context.lineTo(length - 10, -6); context.moveTo(length, 0); context.lineTo(length - 10, 6); context.stroke();
      context.rotate(-angle); context.fillStyle = '#ffffff'; context.beginPath(); context.arc(0, 0, 8, 0, Math.PI * 2); context.fill(); context.stroke();
      context.font = 'bold 12px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillStyle = '#087a99'; context.fillRect(-16, -31, 32, 19); context.fillStyle = '#fff'; context.fillText(label, 0, -21);
      context.restore();
    };
    state.photos.forEach((p, i) => { if (p.camera) draw(p.camera, `P${i + 1}`); });
    if (photoPlacement?.first) {
      const p = photoPlacement.first, end = photoPlacement.cursor || p;
      draw({ x: p.x, y: p.y, targetX: end.x, targetY: end.y }, `P${state.photos.indexOf(photoPlacement.photo) + 1}`, true);
    }
  }
  function sync() {
    $('env-floor').value = state.floorColor; $('env-wall').value = state.wallColor;
    $('env-plan').checked = state.showPlan; $('env-structures').checked = state.showStructures;
    $('env-tile').value = state.textureMeters; $('env-notes').value = state.notes;
    $('env-pattern').value = state.floorPattern; $('env-pattern-size').value = state.floorTileMeters;
    syncObjects(); syncPhotos();
    marbleUI?.sync();
  }
  function download(name, data) {
    const url = URL.createObjectURL(new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.download = name; a.href = url; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function readImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('请使用 JPG、PNG 或 WebP 图片');
    if (file.size > 25 * 1024 * 1024) throw new Error('单张图片请小于 25MB');
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bitmap.width * scale)); c.height = Math.max(1, Math.round(bitmap.height * scale));
    c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height); bitmap.close();
    let quality = 0.88, dataUrl;
    do { dataUrl = c.toDataURL('image/jpeg', quality); quality -= 0.1; } while (dataUrl.length >= 4000000 && quality >= 0.35);
    if (dataUrl.length >= 4000000) throw new Error('压缩后的照片仍过大，请缩小图片后重试');
    return dataUrl;
  }

  function lockPreview(locked) {
    panel.querySelectorAll('.env-section input, .env-section textarea, .env-section select, .env-section button').forEach(e => { e.disabled = locked; });
    $('env-save').disabled = locked;
    document.querySelector('button[onclick="saveProject()"]').disabled = locked;
    $('env-method-manual').disabled = $('env-method-marble').disabled = locked;
    marbleUI?.sync();
  }
  function dropPreview() {
    proposalPreview = null; lockPreview(false);
    $('env-hud-tip').textContent = '拖动旋转 · 滚轮缩放 · 右键平移';
    marbleUI?.sync();
  }

  $('env-close').onclick = () => { marbleUI?.cancel(); finishPhotoPlacement(); panel.hidden = true; cancel(); dropPreview(); changed(); };
  $('env-cancel').onclick = cancel;
  $('env-fit').onclick = $('env-hud-fit').onclick = () => { if (photoPlacement) { renderer.fitToView(); render(); } else scene?.fit(); };
  $('env-photo-cancel').onclick = () => { if (photoPlacement?.kind === 'marble') marbleUI?.cancel(); else finishPhotoPlacement(); message('已取消选点，保留原数据。'); };
  $('env-png').onclick = () => scene?.exportPNG();
  $('env-save').onclick = () => saveProject();
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { marbleUI?.cancel(); finishPhotoPlacement(); cancel(); } });
  for (const [id, key] of [['env-floor', 'floorColor'], ['env-wall', 'wallColor'], ['env-plan', 'showPlan'], ['env-structures', 'showStructures'], ['env-tile', 'textureMeters'], ['env-pattern', 'floorPattern'], ['env-pattern-size', 'floorTileMeters']]) {
    $(id).onchange = () => {
      try {
        finishPhotoPlacement(false);
        const value = $(id).type === 'checkbox' ? $(id).checked : $(id).type === 'number' ? Number($(id).value) : $(id).value;
        state = validate({ ...state, [key]: value }); sync(); changed();
      } catch (err) { message(err.message); sync(); }
    };
  }
  $('env-notes').oninput = () => { state.notes = $('env-notes').value.slice(0, 10000); };
  panel.querySelectorAll('[data-env-add]').forEach(button => { button.onclick = () => {
    cancel(); mode = button.dataset.envAdd; if (scene) scene.controls.enabled = false;
    host.style.cursor = 'crosshair'; $('env-cancel').hidden = false;
    $('env-hud-tip').textContent = mode === 'wall' ? '在底图上点击墙体起点，再点终点' : '在底图上点击中心位置';
    message('放置期间暂停视角操作；按 Esc 取消。');
  }; });
  $('env-photos').onchange = async e => {
    try {
      const files = [...e.target.files];
      if (state.photos.length + files.length > 12) throw new Error('参考照片最多 12 张');
      const photos = [];
      for (const f of files) photos.push({ name: f.name, note: '', dataUrl: await readImage(f) });
      state.photos.push(...photos); syncPhotos(); message('照片已加入。请补充拍摄位置、方向和实测信息。');
    } catch (err) { message(err.message); } finally { e.target.value = ''; }
  };
  $('env-texture').onchange = async e => {
    try { if (e.target.files[0]) { state.floorTexture = await readImage(e.target.files[0]); changed(); message('地面材质已添加，关闭“显示底图”查看完整铺装。'); } }
    catch (err) { message(err.message); } finally { e.target.value = ''; }
  };
  $('env-texture-remove').onclick = () => { state.floorTexture = null; changed(); };
  $('env-export').onclick = () => download('NEEDFLEA_environment.json', state);
  $('env-brief').onclick = () => {
    download('NEEDFLEA_modeling_brief.json', {
      instructions: '结合本文件与原始场地照片，为 Three.js 场地环境生成 needflea-environment/1 JSON。CAD 定位、实测定尺寸；不要把无法确认的照片位置或估计高度当成实测值。缺少尺寸或定位时先提出问题。照片只提供外观；原始照片请另外提供。输出 schema、floorColor、wallColor、objects；objects 为完整的环境对象列表，导入时替换现有墙柱。保留已有对象，新增对象使用新的 id。不要包含 photos、floorTexture。所有位置 x/y 使用下述 CAD 世界坐标；width/depth/height 使用米；angle 是 CAD 平面逆时针角度；x/y 是几何中心。只支持 wall、column、platform。',
      metersPerUnit, bounds: bounds(), notes: state.notes,
      photos: state.photos.map(({ name, note, camera }) => ({ name, note, ...(camera ? { camera } : {}) })),
      cadLayers: _venueLayers(), cadEntities: _venueEntities(),
      environment: { ...state, photos: undefined, floorTexture: undefined },
      objectExample: { id: 1, type: 'column', name: '确认过位置的柱子', x: 0, y: 0, width: 0.5, depth: 0.5, height: 3, angle: 0 },
    }); message('建模资料已导出。此文件不含照片，请另附原始照片；照片生成请切换到“Marble 生成”。');
  };
  $('env-import').onchange = async e => {
    try {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 50 * 1024 * 1024) throw new Error('环境文件请小于 50MB');
      const incoming = JSON.parse(await f.text());
      const next = validate({ ...state, ...incoming });
      if (!confirm(`导入 ${next.objects.length} 个墙柱 / 台面，将替换当前 ${state.objects.length} 个环境对象。摊位和底图保留。是否继续？`)) return;
      finishPhotoPlacement(false);
      state = next; cancel(); selected = null; sync(); changed(); message('环境已导入，请对照 CAD 和实测检查位置与尺寸。');
    } catch (err) { message(`导入失败：${err.message}`); } finally { e.target.value = ''; }
  };

  window.environmentUI = {
    hasPendingPreview: () => !!proposalPreview || !!marbleUI?.isLoading(),
    drawPhotoMarkers,
    photoPointerDown,
    photoPointerMove(x, y) {
      if (!photoPlacement) return false;
      photoPlacement.cursor = { x, y }; render(); return true;
    },
    isPhotoPositioning: () => !!photoPlacement,
    cancelPhotoPlacement(returnToView = true) { if (photoPlacement?.kind === 'marble') marbleUI?.cancel(); else finishPhotoPlacement(returnToView); },
    validate: data => data == null ? defaults() : validate(data),
    snapshot: () => structuredClone(state),
    restore(data) {
      const next = data == null ? defaults() : validate(data);
      marbleUI?.cancel(); finishPhotoPlacement(false);
      dropPreview();
      state = next; selected = null; cancel(); sync(); setInputMethod(state.marble ? 'marble' : 'manual');
    },
    async toggle(openPanel = false) {
      finishPhotoPlacement(false);
      if (_3dMode && !openPanel) { this.close(); return; }
      if (!metersPerUnit || !Number.isFinite(metersPerUnit) || metersPerUnit <= 0) {
        alert('请先导入底图，并用“定比例尺”设定真实尺寸，再打开场地三维预览。'); return;
      }
      const button = $('btn-3d'); button.disabled = true; $('btn-environment').disabled = true;
      try {
        if (!scene) {
          loading ||= import('./scene-three.js?v=5').then(module => module.VenueScene).catch(err => { loading = null; throw err; });
          const Viewer = await loading;
          scene = new Viewer(host, groundClick, text => marbleUI?.renderStatus(text));
        }
        _3dMode = true; if (_isoRenderer) _isoRenderer.active = false;
        canvas.style.visibility = 'hidden'; host.hidden = false; hud.hidden = false;
        $('welcome').classList.add('hidden');
        panel.hidden = !openPanel;
        button.style.background = 'var(--green)'; button.style.color = '#fff';
        await refresh(true);
        message('选择“手动增加环境”搭建结构，或切换到“Marble 生成”上传场地照片。');
      } catch (err) {
        this.close(); alert(`三维预览无法启动：${err.message}。请检查浏览器 WebGL 支持和本地资源。二维规划仍可使用。`);
      } finally { button.disabled = false; $('btn-environment').disabled = false; }
    },
    close() {
      marbleUI?.cancel(); finishPhotoPlacement(false);
      cancel(); dropPreview(); _3dMode = false; canvas.style.visibility = ''; host.hidden = panel.hidden = hud.hidden = true;
      $('btn-3d').style.background = ''; $('btn-3d').style.color = ''; render();
    },
    render() {
      if (!_3dMode || !scene) return;
      refresh().catch(err => { if (err.name === 'AbortError') return; message(err.message); console.error(err); });
    },
    exportPNG() { scene?.exportPNG(); },
  };
  window.toggle3DView = () => window.environmentUI.toggle();
  window.openEnvironment = () => window.environmentUI.toggle(true);
  window.export3DPNG = () => window.environmentUI.exportPNG();
  marbleUI = createMarbleUI({
    panel, getState: () => state, getAsset: () => (proposalPreview?.environment || state).marble,
    isPreview: () => proposalPreview?.kind === 'marble', isBusy: () => false,
    getBounds: bounds, getMpu: () => metersPerUnit, message,
    async preview(asset) {
      finishPhotoPlacement(); cancel();
      const currentPreview = proposalPreview = { kind: 'marble', environment: validate({ ...state, marble: asset, showPlan: false }) };
      lockPreview(true);
      try { await refresh(); if (proposalPreview === currentPreview) { scene?.enterMarble(); message('已进入 Marble 场景，拖动环顾；需要对齐时切换「俯视校准」。'); } }
      catch (err) { if (proposalPreview === currentPreview) { dropPreview(); changed(); } throw err; }
    },
    cancelLoad() { scene?.releaseMarble(); if (proposalPreview?.kind === 'marble') { dropPreview(); changed(); } },
    fitScene() { scene?.fitMarble(); },
    enterScene() { scene?.enterMarble(); },
    async edit(asset) { (proposalPreview?.kind === 'marble' ? proposalPreview.environment : state).marble = asset; await refresh(); },
    apply() { if (proposalPreview?.kind !== 'marble') return; state = proposalPreview.environment; dropPreview(); sync(); changed(); message('Marble 环境已应用，请保存完整项目。'); },
    discard() { if (proposalPreview?.kind === 'marble') { dropPreview(); changed(); message('已放弃 Marble 预览，恢复原环境。'); } },
    pickScene(callback) {
      if (!scene || !_3dMode) { message('请先打开三维视图。'); return; }
      scene.marblePick = callback;
    },
    pickCAD(callback) {
      finishPhotoPlacement(); cancel();
      photoPlacement = { kind: 'marble', callback, return3D: _3dMode };
      _3dMode = false; canvas.style.visibility = ''; host.hidden = true;
      setTool('photo-camera'); canvas.style.cursor = 'crosshair';
      hud.hidden = false; $('env-photo-cancel').hidden = false;
      hud.querySelector('strong').textContent = 'Marble 校准 · 选择 CAD 对应点';
      $('env-hud-tip').textContent = '点击同一墙角 / 柱脚 · Alt 拖动平移 · 滚轮缩放 · Esc 取消'; render();
    },
    cancelPick() { if (scene) scene.marblePick = null; if (photoPlacement?.kind === 'marble') finishPhotoPlacement(); },
  });
  sync();
})();
