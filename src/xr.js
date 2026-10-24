// WebXR (Quest, Pico, Vision Pro...). The player stands inside the shop; the screen's GUI is drawn
// onto a floating panel that controllers (or hands, via 'select') point at. Pointing at the world
// picks tables, the pass, the game shelf... exactly like tapping in the flat game.
import * as THREE from 'three';
import { Gui } from './gui.js';
import { sfx } from './audio.js';

const PANEL_W = 1280;
const PANEL_H = 800;

export class XR {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.active = false;
    const canvas = document.createElement('canvas');
    this.gui = new Gui(canvas, { fixed: { w: PANEL_W, h: PANEL_H }, dprCap: 1 });
    this.gui.navMode = false;
    this.gui.onClickSound = () => sfx.click();
    this.tex = new THREE.CanvasTexture(canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 1.15 * (PANEL_H / PANEL_W)),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, toneMapped: false }),
    );
    this.panel.renderOrder = 20;
    this.panel.visible = false;
    this.world.dolly.add(this.panel);
    this.raycaster = new THREE.Raycaster();
    this.controllers = [];
    this.turnCooldown = 0;
    this.frame = 0;
  }

  async supported() {
    try {
      return !!(navigator.xr && (await navigator.xr.isSessionSupported('immersive-vr')));
    } catch {
      return false;
    }
  }

  async enter() {
    if (this.active) return;
    const r = this.world.renderer;
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
    });
    r.xr.setReferenceSpaceType('local-floor');
    r.xr.setFramebufferScaleFactor(this.world.quality === 'high' ? 1.2 : 1.0);
    // Controllers must exist before the session starts so they receive the initial 'connected' events.
    if (!this.controllers.length) this._setupControllers();
    await r.xr.setSession(session);
    this.active = true;
    this.world.inVR = true;
    this.world._applyVisibility();
    this.panel.visible = true;
    this.placeForScreen();
    session.addEventListener('end', () => {
      this.active = false;
      this.world.inVR = false;
      this.panel.visible = false;
      this.world.dolly.position.set(0, 0, 0);
      this.world.dolly.rotation.set(0, 0, 0);
      this.world._applyVisibility();
      this.world._snap = true;
    });
  }

  exit() {
    this.world.renderer.xr.getSession()?.end();
  }

  _setupControllers() {
    const r = this.world.renderer;
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x9fe07a, transparent: true, opacity: 0.8 });
    const cursorMat = new THREE.MeshBasicMaterial({ color: 0xffcf5a, depthTest: false, transparent: true });
    for (let i = 0; i < 2; i++) {
      const c = r.xr.getController(i);
      const line = new THREE.Line(lineGeo, lineMat);
      line.scale.z = 4;
      c.add(line);
      const cursor = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), cursorMat);
      cursor.renderOrder = 30;
      cursor.visible = false;
      this.world.scene.add(cursor);
      c.userData = { line, cursor, source: null, hit: null };
      c.addEventListener('connected', (e) => {
        c.userData.source = e.data;
        line.visible = e.data.targetRayMode !== 'gaze';
      });
      c.addEventListener('disconnected', () => {
        c.userData.source = null;
      });
      c.addEventListener('selectstart', () => this._select(c, true));
      c.addEventListener('selectend', () => this._select(c, false));
      this.world.dolly.add(c);
      const grip = r.xr.getControllerGrip(i);
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.09, 4, 8),
        new THREE.MeshStandardMaterial({ color: 0x1e1e20, roughness: 0.5 }));
      body.rotation.x = Math.PI / 2.4;
      grip.add(body);
      this.world.dolly.add(grip);
      this.controllers.push(c);
    }
  }

  _ray(c) {
    const m = new THREE.Matrix4().extractRotation(c.matrixWorld);
    const origin = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
    const dir = new THREE.Vector3(0, 0, -1).applyMatrix4(m).normalize();
    return { origin, dir };
  }

  _panelHit(c) {
    const { origin, dir } = this._ray(c);
    this.raycaster.set(origin, dir);
    const hit = this.raycaster.intersectObject(this.panel, false)[0];
    if (!hit || !hit.uv) return null;
    return { x: hit.uv.x * PANEL_W, y: (1 - hit.uv.y) * PANEL_H, point: hit.point, distance: hit.distance };
  }

  _select(c, down) {
    if (!this.active) return;
    const ph = this._panelHit(c);
    if (down) {
      this.pointerOwner = c;
      if (ph) {
        this.gui.pointerMove(ph.x, ph.y);
        this.gui.pointerDown(ph.x, ph.y);
        c.userData.onPanel = true;
        return;
      }
      c.userData.onPanel = false;
      const { origin, dir } = this._ray(c);
      const pick = this.world.pickRay(origin, dir);
      if (pick) this.game.screen?.onWorldPick?.(pick);
    } else if (c.userData.onPanel) {
      if (ph) this.gui.pointerUp(ph.x, ph.y);
      else this.gui.pointerCancel();
      c.userData.onPanel = false;
    }
  }

  placeForScreen() {
    if (!this.active) return;
    const a = this.game.screen?.vrAnchor?.() || { x: 11.6, y: 0, z: 8.2, yaw: Math.PI / 2 };
    const d = this.world.dolly;
    d.position.set(a.x, a.y || 0, a.z);
    d.rotation.set(0, a.yaw || 0, 0);
    this.panel.position.set(a.panelX || 0, a.panelY ?? 1.3, -(a.panelDist ?? 0.95));
    this.panel.rotation.set(a.panelTilt ?? -0.18, 0, 0);
    this.panel.scale.setScalar(a.panelScale || 1);
  }

  update(dt) {
    this.frame++;
    this.turnCooldown -= dt;
    for (const c of this.controllers) {
      const ud = c.userData;
      const ph = this._panelHit(c);
      if (ph) {
        ud.line.scale.z = ph.distance;
        ud.cursor.visible = true;
        ud.cursor.position.copy(ph.point);
        if (this.pointerOwner === c || !this.pointerOwner) this.gui.pointerMove(ph.x, ph.y);
      } else {
        ud.cursor.visible = false;
        const { origin, dir } = this._ray(c);
        const pick = this.world.pickRay(origin, dir);
        ud.line.scale.z = pick ? origin.distanceTo(pick.point) : 4;
        ud.line.material.color.setHex(pick ? 0xffcf5a : 0x9fe07a);
      }
      const gp = ud.source?.gamepad;
      if (gp) {
        const ax = gp.axes[2] || 0;
        if (Math.abs(ax) > 0.75 && this.turnCooldown <= 0) {
          this.world.dolly.rotation.y -= Math.sign(ax) * (Math.PI / 6);
          this.turnCooldown = 0.35;
        }
        const prev = ud.prevButtons || [];
        const b = gp.buttons.map((x) => x.pressed);
        if (b[5] && !prev[5]) this.game.screen?.onBack?.();
        if (b[4] && !prev[4]) this.game.screen?.onAlt?.('x');
        ud.prevButtons = b;
      }
    }
    // Redraw the panel at ~36 fps to spare the headset's GPU upload bandwidth
    if (this.frame % 2 === 0) {
      this.gui.begin(dt * 2);
      this.gui.box(0, 0, PANEL_W, PANEL_H, { r: 28, fill: 'rgba(10,20,14,0.55)', stroke: 'rgba(255,255,255,0.12)', lw: 2 });
      this.game.screen?.draw?.(this.gui);
      this.gui.end(dt * 2);
      this.tex.needsUpdate = true;
    }
  }
}
