import * as THREE from 'three';
import { OrbitControls } from './vendor/three/OrbitControls.js';

// CAD (X,Y-up) -> Three (X,Y-height,Z), rebased near the venue centre.
export class VenueScene {
  constructor(host, onGroundClick, onMarbleStatus = () => {}) {
    this.host = host;
    this.onMarbleStatus = onMarbleStatus;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 20000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.addEventListener('change', () => this.draw());
    this.marbleView = 'overview';
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '三维场景：拖动环顾，滚轮前后移动，WASD 移动，R/F 升降');
    this.walkKeys = new Set();
    canvas.addEventListener('keydown', e => {
      if (this.marbleView !== 'inside' || !['KeyW','KeyA','KeyS','KeyD','KeyR','KeyF'].includes(e.code)) return;
      e.preventDefault(); this.walkKeys.add(e.code);
    });
    canvas.addEventListener('keyup', e => this.walkKeys.delete(e.code));
    canvas.addEventListener('blur', () => this.walkKeys.clear());
    canvas.addEventListener('pointermove', e => {
      if (this.marbleView !== 'inside' || !this.down || !e.buttons) return;
      const rotation = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
      rotation.y -= (e.clientX - this.lookX) * .003;
      rotation.x = THREE.MathUtils.clamp(rotation.x - (e.clientY - this.lookY) * .003, -1.5, 1.5);
      this.camera.quaternion.setFromEuler(rotation);
      this.lookX = e.clientX; this.lookY = e.clientY; this.draw();
    });
    canvas.addEventListener('wheel', e => {
      if (this.marbleView !== 'inside') return;
      e.preventDefault(); this.camera.translateZ(THREE.MathUtils.clamp(e.deltaY * .005, -1, 1)); this.draw();
    }, { passive: false });
    this.ray = new THREE.Raycaster();
    this.renderer.domElement.addEventListener('pointerdown', e => { this.down = [e.clientX, e.clientY]; this.lookX = e.clientX; this.lookY = e.clientY; canvas.focus({ preventScroll: true }); });
    this.renderer.domElement.addEventListener('pointerup', e => {
      if (e.button !== 0 || !this.down || Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) > 4) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), this.camera);
      if (this.marblePick) {
        if (!this.marbleMesh || !this.marbleRoot?.visible) return;
        this.scene.updateMatrixWorld(true);
        const hit = this.ray.intersectObject(this.marbleMesh, false)[0];
        if (!hit) { this.onMarbleStatus('此处没有可选中的场景，请选择清晰可见的墙角或柱脚。'); return; }
        const point = this.marbleRoot.worldToLocal(hit.point.clone()), callback = this.marblePick;
        this.marblePick = null; callback(point); return;
      }
      if (this.marbleView === 'inside') return;
      const p = this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
      if (p && this.frame) onGroundClick({ x: p.x / this.frame.mpu + this.frame.cx, y: -p.z / this.frame.mpu + this.frame.cy });
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.draw();
  }

  draw() { this.renderer.render(this.scene, this.camera); }

  clear() {
    // Environment splats and their worker are cached separately from editable CAD objects.
    this.marbleRoot?.removeFromParent(); this.spark?.removeFromParent();
    this.scene.traverse(o => {
      o.geometry?.dispose();
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (!m) continue;
        m.map?.dispose();
        m.dispose();
      }
      if (o.isLight) o.shadow?.dispose();
    });
    this.scene.clear();
  }

  releaseMarble() {
    this.setMarbleView('overview');
    this.marbleController?.abort(); this.marbleController = null;
    this.marbleLoadToken = (this.marbleLoadToken || 0) + 1;
    this.marbleMesh?.dispose(); this.marbleRoot?.removeFromParent();
    this.marbleMesh = this.marbleRoot = null; this.marbleKey = null; this.marbleLoading = null;
    this.spark?.removeFromParent(); this.spark?.dispose(); this.spark = null;
    this.renderer.setAnimationLoop(null); this.marblePick = null;
  }

  async updateMarble(asset) {
    if (!asset) { this.releaseMarble(); this.onMarbleStatus(''); return; }
    const key = asset.spzUrls[asset.resolution];
    if (this.marbleKey !== key) {
      const previousView = this.marbleView;
      this.releaseMarble(); this.marbleKey = key; this.setMarbleView(previousView);
      const token = this.marbleLoadToken;
      const controller = this.marbleController = new AbortController();
      this.marbleLoading = (async () => {
        let mesh, monitor, timeout;
        const start = Date.now();
        const report = text => { if (token === this.marbleLoadToken && !controller.signal.aborted) this.onMarbleStatus(text); };
        const bounded = (promise, ms, label) => new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(label)), ms);
          const aborted = () => { clearTimeout(timer); reject(new DOMException('已取消加载', 'AbortError')); };
          controller.signal.addEventListener('abort', aborted, { once: true });
          if (controller.signal.aborted) aborted();
          promise.then(value => { clearTimeout(timer); controller.signal.removeEventListener('abort', aborted); resolve(value); }, err => { clearTimeout(timer); controller.signal.removeEventListener('abort', aborted); reject(err); });
        });
        try {
          report('① 正在加载场景渲染器…');
          const { SplatMesh, SparkRenderer } = await bounded(import('@sparkjsdev/spark'), 30000, '渲染器加载超过 30 秒，请检查本地服务后重试');
          if (controller.signal.aborted) throw new DOMException('已取消加载', 'AbortError');
          report('② 正在连接场景下载服务…可取消加载，生成结果会保留');
          timeout = setTimeout(() => controller.abort(), asset.resolution === 'full_res' ? 660000 : 150000);
          const url = new URL(key, location.href);
          if (/\/assets\/[a-f\d-]{36}\/(100k|500k|full_res)\.spz$/i.test(url.pathname)) {
            url.pathname = url.pathname.replace('/assets/', '/asset-status/');
            let checking = false;
            monitor = setInterval(async () => {
              if (checking || controller.signal.aborted) return;
              checking = true;
              try {
                const result = await fetch(url.href, { signal: AbortSignal.timeout(4000) });
                if (result.ok) {
                  const info = await result.json();
                  report(info.status === 'downloading' ? `② 服务正在下载场景：${(info.received / 1048576).toFixed(1)} MB${info.total ? ` / ${(info.total / 1048576).toFixed(1)} MB` : ''}` : info.status === 'failed' ? '② 场景下载失败，正在结束加载；稍后可重试原结果' : `② 正在等待场景 CDN 响应 · 已用 ${Math.floor((Date.now() - start) / 1000)} 秒`);
                }
              } catch { /* The primary asset request reports errors; status polling is advisory. */ }
              finally { checking = false; }
            }, 1500);
          }
          const response = await fetch(key, { signal: controller.signal });
          if (!response.ok) { let detail; try { detail = (await response.json()).error; } catch { /* Not a JSON response. */ } throw new Error(detail || `场景下载失败（HTTP ${response.status}）`); }
          clearInterval(monitor); monitor = null;
          const reader = response.body.getReader(), chunks = []; let received = 0;
          const total = Number(response.headers.get('content-length'));
          try {
            while (true) {
              const { value, done } = await reader.read(); if (done) break;
              received += value.length;
              if (received > 250 * 1048576) { await reader.cancel(); throw new Error('场景超过 250MB，请选择轻量精度'); }
              chunks.push(value);
              report(`② 场景下载 ${total ? Math.round(received / total * 100) + '%' : (received / 1048576).toFixed(1) + ' MB'}`);
            }
          } finally { reader.releaseLock(); }
          clearTimeout(timeout); timeout = null;
          const bytes = new Uint8Array(received); let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          report(`③ 正在解码 ${(received / 1048576).toFixed(1)} MB 场景…`);
          mesh = new SplatMesh({ fileBytes: bytes, fileName: 'marble.spz', raycastable: true, lod: false });
          // A decoder may settle after cancellation. Dispose its late result too.
          mesh.initialized.then(() => { if (token !== this.marbleLoadToken || controller.signal.aborted) mesh.dispose(); }, () => {});
          await bounded(mesh.initialized, asset.resolution === 'full_res' ? 120000 : 45000, '场景解码超时，请切回标准精度或重试');
          if (controller.signal.aborted || token !== this.marbleLoadToken) { mesh.dispose(); return; }
          this.marbleMesh = mesh;
          this.marbleRoot = new THREE.Group();
          this.marbleRoot.name = 'MarbleEnvironment';
          const axes = new THREE.Group(); axes.rotation.x = Math.PI;
          const ground = new THREE.Group(); ground.position.y = -asset.groundOffset;
          mesh.scale.setScalar(asset.metricScale);
          ground.add(mesh); axes.add(ground); this.marbleRoot.add(axes);
          this.spark = new SparkRenderer({ renderer: this.renderer });
          this.renderer.setAnimationLoop(time => {
            const dt = Math.min(.05, Math.max(0, (time - (this.walkTime ?? time)) / 1000)); this.walkTime = time;
            if (this.host.hidden) return;
            if (this.marbleView === 'inside' && document.activeElement === this.renderer.domElement) {
              const speed = 2 * dt;
              this.camera.translateX(((this.walkKeys.has('KeyD') ? 1 : 0) - (this.walkKeys.has('KeyA') ? 1 : 0)) * speed);
              this.camera.translateZ(((this.walkKeys.has('KeyS') ? 1 : 0) - (this.walkKeys.has('KeyW') ? 1 : 0)) * speed);
              this.camera.position.y += ((this.walkKeys.has('KeyR') ? 1 : 0) - (this.walkKeys.has('KeyF') ? 1 : 0)) * speed;
            }
            this.draw();
          });
          report('④ Marble 场景已加载。请对照 CAD 检查比例、地面和对应柱位。');
        } catch (err) {
          mesh?.dispose();
          if (token === this.marbleLoadToken) { this.marbleKey = null; this.onMarbleStatus(controller.signal.aborted ? '场景加载已取消或超时，生成结果仍可从历史任务加载。' : `场景加载失败：${err.message}。可重试原任务，无需重新生成。`); }
          throw err;
        } finally { clearTimeout(timeout); clearInterval(monitor); }
      })();
    }
    await this.marbleLoading;
    if (this.marbleKey !== key || !this.marbleRoot) return;
    const t = asset.transform;
    this.marbleRoot.position.copy(this.position(t.x, t.y, t.height));
    this.marbleRoot.rotation.y = t.angle * Math.PI / 180;
    this.marbleRoot.scale.setScalar(t.scale); this.marbleRoot.visible = asset.visible;
    // Metadata can change even when the same resource URL is reused.
    this.marbleRoot.children[0].children[0].position.y = -asset.groundOffset;
    this.marbleMesh.scale.setScalar(asset.metricScale);
    this.scene.add(this.marbleRoot, this.spark); this.setMarbleView(this.marbleView); this.draw();
  }

  position(x, y, height = 0) {
    return new THREE.Vector3((x - this.frame.cx) * this.frame.mpu, height, -(y - this.frame.cy) * this.frame.mpu);
  }

  box(parent, w, h, d, color, x = 0, y = h / 2, z = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  floorPattern(env, w, d) {
    if (!env.floorPattern || env.floorPattern === 'plain') return null;
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const ctx = c.getContext('2d'); ctx.fillStyle = env.floorColor; ctx.fillRect(0, 0, 256, 256);
    if (env.floorPattern === 'tile') {
      ctx.strokeStyle = '#00000025'; ctx.lineWidth = 3; ctx.strokeRect(1, 1, 254, 254);
    } else if (env.floorPattern === 'wood') {
      ctx.strokeStyle = '#00000028'; ctx.lineWidth = 2;
      for (let y = 0; y < 256; y += 32) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.moveTo((y * 7) % 256, y); ctx.lineTo((y * 7) % 256, y + 32); ctx.stroke();
        for (let k = 0; k < 5; k++) { ctx.fillStyle = k % 2 ? '#ffffff0c' : '#0000000c'; ctx.fillRect(0, y + k * 6, 256, 1); }
      }
    } else {
      let seed = 17;
      for (let i = 0; i < 8000; i++) {
        seed = (seed * 16807) % 2147483647; const x = seed % 256;
        seed = (seed * 16807) % 2147483647; const y = seed % 256;
        ctx.fillStyle = i % 2 ? '#ffffff0d' : '#0000000d'; ctx.fillRect(x, y, 2, 2);
      }
    }
    const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(w / env.floorTileMeters, d / env.floorTileMeters);
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return texture;
  }

  label(text, position, color = '#263c37', size = 1.1) {
    if (!text) return;
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fffffff2'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 64px "PingFang SC", sans-serif';
    ctx.fillText(String(text).slice(0, 40), 256, 64, 490);
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
    sprite.position.copy(position); sprite.scale.set(size * 2, size / 2, 1);
    sprite.renderOrder = 10;
    this.scene.add(sprite);
  }

  async update(data, fit = false) {
    const generation = this.generation = (this.generation || 0) + 1;
    this.clear();
    const { bounds: b, mpu, environment: env } = data;
    this.frame = { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, mpu };
    const w = Math.max(1, (b.maxX - b.minX) * mpu), d = Math.max(1, (b.maxY - b.minY) * mpu);
    this.span = Math.max(w, d, ...env.objects.map(o => o.height * 1.5), 10);
    this.scene.background = new THREE.Color(data.dark ? '#20282c' : '#edf0ed');
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x7b8276, 2));
    const sun = new THREE.DirectionalLight(0xfff3dc, 3);
    sun.position.set(this.span * 0.3, this.span, this.span * 0.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -this.span, right: this.span, top: this.span, bottom: -this.span, near: 0.1, far: this.span * 4 });
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
    const ground = this.box(this.scene, w + 2, 0.15, d + 2, env.floorColor, 0, -0.09, 0);
    ground.visible = !env.marble?.visible || env.showPlan;
    const pattern = this.floorPattern(env, w + 2, d + 2);
    if (pattern) { ground.material.map = pattern; ground.material.color.set('#ffffff'); }
    if (data.floorImage && env.showPlan) {
      const texture = new THREE.Texture(data.floorImage);
      texture.needsUpdate = true; texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }));
      plane.rotation.x = -Math.PI / 2;
      plane.position.y = 0.005;
      plane.receiveShadow = true;
      this.scene.add(plane);
    }
    for (const item of env.objects) {
      if (!env.showStructures) continue;
      const group = new THREE.Group();
      group.position.copy(this.position(item.x, item.y));
      group.rotation.y = (item.angle || 0) * Math.PI / 180;
      this.box(group, item.width, item.height, item.depth, item.color || env.wallColor);
      this.scene.add(group);
    }
    env.photos.forEach((photo, i) => {
      if (!photo.camera) return;
      const c = photo.camera, origin = this.position(c.x, c.y, 0.18);
      const direction = this.position(c.targetX, c.targetY, 0.18).sub(origin).normalize();
      this.scene.add(new THREE.ArrowHelper(direction, origin, 1.8, 0x087a99, 0.4, 0.25));
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: '#087a99' }));
      marker.position.copy(origin); this.scene.add(marker);
      this.label(`P${i + 1}`, origin.clone().add(new THREE.Vector3(0, 0.5, 0)), '#087a99', 0.45);
    });
    for (const b of data.booths.items) {
      if (b.type !== 'booth') continue;
      const mw = b.ww * mpu, md = b.wh * mpu, color = data.booths.catColor(b.cat).fill;
      const group = new THREE.Group();
      group.position.copy(this.position(b.wx + b.ww / 2, b.wy + b.wh / 2));
      group.rotation.y = (b.angle || 0) * Math.PI / 180;
      this.box(group, mw, 0.025, md, color, 0, 0.035, 0);
      const style = b.boothStyle || 'tent';
      if (style !== 'table') {
        const composite = style.endsWith('-yard');
        const fw = composite ? Math.min(2, mw) : mw, fd = composite ? Math.min(2, md) : md;
        const corner = b.tentCorner || { sx: -1, sy: 1 };
        const ox = composite ? corner.sx * (mw - fw) / 2 : 0;
        const oz = composite ? -corner.sy * (md - fd) / 2 : 0;
        for (const x of [-fw / 2, fw / 2]) for (const z of [-fd / 2, fd / 2]) this.box(group, 0.055, 2, 0.055, '#a5aaa8', x + ox, 1, z + oz);
        for (const z of [-fd / 2, fd / 2]) this.box(group, fw, 0.055, 0.055, '#969f9b', ox, 2, z + oz);
        for (const x of [-fw / 2, fw / 2]) this.box(group, 0.055, 0.055, fd, '#969f9b', x + ox, 2, oz);
        if (style.startsWith('canopy')) {
          const geometry = new THREE.ConeGeometry(1, 0.6, 4);
          geometry.rotateY(Math.PI / 4); geometry.scale(fw / Math.SQRT2, 1, fd / Math.SQRT2);
          const roof = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#f4eddb', side: THREE.DoubleSide }));
          roof.position.set(ox, 2.3, oz); roof.castShadow = true; group.add(roof);
        }
      }
      this.scene.add(group);
      this.label(b.label, this.position(b.wx + b.ww / 2, b.wy + b.wh / 2, style === 'table' ? 0.3 : 2.8), color, Math.min(mw * 0.35, 0.75));
    }
    for (const item of data.booths.items) {
      if (item.type === 'zone' || item.type === 'guard' || item.type === 'fire') {
        this.label(item.label || (item.type === 'guard' ? '安保' : item.type === 'fire' ? '灭火器' : ''), this.position(item.wx, item.wy, 0.2));
      } else {
        let pts = item.type === 'arrow' || item.type === 'dim' ? [[item.wx1, item.wy1], [item.wx2, item.wy2]] : item.type === 'line' ? item.pts.map(p => [p.wx, p.wy]) : null;
        if (!pts) continue;
        if (item.closed) pts = [...pts, pts[0]];
        const points = pts.map(p => this.position(p[0], p[1], 0.06));
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: item.type === 'arrow' ? '#28ba78' : '#687572' }));
        this.scene.add(line);
        if (item.type === 'arrow' && points.length === 2) {
          const dir = points[1].clone().sub(points[0]);
          if (dir.length() > 0) this.scene.add(new THREE.ArrowHelper(dir.clone().normalize(), points[0], dir.length(), 0x28ba78, Math.min(0.7, dir.length() / 3), 0.35));
        }
        if (item.type === 'dim') this.label(item.label, points[0].clone().add(points[1]).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.3, 0)));
      }
    }
    if (fit || !this.fitted) this.fit();
    this.resize();
    await this.updateMarble(env.marble);
    if (generation !== this.generation) return;
    // Optional floor close-up, repeated at a known physical tile size.
    if (env.floorTexture) {
      try {
        const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = env.floorTexture; });
        if (generation !== this.generation) return;
        const texture = new THREE.Texture(image); texture.needsUpdate = true; texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set((w + 2) / env.textureMeters, (d + 2) / (env.textureMeters * image.height / image.width));
        ground.material.map?.dispose(); ground.material.map = texture; ground.material.color.set('#ffffff'); ground.material.needsUpdate = true; this.draw();
      } catch { /* The plan remains usable if a stored texture cannot decode. */ }
    }
  }

  fit() {
    this.setMarbleView('overview'); this.camera.fov = 40;
    this.camera.near = Math.max(0.01, this.span / 10000);
    this.camera.far = this.span * 100;
    const distance = this.span / Math.min(1, this.host.clientWidth / Math.max(1, this.host.clientHeight));
    this.camera.position.set(distance * 0.9, distance * 1.1, distance * 1.1);
    this.controls.target.set(0, 0, 0);
    this.camera.updateProjectionMatrix(); this.controls.update(); this.fitted = true;
  }

  fitMarble() {
    if (!this.marbleMesh || !this.marbleRoot?.visible) return;
    this.setMarbleView('overview'); this.camera.fov = 40;
    this.scene.updateMatrixWorld(true);
    const box = this.marbleMesh.getBoundingBox().clone().applyMatrix4(this.marbleMesh.matrixWorld);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const distance = Math.max(size.x, size.y, size.z, 2) / Math.min(1, this.camera.aspect);
    this.camera.position.copy(center).add(new THREE.Vector3(distance * 0.9, distance * 0.8, distance * 1.1));
    this.controls.target.copy(center); this.camera.updateProjectionMatrix(); this.controls.update(); this.draw();
  }

  setMarbleView(mode) {
    this.marbleView = mode; this.controls.enabled = mode !== 'inside'; this.walkKeys?.clear();
    // Keep saved visibility intact. This is a temporary viewing mode, never project data.
    for (const child of this.scene.children) {
      if (child === this.marbleRoot || child === this.spark || child.isLight) continue;
      if (mode === 'inside') {
        if (child.userData.marbleViewVisible === undefined) child.userData.marbleViewVisible = child.visible;
        child.visible = false;
      } else if (child.userData.marbleViewVisible !== undefined) {
        child.visible = child.userData.marbleViewVisible; delete child.userData.marbleViewVisible;
      }
    }
  }

  enterMarble() {
    if (!this.marbleMesh || !this.marbleRoot?.visible) return;
    this.scene.updateMatrixWorld(true); this.setMarbleView('inside');
    // World Labs' viewing origin is raw (0,0,0), not the splat bounding-box centre.
    this.camera.position.copy(this.marbleMesh.localToWorld(new THREE.Vector3()));
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.marbleRoot.quaternion);
    this.camera.up.set(0, 1, 0); this.camera.lookAt(this.camera.position.clone().add(direction));
    this.camera.fov = 65; this.camera.near = .03; this.camera.far = Math.max(1000, this.span * 10);
    this.camera.updateProjectionMatrix(); this.draw();
  }

  exportPNG() {
    this.draw();
    const a = document.createElement('a'); a.download = 'NEEDFLEA_environment.png';
    a.href = this.renderer.domElement.toDataURL('image/png'); a.click();
  }
}
