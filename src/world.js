// three.js side of the game: loads the Blender exports, lights the shop, places cameras,
// mirrors sim entities as animated people/props and handles 3D picking.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { clamp, damp } from './util.js';

const TRANSPARENT = new Set(['Glass', 'GlassTint', 'Etched', 'Balloon', 'Tea', 'Ice', 'Baggie']);
const RECOLOR = { skin: 'Skin', shirt: 'Shirt', pants: 'Pants', hair: 'Hair', hat: 'Hat', shoes: 'Shoes' };
const ACCESSORIES = ['hair_short', 'hair_long', 'hair_bun', 'hair_curly', 'hat_beanie', 'hat_cap', 'glasses', 'beard',
  'apron'];

export function detectQuality() {
  const mobile = /Android|iPhone|iPad|iPod|Mobile|Quest|Pico/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  return mobile ? 'medium' : 'high';
}

export class World {
  constructor(canvas, layout, quality = 'high') {
    this.L = layout;
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.xr.enabled = true;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 400);
    this.dolly = new THREE.Group(); // VR rig; the camera lives inside so XR can move the player
    this.dolly.add(this.camera);
    this.scene.add(this.dolly);
    this.raycaster = new THREE.Raycaster();
    this.people = new Map();
    this.props = new Map();
    this.bubbles = new Map();
    this.proxies = [];
    this.nodes = {};
    this.upgrades = new Set();
    this.view = 'title';
    this.camTarget = { pos: new THREE.Vector3(12.5, 1.7, 8.4), look: new THREE.Vector3(2, 4.2, 7), fov: 55 };
    this.camLook = this.camTarget.look.clone();
    this.pan = 0;
    this.zoom = 1;
    this.orbit = 0;
    this.time = 0;
    this.hour = 21;
    this.iconCache = new Map();
    this.matCache = new Map();
    this._tmp = new THREE.Vector3();
  }

  resize(w, h, dpr) {
    const cap = this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.5 : 1;
    this.renderer.setPixelRatio(Math.min(dpr, cap));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.w = w;
    this.h = h;
  }

  async load(onProgress) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const files = ['assets/models/shop.glb', 'assets/models/people.glb', 'assets/models/props.glb'];
    const progress = files.map(() => 0);
    const report = () => onProgress?.(progress.reduce((a, b) => a + b, 0) / files.length);
    const [shop, people, props] = await Promise.all(files.map((f, i) => loader.loadAsync(f, (e) => {
      if (e.total) progress[i] = e.loaded / e.total;
      report();
    }).then((g) => {
      progress[i] = 1;
      report();
      return g;
    })));
    this._setupShop(shop.scene);
    this.personTemplate = people.scene;
    this.clips = Object.fromEntries(people.animations.map((a) => [a.name, a]));
    this.propTemplates = {};
    props.scene.traverse((o) => {
      if (o.name.startsWith('prop_')) this.propTemplates[o.name.slice(5)] = o;
    });
    this._setupLights();
    this._setupProxies();
    this._blobShadow();
    this.setHour(this.hour);
  }

  _setupShop(root) {
    const maxAniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    root.traverse((o) => {
      if (o.name) this.nodes[o.name] = o;
      if (!o.isMesh) return;
      o.matrixAutoUpdate = false;
      o.updateMatrix();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (TRANSPARENT.has(m.name)) {
          m.transparent = true;
          m.depthWrite = false;
          m.opacity = m.name === 'GlassTint' ? 0.5 : m.name === 'Etched' ? 0.45 : 0.22;
          m.side = THREE.DoubleSide;
        }
        if (m.map) m.map.anisotropy = maxAniso;
        if (m.name.startsWith('KronkelLogo')) {
          m.transparent = false;
          m.alphaTest = 0.5;
          m.depthWrite = true;
          if (m.name.endsWith('Lit')) m.emissiveIntensity = 1.2;
        }
        if (m.name === 'TvScreen') this.tvMaterial = m;
        if (m.name === 'WindowLit') m.emissiveIntensity = 0.35;
        if (m.name === 'Globe') m.emissiveIntensity = 0.45;
        if (m.name === 'Downlight') m.emissiveIntensity = 0.5;
        if (m.name === 'SignRedLit') m.emissiveIntensity = 0.12;
        if (m.name === 'SignWhiteLit') m.emissiveIntensity = 0.6;
        if (m.name === 'Fire') this.fireMaterial = m;
      }
      // Baked AO lives in COLOR_0; lift it a bit so the moody shop isn't pitch black.
      const col = o.geometry.getAttribute('color');
      if (col && !o.geometry.userData.aoLifted) {
        o.geometry.userData.aoLifted = true;
        for (let i = 0; i < col.count; i++) {
          const v = col.getX(i);
          const a = 0.3 + 0.7 * Math.pow(v, 0.8);
          col.setXYZ(i, a, a, a);
        }
        col.needsUpdate = true;
      }
    });
    this.shopRoot = root;
    this.scene.add(root);
    // Toggle groups are the direct children of the "Kronkel" root empty (static, table_G1, upg_pool...).
    const top = root.getObjectByName('Kronkel') || root;
    this.groups = {};
    for (const c of top.children) this.groups[c.name] = c;
    // Clock hands rotate around the clock centre: wrap each in a pivot so the compressed node's own
    // offset doesn't move the rotation axis.
    const centre = new THREE.Vector3(6.92, 2.75, 1.4);
    for (const key of ['clock_hour', 'clock_minute']) {
      const hand = this.nodes[key];
      if (!hand) continue;
      const pivot = new THREE.Group();
      pivot.position.copy(centre);
      hand.parent.add(pivot);
      pivot.updateMatrixWorld(true);
      pivot.attach(hand);
      if (key === 'clock_hour') this.clockHour = pivot;
      else this.clockMinute = pivot;
    }
    this._tvScreen();
  }

  _tvScreen() {
    if (!this.tvMaterial) return;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 144;
    this.tvCanvas = c;
    this.tvTex = new THREE.CanvasTexture(c);
    this.tvTex.colorSpace = THREE.SRGBColorSpace;
    this.tvMaterial.emissiveMap = this.tvTex;
    this.tvMaterial.emissive = new THREE.Color(1, 1, 1);
    this.tvMaterial.emissiveIntensity = 1.4;
    this.tvMaterial.map = null;
    this.tvMaterial.color = new THREE.Color(0, 0, 0);
  }

  _drawTv(t) {
    if (!this.tvCanvas || Math.floor(t * 8) === this._tvFrame) return;
    this._tvFrame = Math.floor(t * 8);
    const c = this.tvCanvas.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, 144);
    g.addColorStop(0, '#1d5b2a');
    g.addColorStop(1, '#0d3317');
    c.fillStyle = g;
    c.fillRect(0, 0, 256, 144);
    // A football match on the shop TV
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.lineWidth = 2;
    c.strokeRect(10, 20, 236, 110);
    c.beginPath();
    c.moveTo(128, 20);
    c.lineTo(128, 130);
    c.stroke();
    c.beginPath();
    c.arc(128, 75, 18, 0, Math.PI * 2);
    c.stroke();
    for (let i = 0; i < 10; i++) {
      const x = 128 + Math.sin(t * 0.7 + i * 1.7) * 100;
      const y = 75 + Math.cos(t * 0.5 + i * 2.3) * 40;
      c.fillStyle = i < 5 ? '#e4002b' : '#ffffff';
      c.fillRect(x - 3, y - 5, 6, 10);
    }
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(128 + Math.sin(t * 1.3) * 90, 75 + Math.sin(t * 1.7) * 35, 3, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(0,0,0,0.65)';
    c.fillRect(0, 0, 120, 16);
    c.fillStyle = '#fff';
    c.font = '800 12px "Barlow Condensed", sans-serif';
    c.fillText(`NEC 2 - 1 AJA   ${String(60 + Math.floor(t / 4) % 30).padStart(2, '0')}'`, 4, 12);
    this.tvTex.needsUpdate = true;
  }

  _setupLights() {
    const S = this.scene;
    this.hemi = new THREE.HemisphereLight(0x8a6ab0, 0x2a1810, 0.55);
    S.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0x9db4ff, 0.4);
    this.moon.position.set(-20, 40, 30);
    S.add(this.moon);
    const lights = [];
    const add = (color, intensity, x, y, z, dist = 7, prio = 1, zone = 'in') => {
      const l = new THREE.PointLight(color, intensity, dist, 2);
      l.position.set(x, y, z);
      l.userData = { prio, zone, base: intensity };
      lights.push(l);
      S.add(l);
      return l;
    };
    // Inside: pink drum lamps, purple ceiling wash, orange wall washers, counter + bar task light
    for (const t of this.L.tables.filter((t) => t.type === 'pod')) add(0xff4f7a, 7, t.x, 2.0, t.z, 5, 2);
    add(0xa040ff, 14, -3.5, 3.1, 0.5, 9, 1);
    add(0xa040ff, 12, 3.5, 3.1, 1.5, 9, 3);
    add(0xffe9c8, 5, 4.1, 2.7, -5.2, 6, 1); // shop counter
    add(0xffc27a, 9, -3.9, 2.3, -3.9, 6, 1); // bar lanterns
    add(0xff8a30, 8, -6.6, 0.6, -4.3, 5, 2); // wall washers
    add(0xff8a30, 8, -6.6, 0.6, 4.4, 5, 3);
    this.fireLight = add(0xff6a1a, 4, -6.3, 0.7, this.L.fireplace.z, 4, 3);
    add(0xfff4e0, 6, -5.3, 1.7, 3.5, 5, 3); // pool lamp
    add(0xfff1d6, 6, -3.6, 2.5, -7.2, 5, 4); // kitchen
    // Outside: alley globes + sign glow; terrace string lights
    add(0xffd9a0, 10, 0.6, 3.5, 6.8, 10, 1, 'out');
    add(0xffd9a0, 8, -10, 3.4, 6.8, 10, 2, 'out');
    add(0xffd9a0, 8, 10, 3.4, 6.8, 10, 2, 'out');
    this.signLight = add(0xff3030, 6, 3.0, 6.0, 7.8, 8, 2, 'out');
    add(0xffc87a, 10, -2.5, 6.2, -2.0, 10, 1, 'roof');
    add(0xffc87a, 10, 3.0, 6.2, -3.5, 10, 2, 'roof');
    this.pointLights = lights;
    this._applyLightBudget();
  }

  _applyLightBudget() {
    const budget = this.quality === 'high' ? 14 : this.quality === 'medium' ? 9 : 6;
    const zones = this.view === 'title' ? ['out', 'in'] : this.view === 'terrace' ? ['roof', 'in'] : ['in', 'out'];
    const ranked = [...this.pointLights].sort((a, b) => {
      const za = zones.indexOf(a.userData.zone);
      const zb = zones.indexOf(b.userData.zone);
      return (za < 0 ? 9 : za) - (zb < 0 ? 9 : zb) || a.userData.prio - b.userData.prio;
    });
    ranked.forEach((l, i) => {
      l.visible = i < budget && zones.includes(l.userData.zone);
    });
  }

  _setupProxies() {
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    const add = (geo, x, y, z, data) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.userData = data;
      this.scene.add(m);
      this.proxies.push(m);
      return m;
    };
    for (const t of this.L.tables) {
      const r = this.L.tableRadius[t.type] || 1;
      const y0 = t.level ? this.L.terrace.y : 0;
      t._proxy = add(new THREE.CylinderGeometry(r, r, 1.4, 16), t.x, y0 + 0.7, t.z, { kind: 'table', id: t.id, level: t.level });
    }
    const [px, pz] = this.L.pass;
    add(new THREE.BoxGeometry(2.6, 1.6, 1.4), px, 0.8, pz - 0.5, { kind: 'pass', level: 0 });
    const gs = this.L.gameShelf;
    add(new THREE.BoxGeometry(0.9, 2.2, 2.4), 6.6, 1.1, (gs.minZ + gs.maxZ) / 2, { kind: 'shelf', level: 0 });
    const [hx, hz] = this.L.host;
    add(new THREE.CylinderGeometry(1.1, 1.1, 2, 16), hx, 1, hz, { kind: 'host', level: 0 });
    const st = this.L.stairs;
    add(new THREE.BoxGeometry(0.8, 2.4, 1.4), 6.6, 1.2, st.doorGroundZ, { kind: 'stairs', level: 0 });
    add(new THREE.BoxGeometry(1.4, 2.4, 0.8), st.doorTerraceX, this.L.terrace.y + 1.2, this.L.upper.minZ - 0.5,
      { kind: 'stairs', level: 1 });
  }

  _blobShadow() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    this.shadowMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    this.shadowGeo = new THREE.PlaneGeometry(0.75, 0.75).rotateX(-Math.PI / 2);
  }

  // ------------------------------------------------------------------ state toggles
  setUpgrades(set) {
    this.upgrades = new Set(set);
    this._applyVisibility();
  }

  _applyVisibility() {
    const cut = !this.inVR && (this.view === 'floor' || this.view === 'tycoon');
    for (const [name, node] of Object.entries(this.groups)) {
      if (name.startsWith('upg_')) {
        const id = name.slice(4).replace(/_ceil$/, '');
        let vis = this.upgrades.has(id);
        if (name.endsWith('_ceil') && cut) vis = false;
        if (id === 'terrace' && cut) vis = false;
        node.visible = vis;
      } else if (name.startsWith('table_')) {
        const t = this.L.tables.find((t) => `table_${t.id}` === name);
        node.visible = !t?.unlock || this.upgrades.has(t.unlock);
        if (t && t.level === 1 && cut) node.visible = false;
        // parasols would hide the terrace tables in the top-down terrace view
        for (const c of node.children) {
          if (c.name.endsWith('_Parasol')) c.visible = this.inVR || this.view !== 'terrace';
        }
      }
    }
    if (this.groups.static_facade) this.groups.static_facade.visible = !cut;
    if (this.groups.static_ceiling) this.groups.static_ceiling.visible = !cut;
    for (const p of this.proxies) {
      const d = p.userData;
      if (d.kind === 'table') {
        const t = this.L.tables.find((t) => t.id === d.id);
        p.visible = !t.unlock || this.upgrades.has(t.unlock);
      }
    }
  }

  /** view: title | cashier | floor | terrace | tycoon | vr */
  setView(view, opts = {}) {
    this.view = view;
    this.pan = opts.pan ?? 0;
    this.zoom = opts.zoom ?? 1;
    this._applyVisibility();
    this._applyLightBudget();
    this._snap = opts.snap !== false;
  }

  setHour(h) {
    this.hour = h;
    const hh = ((h % 24) + 24) % 24;
    // daylight factor: 1 at noon .. 0 at night
    const day = clamp(Math.min((hh - 6) / 3, (21 - hh) / 3), 0, 1);
    const sky = new THREE.Color().lerpColors(new THREE.Color(0x0d1226), new THREE.Color(0x8fb7dd), day);
    const dusk = clamp(1 - Math.abs(hh - 19.5) / 2, 0, 1) * 0.6;
    sky.lerp(new THREE.Color(0xd9785a), dusk * (1 - day * 0.5));
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 30, 120);
    this.moon.color.setHex(day > 0.5 ? 0xfff2dd : 0x9db4ff);
    this.moon.intensity = 0.25 + day * 1.6;
    this.hemi.intensity = (this.quality === 'high' ? 0.55 : 0.8) + day * 0.5;
    this.dayFactor = day;
    if (this.clockMinute) this.clockMinute.rotation.x = (h % 1) * Math.PI * 2;
    if (this.clockHour) this.clockHour.rotation.x = ((h % 12) / 12) * Math.PI * 2;
  }

  // ------------------------------------------------------------------ camera
  _rig() {
    const w = this.w || 16;
    const h = this.h || 9;
    const aspect = w / h;
    const portrait = aspect < 1;
    const t = this.time;
    switch (this.view) {
      case 'title':
        return {
          pos: new THREE.Vector3(13.5 + Math.sin(t * 0.07) * 0.6, 1.6 + Math.sin(t * 0.11) * 0.08, 8.9),
          look: new THREE.Vector3(2.0 + Math.sin(t * 0.05) * 0.5, portrait ? 5.2 : 4.4, portrait ? 7.4 : 8.9),
          fov: portrait ? 70 : 55,
        };
      case 'cashier':
        return {
          pos: new THREE.Vector3(3.8, 1.62, -4.95),
          look: new THREE.Vector3(3.8, portrait ? 1.1 : 1.3, -1.2),
          fov: portrait ? 72 : 58,
        };
      case 'floor':
      case 'tycoon': {
        const fov = 42;
        const vf = THREE.MathUtils.degToRad(fov);
        const hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
        const fitWidth = (portrait ? 9 : 16.5) / this.zoom;
        const dist = clamp(fitWidth / 2 / Math.tan(hf / 2), 11, 46);
        const look = new THREE.Vector3(this.pan, 0, portrait ? 0.2 : 0.5);
        const dir = new THREE.Vector3(Math.sin(this.orbit) * 0.9, 1.65, Math.cos(this.orbit)).normalize();
        return { pos: look.clone().addScaledVector(dir, dist), look, fov };
      }
      case 'terrace': {
        const look = new THREE.Vector3(this.pan * 0.6, this.L.terrace.y, -1.9);
        const dist = portrait ? 19 : 13 / this.zoom;
        const dir = new THREE.Vector3(0, 0.95, -1).normalize();
        return { pos: look.clone().addScaledVector(dir, dist), look, fov: 45 };
      }
      default:
        return this.camTarget;
    }
  }

  // ------------------------------------------------------------------ people
  person(id, look) {
    let p = this.people.get(id);
    if (p) return p;
    p = new Person(this, look);
    this.people.set(id, p);
    this.scene.add(p.root);
    return p;
  }

  removePerson(id) {
    const p = this.people.get(id);
    if (!p) return;
    this.scene.remove(p.root);
    p.dispose();
    this.people.delete(id);
  }

  /**
   * Mirror a list of sim entities: {id, look, x, z, level, yaw, anim, carry, hidden}.
   * Entities that disappear from the list are removed.
   */
  syncPeople(list, dt) {
    const seen = new Set();
    for (const e of list) {
      seen.add(e.id);
      const p = this.person(e.id, e.look);
      p.sync(e, dt, this.L);
    }
    for (const id of [...this.people.keys()]) if (!seen.has(id)) this.removePerson(id);
  }

  clearPeople() {
    for (const id of [...this.people.keys()]) this.removePerson(id);
    this.clearProps();
    this.clearBubbles();
  }

  // ------------------------------------------------------------------ props
  _material(base, color) {
    const key = base.uuid + color;
    let m = this.matCache.get(key);
    if (!m) {
      m = base.clone();
      m.color = new THREE.Color(color);
      this.matCache.set(key, m);
    }
    return m;
  }

  makeProp(name, color = null) {
    const tpl = this.propTemplates[name];
    if (!tpl) return new THREE.Group();
    // The compressed glb keeps a dequantization scale/offset on the node, so keep the clone's own
    // transform and move it so the prop's bottom-centre sits at the wrapper's origin.
    const o = new THREE.Group();
    const inner = tpl.clone(true);
    o.add(inner);
    if (!tpl.userData.box) tpl.userData.box = new THREE.Box3().setFromObject(inner);
    const box = tpl.userData.box;
    inner.position.x -= (box.min.x + box.max.x) / 2;
    inner.position.y -= box.min.y;
    inner.position.z -= (box.min.z + box.max.z) / 2;
    if (color) {
      o.traverse((m) => {
        if (!m.isMesh) return;
        if (Array.isArray(m.material)) {
          m.material = m.material.map((mm) => (mm.name === 'ShakeFill' || mm.name === 'GameBox' ? this._material(mm, color) : mm));
        } else if (m.material.name === 'ShakeFill' || m.material.name === 'GameBox') {
          m.material = this._material(m.material, color);
        }
      });
    }
    o.traverse((m) => {
      if (m.isMesh && TRANSPARENT.has(m.material.name)) {
        m.material.transparent = true;
        m.material.opacity = 0.35;
        m.material.depthWrite = false;
      }
    });
    return o;
  }

  /** Keyed props: {key, name, color, x, y, z, yaw, scale} */
  syncProps(list) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.key);
      let o = this.props.get(p.key);
      if (!o) {
        o = this.makeProp(p.name, p.color);
        this.props.set(p.key, o);
        this.scene.add(o);
      }
      o.position.set(p.x, p.y, p.z);
      o.rotation.y = p.yaw || 0;
      o.scale.setScalar(p.scale || 1);
    }
    for (const [k, o] of [...this.props]) {
      if (!seen.has(k)) {
        this.scene.remove(o);
        this.props.delete(k);
      }
    }
  }

  clearProps() {
    for (const o of this.props.values()) this.scene.remove(o);
    this.props.clear();
  }

  // ------------------------------------------------------------------ status bubbles
  _icon(icon, mood) {
    const level = mood == null ? -1 : Math.round(clamp(mood, 0, 1) * 8);
    const key = `${icon}:${level}`;
    let tex = this.iconCache.get(key);
    if (tex) return tex;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const ink = '#121015';
    const fill = { order: '#ffc814', bill: '#ffc814', angry: '#d51f2b' }[icon] || '#f5efe1';
    const bubble = (ox, oy) => {
      g.beginPath();
      g.arc(62 + ox, 54 + oy, 38, 0, Math.PI * 2);
      g.moveTo(50 + ox, 88 + oy);
      g.lineTo(60 + ox, 116 + oy);
      g.lineTo(74 + ox, 86 + oy);
      g.closePath();
    };
    bubble(5, 5);
    g.fillStyle = ink;
    g.fill();
    if (level >= 0) {
      const f = level / 8;
      g.lineWidth = 12;
      g.strokeStyle = ink;
      g.beginPath();
      g.arc(62, 54, 47, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = 7;
      g.strokeStyle = f > 0.6 ? '#ffc814' : f > 0.3 ? '#ff9a2e' : '#d51f2b';
      g.beginPath();
      g.arc(62, 54, 47, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f);
      g.stroke();
    }
    bubble(0, 0);
    g.fillStyle = fill;
    g.fill();
    g.lineWidth = 6;
    g.lineJoin = 'round';
    g.strokeStyle = ink;
    g.stroke();
    drawIcon(g, icon, 62, 54);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.iconCache.set(key, tex);
    return tex;
  }

  /** {key, icon, mood, x, y, z, scale} */
  syncBubbles(list) {
    const seen = new Set();
    for (const b of list) {
      seen.add(b.key);
      let s = this.bubbles.get(b.key);
      if (!s) {
        s = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
        s.renderOrder = 10;
        this.bubbles.set(b.key, s);
        this.scene.add(s);
      }
      const tex = this._icon(b.icon, b.mood);
      if (s.material.map !== tex) {
        s.material.map = tex;
        s.material.needsUpdate = true;
      }
      const bob = Math.sin(this.time * 3 + b.x) * 0.04;
      s.position.set(b.x, b.y + bob, b.z);
      const overhead = !this.inVR && (this.view === 'floor' || this.view === 'tycoon' || this.view === 'terrace');
      const sc = (b.scale || 0.55) * (overhead ? 1.6 : 0.7);
      s.scale.set(sc, sc, sc);
    }
    for (const [k, s] of [...this.bubbles]) {
      if (!seen.has(k)) {
        this.scene.remove(s);
        s.material.dispose();
        this.bubbles.delete(k);
      }
    }
  }

  clearBubbles() {
    this.syncBubbles([]);
  }

  // ------------------------------------------------------------------ picking
  pickScreen(x, y) {
    const ndc = new THREE.Vector2((x / this.w) * 2 - 1, -(y / this.h) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this._pickRay();
  }

  pickRay(origin, dir) {
    this.raycaster.set(origin, dir);
    return this._pickRay();
  }

  _pickRay() {
    const visible = this.proxies.filter((p) => p.visible);
    const hits = this.raycaster.intersectObjects(visible, false);
    return hits.length ? { ...hits[0].object.userData, point: hits[0].point } : null;
  }

  project(pos) {
    const v = this._tmp.copy(pos).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.w, y: (-v.y * 0.5 + 0.5) * this.h, visible: v.z < 1 && v.z > -1 };
  }

  // ------------------------------------------------------------------ frame
  update(dt, inXR = false) {
    this.time += dt;
    if (!inXR) {
      const rig = this._rig();
      const k = this._snap ? 0 : 0.18;
      this._snap = false;
      if (k === 0) {
        this.camera.position.copy(rig.pos);
        this.camLook.copy(rig.look);
        this.camera.fov = rig.fov;
      } else {
        this.camera.position.x = damp(this.camera.position.x, rig.pos.x, k, dt);
        this.camera.position.y = damp(this.camera.position.y, rig.pos.y, k, dt);
        this.camera.position.z = damp(this.camera.position.z, rig.pos.z, k, dt);
        this.camLook.x = damp(this.camLook.x, rig.look.x, k, dt);
        this.camLook.y = damp(this.camLook.y, rig.look.y, k, dt);
        this.camLook.z = damp(this.camLook.z, rig.look.z, k, dt);
        this.camera.fov = damp(this.camera.fov, rig.fov, k, dt);
      }
      this.dolly.position.set(0, 0, 0);
      this.dolly.rotation.set(0, 0, 0);
      this.camera.lookAt(this.camLook);
      this.camera.updateProjectionMatrix();
    }
    for (const p of this.people.values()) p.update(dt);
    if (this.fireLight) {
      this.fireLight.intensity = this.fireLight.userData.base * (0.75 + 0.35 * Math.sin(this.time * 13) * Math.sin(this.time * 7.3));
    }
    if (this.signLight) {
      const on = this.upgrades.has('neon');
      this.signLight.intensity = on ? this.signLight.userData.base * (1 - this.dayFactor * 0.8) : 0;
    }
    this._drawTv(this.time);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

// ----------------------------------------------------------------------------
class Person {
  constructor(world, look) {
    this.world = world;
    this.look = look;
    this.root = new THREE.Group();
    const model = SkeletonUtils.clone(world.personTemplate);
    this.model = model;
    this.root.add(model);
    model.traverse((o) => {
      if (o.isMesh) {
        o.frustumCulled = false;
        if (Array.isArray(o.material)) o.material = o.material.map((m) => this._recolor(m));
        else o.material = this._recolor(o.material);
      }
    });
    for (const name of ACCESSORIES) {
      const node = model.getObjectByName(name);
      if (!node) continue;
      let vis = false;
      if (name === look.style) vis = true;
      if (name === 'glasses') vis = !!look.glasses;
      if (name === 'beard') vis = !!look.beard;
      if (name === 'apron') vis = !!look.apron;
      node.visible = vis;
    }
    model.scale.set(look.width || 1, look.height || 1, look.width || 1);
    const shadow = new THREE.Mesh(world.shadowGeo, world.shadowMat);
    shadow.position.y = 0.012;
    shadow.renderOrder = 1;
    this.shadow = shadow;
    this.root.add(shadow);
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const [name, clip] of Object.entries(world.clips)) this.actions[name] = this.mixer.clipAction(clip);
    this.anim = null;
    this.play('Idle', 0);
    this.mixer.update(Math.random() * 2);
    this.carry = null;
    this.yaw = 0;
    this.initialized = false;
  }

  _recolor(m) {
    const look = this.look;
    for (const [key, matName] of Object.entries(RECOLOR)) {
      if (m.name === matName && look[key]) return this.world._material(m, look[key]);
    }
    return m;
  }

  play(name, fade = 0.25) {
    if (this.anim === name || !this.actions[name]) return;
    const next = this.actions[name];
    next.reset().play();
    if (this.anim && this.actions[this.anim]) {
      this.actions[this.anim].crossFadeTo(next, fade, false);
    }
    this.anim = name;
  }

  sync(e, dt, L) {
    const y = (e.level ? L.terrace.y : 0) + (e.y || 0);
    if (!this.initialized || e.snap) {
      this.root.position.set(e.x, y, e.z);
      this.yaw = e.yaw || 0;
      this.initialized = true;
    } else {
      // smooth small jumps (sim moves in steps), snap big ones (stairs)
      const d = Math.hypot(e.x - this.root.position.x, e.z - this.root.position.z) + Math.abs(y - this.root.position.y);
      if (d > 2.5) this.root.position.set(e.x, y, e.z);
      else {
        this.root.position.x = damp(this.root.position.x, e.x, 0.05, dt);
        this.root.position.z = damp(this.root.position.z, e.z, 0.05, dt);
        this.root.position.y = y;
      }
      let dy = (e.yaw || 0) - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * Math.min(1, dt * 10);
    }
    this.root.rotation.y = this.yaw;
    this.root.visible = !e.hidden;
    this.shadow.visible = e.anim !== 'Sit';
    let anim = e.anim || 'Idle';
    if (e.carry && anim === 'Walk') anim = 'CarryWalk';
    if (e.carry && anim === 'Idle') anim = 'CarryIdle';
    this.play(anim);
    this._syncCarry(e.carry);
  }

  _syncCarry(carry) {
    const key = carry ? carry.map((c) => c.name + (c.color || '')).join(',') : '';
    if (key === this._carryKey) return;
    this._carryKey = key;
    if (this.tray) {
      this.root.remove(this.tray);
      this.tray = null;
    }
    if (!carry || !carry.length) return;
    const tray = new THREE.Group();
    const base = this.world.makeProp('tray');
    tray.add(base);
    carry.slice(0, 4).forEach((c, i) => {
      const p = this.world.makeProp(c.name, c.color);
      const a = (i / Math.max(1, carry.length)) * Math.PI * 2;
      p.position.set(Math.sin(a) * (carry.length > 1 ? 0.1 : 0), 0.014, Math.cos(a) * (carry.length > 1 ? 0.1 : 0));
      tray.add(p);
    });
    tray.position.set(0, 1.08, 0.38);
    this.tray = tray;
    this.root.add(tray);
  }

  update(dt) {
    this.mixer.update(dt);
  }

  dispose() {
    this.mixer.stopAllAction();
  }
}

function drawIcon(g, icon, cx, cy) {
  const ink = '#121015';
  const red = '#d51f2b';
  g.save();
  g.translate(cx, cy);
  g.fillStyle = ink;
  g.strokeStyle = ink;
  g.lineWidth = 7;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const txt = (t, color = ink, size = 52) => {
    g.fillStyle = color;
    g.font = `${size}px "Archivo Black", Impact, sans-serif`;
    g.fillText(t, 0, 4);
  };
  switch (icon) {
    case 'order':
      txt('!', ink, 62);
      break;
    case 'bill':
    case 'cash':
      txt('€', ink, 54);
      break;
    case 'angry':
      txt('!!', '#f5efe1', 50);
      break;
    case 'wait': {
      g.beginPath();
      g.arc(0, 0, 21, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, -13);
      g.moveTo(0, 0);
      g.lineTo(10, 6);
      g.stroke();
      break;
    }
    case 'food': {
      g.beginPath();
      g.arc(0, 8, 22, Math.PI, 0);
      g.closePath();
      g.fill();
      g.fillRect(-28, 8, 56, 6);
      g.beginPath();
      g.arc(0, -16, 4.5, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'game': {
      g.beginPath();
      g.roundRect(-21, -21, 42, 42, 7);
      g.fillStyle = '#f5efe1';
      g.fill();
      g.lineWidth = 5;
      g.stroke();
      g.fillStyle = ink;
      for (const [x, y] of [[-10, -10], [10, 10], [0, 0], [10, -10], [-10, 10]]) {
        g.beginPath();
        g.arc(x, y, 4.2, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'dirty': {
      g.strokeStyle = '#9a45ff';
      for (let i = -1; i <= 1; i++) {
        g.beginPath();
        g.moveTo(i * 14 - 6, 18);
        g.quadraticCurveTo(i * 14 + 6, 0, i * 14 - 4, -18);
        g.stroke();
      }
      break;
    }
    case 'seat':
      txt('?', red, 58);
      break;
    case 'happy':
      txt('♥', red, 52);
      break;
    case 'id':
      txt('ID', ink, 38);
      break;
    default:
      txt(icon.slice(0, 2), ink, 40);
  }
  g.restore();
}
