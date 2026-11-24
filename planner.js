import { emptyPlan, strategies } from './cloud/planning-input.mjs';

import { draftInput, draftProblems } from './local-draft-input.mjs';
import { buildSnapIndex, snapPoint } from './planner-snap.mjs';

const $ = (id) => document.getElementById(id);
const panel = document.createElement('aside');
panel.id = 'planner-panel';
panel.hidden = true;
panel.setAttribute('aria-label', '摊位规划助手');
panel.innerHTML = `
  <header><h2>生成摊位初稿</h2><button id="plan-close" aria-label="关闭">×</button></header>
  <section><h3>场地标注</h3><div id="plan-marks"></div>
  <div id="plan-drawing" hidden><button id="plan-undo">撤销上一点</button> <button id="plan-finish">完成轮廓</button> <button id="plan-cancel">取消标记</button></div>
  <details><summary>编辑已有标注</summary><div id="plan-regions"></div></details></section>
  <section><h3>摊位需求</h3><div id="plan-demands"></div><button id="plan-add">＋ 添加类型</button></section>
  <section><h3>排间过道净宽（米）</h3><fieldset><label>最小<input type="number" min="0.01" step="any" id="plan-min"></label></fieldset></section>
  <p class="plan-help">优先沿可摆区两侧边界摆摊，营业面朝内；空间足够时补充背靠背双排。请将贴墙边界圈到实际墙边。</p>
  <button class="plan-primary" id="plan-generate">生成两种初稿</button><p id="plan-status" role="status"></p>
  <div id="plan-cards"></div><div id="plan-follow" hidden><button id="plan-apply" class="plan-primary">采用这版</button> <button id="plan-dismiss">取消预览</button></div>
  <button id="plan-revert" hidden>撤销整版采用</button>`;
$('canvas-wrap').after(panel);
const preview = new BoothSystem();
let visibleMarks = null;
let snapIndex = null,
  hover = null,
  gesture = null,
  frame = 0;
const outlining = () => mode === 'region' || mode === 'obstacle';
let mode = '',
  points = [],
  candidates = [],
  selected = 0,
  fingerprint = '',
  serial = 0,
  busy = false;
function data() {
  planningData ||= emptyPlan();
  planningData.regions ||= [];
  planningData.demands ||= [];
  return planningData;
}
const project = () => window.projectIO.capture(false);
let cadRef, cadMarks;
const spec = () => {
  if (cadRef !== _cadFileData || !cadMarks) {
    cadRef = _cadFileData;
    cadMarks = _venueEntities().filter(
      (e) =>
        /^(可摆区域|禁摆区|障碍物|固定点位|柱子|墙体|锁定通道|主通道|次通道|场地边界|入口|出口|出入口)$/.test(
          e.layer
        ) ||
        (e.type === 'text' && /^(入口|出口|出入口)$/.test(e.text?.trim()))
    );
  }
  return draftInput({
    planning: planningData,
    metersPerUnit,
    items: booths.items,
    nextId: booths.nextId,
    environment: { objects: window.environmentUI?.snapshot().objects },
    cadFile: cadRef,
    venue: { entities: cadMarks }
  });
};
let worker,
  timer,
  adopted = null;
function endSearch() {
  worker?.terminate();
  worker = null;
  clearTimeout(timer);
  busy = false;
}

const notify = (s) => {
  $('plan-status').textContent = s;
};
function discard() {
  serial++;
  candidates = [];
  endSearch();
  fingerprint = '';
  selected = 0;
  preview.items = [];
  $('plan-cards').replaceChildren();
  $('plan-follow').hidden = true;
  $('plan-generate').disabled = false;
}
function stopDrawing() {
  endGesture();
  cancelAnimationFrame(frame);
  frame = 0;
  snapIndex = hover = null;
  canvas.classList.remove('plan-marking');
  mode = '';
  points = [];
  $('plan-drawing').hidden = true;
}
function reset() {
  stopDrawing();
  discard();
  if (!panel.hidden) {
    refresh();
    notify('');
  }
  render();
}
function close() {
  panel.hidden = true;
  stopDrawing();
  discard();
  $('btn-planner').setAttribute('aria-expanded', 'false');
  document.body.classList.remove('planning');
  render();
}
$('plan-close').onclick = close;
$('btn-planner').onclick = () => {
  if (!panel.hidden) return close();
  window.environmentUI?.close();
  setTool('select');
  panel.hidden = false;
  document.body.classList.add('planning');
  $('btn-planner').setAttribute('aria-expanded', 'true');
  if (
    !planningData ||
    !Object.hasOwn(planningData, 'demands') ||
    (!planningData.demands?.length && !planningData.demandsEdited)
  ) {
    const [width, depth] = currentBoothSize().split('x').map(Number);
    data().demands = [
      { id: crypto.randomUUID(), cat: activeCat, style: activeBoothStyle, width, depth, min: null, max: null }
    ];
  }
  refresh();
  render();
};
for (const id of ['btn-site-setup', 'btn-environment', 'site-library-button'])
  $(id).addEventListener('click', close, true);
window.addEventListener('needflea-project-loaded', () => {
  adopted = null;
  $('plan-revert').hidden = true;
  reset();
});
function element(tag, text) {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
}
function option(value, label) {
  return new Option(label, value);
}
function refresh() {
  const plan = { ...emptyPlan(), ...planningData },
    s = spec();
  visibleMarks = s;
  const marks = $('plan-marks'),
    list = $('plan-regions');
  marks.replaceChildren();
  list.replaceChildren();
  const addButton = (parent, text, click) => {
    const b = element('button', text);
    b.onclick = click;
    parent.append(b);
    return b;
  };
  const importedZones = s.importedZones || [];
  const titles = { region: '可摆区域', obstacle: '禁摆区域', entrance: '入口', exit: '出口' };
  for (const [kind, title] of Object.entries(titles)) {
    const count =
      kind === 'region'
        ? s.regions.length
        : kind === 'obstacle'
          ? s.zones.length + importedZones.length
          : s.gates[kind].length;
    const row = element('div', '');
    row.className = 'plan-mark-row';
    row.append(
      element(
        'span',
        title + ' · ' + (count ? count + ' 处' : kind === 'obstacle' && plan.noZones ? '已确认无' : '待标注')
      )
    );
    const b = addButton(row, count ? '追加' : '去标注', () => beginMark(kind));
    b.dataset.mark = kind;
    if (kind === 'obstacle' && !count)
      addButton(row, plan.noZones ? '撤销确认' : '确认无禁摆区', () => {
        data().noZones = !plan.noZones;
        reset();
      });
    marks.append(row);
  }
  for (const [i, r] of plan.regions.entries())
    addButton(list, '移除 ' + r.name, () => {
      data().regions.splice(i, 1);
      reset();
    });
  const editZones = () => (data().zones ||= []);
  const migrateZones = () => {
    if (data().obstacles?.length) {
      data().zones = [...data().obstacles.map((points) => ({ points, passable: false })), ...editZones()];
      data().obstacles = [];
    }
  };
  for (const [i, z] of [...s.zones, ...importedZones].entries()) {
    const row = element('label', '禁摆区 ' + (i + 1));
    const select = document.createElement('select');
    select.append(option('yes', '可通行'), option('no', '不可通行'));
    select.value = z.passable ? 'yes' : 'no';
    select.dataset.zoneIndex = i;
    row.append(select);
    select.onchange = () => {
      migrateZones();
      if (z.key) (data().zoneAccess ||= {})[z.key] = select.value === 'yes';
      else editZones()[i].passable = select.value === 'yes';
      reset();
    };
    if (!z.key)
      addButton(row, '移除', () => {
        migrateZones();
        editZones().splice(i, 1);
        data().noZones = false;
        reset();
      });
    list.append(row);
  }
  for (const kind of ['entrance', 'exit'])
    for (const [i, g] of s.gates[kind].entries()) {
      const width = g.a
        ? (Math.hypot(g.a.x - g.b.x, g.a.y - g.b.y) * s.scale).toFixed(2) + ' m'
        : '位置标注';
      addButton(list, '移除' + titles[kind] + ' ' + (i + 1) + '（' + width + '）', () => {
        data()[kind + 's'] = s.gates[kind].filter((_, n) => n !== i);
        reset();
      });
    }
  for (const key of ['min']) {
    const input = $('plan-' + key);
    input.value = s[key] ?? '';
    input.oninput = () => {
      data().aisles = {
        min: s.min,
        [key]: input.value === '' ? null : input.valueAsNumber
      };
      discard();
      render();
    };
  }
  const demands = $('plan-demands');
  demands.replaceChildren();
  for (const d of plan.demands) {
    const box = document.createElement('fieldset');
    const label = (name, input) => {
      const l = element('label', name);
      l.append(input);
      box.append(l);
    };
    const cat = document.createElement('input');
    cat.value = d.cat;
    cat.maxLength = 80;
    cat.oninput = () => {
      d.cat = cat.value;
      discard();
      render();
    };
    label('摊位类型', cat);
    const style = document.createElement('select');
    style.replaceChildren(...[...$('btn-booth').options].map((o) => option(o.value, o.text)));
    style.value = d.style;
    style.onchange = () => {
      d.style = style.value;
      d.width = d.style.endsWith('-yard') ? 4 : 2;
      d.depth = 2;
      reset();
    };
    label('模板', style);
    for (const [key, title, step] of [
      ['width', '宽（米）', 'any'],
      ['depth', '深（米）', 'any'],
      ['min', '最少', '1'],
      ['max', '最多', '1']
    ]) {
      const input = document.createElement('input');
      input.type = 'number';
      input.min = step === '1' ? '0' : '0.01';
      input.step = step;
      input.value = d[key] ?? '';
      input.oninput = () => {
        d[key] = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : null;
        discard();
        render();
      };
      label(title, input);
    }
    const remove = element('button', '删除此类型');
    remove.onclick = () => {
      data().demandsEdited = true;
      data().demands = plan.demands.filter((r) => r !== d);
      reset();
    };
    box.append(remove);
    demands.append(box);
  }
}
$('plan-add').onclick = () => {
  const [width, depth] = currentBoothSize().split('x').map(Number);
  data().demands.push({
    id: crypto.randomUUID(),
    cat: activeCat,
    style: activeBoothStyle,
    width,
    depth,
    min: null,
    max: null
  });
  reset();
};
function beginMark(kind) {
  discard();
  stopDrawing();
  mode = kind;
  const rings = [
    window.environmentUI?.snapshot().sitePlan?.points,
    ...(visibleMarks?.regions || []).map((r) => r.points)
  ].filter(Boolean);
  snapIndex = buildSnapIndex(_dwgEntitiesByLayer, rings);
  canvas.classList.add('plan-marking');
  $('plan-drawing').hidden = false;
  $('plan-finish').hidden = $('plan-undo').hidden = !outlining();
  updateDrawingButtons();
  notify(
    outlining()
      ? '点击落点，靠近 CAD 直线自动吸附。拖动画布可平移，Shift＋拖动可移动整个未完成轮廓。'
      : '依次点击门洞两端，标出实际开口范围。'
  );
  render();
}
function updateDrawingButtons() {
  $('plan-undo').disabled = busy || !points.length;
  $('plan-finish').disabled = busy || points.length < 3;
}
function undoPoint() {
  points.pop();
  hover = null;
  updateDrawingButtons();
  render();
}
$('plan-undo').onclick = undoPoint;
$('plan-cancel').onclick = () => {
  stopDrawing();
  notify('');
  render();
};
function finishOutline() {
  if (!outlining() || points.length < 3) return;
  if (mode === 'obstacle') {
    (data().zones ||= []).push({ points, passable: true });
    data().noZones = false;
  } else
    data().regions.push({ id: crypto.randomUUID(), name: '可摆区域 ' + (data().regions.length + 1), points });
  reset();
}
$('plan-finish').onclick = finishOutline;
function worldAt(e) {
  const rect = canvas.getBoundingClientRect();
  const { wx, wy } = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  return { x: wx, y: wy };
}
canvas.addEventListener('click', (e) => {
  if (panel.hidden || mode || busy || candidates.length || !visibleMarks) return;
  const { x, y } = worldAt(e);
  const zones = [...visibleMarks.zones, ...visibleMarks.importedZones];
  for (let i = zones.length - 1; i >= 0; i--) {
    const path = new Path2D();
    zones[i].points.forEach((p, j) => (j ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
    path.closePath();
    if (!ctx.isPointInPath(path, x, y)) continue;
    const select = $('plan-regions').querySelector('[data-zone-index="' + i + '"]');
    if (select) {
      $('plan-regions').parentElement.open = true;
      select.focus();
    }
    break;
  }
});
function targetAt(e) {
  const p = worldAt(e),
    radius = 10 / renderer.scale;
  const first = points[0];
  if (points.length >= 3 && Math.hypot(p.x - first.x, p.y - first.y) <= radius)
    return { point: first, close: true };
  if (!outlining()) {
    const ends = visibleMarks.openings.flatMap((g) => (g.a ? [g.a, g.b] : [g.center]));
    const hit = ends
      .filter((q) => Math.hypot(q.x - p.x, q.y - p.y) <= radius)
      .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    if (hit) return { point: { ...hit }, corner: true };
  }
  return snapPoint(snapIndex, p, radius, points.at(-1), _dwgLayerVisibility);
}
function endGesture() {
  const id = gesture?.id;
  gesture = null;
  if (id != null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  canvas.classList.remove('plan-dragging');
}
function paint() {
  if (!frame)
    frame = requestAnimationFrame(() => {
      frame = 0;
      render();
    });
}
canvas.addEventListener('pointerdown', (e) => {
  if (!mode || busy || gesture || (e.button !== 0 && e.button !== 1)) return;
  e.preventDefault(); // suppress the editor's compatibility mousedown (selection and dragging)
  canvas.setPointerCapture(e.pointerId);
  gesture = {
    id: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    startX: e.clientX,
    startY: e.clientY,
    panOnly: e.button === 1 || e.altKey,
    movingOutline: e.button === 0 && e.shiftKey && points.length > 0,
    original: points,
    startWorld: worldAt(e),
    dragging: false
  };
});
function dragTo(e) {
  if (!gesture.dragging && Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) < 4) return;
  gesture.dragging = true;
  canvas.classList.add('plan-dragging');
  hover = null;
  if (gesture.movingOutline) {
    const p = worldAt(e),
      dx = p.x - gesture.startWorld.x,
      dy = p.y - gesture.startWorld.y;
    points = gesture.original.map((v) => ({ x: v.x + dx, y: v.y + dy }));
  } else renderer.pan(e.clientX - gesture.x, e.clientY - gesture.y);
  gesture.x = e.clientX;
  gesture.y = e.clientY;
}
canvas.addEventListener('pointermove', (e) => {
  if (!mode || busy) return;
  if (gesture) {
    if (gesture.id !== e.pointerId) return;
    dragTo(e);
  } else hover = targetAt(e);
  paint();
});
canvas.addEventListener('pointerup', (e) => {
  if (!gesture || gesture.id !== e.pointerId) return;
  dragTo(e);
  const click = !gesture.dragging && !gesture.panOnly;
  endGesture();
  if (click) {
    const target = targetAt(e);
    if (target.close) return finishOutline();
    if (!outlining()) {
      if (!points.length) {
        points = [target.point];
        render();
        return;
      }
      const a = points[0],
        b = target.point;
      if (Math.hypot(a.x - b.x, a.y - b.y) * renderer.scale < 1) return;
      const gate = { a, b, center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      data()[mode + 's'] = [...visibleMarks.gates[mode], gate];
      return reset();
    }
    const last = points.at(-1);
    if (!last || Math.hypot(target.point.x - last.x, target.point.y - last.y) * renderer.scale > 1)
      points.push(target.point);
    updateDrawingButtons();
  }
  hover = null;
  render();
});
function cancelGesture() {
  if (!gesture) return;
  if (gesture.movingOutline) points = gesture.original;
  endGesture();
  hover = null;
  paint();
}
canvas.addEventListener('pointercancel', cancelGesture);
canvas.addEventListener('lostpointercapture', (e) => {
  if (gesture?.id === e.pointerId) cancelGesture();
});
canvas.addEventListener('pointerleave', () => {
  if (mode && !gesture) {
    hover = null;
    paint();
  }
});
window.addEventListener('blur', cancelGesture);
canvas.addEventListener(
  'wheel',
  (e) => {
    if (mode && !gesture) {
      hover = targetAt(e);
      paint();
    }
  },
  { passive: true }
);
for (const name of ['dblclick', 'contextmenu'])
  canvas.addEventListener(
    name,
    (e) => {
      if (mode) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true
  );
window.addEventListener(
  'keydown',
  (e) => {
    if (
      !mode ||
      busy ||
      document.querySelector('dialog[open]') ||
      e.target.closest?.('input,textarea,select,[contenteditable="true"]')
    )
      return;
    const undo =
      outlining() &&
      (e.key === 'Backspace' || ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z'));
    if (!undo && e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    cancelGesture();
    if (undo) undoPoint();
    else {
      stopDrawing();
      notify('');
      render();
    }
  },
  true
);
function draw(ctx, r) {
  if (panel.hidden) return;
  const plan = visibleMarks || planningData || emptyPlan();
  ctx.save();
  function line(pts, color, closed, width = 2) {
    if (!pts?.length) return;
    ctx.beginPath();
    pts.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](r.wx(p.x), r.wy(p.y)));
    if (closed) {
      ctx.closePath();
      ctx.fillStyle = color + '20';
      ctx.fill();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }
  for (const region of plan.regions || []) line(region.points, '#20966e', true);
  for (const obs of plan.obstacles || []) line(obs, '#c94f3c', true);
  for (const obs of plan.walkable || []) line(obs, '#e19616', true);
  if (hover?.segment) line([hover.segment.a, hover.segment.b], '#5bd4af', false, 3);
  line(points, '#eeb84f', false);
  if (hover && points.length) {
    ctx.setLineDash([6, 4]);
    line([points.at(-1), hover.point], '#eeb84f', false);
    ctx.setLineDash([]);
  }
  for (const p of points) {
    ctx.fillStyle = '#eeb84f';
    ctx.fillRect(r.wx(p.x) - 3, r.wy(p.y) - 3, 6, 6);
  }
  if (hover && (hover.segment || hover.close || hover.corner)) {
    ctx.strokeStyle = '#5bd4af';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.wx(hover.point.x) - 5, r.wy(hover.point.y) - 5, 10, 10);
  }
  const draft = candidates[selected];
  ctx.globalAlpha = 0.32;
  for (const lane of draft?.lanes || [])
    line(
      lane.points,
      lane.kind === 'main' ? '#1877ae' : '#43a7a0',
      false,
      Math.max(1, (lane.width / metersPerUnit) * r.scale)
    );
  ctx.globalAlpha = 1;
  preview.CAT_COLORS = booths.CAT_COLORS;
  preview.draw(ctx, r);
  for (const [key, title, offset] of [
    ['entrance', '入', -10],
    ['exit', '出', 10]
  ]) {
    for (const g of plan.gates?.[key] || []) {
      const p = g.center;
      if (g.a) line([g.a, g.b], key === 'entrance' ? '#008864' : '#7c53ae', false, 5);
      const x = r.wx(p.x),
        y = r.wy(p.y);
      ctx.fillStyle = '#104936';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(x + offset - 8, y - 24, 16, 16);
      ctx.fillStyle = '#104936';
      ctx.font = '12px sans-serif';
      ctx.fillText(title, x + offset - 6, y - 12);
    }
  }
  ctx.restore();
}
function cards() {
  const list = $('plan-cards');
  list.replaceChildren();
  candidates.forEach((d, i) => {
    const m = d.metrics,
      card = element('article', ''),
      button = element(
        'button',
        (selected === i ? '正在预览 · ' : '预览 · ') + (i ? 'B 动线优先' : 'A 两侧连续')
      );
    button.onclick = () => {
      selected = i;
      cards();
    };
    card.append(button);
    card.append(
      element(
        'p',
        d.report.quantities
          .map(
            (q) =>
              q.name + '：' + q.actual + ' / 目标 ' + q.min + '–' + q.max + (q.short ? '，缺 ' + q.short : '')
          )
          .join('\n')
      )
    );
    card.append(
      element(
        'p',
        '共 ' +
          m.total +
          ' 摊 · ' +
          strategies[d.strategy] +
          ' · 最窄排间过道 ' +
          (m.gap == null ? '无相邻排面' : m.gap.toFixed(2) + ' m')
      )
    );
    card.append(
      element(
        'p',
        '主通道净宽 ' +
          m.main.toFixed(2) +
          ' m，入口最近摊位 ' +
          m.entranceSpace.toFixed(2) +
          ' m，场内主通道长度 ' +
          m.routeLength.toFixed(2) +
          ' m。'
      )
    );
    if (i === 1) {
      const a = candidates[0].metrics;
      const differences = [];
      if (m.gap != null && a.gap != null && m.gap > a.gap + 0.05)
        differences.push('排间过道加宽 ' + (m.gap - a.gap).toFixed(2) + ' m');
      if (m.main > a.main + 0.05) differences.push('主通道加宽 ' + (m.main - a.main).toFixed(2) + ' m');
      if (m.routeLength < a.routeLength - 0.1)
        differences.push('场内主通道缩短 ' + (a.routeLength - m.routeLength).toFixed(2) + ' m');
      if (m.entranceSpace > a.entranceSpace + 0.2)
        differences.push('入口多留出 ' + (m.entranceSpace - a.entranceSpace).toFixed(2) + ' m');
      card.append(
        element(
          'p',
          '相比 A，' +
            differences.join('，') +
            '；' +
            (m.total === a.total ? '摊位数相同' : '少 ' + (a.total - m.total) + ' 摊') +
            '。'
        )
      );
    }
    list.append(card);
  });
  preview.items = candidates[selected]?.items || [];
  $('plan-follow').hidden = !preview.items.length;
  render();
}
$('plan-dismiss').onclick = () => {
  discard();
  notify('已取消预览');
  render();
};
$('plan-generate').onclick = () => {
  stopDrawing();
  discard();
  const s = spec(),
    issues = draftProblems(s);
  if (issues.length) {
    const kind = !s.regions.length
      ? 'region'
      : !s.zoneConfirmed
        ? 'obstacle'
        : !s.entrance
          ? 'entrance'
          : !s.exit
            ? 'exit'
            : '';
    if (kind) beginMark(kind);
    notify(issues.join('；'));
    render();
    return;
  }
  fingerprint = JSON.stringify(s);
  const stamp = ++serial;
  busy = true;
  $('plan-generate').disabled = true;
  notify('正在本机比较排法…');
  worker = new Worker(new URL('./planner-worker.mjs', import.meta.url), { type: 'module' });
  const finish = (msg) => {
    endSearch();
    $('plan-generate').disabled = false;
    cards();
    notify(msg || (candidates.length === 1 ? '本轮只找到一种有明显意义的排法。' : '可切换两版比较排布。'));
    if (!candidates.length && msg?.includes('可通行禁摆区')) {
      const mark=element('button','圈门前可通行区');
      mark.onclick=()=>{beginMark('obstacle');notify('圈出门前实际可通行的留白，让轮廓连接门洞并与场内区域相接，再点「完成轮廓」。此处仅供通行。');};
      $('plan-status').append(document.createElement('br'),mark);
    }
  };
  worker.onmessage = ({ data: res }) => {
    if (stamp !== serial) return;
    if (res.candidates) candidates = res.candidates;
    if (res.done) finish(res.error);
  };
  worker.onerror = (e) => finish(e.message || '本地排布计算失败');
  timer = setTimeout(
    () =>
      finish(
        candidates.length
          ? '已达到搜索时限，显示已通过校验的初稿。' +
              (candidates.length === 1 ? '本轮未找到明显不同的第二版。' : '')
          : '已达到搜索时限，请检查区域、开口和过道宽度。'
      ),
    12000
  );
  worker.postMessage(s);
};
$('plan-apply').onclick = async () => {
  const d = candidates[selected];
  if (!d || busy) return;
  if (JSON.stringify(spec()) !== fingerprint) {
    reset();
    return notify('画布已变化，请重新生成。');
  }
  const original = project(),
    next = structuredClone(original);
  next.items.push(...d.items);
  next.nextId = Math.max(next.nextId || 1, ...d.items.map((i) => i.id + 1));
  next.planning = { ...next.planning, routes: d.lanes };
  busy = true;
  $('plan-apply').disabled = true;
  try {
    const title = await window.savePlanningDraft(next, original);
    adopted = { ids: new Set(d.items.map((i) => i.id)), routes: original.planning?.routes };
    $('plan-revert').hidden = false;
    setTool('select');
    close();
    $('tool-hint').textContent = '已采用为活动副本「' + title + '」，可手动编辑。';
  } catch (e) {
    notify(e.message);
  } finally {
    busy = false;
    $('plan-apply').disabled = false;
  }
};
function revert() {
  if (!adopted) return;
  booths.items = booths.items.filter((i) => !adopted.ids.has(i.id));
  data().routes = adopted.routes;
  adopted = null;
  booths.selectedId = null;
  booths.selectedIds.clear();
  $('plan-revert').hidden = true;
  reset();
  notify('已撤销本版摊位，可保存当前活动。');
  render();
}
$('plan-revert').onclick = revert;
window.addEventListener(
  'keydown',
  (e) => {
    if (
      adopted &&
      !mode &&
      !e.shiftKey &&
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === 'z' &&
      !document.querySelector('dialog[open]') &&
      !e.target.closest?.('input,textarea,select,[contenteditable=true]')
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      revert();
    }
  },
  true
);
window.plannerUI = {
  snapshotSettings() {
    if (!planningData) return undefined;
    // Save effective defaults as well as edited fields. Preview candidates
    // remain transient; adopted booths already belong to the project items.
    const plan = structuredClone(planningData);
    plan.aisles = { min: spec().min };
    return plan;
  },
  draw,
  reset,
  newBase() {
    close();
    discard();
    adopted = null;
    $('plan-revert').hidden = true;
    visibleMarks = null;
  }
};
