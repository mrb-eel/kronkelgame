// Touch / mouse / keyboard / gamepad -> GUI focus navigation + screen callbacks.
// Screens may implement: onBack(), onTab(dir), onAlt(button), onPause(), onLook(x, y, dt), onZoom(delta), onKey(key)
import { unlock } from './audio.js';

const REPEAT_DELAY = 0.38;
const REPEAT_RATE = 0.12;

export class Input {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.pad = null;
    this.prevButtons = [];
    this.held = { dir: null, t: 0 };
    this.lastDevice = 'pointer';
    this.touches = new Map();
    this.pinch = 0;
    this._bind();
  }

  get gui() {
    return this.game.gui;
  }

  get screen() {
    return this.game.screen;
  }

  _local(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      unlock();
      this.game.onFirstGesture?.();
      this.lastDevice = e.pointerType === 'touch' ? 'touch' : 'pointer';
      c.setPointerCapture?.(e.pointerId);
      const [x, y] = this._local(e);
      this.touches.set(e.pointerId, [x, y]);
      if (this.touches.size === 2) {
        // second finger: start a pinch instead of a tap
        this.gui.pointerCancel();
        this.pinch = this._spread();
      } else if (this.touches.size === 1) {
        this.gui.pointerDown(x, y, e.pointerType === 'touch');
      }
      e.preventDefault();
    });
    c.addEventListener('pointermove', (e) => {
      const [x, y] = this._local(e);
      if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, [x, y]);
      if (this.touches.size === 2) {
        const d = this._spread();
        if (this.pinch && Math.abs(d - this.pinch) > 18) {
          this.screen?.onZoom?.(d > this.pinch ? -1 : 1);
          this.pinch = d;
        }
        return;
      }
      this.gui.pointerMove(x, y, e.pointerType === 'touch');
    });
    const up = (e) => {
      const wasPinch = this.touches.size >= 2 || this.pinch;
      this.touches.delete(e.pointerId);
      if (!this.touches.size) this.pinch = 0;
      if (wasPinch) return;
      const [x, y] = this._local(e);
      this.gui.pointerUp(x, y);
      e.preventDefault();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', (e) => {
      this.touches.delete(e.pointerId);
      if (!this.touches.size) this.pinch = 0;
      this.gui.pointerCancel();
    });
    c.addEventListener('wheel', (e) => {
      this.screen?.onZoom?.(Math.sign(e.deltaY));
      e.preventDefault();
    }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      unlock();
      this.game.onFirstGesture?.();
      this.lastDevice = 'keyboard';
      const k = e.key;
      const nav = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
        w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] }[k.length === 1 ? k.toLowerCase() : k];
      if (nav && !e.metaKey && !e.ctrlKey) {
        this.gui.nav(nav[0], nav[1]);
        e.preventDefault();
        return;
      }
      if (k === 'Enter' || k === ' ') {
        this.gui.activate();
        e.preventDefault();
        return;
      }
      if (k === 'Escape' || k === 'Backspace') {
        this.screen?.onBack?.();
        e.preventDefault();
        return;
      }
      if (k === 'q' || k === 'Q' || k === 'PageUp') this.screen?.onTab?.(-1);
      else if (k === 'e' || k === 'E' || k === 'PageDown') this.screen?.onTab?.(1);
      else if (k === 'p' || k === 'P') this.screen?.onPause?.();
      else if (k === 'f' || k === 'F') this.game.toggleFullscreen?.();
      else this.screen?.onKey?.(k);
    });

    window.addEventListener('gamepadconnected', (e) => {
      this.game.gui.toast(`Controller connected: ${shortPadName(e.gamepad.id)}`, '#9fe07a');
      this.lastDevice = 'gamepad';
    });
    window.addEventListener('gamepaddisconnected', () => this.game.gui.toast('Controller disconnected', '#ffcf5a'));
  }

  _spread() {
    const [a, b] = [...this.touches.values()];
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  }

  rumble(strong = 0.5, weak = 0.3, ms = 120) {
    if (!this.game.save.settings.haptics) return;
    const pad = this.pad;
    try {
      pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak });
    } catch {
      /* not supported */
    }
    if (this.lastDevice === 'touch' && navigator.vibrate) {
      try {
        navigator.vibrate(Math.min(60, ms / 2));
      } catch {
        /* ignore */
      }
    }
  }

  update(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) {
      if (p && p.connected && p.mapping !== 'xr-standard') {
        pad = p;
        break;
      }
    }
    this.pad = pad;
    if (!pad) return;
    const b = pad.buttons.map((x) => x.pressed || x.value > 0.5);
    const pressed = (i) => b[i] && !this.prevButtons[i];
    if (b.some((x) => x)) {
      this.lastDevice = 'gamepad';
      unlock();
      this.game.onFirstGesture?.();
    }
    // Direction (d-pad or left stick) with key-repeat
    const ax = pad.axes[0] || 0;
    const ay = pad.axes[1] || 0;
    let dir = null;
    if (b[12] || ay < -0.55) dir = 'u';
    else if (b[13] || ay > 0.55) dir = 'd';
    else if (b[14] || ax < -0.55) dir = 'l';
    else if (b[15] || ax > 0.55) dir = 'r';
    if (dir) {
      const v = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] }[dir];
      if (this.held.dir !== dir) {
        this.held = { dir, t: REPEAT_DELAY };
        this.gui.nav(v[0], v[1]);
      } else {
        this.held.t -= dt;
        if (this.held.t <= 0) {
          this.held.t = REPEAT_RATE;
          this.gui.nav(v[0], v[1]);
        }
      }
    } else {
      this.held.dir = null;
    }
    if (pressed(0)) this.gui.activate();
    if (pressed(1)) this.screen?.onBack?.();
    if (pressed(2)) this.screen?.onAlt?.('x');
    if (pressed(3)) this.screen?.onAlt?.('y');
    if (pressed(4)) this.screen?.onTab?.(-1);
    if (pressed(5)) this.screen?.onTab?.(1);
    if (pressed(9)) this.screen?.onPause?.();
    const rx = pad.axes[2] || 0;
    const ry = pad.axes[3] || 0;
    if (Math.abs(rx) > 0.15 || Math.abs(ry) > 0.15) this.screen?.onLook?.(rx, ry, dt);
    const lt = pad.buttons[6]?.value || 0;
    const rt = pad.buttons[7]?.value || 0;
    if (lt > 0.2 || rt > 0.2) this.screen?.onZoom?.((lt - rt) * dt * 6);
    this.prevButtons = b;
  }
}

function shortPadName(id) {
  if (/xbox|xinput/i.test(id)) return 'Xbox';
  if (/054c|playstation|dualsense|dualshock/i.test(id)) return 'PlayStation';
  if (/switch|057e/i.test(id)) return 'Switch';
  return id.split('(')[0].trim().slice(0, 24) || 'Gamepad';
}
