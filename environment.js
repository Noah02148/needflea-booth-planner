// Optional Three.js viewer and portable, photo-assisted environment data.
(() => {
  const defaults = () => ({ schema: 'needflea-environment/1', floorColor: '#d4cbbd', wallColor: '#deddd5', floorPattern: 'plain', floorTileMeters: 1, showPlan: true, showStructures: true, floorTexture: null, textureMeters: 2, photos: [], notes: '', generationPrompt: '', objects: [], analysis: null });
  let state = defaults(), scene = null, loading = null, mode = null, firstPoint = null, selected = null;
  let proposalPreview = null, analysisController = null;
  let progressTimer = null, progressState = null;
  let photoPlacement = null;
  const analysisURL = window.NEEDFLEA_ENVIRONMENT_API_URL || 'http://127.0.0.1:3003';
  const $ = id => document.getElementById(id);
  const host = document.createElement('div'); host.id = 'scene-three'; host.hidden = true; wrap.appendChild(host);
  const panel = document.createElement('aside'); panel.id = 'environment-panel'; panel.hidden = true;
  panel.innerHTML = `
    <div class="env-heading"><div><small>PHOTO → SPACE</small><h2>场地环境</h2></div><button id="env-close" aria-label="关闭环境面板">×</button></div>
    <p class="env-intro">用 CAD 定位，用照片还原外观。墙柱高度与尺寸以实测为准。</p>
    <div class="env-section"><h3>01 · 实景照片</h3><p>每张照片可在底图上标注拍摄位置和朝向：先点拍摄点，再点镜头朝向。照片编号与图上的 P1、P2 对应。</p>
      <label class="env-file">＋ 添加场地照片<input id="env-photos" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden></label>
      <div id="env-photo-list"></div>
      <label>场地说明 / 实测记录<textarea id="env-notes" rows="3" placeholder="如：层高 4.2 米；西侧砖墙；柱距以 CAD 为准。"></textarea></label>
    </div>
    <div class="env-section"><h3>02 · 地面与底图</h3>
      <div class="env-row"><label>地面颜色<input id="env-floor" type="color"></label><label>墙柱颜色<input id="env-wall" type="color"></label></div>
      <div class="env-row"><label>地面纹理<select id="env-pattern"><option value="plain">纯色</option><option value="tile">瓷砖</option><option value="wood">木地板</option><option value="concrete">水泥</option></select></label><label>纹理单元（米）<input id="env-pattern-size" type="number" min="0.1" max="20" step="0.1"></label></div>
      <label class="env-check"><input id="env-plan" type="checkbox"> 显示 CAD / 图片地面底图</label>
      <label class="env-file">上传地面材质近照<input id="env-texture" type="file" accept="image/jpeg,image/png,image/webp" hidden></label>
      <p>使用正对地面的材质近照。关闭底图后可看完整材质；普通透视场景照片仅作参考。</p>
      <div class="env-row"><label>每块贴图宽度（米）<input id="env-tile" type="number" min="0.1" max="100" step="0.1"></label><button id="env-texture-remove">移除材质</button></div>
    </div>
    <div class="env-section"><h3>03 · 墙柱与台面</h3>
      <p>先填写实测尺寸，再在三维底图上点击定位。墙体需点起点、终点；柱和台面点中心。</p>
      <div class="env-row"><label>高度（米）<input id="env-height" type="number" value="3" min="0.01" max="100" step="0.1"></label><label>厚 / 宽（米）<input id="env-width" type="number" value="0.3" min="0.01" max="1000" step="0.1"></label><label>深度（米）<input id="env-depth" type="number" value="0.5" min="0.01" max="1000" step="0.1"></label></div>
      <div class="env-row"><button data-env-add="wall">＋ 墙体</button><button data-env-add="column">＋ 柱子</button><button data-env-add="platform">＋ 台面</button></div>
      <button id="env-cancel" hidden>取消放置（Esc）</button>
      <label class="env-check"><input id="env-structures" type="checkbox"> 显示墙柱 / 台面</label>
      <div id="env-object-list"></div><div id="env-object-editor" hidden></div>
    </div>
    <div class="env-section env-ai-section"><h3>照片 → 三维环境</h3>
      <p>识别照片中的墙柱外观、地面材质，结合 CAD 生成可旋转的场地简模。未知位置会列为待确认项；近似尺寸标注为“估计”。</p>
      <p id="env-ai-status" role="status">正在检查本机 Codex 登录状态…</p>
      <div id="env-ai-progress" hidden>
        <div class="env-progress-meta"><strong id="env-ai-elapsed"></strong><span id="env-ai-activity"></span></div>
        <ol id="env-ai-steps"><li>准备资料</li><li>启动 Codex</li><li>模型处理</li><li>校验结果</li><li>显示预览</li></ol>
        <p id="env-ai-wait"></p>
        <details><summary>查看阶段记录</summary><ol id="env-ai-log"></ol></details>
      </div>
      <label>补充要求 / 修改意见<textarea id="env-instruction" rows="3" maxlength="4000" placeholder="例如：柱高按实测 4.2 米；把地面改成照片里的灰色瓷砖，保留其他结构。"></textarea></label>
      <div class="env-row" id="env-ai-actions"><button id="env-generate">从照片生成环境</button><button id="env-ai-check">检查连接</button><button id="env-ai-cancel" hidden>取消分析</button></div>
      <p>通过本机 Codex 的 ChatGPT 登录使用现有套餐额度，无需 API Key，不调用另行计费的 API。仍受套餐用量限制；生成、修改和预览均在本网页完成。</p>
      <div id="env-ai-preview" hidden><strong>生成结果预览 · 尚未应用</strong><div class="env-row env-preview-actions"><button id="env-ai-apply">应用此环境</button><button id="env-ai-discard">放弃预览</button></div><p id="env-ai-summary"></p><div id="env-ai-report"></div></div>
    </div>
    <div class="env-section"><h3>手动交换建模资料</h3><p>也可导出资料，将资料文件和原始照片交给 GPT，获得环境 JSON 后手动导入。</p>
      <div class="env-row"><button id="env-brief">导出建模资料</button><label class="env-file">导入环境 JSON<input id="env-import" type="file" accept=".json" hidden></label></div>
      <button id="env-export">导出环境 JSON</button>
    </div>
    <p id="env-message" role="status" aria-live="polite"></p>
    <div class="env-footer"><button id="env-fit">适合视图</button><button id="env-png">导出 3D 图片</button><button id="env-save">保存完整项目</button></div>`;
  document.body.appendChild(panel);
  // Opening the progress details must not move the cancel button mid-click.
  $('env-ai-actions').after($('env-ai-progress'));
  // Keep the photo-generation action next to the uploaded photos.
  panel.insertBefore(panel.querySelector('.env-ai-section'), panel.querySelectorAll('.env-section')[1]);
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
    host.style.cursor = ''; if (scene) scene.controls.enabled = true;
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
      for (const button of [place, clear, remove]) button.disabled = !!analysisController || !!proposalPreview;
      actions.append(place, clear, remove);
      row.append(title, img, text, pose, actions); list.append(row);
    });
  }

  function cameraAngle(camera) { return (Math.atan2(camera.targetY - camera.y, camera.targetX - camera.x) * 180 / Math.PI + 360) % 360; }
  function startPhotoPlacement(photo) {
    if (analysisController || proposalPreview) { message('请先取消生成或应用 / 放弃预览，再标注拍摄位置。'); return; }
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
    $('env-instruction').value = state.generationPrompt;
    syncObjects(); syncPhotos();
  }
  function download(name, data) {
    const url = URL.createObjectURL(new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.download = name; a.href = url; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function readImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('请使用 JPG、PNG 或 WebP 图片');
    if (file.size > 25 * 1024 * 1024) throw new Error('单张图片请小于 25MB');
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bitmap.width * scale)); c.height = Math.max(1, Math.round(bitmap.height * scale));
    c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height); bitmap.close();
    return c.toDataURL('image/jpeg', 0.82);
  }

  async function checkConnection() {
    $('env-ai-status').classList.remove('env-ai-error');
    try {
      const response = await fetch(`${analysisURL}/health`, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error('服务未响应');
      const status = await response.json();
      $('env-ai-status').textContent = status.configured
        ? `已连接 ${status.provider} · 使用现有套餐额度`
        : status.message || '请先在本机运行 codex login，通过 ChatGPT 登录后重试。';
      return status;
    } catch {
      $('env-ai-status').textContent = '未连接照片分析服务。请在本地终端运行 node environment-server.mjs，再点击“检查连接”。';
      return null;
    }
  }
  function generationMessage(text, error = false) {
    $('env-ai-status').textContent = text;
    $('env-ai-status').classList.toggle('env-ai-error', error);
    message(text);
  }
  function startProgress() {
    clearInterval(progressTimer);
    progressState = { started: Date.now(), activity: Date.now(), heartbeat: 0, step: 0, active: true, lastMessage: '' };
    $('env-ai-log').replaceChildren(); $('env-ai-progress').hidden = false;
    progressTimer = setInterval(drawProgress, 1000); drawProgress();
  }
  function drawProgress() {
    if (!progressState) return;
    const s = progressState, seconds = Math.floor(((s.finished || Date.now()) - s.started) / 1000);
    $('env-ai-elapsed').textContent = `已用 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
    const quiet = Math.floor((Date.now() - s.activity) / 1000);
    $('env-ai-activity').textContent = s.active ? `最近状态更新：${quiet} 秒前` : s.outcome;
    $('env-ai-steps').querySelectorAll('li').forEach((li, i) => {
      li.className = i < s.step || s.outcome === '已完成' ? 'done' : i === s.step && s.active ? 'active' : '';
    });
    const alive = s.heartbeat && Date.now() - s.heartbeat < 20000;
    $('env-ai-wait').textContent = !s.active ? '用时为实际耗时；阶段信息来自本地服务和 Codex 事件。'
      : quiet >= 30 ? (alive ? '服务仍连通，正在等待 Codex 的下一次状态更新。模型没有提供可计算的完成百分比。' : '暂未收到新的服务状态，连接可能中断；可继续等待或取消。')
      : '显示实际阶段与耗时，完成后会自动打开三维预览。';
  }
  function progressEvent(event) {
    if (!progressState || !progressState.active) return;
    progressState.heartbeat = Date.now();
    if (event.type === 'heartbeat') { drawProgress(); return; }
    progressState.activity = Date.now();
    const steps = { auth: 0, preparing: 0, starting: 1, connected: 1, analyzing: 2, generating: 2, validating: 3, preview: 4 };
    if (steps[event.stage] !== undefined) progressState.step = Math.max(progressState.step, steps[event.stage]);
    if (typeof event.message === 'string') {
      generationMessage(event.message);
      if (event.message !== progressState.lastMessage) {
        const li = document.createElement('li');
        li.textContent = `${Math.floor((Date.now() - progressState.started) / 1000)} 秒 · ${event.message}`;
        $('env-ai-log').append(li);
        if ($('env-ai-log').children.length > 15) $('env-ai-log').firstChild.remove();
        progressState.lastMessage = event.message;
      }
    }
    drawProgress();
  }
  function stopProgress(outcome) {
    clearInterval(progressTimer); progressTimer = null;
    if (progressState) { progressState.active = false; progressState.finished = Date.now(); progressState.outcome = outcome; drawProgress(); }
  }
  function updateGenerateButton() {
    const button = $('env-generate');
    button.disabled = !!analysisController;
    button.textContent = analysisController ? 'Codex 正在生成…' : proposalPreview ? '按修改意见重新生成' : '从照片生成环境';
    $('env-instruction').disabled = !!analysisController;
    $('env-ai-apply').disabled = $('env-ai-discard').disabled = !!analysisController;
    panel.querySelectorAll('.env-photo-actions button').forEach(button => { button.disabled = !!analysisController || !!proposalPreview; });
  }
  function lockPreview(locked) {
    panel.querySelectorAll('.env-section:not(.env-ai-section) input, .env-section:not(.env-ai-section) textarea, .env-section:not(.env-ai-section) select, .env-section:not(.env-ai-section) button').forEach(e => { e.disabled = locked; });
    $('env-save').disabled = locked;
    document.querySelector('button[onclick="saveProject()"]').disabled = locked;
    updateGenerateButton();
  }
  function dropPreview() {
    proposalPreview = null; $('env-ai-preview').hidden = true; lockPreview(false);
    $('env-hud-tip').textContent = '拖动旋转 · 滚轮缩放 · 右键平移';
  }
  function previewProposal(proposal, model) {
    cancel();
    const environment = validate({ ...state, ...proposal, schema: 'needflea-environment/1', floorTexture: null, showPlan: false, showStructures: true, analysis: { summary: proposal.summary, observations: proposal.observations, assumptions: proposal.assumptions, questions: proposal.questions, model } });
    proposalPreview = { environment, proposal, model };
    $('env-ai-summary').textContent = `${proposal.summary}（${proposal.objects.length} 个结构，${proposal.objects.filter(o => o.estimated).length} 个包含估计尺寸）`;
    const report = $('env-ai-report'); report.replaceChildren();
    for (const [key, title] of [['observations', '照片识别'], ['assumptions', '估计与假设'], ['questions', '待确认']]) {
      if (!proposal[key].length) continue;
      const h = document.createElement('h4'); h.textContent = title;
      const ul = document.createElement('ul');
      for (const value of proposal[key]) { const li = document.createElement('li'); li.textContent = value; ul.append(li); }
      report.append(h, ul);
    }
    $('env-ai-preview').hidden = false;
    $('env-hud-tip').textContent = '照片生成预览 · 尚未应用 · 查看面板确认结果';
    lockPreview(true); refresh(true).catch(err => { message(err.message); });
    message('三维视图已显示生成结果。应用后替换原有墙柱与地面材质；摊位保持原位置。');
    panel.scrollTo({ top: $('env-ai-preview').offsetTop - 20, behavior: 'instant' });
  }
  function analysisFrame() {
    return JSON.stringify({ state, preview: proposalPreview?.proposal || null, mpu: metersPerUnit, bounds: bounds() });
  }
  $('env-ai-check').onclick = checkConnection;
  $('env-ai-cancel').onclick = () => { analysisController?.abort(); };
  $('env-ai-discard').onclick = () => { dropPreview(); changed(); message('已放弃预览，恢复原环境。'); };
  $('env-ai-apply').onclick = () => {
    if (!proposalPreview) return;
    state = { ...proposalPreview.environment, generationPrompt: state.generationPrompt }; selected = null;
    dropPreview(); sync(); changed(); message('照片生成的环境已应用。可逐项修正估计尺寸，完成后保存完整项目。');
  };
  $('env-generate').onclick = async () => {
    if (photoPlacement) { message('请先完成拍摄位置与朝向标注，或按 Esc 取消。'); return; }
    if (analysisController) {
      generationMessage('Codex 正在分析中，可点击“取消分析”。'); return;
    }
    if (!state.photos.length) { generationMessage('请先上传至少一张实景照片。', true); return; }
    const frame = analysisFrame(), cadFile = _cadFileData;
    const controller = analysisController = new AbortController();
    startProgress();
    updateGenerateButton(); $('env-ai-cancel').hidden = false;
    generationMessage('正在检查照片分析服务…');
    try {
      const connection = await checkConnection();
      if (analysisController !== controller) return;
      if (controller.signal.aborted) throw new DOMException('分析已取消', 'AbortError');
      if (!connection) throw new Error('照片分析服务未启动。请在项目终端运行 node environment-server.mjs，再点击生成。');
      if (!connection.configured) throw new Error(connection.message || '请先通过 ChatGPT 登录本机 Codex，再重试。');
      generationMessage(`正在通过 ${connection.provider} 分析照片并生成环境，请稍候…`);
      const b = bounds(), image = floorImage(b);
      if (!image) throw new Error('请先导入场地底图，再从照片生成环境。');
      const c = document.createElement('canvas');
      const scale = Math.min(1, 1400 / Math.max(image.width, image.height));
      c.width = Math.max(1, Math.round(image.width * scale)); c.height = Math.max(1, Math.round(image.height * scale));
      const ctx = c.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(image, 0, 0, c.width, c.height);
      const allEntities = _venueEntities();
      // The plan image keeps whole-site context when geometry needs capping.
      const cadEntities = allEntities.filter(e => !e.points || e.points.length <= 100).slice(0, 1500).map(e => e.text ? { ...e, text: e.text.slice(0, 500) } : e);
      const current = proposalPreview?.environment || state;
      const body = { bounds: b, metersPerUnit, notes: state.notes, instruction: state.generationPrompt, currentEnvironment: { floorColor: current.floorColor, wallColor: current.wallColor, floorPattern: current.floorPattern, floorTileMeters: current.floorTileMeters, objects: current.objects.map(o => ({ ...o, name: o.name || '', color: o.color || current.wallColor, estimated: o.estimated ?? true, source: o.source || '用户手动添加的环境对象' })) }, photos: state.photos, planImage: c.toDataURL('image/jpeg', 0.85), cadEntities };
      const timeout = setTimeout(() => controller.abort(), 250000);
      let response, result;
      try {
        const { readAnalysisResponse } = await import('./environment-progress.mjs');
        response = await fetch(`${analysisURL}/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body: JSON.stringify(body), signal: controller.signal });
        result = await readAnalysisResponse(response, event => { if (analysisController === controller) progressEvent(event); });
      }
      finally { clearTimeout(timeout); }
      if (!response.ok || result.error) throw new Error(result.error || '照片分析失败，请重试。');
      if (controller.signal.aborted || analysisController !== controller) return;
      if (cadFile !== _cadFileData || frame !== analysisFrame()) throw new Error('分析期间项目或照片发生变化，本次结果未应用。请以当前资料重新生成。');
      const { validateProposal } = await import('./environment-ai-contract.mjs');
      if (controller.signal.aborted || analysisController !== controller || cadFile !== _cadFileData || frame !== analysisFrame()) return;
      previewProposal(validateProposal(result.proposal, b), result.model);
      progressEvent({ type: 'progress', stage: 'preview', message: '环境数据校验通过，已显示三维预览' }); stopProgress('已完成');
      generationMessage(`分析完成 · ${result.provider} · ${result.model}。请检查下方预览，再应用或放弃。`);
    } catch (err) {
      if (analysisController !== controller) return;
      stopProgress(controller.signal.aborted ? '已取消 / 超时' : '未完成');
      generationMessage(controller.signal.aborted ? '照片分析已取消或超时，原环境未修改。' : err instanceof TypeError ? '无法连接本地照片分析服务，请运行 node environment-server.mjs 并检查模型配置。' : err.message, true);
    } finally {
      if (analysisController === controller) { if (progressState?.active) stopProgress('已结束'); analysisController = null; $('env-ai-cancel').hidden = true; updateGenerateButton(); }
    }
  };

  $('env-close').onclick = () => { finishPhotoPlacement(); panel.hidden = true; cancel(); analysisController?.abort(); dropPreview(); changed(); };
  $('env-cancel').onclick = cancel;
  $('env-fit').onclick = $('env-hud-fit').onclick = () => { if (photoPlacement) { renderer.fitToView(); render(); } else scene?.fit(); };
  $('env-photo-cancel').onclick = () => { finishPhotoPlacement(); message('已取消标注，保留原拍摄位置和朝向。'); };
  $('env-png').onclick = () => scene?.exportPNG();
  $('env-save').onclick = () => saveProject();
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { finishPhotoPlacement(); cancel(); } });
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
  $('env-instruction').oninput = () => { state.generationPrompt = $('env-instruction').value.slice(0, 4000); };
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
    }); message('建模资料已导出。此文件不含照片，请另附原始照片；也可用“从照片生成环境”直接分析。');
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
    drawPhotoMarkers,
    photoPointerDown,
    photoPointerMove(x, y) {
      if (!photoPlacement) return false;
      photoPlacement.cursor = { x, y }; render(); return true;
    },
    isPhotoPositioning: () => !!photoPlacement,
    cancelPhotoPlacement: finishPhotoPlacement,
    validate: data => data == null ? defaults() : validate(data),
    snapshot: () => structuredClone(state),
    restore(data) {
      const next = data == null ? defaults() : validate(data);
      finishPhotoPlacement(false);
      stopProgress('已切换项目');
      analysisController?.abort(); analysisController = null; $('env-ai-cancel').hidden = true; dropPreview();
      state = next; selected = null; cancel(); sync();
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
          loading ||= import('./scene-three.js').then(module => module.VenueScene).catch(err => { loading = null; throw err; });
          const Viewer = await loading;
          scene = new Viewer(host, groundClick);
        }
        _3dMode = true; if (_isoRenderer) _isoRenderer.active = false;
        canvas.style.visibility = 'hidden'; host.hidden = false; hud.hidden = false;
        $('welcome').classList.add('hidden');
        panel.hidden = !openPanel;
        button.style.background = 'var(--green)'; button.style.color = '#fff';
        await refresh(true);
        message('上传照片后点击“从照片生成环境”，或按 CAD 手工添加墙柱。');
        if (openPanel) checkConnection();
      } catch (err) {
        this.close(); alert(`三维预览无法启动：${err.message}。请检查浏览器 WebGL 支持和本地资源。二维规划仍可使用。`);
      } finally { button.disabled = false; $('btn-environment').disabled = false; }
    },
    close() {
      finishPhotoPlacement(false);
      cancel(); analysisController?.abort(); dropPreview(); _3dMode = false; canvas.style.visibility = ''; host.hidden = panel.hidden = hud.hidden = true;
      $('btn-3d').style.background = ''; $('btn-3d').style.color = ''; render();
    },
    render() {
      if (!_3dMode || !scene) return;
      refresh().catch(err => { message(err.message); console.error(err); });
    },
    exportPNG() { scene?.exportPNG(); },
  };
  window.toggle3DView = () => window.environmentUI.toggle();
  window.openEnvironment = () => window.environmentUI.toggle(true);
  window.export3DPNG = () => window.environmentUI.exportPNG();
  sync();
})();
