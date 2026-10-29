// Shared measured plan, fixed structures, activity components and presentation views.
(() => {
  const defaults = () => ({ schema: 'needflea-environment/1', sitePlan: null, views: [], floorColor: '#d4cbbd', wallColor: '#deddd5', floorPattern: 'plain', floorTileMeters: 1, showPlan: true, showStructures: true, floorTexture: null, textureMeters: 2, photos: [], notes: '', generationPrompt: '', objects: [], analysis: null });
  let state = defaults(), scene = null, loading = null, mode = null, firstPoint = null, selected = null;
  let photoPlacement = null, step = 'base';
  let boundaryDraft = null, sourceChoice = null;
  const types = { wall: '墙体', column: '柱子', platform: '平台', building: '建筑', stage: '舞台', truss: '桁架展亭', counter: '展台', sign: '招牌', table: '桌台', fence: '围挡', tree: '树木' };
  const fixedTypes = ['wall', 'column', 'platform', 'building', 'tree'];
  const $ = id => document.getElementById(id);
  const host = document.createElement('div'); host.id = 'scene-three'; host.hidden = true; wrap.appendChild(host);
  const panel = document.createElement('aside'); panel.id = 'environment-panel'; panel.hidden = true;
  panel.innerHTML = `
    <div class="env-heading"><div><small>SCENE BUILDER</small><h2>场景搭建</h2></div><button id="env-close" aria-label="关闭场景面板">×</button></div>
    <p class="env-intro">从准确的平面开始，补充高度，搭建活动方案。</p>
    <div class="env-methods" role="tablist" aria-label="场景搭建步骤">${[['structure','01','结构高度'],['export','02','展示出图']].map(([id,n,title]) => `<button id="env-step-${id}" role="tab" aria-controls="env-${id}-panel" aria-selected="${id === 'base'}" tabindex="${id === 'base' ? 0 : -1}"><small>${n}</small>${title}</button>`).join('')}</div>
    <div class="env-context"><span id="env-source-status"></span><button id="env-step-base">编辑场地 →</button></div>
    <div class="env-view-switch"><button id="env-view-2d">二维平面</button><button id="env-view-3d">三维场景</button><button id="env-fit">适合视图</button></div>
    <section id="env-base-panel" aria-label="建立场地">
      <h3>建立二维场地</h3><p>选择 CAD、参考平面图片或实测尺寸作为起点。图片保留颜色与标识；结构轮廓和高度需按实测补全。</p>
      <div class="env-source-grid"><button id="env-source-cad">导入 CAD<small>DWG / DXF</small></button><button id="env-source-image">导入图片<small>平面图 / 鸟瞰图</small></button><button id="env-source-measured">实测新建<small>按米建立空地</small></button></div>
      <div id="env-measured-fields" class="env-section" hidden><h3>实测场地边界</h3><div class="env-row"><label>长度（米）<input id="env-site-width" type="number" value="40" min="1" max="1000"></label><label>宽度（米）<input id="env-site-depth" type="number" value="25" min="1" max="1000"></label></div><button id="env-create-site">新建矩形场地</button>
      <details><summary>不规则边界 / 精确坐标</summary><p>每行一个点：X,Y，单位为米。至少三个点，按边界顺序输入，末点自动闭合。新建会替换当前画布，请先保存。</p><textarea id="env-boundary" rows="5" placeholder="0,0&#10;40,0&#10;40,25&#10;0,25"></textarea><button id="env-create-polygon">按坐标新建场地</button><div class="env-row"><button id="env-draw-boundary">在平面上描边</button><button id="env-finish-boundary" hidden>完成边界</button></div><p>描边使用 0.1 米网格吸附；只修改实测场地边界，已有布置保留。</p></details></div>
      <div class="env-section"><h3>比例与测量</h3><p id="env-scale-status"></p><div class="env-row"><span id="env-calibrate-slot"></span><button id="env-measure">测量距离</button></div></div>
      <details class="env-section"><summary>现场参考照片与记录</summary><p>照片仅作建模参考，可标注拍摄位置和朝向。</p><label class="env-file">＋ 添加参考照片<input id="env-photos" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden></label><div id="env-photo-list"></div><label>实测记录<textarea id="env-notes" rows="3" placeholder="记录层高、柱距、材质及待确认尺寸"></textarea></label></details>
      <div class="env-section"><button id="env-continue">继续：结构与高度 →</button><p id="env-continue-note"></p></div>
    </section>
    <section id="env-structure-panel" role="tabpanel" aria-labelledby="env-step-structure" hidden><h3>补充固定结构与高度</h3><p>按平面定位墙柱、建筑与平台，再精确输入高度。固定结构可保存到场地基础，供多个活动复用。</p><div class="env-row"><button data-env-add="wall">＋ 墙体</button><button data-env-add="column">＋ 柱子</button><button data-env-add="platform">＋ 平台</button><button data-env-add="building">＋ 建筑</button><button data-env-add="tree">＋ 树木</button></div><div id="env-structure-tools"></div>
      <div class="env-section"><h3>地面与材质</h3><div class="env-row"><label>地面颜色<input id="env-floor" type="color"></label><label>默认结构颜色<input id="env-wall" type="color"></label></div><div class="env-row"><label>地面纹理<select id="env-pattern"><option value="plain">纯色</option><option value="tile">瓷砖</option><option value="wood">木地板</option><option value="concrete">水泥</option></select></label><label>纹理单元（米）<input id="env-pattern-size" type="number" min="0.1" max="20" step="0.1"></label></div><label class="env-check"><input id="env-plan" type="checkbox"> 显示 CAD / 图片参考底图</label><label class="env-file">上传地面材质<input id="env-texture" type="file" accept="image/jpeg,image/png,image/webp" hidden></label><div class="env-row"><label>贴图宽度（米）<input id="env-tile" type="number" min="0.1" max="100" step="0.1"></label><button id="env-texture-remove">移除材质</button></div></div>
    </section>
    <section id="env-layout-panel" role="tabpanel" aria-labelledby="env-step-layout" hidden><h3>布置活动组件</h3><p>在平面或三维地面点击放置。组件的占地、位置、转角与离地高度共同保存；已有摊位继续同步显示。</p><div class="env-component-grid">${['stage','truss','counter','sign','table','fence'].map(t => `<button data-env-add="${t}">＋ ${types[t]}</button>`).join('')}</div><div id="env-layout-tools"></div><p>当前提供参数化基础组件；自定义模型和复杂品牌展亭需另行扩展。</p></section>
    <section id="env-export-panel" role="tabpanel" aria-labelledby="env-step-export" hidden><h3>构图与出图</h3><p>选择视角后保存机位，调整画幅并导出。人视角从场地中心附近进入，可拖动环顾。</p><div class="env-row"><button id="env-overview">鸟瞰</button><button id="env-human">人视角</button></div><label>机位名称<input id="env-view-name" type="text" maxlength="60" placeholder="如：入口看向主舞台"></label><button id="env-view-save">保存当前机位</button><div id="env-view-list"></div><label>图片尺寸<select id="env-output-size"><option value="1920">1920 × 1080</option><option value="2560">2560 × 1440</option><option value="3840">3840 × 2160</option></select></label><button id="env-png">导出 3D 图片</button><label class="env-check"><input id="env-labels" type="checkbox" checked> 显示摊位与结构名称</label><details class="env-section env-data-tools"><summary>场景数据导入 / 导出</summary><div class="env-row"><button id="env-brief">导出建模资料</button><label class="env-file">导入场景 JSON<input id="env-import" type="file" accept=".json" hidden></label></div><button id="env-export">导出场景 JSON</button></details></section>
    <div id="env-edit-tools" hidden><div class="env-section"><h3>尺寸与位置</h3><div class="env-row"><label>高度（米）<input id="env-height" type="number" value="3" min="0.01" max="100" step="0.1"></label><label>厚 / 宽（米）<input id="env-width" type="number" value="0.3" min="0.01" max="1000" step="0.1"></label><label>深度（米）<input id="env-depth" type="number" value="0.5" min="0.01" max="1000" step="0.1"></label></div><p>点击中心放置组件；墙体需点击起点和终点。选中后可编辑名称、尺寸与位置，右键点击删除。</p><button id="env-cancel" hidden>取消放置（Esc）</button><label class="env-check"><input id="env-structures" type="checkbox"> 显示场景组件</label><div id="env-object-list"></div><div id="env-object-editor" hidden></div></div></div>
    <p id="env-message" role="status" aria-live="polite"></p><p class="env-save-note">修改后使用顶部「保存」备份完整项目。</p>`;
  document.body.appendChild(panel);
  const calibrate = document.createElement('button'); calibrate.id = 'btn-calib'; calibrate.disabled = !metersPerUnit;
  calibrate.textContent = '定比例尺'; calibrate.onclick = () => { show2D(); startCalib(); };
  $('env-calibrate-slot').replaceWith(calibrate);
  $('env-step-base').onclick = () => window.openSiteSetup();
  $('env-continue').onclick = () => window.openEnvironment();
  async function setStep(next) {
    finishPhotoPlacement(); cancel(); boundaryDraft = null; selected = null; step = next; panel.scrollTop = 0;
    for (const name of ['base','structure','layout','export']) {
      const tab = ['base','layout'].includes(name) ? null : $('env-step-' + name);
      if (tab) { tab.setAttribute('aria-selected', String(name === step)); tab.tabIndex = name === step ? 0 : -1; }
      $('env-' + name + '-panel').hidden = name !== step;
    }
    const tools = $('env-edit-tools'); tools.hidden = !['structure','layout'].includes(step);
    if (!tools.hidden) $('env-' + step + '-tools').append(tools);
    const isBase = step === 'base';
    panel.querySelector('.env-heading small').textContent = isBase ? 'SITE SETUP' : 'SCENE BUILDER';
    panel.querySelector('h2').textContent = isBase ? '建立 / 编辑场地' : step === 'layout' ? '活动组件属性' : '场景搭建';
    panel.querySelector('.env-intro').textContent = isBase ? '导入参考底图或输入实测尺寸，建立准确的二维场地。' : step === 'layout' ? '在顶部选取组件，点击画布放置；右键点击删除。' : '补充场地固定结构、设置材质并展示出图。';
    panel.querySelector('.env-methods').hidden = isBase || step === 'layout';
    panel.querySelector('.env-context').hidden = isBase;
    panel.querySelector('.env-view-switch').hidden = isBase;
    syncObjects(); syncStatus();
    if (step === 'base') show2D();
    else if (step !== 'layout' && metersPerUnit && !_3dMode) await window.environmentUI.toggle(true);
    render();
  }
  for (const name of ['structure','export']) {
    const tab = $('env-step-' + name);
    tab.onclick = () => setStep(name);
    tab.onkeydown = e => {
      const names = ['structure','export'], index = names.indexOf(name);
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
      e.preventDefault(); const next = names[e.key === 'Home' ? 0 : e.key === 'End' ? 1 : (index + 1) % 2];
      setStep(next); $('env-step-' + next).focus();
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
    if (input.sitePlan != null) {
      const plan = input.sitePlan;
      if (plan.schema !== 'needflea-site-plan/1' || !Array.isArray(plan.points) || plan.points.length < 3 || plan.points.length > 500) throw new Error('实测边界需要 3～500 个点');
      const points = plan.points.map(p => ({ x: number(p.x, '边界 X', -1e7, 1e7), y: number(p.y, '边界 Y', -1e7, 1e7) }));
      const area = points.reduce((v,p,i) => { const q = points[(i+1)%points.length]; return v + p.x*q.y-q.x*p.y; },0);
      if (Math.abs(area) < 0.01) throw new Error('场地边界面积过小');
      const cross = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
      for (let i=0;i<points.length;i++) {
        const a=points[i], b=points[(i+1)%points.length];
        if (Math.hypot(a.x-b.x,a.y-b.y)<1e-6) throw new Error('边界存在重复相邻点');
        for (let j=i+2;j<points.length;j++) {
          if (i===0 && j===points.length-1) continue;
          const c=points[j], d=points[(j+1)%points.length];
          if (cross(a,b,c)*cross(a,b,d)<=0 && cross(c,d,a)*cross(c,d,b)<=0 && Math.max(a.x,b.x)>=Math.min(c.x,d.x) && Math.max(c.x,d.x)>=Math.min(a.x,b.x) && Math.max(a.y,b.y)>=Math.min(c.y,d.y) && Math.max(c.y,d.y)>=Math.min(a.y,b.y)) throw new Error('场地边界不能自交或重叠');
        }
      }
      result.sitePlan = { schema: 'needflea-site-plan/1', points };
    }
    if (input.views !== undefined && (!Array.isArray(input.views) || input.views.length > 20)) throw new Error('机位最多 20 个');
    result.views = (input.views || []).map(v => ({ name: String(v.name || '机位').slice(0,60), position: ['x','y','z'].map((k,i) => number(v.position?.[i], '相机位置', -1e9,1e9)), target: ['x','y','z'].map((k,i) => number(v.target?.[i], '相机朝向', -1e9,1e9)), fov: number(v.fov, '视野', 10,100) }));
    result.showLabels = input.showLabels !== false;
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
    const ids = new Set();
    result.objects = input.objects.map((o, i) => {
      if (!o || !Object.hasOwn(types, o.type)) throw new Error(`第 ${i + 1} 项组件类型无效`);
      if (o.color !== undefined && !validColor(o.color)) throw new Error(`第 ${i + 1} 项颜色无效`);
      let id = Number.isSafeInteger(o.id) && o.id > 0 ? o.id : i + 1;
      while (ids.has(id)) id++;
      ids.add(id);
      return { id, type: o.type, name: String(o.name || '').slice(0, 100), x: number(o.x, 'X 世界坐标', -1e12, 1e12), y: number(o.y, 'Y 世界坐标', -1e12, 1e12), width: number(o.width, '宽度（米）', 0.01, 1000), depth: number(o.depth, '深度（米）', 0.01, 1000), height: number(o.height, '高度（米）', 0.01, 100), angle: number(o.angle ?? 0, '角度', -360, 360), elevation: number(o.elevation ?? 0, '离地高度', 0, 100), scope: fixedTypes.includes(o.type) ? 'site' : 'activity', ...(o.color ? { color: o.color } : {}), ...(typeof o.estimated === 'boolean' ? { estimated: o.estimated, source: String(o.source || '').slice(0, 2000) } : {}) };
    });
    return result;
  }

  function bounds() {
    if (state.sitePlan && !_cadFileData) {
      const xs = state.sitePlan.points.map(p => p.x), ys = state.sitePlan.points.map(p => p.y);
      return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
    }
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
    if (state.sitePlan && !_cadFileData) return null;
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

  function changed() { render(); syncStatus(); }
  async function refresh(fit = false) {
    if (!scene || !_3dMode) return;
    const b = bounds();
    await scene.update({ bounds: b, mpu: metersPerUnit, environment: state, booths, dark: darkMode, floorImage: floorImage(b) }, fit);
  }
  function cancel() {
    mode = null; firstPoint = null; boundaryDraft = null; $('env-finish-boundary').hidden = true; $('env-cancel').hidden = true;
    host.style.cursor = ''; if (scene) scene.controls.enabled = true;
    $('env-hud-tip').textContent = '拖动旋转 · 滚轮缩放 · 右键平移';
  }
  function componentAt(x, y) {
    if (!state.showStructures) return null;
    return [...state.objects].reverse().find(o => {
      const a=-(o.angle||0)*Math.PI/180, dx=(x-o.x)*metersPerUnit, dy=(y-o.y)*metersPerUnit;
      return Math.abs(dx*Math.cos(a)-dy*Math.sin(a))<=o.width/2 && Math.abs(dx*Math.sin(a)+dy*Math.cos(a))<=o.depth/2;
    });
  }
  function deleteAt(x, y, hit) {
    if (mode || boundaryDraft || photoPlacement) { finishPhotoPlacement(); cancel(); render(); return true; }
    if (!hit && booths.hitTest(x, y, renderer.scale)) return false;
    const booth = hit?.kind === 'booth' ? booths.getItem(hit.id) : null;
    const object = hit ? (hit.kind === 'component' ? state.objects.find(o => o.id === hit.id) : null) : componentAt(x,y);
    if (!booth && !object) return false;
    if (confirm(`删除此${booth ? ({booth:'摊位',guard:'安保点',fire:'灭火器'}[booth.type] || '标注') : types[object.type]}？`)) {
      if (booth) { booths.deleteItem(booth.id); hideProps(); }
      else { state.objects=state.objects.filter(o=>o!==object); if(selected===object.id) selected=null; syncObjects(); }
      changed();
    }
    return true;
  }
  function groundClick(point, hit) {
    const objectId = hit?.kind === 'component' ? hit.id : null;
    if (!mode && placeLayoutItem(point.x, point.y)) { render(); return; }
    if (!mode) {
      if (hit?.kind === 'booth') { booths.selectedId = hit.id; booths.selectedIds = new Set([hit.id]); showProps(booths.getItem(hit.id)); render(); return; }
      const object = state.objects.find(o => o.id === objectId);
      if (object && !fixedTypes.includes(object.type)) window.openLayoutComponents();
      if (!panel.hidden && object && ((step === 'structure' && fixedTypes.includes(object.type)) || (step === 'layout' && !fixedTypes.includes(object.type)))) { selected = object.id; syncObjects(); }
      return;
    }
    if (state.sitePlan && !_cadFileData) point = { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 };
    try {
      const b = bounds();
      if (point.x < b.minX || point.x > b.maxX || point.y < b.minY || point.y > b.maxY) {
        message('请在场地底图范围内点击定位。'); return;
      }
      if (mode === 'move') {
        const object = state.objects.find(o => o.id === selected);
        if (object) { object.x = point.x; object.y = point.y; }
        cancel(); syncObjects(); changed(); message('组件已重新定位。'); return;
      }
      const height = number(Number($('env-height').value), '高度', 0.01, 100);
      const width = number(Number($('env-width').value), '厚 / 宽', 0.01, 1000);
      const depth = number(Number($('env-depth').value), '深度', 0.01, 1000);
      if (mode === 'wall' && !firstPoint) {
        firstPoint = point; $('env-hud-tip').textContent = '已记录墙体起点，请点击终点'; return;
      }
      let object = { id: Date.now(), type: mode, name: '', scope: fixedTypes.includes(mode) ? 'site' : 'activity', elevation: 0, x: point.x, y: point.y, width, depth, height, angle: 0 };
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
    for (const o of state.objects.filter(o => step === 'layout' ? !fixedTypes.includes(o.type) : fixedTypes.includes(o.type))) {
      const row = document.createElement('div'); row.className = 'env-object';
      const edit = document.createElement('button'); edit.textContent = `${o.name || types[o.type]} · ${o.width.toFixed(2)} × ${o.depth.toFixed(2)} × ${o.height.toFixed(2)} m`;
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
    const nameLabel = document.createElement('label'); nameLabel.textContent = '名称';
    const nameInput = document.createElement('input'); nameInput.type = 'text'; nameInput.value = object.name || '';
    nameInput.onchange = () => { object.name = nameInput.value.slice(0,100); syncObjects(); changed(); };
    nameLabel.append(nameInput); editor.append(nameLabel);
    const color = document.createElement('input'); color.type = 'color'; color.value = object.color || state.wallColor;
    color.onchange = () => { object.color = color.value; changed(); }; editor.append(color);
    const relocate = document.createElement('button'); relocate.textContent = '在图中重新定位';
    relocate.onclick = () => { cancel(); setTool('select'); mode = 'move'; if (scene) scene.controls.enabled = false; $('env-cancel').hidden = false; host.style.cursor = 'crosshair'; message('点击新的中心位置，Esc 取消，原位置保留。'); }; editor.append(relocate);
    const duplicate = document.createElement('button'); duplicate.textContent = '复制组件'; duplicate.onclick = () => { if (state.objects.length >= 1000) return message('组件最多 1000 个'); const copy = { ...object, id: Date.now(), x: object.x + 1 / metersPerUnit, y: object.y + 1 / metersPerUnit }; state.objects.push(copy); selected = copy.id; syncObjects(); changed(); }; editor.append(duplicate);
    for (const [key, title, step] of [['x', '中心 X（CAD 世界坐标）', 'any'], ['y', '中心 Y（CAD 世界坐标）', 'any'], ['width', '宽 / 墙长（米）', '.1'], ['depth', '深 / 墙厚（米）', '.1'], ['height', '高度（米）', '.1'], ['angle', '逆时针角度（度）', '1'], ['elevation', '离地高度（米）', '.1']]) {
      const label = document.createElement('label'); label.textContent = title;
      const input = document.createElement('input'); input.type = 'number'; input.name = key; input.step = step; input.value = object[key] ?? 0;
      input.onchange = () => {
        try {
          const selectedIndex = state.objects.indexOf(object);
          const next = validate({ ...state, objects: state.objects.map(o => o === object ? { ...o, [key]: Number(input.value) } : o) });
          state = next; selected = next.objects[selectedIndex]?.id || null;
          syncObjects(); changed();
        } catch (err) { input.value = object[key] ?? 0; message(err.message); }
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
      for (const button of [place, clear, remove]) button.disabled = false;
      actions.append(place, clear, remove);
      row.append(title, img, text, pose, actions); list.append(row);
    });
  }

  function cameraAngle(camera) { return (Math.atan2(camera.targetY - camera.y, camera.targetX - camera.x) * 180 / Math.PI + 360) % 360; }
  function startPhotoPlacement(photo) {
    if (!renderer.dxfData) { message('请先导入 CAD 或图片底图。'); return; }
    if (photoPlacement) finishPhotoPlacement();
    cancel();
    photoPlacement = { photo, first: null, cursor: null, return3D: _3dMode };
    _3dMode = false; canvas.style.visibility = ''; host.hidden = true;
    $('btn-environment').style.background = ''; $('btn-environment').style.color = '';
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
      $('btn-environment').style.background = 'var(--green)'; $('btn-environment').style.color = '#fff';
    } else hud.hidden = true;
    render();
  }
  function photoPointerDown(x, y) {
    if (!photoPlacement) {
      if (boundaryDraft) { boundaryDraft.push({ x: Math.round(x * metersPerUnit * 10) / (metersPerUnit * 10), y: Math.round(y * metersPerUnit * 10) / (metersPerUnit * 10) }); render(); return true; }
      if (mode) { groundClick({ x, y }); render(); return true; }
      if (!panel.hidden && ['structure','layout'].includes(step)) {
        const p = [...state.objects].reverse().find(o => {
          if ((step === 'structure') !== fixedTypes.includes(o.type)) return false;
          const a = -(o.angle || 0)*Math.PI/180, dx=(x-o.x)*metersPerUnit, dy=(y-o.y)*metersPerUnit;
          return Math.abs(dx*Math.cos(a)-dy*Math.sin(a))<=o.width/2 && Math.abs(dx*Math.sin(a)+dy*Math.cos(a))<=o.depth/2;
        });
        if (p) { selected = p.id; syncObjects(); return true; }
      }
      return false;
    }
    if (!photoPlacement.first) {
      photoPlacement.first = { x, y }; photoPlacement.cursor = { x, y };
      $('env-hud-tip').textContent = '② 移动鼠标预览朝向，再点击确认 · Esc 取消';
    } else {
      const first = photoPlacement.first;
      if (Math.hypot(x - first.x, y - first.y) * renderer.scale < 8) { message('请点击离拍摄位置稍远的点，确定镜头朝向。'); return true; }
      photoPlacement.photo.camera = { x: first.x, y: first.y, targetX: x, targetY: y };
      finishPhotoPlacement(); syncPhotos();
      message('拍摄位置与朝向已保存。图上的 P 编号与照片对应，并随完整项目保存。');
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
    if (state.sitePlan) $('env-boundary').value = state.sitePlan.points.map(p => `${p.x},${p.y}`).join('\n');
    syncObjects(); syncPhotos(); syncStatus(); syncViews(); $('env-labels').checked = state.showLabels !== false;
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

  $('env-close').onclick = () => { finishPhotoPlacement(); panel.hidden = true; cancel(); changed(); };
  $('env-cancel').onclick = cancel;
  $('env-fit').onclick = $('env-hud-fit').onclick = () => { if (photoPlacement) { renderer.fitToView(); render(); } else scene?.fit(); };
  $('env-photo-cancel').onclick = () => { finishPhotoPlacement(); message('已取消选点，保留原数据。'); };
  $('env-png').onclick = async () => { if (!_3dMode) await window.environmentUI.toggle(false); scene?.exportPNG(Number($('env-output-size').value)); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { finishPhotoPlacement(); cancel(); render(); } });
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
  document.querySelectorAll('[data-env-add]').forEach(button => { button.onclick = () => {
    if (!metersPerUnit) { window.openSiteSetup(); message('请先建立场地并设置比例尺。'); return; }
    if (!fixedTypes.includes(button.dataset.envAdd)) window.openLayoutComponents();
    cancel(); setTool('select'); mode = button.dataset.envAdd;
    const sizes = { stage:[6,4,.6], truss:[4,3,3], counter:[2,.6,1], sign:[2,.12,2.5], table:[1.8,.7,.75], fence:[2,.1,1.2], building:[8,6,6], tree:[3,3,5] };
    if (sizes[mode]) { const [w,d,h] = sizes[mode]; $('env-width').value=w; $('env-depth').value=d; $('env-height').value=h; }
    if (scene) scene.controls.enabled = false;
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
      instructions: '结合本文件与原始场地照片，为 Three.js 场地环境生成 needflea-environment/1 JSON。CAD 定位、实测定尺寸；不要把无法确认的照片位置或估计高度当成实测值。缺少尺寸或定位时先提出问题。照片只提供外观；原始照片请另外提供。输出 schema、floorColor、wallColor、objects；objects 为完整的环境对象列表，导入时替换现有墙柱。保留已有对象，新增对象使用新的 id。不要包含 photos、floorTexture。所有位置 x/y 使用下述 CAD 世界坐标；width/depth/height 使用米；angle 是 CAD 平面逆时针角度；x/y 是几何中心。按组件类型、米制尺寸及离地高度描述结构与活动装置。',
      metersPerUnit, bounds: bounds(), notes: state.notes,
      photos: state.photos.map(({ name, note, camera }) => ({ name, note, ...(camera ? { camera } : {}) })),
      cadLayers: _venueLayers(), cadEntities: _venueEntities(),
      environment: { ...state, photos: undefined, floorTexture: undefined },
      objectExample: { id: 1, type: 'column', name: '确认过位置的柱子', x: 0, y: 0, width: 0.5, depth: 0.5, height: 3, angle: 0 },
    }); message('建模资料已导出。此文件不含照片，请另附原始照片。');
  };
  $('env-import').onchange = async e => {
    try {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 50 * 1024 * 1024) throw new Error('环境文件请小于 50MB');
      const incoming = JSON.parse(await f.text());
      const next = validate({ ...state, ...incoming });
      if (next.sitePlan && (_cadFileData || metersPerUnit !== 1)) throw new Error('实测场景请通过完整项目载入，或先建立米制场地。');
      if (!confirm(`导入 ${next.objects.length} 个场景组件，将替换当前 ${state.objects.length} 个环境对象。摊位和底图保留。是否继续？`)) return;
      finishPhotoPlacement(false);
      state = next; restoreMeasuredBase(false); cancel(); selected = null; sync(); changed(); message('环境已导入，请对照 CAD 和实测检查位置与尺寸。');
    } catch (err) { message(`导入失败：${err.message}`); } finally { e.target.value = ''; }
  };

  function show2D() {
    finishPhotoPlacement(false); _3dMode = false;
    if (_isoRenderer) _isoRenderer.active = false;
    canvas.style.visibility = ''; host.hidden = true; hud.hidden = true;
    $('btn-environment').style.background = ''; $('btn-environment').style.color = ''; render(); syncStatus();
  }
  function syncStatus() {
    const source = state.sitePlan && !_cadFileData ? '实测场地 · 米制' : _cadFileData ? (_cadFileData.isImage ? '图片场地' : 'CAD 场地') : '尚未建立场地';
    $('env-source-status').textContent = source;
    $('toolbar-site-status').textContent = dxfLoaded ? source : 'CAD / 图片 / 实测';
    $('btn-site-setup').textContent = dxfLoaded ? '📐 编辑场地' : '📐 建立场地';
    $('env-continue').disabled = !metersPerUnit;
    $('env-continue-note').textContent = metersPerUnit ? '场地已就绪，可补充结构高度并布置活动。' : dxfLoaded ? '请先通过已知长度定比例尺，再进入场景搭建。' : '请选择一种场地来源，建立平面后继续。';
    $('env-measured-fields').hidden = sourceChoice !== 'measured' && !state.sitePlan;
    $('btn-calib').disabled = !dxfLoaded || (!!state.sitePlan && !_cadFileData);
    $('env-scale-status').textContent = metersPerUnit ? `当前 1 世界单位 = ${metersPerUnit} 米。` : '尚未校准：导入图片或无单位 CAD 后，请用已知距离定比例尺。';
    $('btn-environment').setAttribute('aria-expanded', String(!panel.hidden && step !== 'base'));
    $('env-view-2d').setAttribute('aria-pressed', String(!_3dMode)); $('env-view-3d').setAttribute('aria-pressed', String(_3dMode));
  }
  function restoreMeasuredBase(fit = true) {
    if (!state.sitePlan || _cadFileData) return;
    const b = bounds(), points = state.sitePlan.points;
    const data = { bounds: { ...b, width: b.maxX-b.minX, height: b.maxY-b.minY }, layers: { '实测边界': { color: 3 } }, entities: points.map((p,i) => { const q=points[(i+1)%points.length]; return { type:'LINE', layer:'实测边界', x1:p.x,y1:p.y,x2:q.x,y2:q.y, color:3 }; }) };
    if (fit) renderer.load(data); else renderer.dxfData = data;
    _setupDxfLayerState(data); dxfLoaded = true; $('welcome').classList.add('hidden'); $('btn-calib').disabled = true;
  }
  async function createSite(points) {
    try {
      const next = validate({ ...defaults(), sitePlan: { schema:'needflea-site-plan/1', points } });
      if ((_cadFileData || dxfLoaded || booths.items.length || state.objects.length) && !confirm('新建实测场地将替换当前画布及布置。请确认已保存完整项目，是否继续？')) return;
      await window.projectIO.load({ version:3, items:[], nextId:1, metersPerUnit:1, cadFile:null, environment:next });
      show2D(); panel.hidden=false; sync(); render(); message('米制场地已建立，可描绘边界、测量并补充结构。');
    } catch (err) { message(err.message); }
  }
  function drawPlan(context, view) {
    const plan = state.sitePlan && !_cadFileData;
    if (plan) {
      const b = bounds(), m = metersPerUnit || 1;
      const spacing = Math.max(1, 10 ** Math.ceil(Math.log10(18 / Math.max(.001, view.scale * m))));
      context.save(); context.strokeStyle = '#7b948522'; context.lineWidth = 1;
      for (let x=Math.ceil(b.minX/spacing)*spacing;x<=b.maxX;x+=spacing) { context.beginPath(); context.moveTo(view.wx(x),view.wy(b.minY)); context.lineTo(view.wx(x),view.wy(b.maxY)); context.stroke(); }
      for (let y=Math.ceil(b.minY/spacing)*spacing;y<=b.maxY;y+=spacing) { context.beginPath(); context.moveTo(view.wx(b.minX),view.wy(y)); context.lineTo(view.wx(b.maxX),view.wy(y)); context.stroke(); }
      context.restore();
      const points = state.sitePlan.points;
      context.save(); context.font='11px sans-serif'; context.textAlign='center'; context.fillStyle=darkMode?'#a9c9b2':'#486e58';
      points.forEach((p,i) => { const q=points[(i+1)%points.length], length=Math.hypot(q.x-p.x,q.y-p.y); if(length*view.scale>55) context.fillText(`${length.toFixed(2)} m`,view.wx((p.x+q.x)/2),view.wy((p.y+q.y)/2)-8); }); context.restore();
    }
    if (state.showStructures) for (const o of state.objects) {
      context.save(); context.translate(view.wx(o.x),view.wy(o.y)); context.rotate(-o.angle*Math.PI/180);
      const w=o.width/(metersPerUnit||1)*view.scale, d=o.depth/(metersPerUnit||1)*view.scale;
      context.fillStyle = (o.color || (fixedTypes.includes(o.type) ? '#7d9183' : '#d28043'))+'45';
      context.strokeStyle = o.id===selected && !panel.hidden ? '#eb8b30' : (o.color || '#527a68'); context.lineWidth = o.id===selected ? 2.5 : 1;
      context.fillRect(-w/2,-d/2,w,d); context.strokeRect(-w/2,-d/2,w,d);
      context.restore();
      if (state.showLabels !== false) { context.save(); context.font='11px sans-serif'; context.textAlign='center'; context.fillStyle=darkMode?'#eee':'#30473d'; context.fillText(o.name || types[o.type],view.wx(o.x),view.wy(o.y)-5); context.restore(); }
    }
    if (boundaryDraft?.length) {
      context.save(); context.strokeStyle='#e48a28'; context.lineWidth=2; context.beginPath();
      boundaryDraft.forEach((p,i) => { if(i) context.lineTo(view.wx(p.x),view.wy(p.y)); else context.moveTo(view.wx(p.x),view.wy(p.y)); }); context.stroke(); context.restore();
    }
  }
  function syncViews() {
    const list=$('env-view-list'); list.replaceChildren();
    state.views.forEach((v,i) => { const row=document.createElement('div'); row.className='env-object'; const b=document.createElement('button'); b.textContent=v.name; b.onclick=async()=>{ if(!_3dMode) await window.environmentUI.toggle(true); scene?.restoreView(v); }; const del=document.createElement('button'); del.textContent='删除'; del.onclick=()=>{ state.views.splice(i,1); syncViews(); }; row.append(b,del); list.append(row); });
  }
  $('env-view-2d').onclick=show2D; $('env-view-3d').onclick=()=>window.environmentUI.toggle(true);
  $('env-source-measured').onclick=()=>{ sourceChoice='measured'; syncStatus(); $('env-site-width').focus(); message('填写场地长宽，或展开不规则边界输入实测坐标。'); };
  for (const kind of ['cad','image']) $('env-source-'+kind).onclick=()=>{ sourceChoice=kind; syncStatus(); show2D(); const f=$('file-input'); f.accept=kind==='cad'?'.dxf,.dwg':'.jpg,.jpeg,.png,.webp,.bmp'; f.click(); };
  $('env-create-site').onclick=()=>{ const w=Number($('env-site-width').value),d=Number($('env-site-depth').value); if(!Number.isFinite(w)||!Number.isFinite(d)||w<1||d<1||w>1000||d>1000) return message('场地长宽需在 1～1000 米之间'); createSite([{x:0,y:0},{x:w,y:0},{x:w,y:d},{x:0,y:d}]); };
  $('env-create-polygon').onclick=()=>{ try { const points=$('env-boundary').value.trim().split(/\n+/).map(line=>{ const values=line.trim().split(/[,，\s]+/); if(values.length!==2) throw new Error('每行请输入两个坐标：X,Y'); return {x:Number(values[0]),y:Number(values[1])}; }); createSite(points); } catch(e) { message(e.message); } };
  $('env-draw-boundary').onclick=()=>{ if(!state.sitePlan||_cadFileData) return message('请先新建实测场地，再在平面上描绘边界。'); show2D(); cancel(); boundaryDraft=[]; $('env-finish-boundary').hidden=false; message('依次点击边界点，点击“完成边界”闭合；Esc 取消。'); };
  $('env-finish-boundary').onclick=()=>{ try { state=validate({...state,sitePlan:{schema:'needflea-site-plan/1',points:boundaryDraft}}); cancel(); restoreMeasuredBase(false); sync(); render(); message('边界已更新，原有布置保留。'); } catch(e) { message(e.message); } };
  $('env-measure').onclick=()=>{ if(!dxfLoaded) return message('请先建立场地。'); show2D(); setTool('measure'); };
  $('env-overview').onclick=async()=>{ if(!_3dMode) await window.environmentUI.toggle(true); scene?.fit(); };
  $('env-human').onclick=async()=>{ if(!_3dMode) await window.environmentUI.toggle(true); scene?.humanView(); };
  $('env-view-save').onclick=()=>{ if(!scene||!_3dMode) return message('请先打开三维场景并调整视角。'); if(state.views.length>=20) return message('机位最多 20 个'); state.views.push({...scene.captureView(),name:$('env-view-name').value.trim()||`机位 ${state.views.length+1}`}); syncViews(); message('机位已记录，请保存完整项目。'); };
  $('env-labels').onchange=()=>{ state.showLabels=$('env-labels').checked; changed(); };
  window.environmentUI = {
    hasPendingPreview: () => false,
    drawPhotoMarkers, drawPlan, syncStatus, deleteAt,
    restoreMeasuredBase,
    clearMeasuredBase() { state.sitePlan = null; syncStatus(); },
    photoPointerDown,
    photoPointerMove(x, y) {
      if (!photoPlacement) return false;
      photoPlacement.cursor = { x, y }; render(); return true;
    },
    isPhotoPositioning: () => !!photoPlacement || !!boundaryDraft || !!mode,
    cancelPhotoPlacement(returnToView = true) { if (!photoPlacement && !mode && !boundaryDraft) return; finishPhotoPlacement(returnToView); cancel(); render(); },
    validate: data => data == null ? defaults() : validate(data),
    snapshot: () => structuredClone(state),
    restore(data) {
      const next = data == null ? defaults() : validate(data);
      finishPhotoPlacement(false);
      state = next; sourceChoice = null; selected = null; if (scene) scene.fitted = false; cancel(); sync(); syncStatus();
    },
    async toggle(openPanel = false) {
      finishPhotoPlacement(false);
      if (_3dMode && !openPanel) { this.close(); return; }
      if (!metersPerUnit || !Number.isFinite(metersPerUnit) || metersPerUnit <= 0) {
        alert('请先导入底图，并用“定比例尺”设定真实尺寸，再打开场地三维预览。'); return;
      }
      const button = $('btn-environment'); button.disabled = true;
      try {
        if (!scene) {
          loading ||= import('./scene-three.js?v=7').then(module => module.VenueScene).catch(err => { loading = null; throw err; });
          const Viewer = await loading;
          scene = new Viewer(host, groundClick, deleteAt);
        }
        _3dMode = true; if (_isoRenderer) _isoRenderer.active = false;
        canvas.style.visibility = 'hidden'; host.hidden = false; hud.hidden = false;
        $('welcome').classList.add('hidden');
        panel.hidden = !openPanel;
        button.style.background = 'var(--green)'; button.style.color = '#fff';
        await refresh(!scene.fitted); syncStatus();
        message('按步骤补充场地结构、布置组件并保存出图机位。');
      } catch (err) {
        this.close(); alert(`三维预览无法启动：${err.message}。请检查浏览器 WebGL 支持和本地资源。二维规划仍可使用。`);
      } finally { button.disabled = false; }
    },
    close() {
      finishPhotoPlacement(false);
      cancel(); _3dMode = false; canvas.style.visibility = ''; host.hidden = panel.hidden = hud.hidden = true;
      $('btn-environment').style.background = ''; $('btn-environment').style.color = ''; render(); syncStatus();
    },
    render() {
      if (!_3dMode || !scene) return;
      refresh().catch(err => { if (err.name === 'AbortError') return; message(err.message); console.error(err); });
    },
    exportPNG() { scene?.exportPNG(Number($('env-output-size').value)); },
  };
  window.toggle3DView = () => window.environmentUI.toggle();
  window.openSiteSetup = () => { panel.hidden = false; window.toolbarUI?.showGroup('files'); return setStep('base'); };
  window.openEnvironment = () => {
    if (!metersPerUnit) { window.openSiteSetup(); message(dxfLoaded ? '请先定比例尺，再开始场景搭建。' : '请先从 CAD、图片或实测尺寸建立场地。'); return; }
    panel.hidden = false;
    return setStep(['base','layout'].includes(step) ? 'structure' : step);
  };
  window.export3DPNG = () => window.environmentUI.exportPNG();
  window.openLayoutComponents = () => {
    window.toolbarUI.showGroup('layout'); window.toolbarUI.showLayoutTab('components');
    panel.hidden = false; return setStep('layout');
  };
  const catalog = panel.querySelector('.env-component-grid');
  catalog.querySelectorAll('button').forEach(button => button.classList.add('tb-btn'));
  $('layout-component-buttons').append(catalog);
  window.addEventListener('needflea-layout-tab-changed', e => {
    if (e.detail.tab === 'booths' && step === 'layout') { cancel(); panel.hidden = true; syncStatus(); render(); }
  });
  setStep('base'); sync();
})();
