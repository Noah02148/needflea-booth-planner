import * as THREE from 'three';
import { OrbitControls } from './vendor/three/OrbitControls.js';

// CAD (X,Y-up) -> Three (X,Y-height,Z), rebased near the venue centre.
export class VenueScene {
  constructor(host, onGroundClick) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
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
    this.ray = new THREE.Raycaster();
    this.renderer.domElement.addEventListener('pointerdown', e => { this.down = [e.clientX, e.clientY]; });
    this.renderer.domElement.addEventListener('pointerup', e => {
      if (e.button !== 0 || !this.down || Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) > 4) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), this.camera);
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
    this.camera.near = Math.max(0.01, this.span / 10000);
    this.camera.far = this.span * 100;
    const distance = this.span / Math.min(1, this.host.clientWidth / Math.max(1, this.host.clientHeight));
    this.camera.position.set(distance * 0.9, distance * 1.1, distance * 1.1);
    this.controls.target.set(0, 0, 0);
    this.camera.updateProjectionMatrix(); this.controls.update(); this.fitted = true;
  }

  exportPNG() {
    this.draw();
    const a = document.createElement('a'); a.download = 'NEEDFLEA_environment.png';
    a.href = this.renderer.domElement.toDataURL('image/png'); a.click();
  }
}
