// Keep the existing controls and global tool handlers; grouping changes no project data.
(() => {
  const tabs = [...document.querySelectorAll('[data-toolbar-group]')];
  const groups = {
    booth: 'layout', guard: 'layout', fire: 'layout',
    arrow: 'draw', zone: 'draw', line: 'draw', measure: 'draw', dim: 'draw', area: 'draw', eraser: 'draw',
    _calib: 'files', crop: 'view',
  };
  const names = { select: '选择', booth: '放置摊位', guard: '安保', fire: '灭火器', arrow: '动线', zone: '文字', line: '画线', measure: '测距', dim: '标距', area: '测面积', eraser: '橡皮擦', _calib: '定比例尺', crop: '截取导出', 'photo-camera': '标注拍摄位置' };
  function showGroup(group, focus = false) {
    tabs.forEach(tab => {
      const active = tab.dataset.toolbarGroup === group;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
      if (active && focus) tab.focus();
    });
  }
  function showLayoutTab(name, focus = false) {
    for (const key of ['booths', 'components']) {
      const tab = document.getElementById('layout-tab-' + key), active = key === name;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      document.getElementById('layout-' + key).hidden = !active;
      if (active && focus) tab.focus();
    }
    window.dispatchEvent(new CustomEvent('needflea-layout-tab-changed', { detail: { tab: name } }));
  }
  for (const key of ['booths', 'components']) {
    const tab = document.getElementById('layout-tab-' + key);
    tab.onclick = () => showLayoutTab(key);
    tab.onkeydown = e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      showLayoutTab(e.key === 'Home' ? 'booths' : e.key === 'End' ? 'components' : key === 'booths' ? 'components' : 'booths', true);
    };
  }
  window.toolbarUI = { showGroup, showLayoutTab };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => showGroup(tab.dataset.toolbarGroup));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      showGroup(tabs[next].dataset.toolbarGroup, true);
    });
  });
  window.addEventListener('needflea-tool-changed', event => {
    const tool = event.detail.tool;
    document.getElementById('toolbar-current-tool').textContent = '当前：' + (names[tool] || '环境编辑');
    if (groups[tool]) showGroup(groups[tool]);
    if (['booth', 'guard', 'fire'].includes(tool)) showLayoutTab('booths');
  });
})();
