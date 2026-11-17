import * as THREE from 'three';
import { OrbitControls } from './vendor/three/OrbitControls.js';

// CAD (X,Y-up) -> Three (X,Y-height,Z), rebased near the venue centre.
export class VenueScene {
  constructor(host, onGroundClick, onContextClick) {
    this.host = host;
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
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0; canvas.setAttribute('aria-label', '三维场景，画布聚焦后 WASD 平移，拖动旋转，滚轮缩放，右键平移');
    this.navigationKeys = new Set(); this.navigationFrame = null; this.navigationTime = 0;
    const movementKeys = new Set(['KeyW','KeyA','KeyS','KeyD']);
    canvas.addEventListener('keydown', e => {
      if (!movementKeys.has(e.code)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) { this.stopNavigation(); return; }
      if (!this.canNavigate()) return;
      e.preventDefault(); e.stopPropagation(); this.navigationKeys.add(e.code);
      if (this.navigationFrame === null) {
        this.navigationTime = performance.now();
        this.navigationFrame = requestAnimationFrame(time => this.navigate(time));
      }
    });
    canvas.addEventListener('keyup', e => {
      if (!movementKeys.has(e.code)) return;
      e.preventDefault(); e.stopPropagation(); this.navigationKeys.delete(e.code);
      if (!this.navigationKeys.size) this.stopNavigation();
    });
    canvas.addEventListener('blur', () => this.stopNavigation());
    window.addEventListener('blur', () => this.stopNavigation());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.stopNavigation(); });
    this.ray = new THREE.Raycaster();
    this.renderer.domElement.addEventListener('pointerdown', e => { this.down = [e.clientX, e.clientY]; canvas.focus({ preventScroll: true }); });
    this.renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
    this.renderer.domElement.addEventListener('pointerup', e => {
      if (![0, 2].includes(e.button) || !this.down || Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) > 4) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), this.camera);
      const p = this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
      let picked;
      for (const hit of this.ray.intersectObjects(this.scene.children, true)) {
        let object = hit.object;
        while (object && !object.userData.objectId && !object.userData.boothId) object = object.parent;
        if (object) { picked = object.userData.boothId ? { kind: 'booth', id: object.userData.boothId } : { kind: 'component', id: object.userData.objectId }; break; }
      }
      if (p && this.frame) {
        const point = { x: p.x / this.frame.mpu + this.frame.cx, y: -p.z / this.frame.mpu + this.frame.cy };
        if (e.button === 2) onContextClick?.(point.x, point.y, picked || { kind: 'empty' });
        else onGroundClick(point, picked);
      }
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
  }

  canNavigate() {
    return document.activeElement === this.renderer.domElement && !this.host.hidden && this.host.isConnected && !document.hidden;
  }

  stopNavigation() {
    this.navigationKeys.clear();
    if (this.navigationFrame !== null) cancelAnimationFrame(this.navigationFrame);
    this.navigationFrame = null; this.navigationTime = 0;
  }

  navigate(time) {
    this.navigationFrame = null;
    if (!this.canNavigate() || !this.navigationKeys.size) { this.stopNavigation(); return; }
    const dt = Math.min(.05, Math.max(0, (time-this.navigationTime)/1000)); this.navigationTime = time;
    const forward = this.camera.getWorldDirection(new THREE.Vector3()); forward.y = 0;
    if (forward.lengthSq() < 1e-8) { forward.set(0,1,0).applyQuaternion(this.camera.quaternion); forward.y = 0; }
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0)).normalize();
    const x = Number(this.navigationKeys.has('KeyD'))-Number(this.navigationKeys.has('KeyA'));
    const z = Number(this.navigationKeys.has('KeyW'))-Number(this.navigationKeys.has('KeyS'));
    if (x || z) {
      const speed = THREE.MathUtils.clamp(this.camera.position.distanceTo(this.controls.target)*.35,1.2,35);
      const delta = forward.multiplyScalar(z).addScaledVector(right,x).normalize().multiplyScalar(speed*dt);
      this.camera.position.add(delta); this.controls.target.add(delta);
      this.controls.update(); this.draw();
    }
    this.navigationFrame = requestAnimationFrame(next => this.navigate(next));
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
      if (o.isInstancedMesh) o.dispose();
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

  // Parametric ringlock scaffold, based on the supplied 2x2m reference.
  // Nominal width/depth stay at the post centres; only the base plates project out.
  ringlock(parent, width, depth, height, offsetX = 0, offsetZ = 0) {
    const frame = new THREE.Group(); frame.name = 'ringlock-frame';
    frame.position.set(offsetX, 0, offsetZ); parent.add(frame);
    if (!this.metalEnvironment) {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
      const ctx = canvas.getContext('2d'), gradient = ctx.createLinearGradient(0, 0, 0, 128);
      for (const [stop, color] of [[0,'#ffffff'],[.3,'#d7dfe2'],[.47,'#ffffff'],[.52,'#35444f'],[.65,'#c0c8cc'],[1,'#929ca2']]) gradient.addColorStop(stop,color);
      ctx.fillStyle = gradient; ctx.fillRect(0,0,256,128);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(32,0,18,128); ctx.fillRect(165,0,10,128);
      this.metalEnvironment = new THREE.CanvasTexture(canvas);
      this.metalEnvironment.mapping = THREE.EquirectangularReflectionMapping;
      this.metalEnvironment.colorSpace = THREE.SRGBColorSpace;
    }
    const steel = new THREE.MeshStandardMaterial({ color:'#b9c3ca', metalness:.92, roughness:.18, envMap:this.metalEnvironment, envMapIntensity:.9 });
    const jointSteel = new THREE.MeshStandardMaterial({ color:'#a2adb4', metalness:.8, roughness:.32, envMap:this.metalEnvironment });
    const inside = new THREE.MeshStandardMaterial({ color:'#364048', roughness:.8, side:THREE.DoubleSide });
    const upper = height - .18, lower = height - .78;
    const corners = [[-width/2,-depth/2],[width/2,-depth/2],[width/2,depth/2],[-width/2,depth/2]];
    const mesh = (geometry, material, name, x, y, z) => {
      const part = new THREE.Mesh(geometry,material); part.name = name;
      part.position.set(x,y,z); part.castShadow = part.receiveShadow = true; frame.add(part); return part;
    };
    const cylinder = (radius, length, x, y, z, material = steel, name = 'ringlock-collar', open = false) => mesh(new THREE.CylinderGeometry(radius,radius,length,32,1,open),material,name,x,y,z);
    const plate = (radius, thickness, holeCount, holeRadius, boltCircle) => {
      const shape = new THREE.Shape(); shape.absarc(0,0,radius,0,Math.PI*2,false);
      const centre = new THREE.Path(); centre.absarc(0,0,.025,0,Math.PI*2,true); shape.holes.push(centre);
      for (let i=0;i<holeCount;i++) {
        const a=i*Math.PI*2/holeCount, hole=new THREE.Path();
        hole.absarc(Math.cos(a)*boltCircle,Math.sin(a)*boltCircle,holeRadius,0,Math.PI*2,true); shape.holes.push(hole);
      }
      const geometry = new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:false,curveSegments:12});
      geometry.rotateX(-Math.PI/2); return geometry;
    };
    // Reuse each part geometry within this frame instead of rebuilding every joint.
    const baseGeometry = plate(.085,.012,4,.008,.062);
    const rosetteGeometry = plate(.052,.006,8,.0065,.039);
    for (const [x,z] of corners) {
      mesh(baseGeometry,steel,'ringlock-base',x,.002,z);
      cylinder(.034,.085,x,.056,z,jointSteel);
      cylinder(.024,height-.014,x,(height+.014)/2,z,steel,'ringlock-post',true);
      // A recessed dark bore and a narrow rim make the exposed post ends hollow.
      const bore = mesh(new THREE.CircleGeometry(.019,16),inside,'ringlock-bore',x,height-.022,z); bore.rotation.x=-Math.PI/2;
      const rim = mesh(new THREE.RingGeometry(.019,.024,16),steel,'ringlock-rim',x,height,z); rim.rotation.x=-Math.PI/2;
      for (const level of [lower,upper]) {
        mesh(rosetteGeometry,jointSteel,'ringlock-rosette',x,level-.003,z);
        cylinder(.031,.045,x,level+.029,z,jointSteel);
      }
    }
    const up = new THREE.Vector3(0,1,0);
    const ledger = (a,b,level) => {
      const start=new THREE.Vector3(a[0],level+.022,a[1]), end=new THREE.Vector3(b[0],level+.022,b[1]);
      const direction=end.clone().sub(start), centre=start.clone().add(end).multiplyScalar(.5);
      const bar=cylinder(.021,direction.length(),centre.x,centre.y,centre.z,steel,'ringlock-ledger');
      bar.quaternion.setFromUnitVectors(up,direction.normalize());
      for (const point of [start,end]) {
        const head=mesh(new THREE.BoxGeometry(.055,.064,.045),jointSteel,'ringlock-ledger-head',point.x,point.y,point.z);
        head.quaternion.copy(bar.quaternion);
      }
    };
    for (let i=0;i<4;i++) ledger(corners[i],corners[(i+1)%4],upper);
    // The entry side (+Z) stays open: there are no ground-level crossbars.
    for (const i of [0,1,3]) ledger(corners[i],corners[(i+1)%4],lower);
    return this.batchHardware(frame);
  }

  batchHardware(frame) {
    // Merge repeated hardware into instanced draws; all parts still inherit booth picking.
    const batches = new Map();
    for (const part of frame.children) {
      if (!part.isMesh) continue;
      const signature = part.geometry.type === 'ExtrudeGeometry' ? part.geometry.uuid : JSON.stringify(part.geometry.parameters);
      const key = `${part.name}:${part.geometry.type}:${signature}:${part.material.uuid}`;
      if (!batches.has(key)) batches.set(key,[]);
      batches.get(key).push(part);
    }
    for (const parts of batches.values()) {
      if (parts.length < 2) continue;
      const first=parts[0], batch=new THREE.InstancedMesh(first.geometry,first.material,parts.length);
      batch.name=first.name; batch.castShadow=batch.receiveShadow=true;
      parts.forEach((part,i) => {
        part.updateMatrix(); batch.setMatrixAt(i,part.matrix); frame.remove(part);
        if (part.geometry !== first.geometry) part.geometry.dispose();
      });
      batch.instanceMatrix.needsUpdate=true; batch.computeBoundingSphere(); frame.add(batch);
    }
    return frame;
  }

  // Open folding tent: telescopic square posts and exposed scissor trusses.
  // Keep canopy/canopy-yard IDs for projects saved before the visible rename.
  openTent(parent, width, depth, height, offsetX = 0, offsetZ = 0, trussDepth = .41) {
    const frame = new THREE.Group(); frame.name='open-tent-frame';
    frame.position.set(offsetX,0,offsetZ); parent.add(frame);
    const paint = new THREE.MeshStandardMaterial({color:'#e0e4e5',metalness:.35,roughness:.35});
    const fittings = new THREE.MeshStandardMaterial({color:'#b5bdc1',metalness:.65,roughness:.3});
    const outline = new THREE.LineBasicMaterial({color:'#6e797f',transparent:true,opacity:.65});
    const upper=height-.04, lower=upper-trussDepth;
    const corners=[[-width/2,-depth/2],[width/2,-depth/2],[width/2,depth/2],[-width/2,depth/2]];
    const box=(w,h,d,x,y,z,name,material=paint) => {
      const mesh=this.box(frame,w,h,d,material.color,x,y,z);
      mesh.material.dispose(); mesh.material=material; mesh.name=name; return mesh;
    };
    const up=new THREE.Vector3(0,1,0);
    const rod=(a,b) => {
      const start=new THREE.Vector3(...a), end=new THREE.Vector3(...b), direction=end.clone().sub(start);
      const centre=start.clone().add(end).multiplyScalar(.5);
      const mesh=box(.022,direction.length(),.012,centre.x,centre.y,centre.z,'open-tent-scissor');
      mesh.quaternion.setFromUnitVectors(up,direction.normalize()); return mesh;
    };
    const pin=(x,y,z,alongX=false) => {
      const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.009,.009,.025,8),fittings);
      mesh.name='open-tent-pivot';mesh.position.set(x,y,z);
      mesh.rotation[alongX?'z':'x']=Math.PI/2;frame.add(mesh);
    };
    for(const [x,z] of corners) {
      box(.032,1.3,.032,x,.66,z,'open-tent-lower-post');
      const post=box(.044,height-1.2,.044,x,(height+1.2)/2,z,'open-tent-upper-post');
      const edges=new THREE.LineSegments(new THREE.EdgesGeometry(post.geometry),outline);
      edges.position.copy(post.position);frame.add(edges);
      for(const y of [.72,lower,upper]) box(.065,.07,.065,x,Math.min(y,height-.035),z,'open-tent-collar');
      const foot=new THREE.Mesh(new THREE.CylinderGeometry(.052,.052,.012,16),fittings);
      foot.name='open-tent-base';foot.position.set(x,.006,z);foot.receiveShadow=true;frame.add(foot);
      pin(x,lower,z+.04);pin(x,upper,z+.04);
    }
    const truss=(a,b) => {
      const alongX=Math.abs(a[0]-b[0])<1e-6;
      for(let i=0;i<2;i++) {
        const t=i/2,u=(i+1)/2;
        const x1=a[0]+(b[0]-a[0])*t,z1=a[1]+(b[1]-a[1])*t;
        const x2=a[0]+(b[0]-a[0])*u,z2=a[1]+(b[1]-a[1])*u;
        rod([x1,lower,z1],[x2,upper,z2]); rod([x1,upper,z1],[x2,lower,z2]);
        pin((x1+x2)/2,(lower+upper)/2,(z1+z2)/2,alongX);
        box(.035,.035,.035,x1,lower,z1,'open-tent-hub',fittings);
      }
    };
    for(let i=0;i<4;i++) truss(corners[i],corners[(i+1)%4]);
    truss([-width/2,0],[width/2,0]);truss([0,-depth/2],[0,depth/2]);
    // No fabric, roof faces, raised centre peak, or low perimeter rails.
    return this.batchHardware(frame);
  }

  roofedTent(parent, width, depth, frameHeight) {
    const height=frameHeight+.5, eaveBottom=frameHeight-.06, eaveTop=eaveBottom+.15;
    this.openTent(parent,width,depth,frameHeight);
    const fabric=new THREE.MeshStandardMaterial({color:'#f3f4f1',roughness:.9,side:THREE.DoubleSide});
    const corners=[[-width/2,-depth/2],[width/2,-depth/2],[width/2,depth/2],[-width/2,depth/2]];
    const surface=(t,u,a,b)=>[(a[0]+(b[0]-a[0])*u)*t,eaveTop+(height-eaveTop)*Math.pow(1-t,1.35),(a[1]+(b[1]-a[1])*u)*t];
    const seamPoints=[];
    for(let side=0;side<4;side++) {
      const a=corners[side],b=corners[(side+1)%4],positions=[],indices=[],rings=12,segments=8;
      for(let r=0;r<=rings;r++) for(let j=0;j<=segments;j++) positions.push(...surface(r/rings,j/segments,a,b));
      for(let r=0;r<rings;r++) for(let j=0;j<segments;j++) {
        const n=r*(segments+1)+j,m=n+segments+1;
        indices.push(n,m+1,m);if(r>0)indices.push(n,n+1,m+1);
      }
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
      const roof=new THREE.Mesh(geometry,fabric);roof.name='roofed-tent-fabric';roof.castShadow=roof.receiveShadow=true;parent.add(roof);
      const horizontal=Math.abs(a[1]-b[1])<1e-8;
      const valance=new THREE.Mesh(new THREE.BoxGeometry(horizontal?width:.012,.15,horizontal?.012:depth),fabric);
      valance.name='roofed-tent-valance';valance.position.set(horizontal?0:a[0]-Math.sign(a[0])*.006,eaveBottom+.075,horizontal?a[1]-Math.sign(a[1])*.006:0);
      valance.castShadow=valance.receiveShadow=true;parent.add(valance);
      for(let r=0;r<rings;r++) seamPoints.push(new THREE.Vector3(...surface(r/rings,0,a,b)),new THREE.Vector3(...surface((r+1)/rings,0,a,b)));
    }
    const seams=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seamPoints),new THREE.LineBasicMaterial({color:'#bfc5c6',transparent:true,opacity:.3}));
    seams.name='roofed-tent-seams';parent.add(seams);
  }

  boothFootprint(parent, width, depth, color, composite, frameWidth, frameDepth, ox, oz) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width,depth),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.1,depthWrite:false,side:THREE.DoubleSide}));
    plane.rotation.x=-Math.PI/2; plane.position.y=.003; parent.add(plane);
    const corners = [[-width/2,-depth/2],[width/2,-depth/2],[width/2,depth/2],[-width/2,depth/2],[-width/2,-depth/2]];
    const outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(corners.map(([x,z])=>new THREE.Vector3(x,.006,z))),new THREE.LineDashedMaterial({color,dashSize:.12,gapSize:.07,transparent:true,opacity:.65}));
    outline.computeLineDistances(); parent.add(outline);
    if (composite) {
      // A faint footprint, rather than a raised coloured deck, leaves the yard open.
      const points = [[-frameWidth/2,-frameDepth/2],[frameWidth/2,-frameDepth/2],[frameWidth/2,frameDepth/2],[-frameWidth/2,frameDepth/2],[-frameWidth/2,-frameDepth/2]];
      const border = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(([x,z])=>new THREE.Vector3(x+ox,.007,z+oz))),new THREE.LineDashedMaterial({color,dashSize:.09,gapSize:.06,transparent:true,opacity:.55}));
      border.computeLineDistances(); parent.add(border);
    }
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
    return sprite;
  }

  // Plan annotations are a separate ground layer, not camera-facing signboards.
  planAnnotation(item, pixelMeters, dark) {
    const group=new THREE.Group();group.name=`plan-annotation-${item.type}`;
    group.userData.boothId=item.id;group.userData.annotationType=item.type;
    group.position.y=.012;group.rotation.x=-Math.PI/2;
    const local=(x,y)=>new THREE.Vector2((x-this.frame.cx)*this.frame.mpu,(y-this.frame.cy)*this.frame.mpu);
    const color=dark?'#e6eceb':'#29332f';
    const material=value=>new THREE.MeshBasicMaterial({color:value,side:THREE.DoubleSide,depthTest:true,depthWrite:false});
    const stroke=(points,width,tint,dashed=false,dash=8*pixelMeters,gap=5*pixelMeters) => {
      if(points.length<2)return;
      const positions=[],total=points.slice(1).reduce((n,p,i)=>n+p.distanceTo(points[i]),0);
      const scale=Math.max(1,total/(Math.max(Number.EPSILON,dash+gap)*1000));dash*=scale;gap*=scale;
      const cycle=dash+gap;let traveled=0;
      const quad=(a,b)=>{
        const normal=b.clone().sub(a).normalize().rotateAround(new THREE.Vector2(),Math.PI/2).multiplyScalar(width/2);
        const a1=a.clone().add(normal),a2=a.clone().sub(normal),b1=b.clone().add(normal),b2=b.clone().sub(normal);
        for(const p of [a1,a2,b2,a1,b2,b1])positions.push(p.x,p.y,0);
      };
      for(let i=1;i<points.length;i++) {
        const a=points[i-1],b=points[i],length=a.distanceTo(b);if(length<1e-9)continue;
        const direction=b.clone().sub(a).normalize();
        if(!dashed)quad(a,b);
        else {
          let distance=0;
          while(distance<length-1e-8) {
            const phase=(traveled+distance)%cycle,on=phase<dash;
            const run=Math.min(length-distance,Math.max(1e-8,(on?dash:cycle)-phase));
            if(on)quad(a.clone().addScaledVector(direction,distance),a.clone().addScaledVector(direction,distance+run));
            distance+=run;
          }
        }
        traveled+=length;
      }
      if(!positions.length)return;
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();
      const mesh=new THREE.Mesh(geometry,material(tint));mesh.name='annotation-stroke';group.add(mesh);
    };
    const text=(value,point,fontPixels=14,tint=color,background=null)=>{
      if(!value)return;
      const lines=String(value).slice(0,2000).split(/\r?\n/).slice(0,30),font=96,padding=6,lineHeight=font*1.2;
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=`bold ${font}px "PingFang SC", sans-serif`;
      const width=Math.max(1,...lines.map(line=>ctx.measureText(line).width))+padding*2,height=lines.length*lineHeight+padding*2;
      const resolution=Math.min(1,4096/width,2048/height);canvas.width=Math.max(1,Math.ceil(width*resolution));canvas.height=Math.max(1,Math.ceil(height*resolution));
      ctx.scale(resolution,resolution);
      if(background){ctx.fillStyle=background;ctx.fillRect(0,0,width,height);}
      ctx.font=`bold ${font}px "PingFang SC", sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=tint;
      ctx.strokeStyle=dark?'#15201bcc':'#ffffffcc';ctx.lineWidth=font*.035;ctx.lineJoin='round';
      lines.forEach((line,i)=>{const y=padding+(i+.5)*lineHeight;ctx.strokeText(line,width/2,y);ctx.fillText(line,width/2,y);});
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
      texture.anisotropy=this.renderer.capabilities.getMaxAnisotropy();
      const unit=fontPixels*pixelMeters/font;
      const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width*unit,height*unit),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthTest:true,depthWrite:false,side:THREE.DoubleSide}));
      mesh.name='annotation-text';mesh.position.set(point.x,point.y,.003);group.add(mesh);
    };
    if(item.type==='zone') {
      const font=Number.isFinite(item.fontSize)?THREE.MathUtils.clamp(item.fontSize,8,60):14;
      text(item.label,local(item.wx,item.wy),font);
    } else if(item.type==='guard'||item.type==='fire') {
      text(item.label||(item.type==='guard'?'👮':'🧯'),local(item.wx,item.wy),20);
    } else if(item.type==='line'&&Array.isArray(item.pts)) {
      let points=item.pts.filter(p=>Number.isFinite(p.wx)&&Number.isFinite(p.wy)).map(p=>local(p.wx,p.wy));
      if(item.closed&&points.length>2)points=[...points,points[0]];
      stroke(points,2*pixelMeters,color,item.lineStyle==='dashed');
    } else if(item.type==='arrow'||item.type==='dim') {
      const a=local(item.wx1,item.wy1),b=local(item.wx2,item.wy2),length=a.distanceTo(b);
      if(length<1e-9)return;
      const direction=b.clone().sub(a).normalize(),normal=new THREE.Vector2(-direction.y,direction.x);
      if(item.type==='arrow') {
        stroke([a,b],2.5*pixelMeters,'#28b97b',true,10*pixelMeters,6*pixelMeters);
        const head=Math.min(16*pixelMeters,length*.35),base=b.clone().addScaledVector(direction,-head),half=Math.tan(.4)*head;
        const left=base.clone().addScaledVector(normal,half),right=base.clone().addScaledVector(normal,-half);
        const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([b.x,b.y,0,left.x,left.y,0,right.x,right.y,0],3));geometry.computeVertexNormals();
        const mesh=new THREE.Mesh(geometry,material('#28b97b'));mesh.name='annotation-arrowhead';group.add(mesh);
      } else {
        stroke([a,b],1.5*pixelMeters,color,true,6*pixelMeters,4*pixelMeters);
        const tick=6*pixelMeters;
        for(const p of [a,b])stroke([p.clone().addScaledVector(normal,-tick),p.clone().addScaledVector(normal,tick)],1.5*pixelMeters,color);
        const centre=a.clone().add(b).multiplyScalar(.5);centre.y+=12*pixelMeters;
        text(item.label,centre,12,color,dark?'#25302c':'#ffffff');
      }
    }
    if(group.children.length)this.scene.add(group);
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
    if (env.sitePlan && !data.floorImage) {
      // Concave measured boundaries stay geometrically accurate in 3D.
      this.scene.remove(ground); ground.geometry.dispose(); ground.material.map?.dispose(); ground.material.dispose();
      const shape = new THREE.Shape();
      env.sitePlan.points.forEach((p,i) => { const x=(p.x-this.frame.cx)*mpu, y=(p.y-this.frame.cy)*mpu; if(i) shape.lineTo(x,y); else shape.moveTo(x,y); }); shape.closePath();
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({color:env.floorColor, side:THREE.DoubleSide}));
      const uv=mesh.geometry.attributes.uv, positions=mesh.geometry.attributes.position;
      for(let i=0;i<uv.count;i++) uv.setXY(i,(positions.getX(i)+w/2)/w,(positions.getY(i)+d/2)/d);
      uv.needsUpdate=true;
      mesh.rotation.x = -Math.PI/2; mesh.receiveShadow=true; this.scene.add(mesh);
      // Reuse the polygon mesh for optional material loading below.
      ground.material = mesh.material;
      const map = this.floorPattern(env,w,d); if(map) mesh.material.map=map;
    }
    for (const item of env.objects) {
      if (!env.showStructures) continue;
      this.component(item, env);
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
      group.userData.boothId = b.id;
      group.position.copy(this.position(b.wx + b.ww / 2, b.wy + b.wh / 2));
      group.rotation.y = (b.angle || 0) * Math.PI / 180;
      const style = b.boothStyle || 'tent';
      const overallHeight = 2.5;
      if (style === 'table') this.box(group, mw, 0.025, md, color, 0, 0.035, 0);
      if (style !== 'table') {
        const composite = style.endsWith('-yard');
        const fw = composite ? Math.min(2, mw) : mw, fd = composite ? Math.min(2, md) : md;
        const corner = b.tentCorner || { sx: -1, sy: 1 };
        const ox = composite ? corner.sx * (mw - fw) / 2 : 0;
        const oz = composite ? -corner.sy * (md - fd) / 2 : 0;
        this.boothFootprint(group,mw,md,color,composite,fw,fd,ox,oz);
        if (style === 'roofed') this.roofedTent(group,fw,fd,overallHeight);
        else if (style === 'canopy' || style === 'canopy-yard') this.openTent(group,fw,fd,overallHeight,ox,oz);
        else this.ringlock(group,fw,fd,overallHeight,ox,oz);
      }
      this.scene.add(group);
      if (env.showLabels !== false) { const label=this.label(b.label, this.position(b.wx + b.ww / 2, b.wy + b.wh / 2, style === 'table' ? 0.3 : style === 'roofed' ? 3.3 : 2.8), color, Math.min(mw * 0.35, 0.75)); if(label) label.userData.boothId=b.id; }
    }
    if (env.showAnnotations !== false) {
      const pixelMeters=Number.isFinite(data.planPixelMeters)&&data.planPixelMeters>0?data.planPixelMeters:this.span/1200;
      const floorColor=new THREE.Color(env.floorColor);
      const floorIsDark=!(data.floorImage&&env.showPlan)&&(floorColor.r*.2126+floorColor.g*.7152+floorColor.b*.0722)<.25;
      for(const item of data.booths.items) if(item.type!=='booth') this.planAnnotation(item,pixelMeters,floorIsDark);
    }
    if (fit || !this.fitted) this.fit();
    this.resize();
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
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.camera.fov = 40;
    this.camera.near = Math.max(0.01, this.span / 10000);
    this.camera.far = this.span * 100;
    const distance = this.span / Math.min(1, this.host.clientWidth / Math.max(1, this.host.clientHeight));
    this.camera.position.set(distance * 0.9, distance * 1.1, distance * 1.1);
    this.controls.target.set(0, 0, 0);
    this.camera.updateProjectionMatrix(); this.controls.update(); this.fitted = true;
  }

  captureView() {
    return { position:this.camera.position.toArray(), target:this.controls.target.toArray(), fov:this.camera.fov };
  }

  restoreView(view) {
    this.controls.maxPolarAngle = Math.PI - 0.01;
    this.camera.position.fromArray(view.position); this.controls.target.fromArray(view.target);
    this.camera.fov=view.fov; this.camera.updateProjectionMatrix(); this.controls.update(); this.draw();
  }

  humanView() {
    this.controls.maxPolarAngle = Math.PI - 0.01;
    this.camera.position.set(0,1.65,Math.min(this.span*.35,12));
    this.controls.target.set(0,1.65,-Math.min(this.span*.2,8));
    this.camera.fov=60; this.camera.updateProjectionMatrix(); this.controls.update(); this.draw();
  }

  component(item, env) {
    const group=new THREE.Group(), w=item.width, d=item.depth, h=item.height, color=item.color||env.wallColor;
    group.userData.objectId = item.id;
    group.position.copy(this.position(item.x,item.y,item.elevation||0)); group.rotation.y=(item.angle||0)*Math.PI/180;
    if (item.type==='truss') {
      const t=Math.min(.12,w/8,d/8);
      for(const x of [-w/2+t/2,w/2-t/2]) for(const z of [-d/2+t/2,d/2-t/2]) this.box(group,t,h,t,color,x,h/2,z);
      for(const z of [-d/2+t/2,d/2-t/2]) this.box(group,w,t,t,color,0,h-t/2,z);
      for(const x of [-w/2+t/2,w/2-t/2]) this.box(group,t,t,d,color,x,h-t/2,0);
    } else if(item.type==='table') {
      this.box(group,w,Math.min(.08,h/5),d,color,0,h-.04,0);
      for(const x of [-w*.4,w*.4]) for(const z of [-d*.4,d*.4]) this.box(group,Math.min(.06,w/8),h,Math.min(.06,d/8),'#737b78',x,h/2,z);
    } else if(item.type==='sign') {
      this.box(group,w,h*.55,d,color,0,h*.725,0);
      for(const x of [-w*.35,w*.35]) this.box(group,Math.min(.06,w/8),h*.5,Math.max(.06,d),'#6e7872',x,h*.25,0);
    } else if(item.type==='tree') {
      this.box(group,Math.min(.35,w*.2),h*.6,Math.min(.35,d*.2),'#806247');
      const crown=new THREE.Mesh(new THREE.SphereGeometry(1,12,10),new THREE.MeshStandardMaterial({color:item.color||'#63834c',roughness:1}));
      crown.scale.set(w/2,h*.35,d/2); crown.position.y=h*.65; crown.castShadow=true; group.add(crown);
    } else if(item.type==='fence') {
      this.box(group,w,Math.min(.08,h/5),d,color,0,h,0);
      const n=Math.min(60,Math.max(2,Math.ceil(w/.3)));
      for(let i=0;i<=n;i++) this.box(group,Math.min(.04,w/10),h,d,color,-w/2+w*i/n,h/2,0);
    } else {
      this.box(group,w,h,d,color);
      if(item.type==='counter') this.box(group,w+.05,.04,d+.05,'#ededdf',0,h+.02,0);
    }
    this.scene.add(group);
    if(env.showLabels!==false && item.name) { const label=this.label(item.name,this.position(item.x,item.y,(item.elevation||0)+h+.3),'#30473d',Math.min(1,w*.3)); if(label) label.userData.objectId=item.id; }
  }

  exportPNG(width = 1920) {
    const size = this.renderer.getSize(new THREE.Vector2()), ratio=this.renderer.getPixelRatio(), aspect=this.camera.aspect;
    try {
      this.renderer.setPixelRatio(1); this.renderer.setSize(width, Math.round(width*9/16), false);
      this.camera.aspect=16/9; this.camera.updateProjectionMatrix(); this.draw();
      const a = document.createElement('a'); a.download = 'NEEDFLEA_environment.png';
      a.href = this.renderer.domElement.toDataURL('image/png'); a.click();
    } finally { this.renderer.setPixelRatio(ratio); this.renderer.setSize(size.x,size.y,false); this.camera.aspect=aspect; this.camera.updateProjectionMatrix(); this.draw(); }
  }
}
