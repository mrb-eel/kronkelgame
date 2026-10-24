// Shared screen plumbing: base class, top bar, panels, modals and the pause menu.
import { C, SERIF } from '../gui.js';
import { sfx } from '../audio.js';

export class BaseScreen {
  constructor(game, params = {}) {
    this.game = game;
    this.params = params;
    this.paused = false;
    this.modal = null;
  }

  get world() {
    return this.game.world;
  }

  get data() {
    return this.game.data;
  }

  get L() {
    return this.game.layout;
  }

  toast(text, color = C.text) {
    this.game.gui.toast(text, color);
    if (this.game.xr?.active) this.game.xr.gui.toast(text, color);
  }

  onBack() {
    if (this.overlay) {
      this.overlay.onBack();
      return;
    }
    if (this.modal) {
      this.modal = null;
      return;
    }
    this.onPause?.();
  }

  onTab(d) {
    this.overlay?.onTab?.(d);
  }

  /** Show How to play on top of this screen. `resume` unpauses when it closes (first-time tutorial). */
  openHowto(tab, resume = false) {
    this.overlay = new this.game.Screens.howto(this.game, { tab, onClose: () => {
      this.overlay = null;
      if (resume) this.paused = false;
    } });
    this.overlay.enter();
  }

  /** Default pause handling for gameplay screens. */
  onPause() {
    if (!this.pausable) return;
    this.paused = !this.paused;
    sfx.pop();
  }

  drawPause(gui) {
    if (!this.paused) return;
    const S = gui.S;
    if (this.overlay) {
      gui.blocker();
      this.overlay.draw(gui);
      return;
    }
    gui.blocker();
    gui.box(0, 0, gui.w, gui.h, { r: 0, fill: 'rgba(5,10,7,0.6)', stroke: null });
    const w = Math.min(gui.w - 32, 360 * S);
    const h = 330 * S;
    const x = (gui.w - w) / 2;
    const y = (gui.h - h) / 2;
    gui.box(x, y, w, h, { r: 22, fill: C.panel2, shadow: true });
    gui.text('Pauze', gui.w / 2, y + 52 * S, 32 * S, { align: 'center', family: SERIF, color: C.gold, weight: 700 });
    const bw = w - 48 * S;
    const bh = 50 * S;
    let by = y + 80 * S;
    gui.button(x + 24 * S, by, bw, bh, 'Resume', () => { this.paused = false; }, { kind: 'primary', icon: 'play' });
    by += bh + 12 * S;
    gui.button(x + 24 * S, by, bw, bh, 'How to play', () => this.openHowto(this.howtoTab), {});
    by += bh + 12 * S;
    gui.button(x + 24 * S, by, bw, bh, 'Quit to menu', () => {
      this.onQuit?.();
      this.game.setScreen('title');
    }, { kind: 'danger', icon: 'back' });
  }

  drawModal(gui) {
    const m = this.modal;
    if (!m) return;
    const S = gui.S;
    gui.blocker();
    gui.box(0, 0, gui.w, gui.h, { r: 0, fill: 'rgba(5,10,7,0.6)', stroke: null });
    const w = Math.min(gui.w - 32, (m.width || 460) * S);
    const lines = gui.wrap(m.text || '', w - 48 * S, 15 * S, 500);
    const h = (110 + (m.buttons?.length > 2 ? 120 : 60)) * S + lines.length * 15 * S * 1.45 + (m.extraH || 0) * S;
    const x = (gui.w - w) / 2;
    const y = Math.max(16, (gui.h - h) / 2);
    gui.box(x, y, w, h, { r: 22, fill: C.panel2, shadow: true, stroke: (m.color || C.gold) + '55' });
    gui.text(m.title, x + 24 * S, y + 44 * S, 24 * S, { color: m.color || C.gold, weight: 800, max: w - 48 * S });
    gui.paragraph(m.text || '', x + 24 * S, y + 58 * S, w - 48 * S, 15 * S, { color: C.text });
    const btns = m.buttons || [{ label: 'OK', kind: 'primary', onClick: () => { this.modal = null; } }];
    const bh = 48 * S;
    const by = y + h - bh - 20 * S;
    const gap = 10 * S;
    const bw = (w - 48 * S - gap * (btns.length - 1)) / btns.length;
    btns.forEach((b, i) => {
      gui.button(x + 24 * S + i * (bw + gap), by, bw, bh, b.label, () => {
        this.modal = null;
        b.onClick?.();
      }, { kind: b.kind || 'normal', size: 15 * S });
    });
  }
}

/** Pill-shaped info bar along the top. items: [{label, value, color, w}] */
export function topBar(gui, items, { right = null } = {}) {
  const S = gui.S;
  const y = gui.safe.top + 10 * S;
  const h = 44 * S;
  let x = gui.safe.left + 10 * S;
  const maxRight = gui.w - gui.safe.right - 10 * S - (right ? right.w + 8 * S : 0);
  for (const it of items) {
    const w = it.w ? it.w * S : Math.max(70 * S, gui.measure(String(it.value), 17 * S, 800) + 28 * S);
    if (x + w > maxRight) break;
    gui.box(x, y, w, h, { r: h / 2, fill: 'rgba(10,20,14,0.82)', stroke: C.line });
    if (it.draw) it.draw(x, y, w, h);
    else {
      gui.text(it.label, x + w / 2, y + 15 * S, 10 * S, { align: 'center', color: C.dim, weight: 700 });
      gui.text(String(it.value), x + w / 2, y + 34 * S, 17 * S, { align: 'center', color: it.color || C.text, weight: 800,
        max: w - 12 });
    }
    x += w + 6 * S;
  }
  if (right) {
    gui.button(gui.w - gui.safe.right - 10 * S - right.w, y, right.w, h, right.label, right.onClick,
      { icon: right.icon, kind: 'ghost', size: 15 * S, id: 'topbar-right' });
  }
  return y + h;
}

export function panel(gui, x, y, w, h, title = null, opts = {}) {
  const S = gui.S;
  gui.box(x, y, w, h, { r: 18, fill: opts.fill || C.panel, shadow: true, stroke: opts.stroke || C.line });
  if (title) gui.text(title, x + 16 * S, y + 28 * S, 15 * S, { color: opts.titleColor || C.gold, weight: 800 });
  return { x: x + 14 * S, y: y + (title ? 40 : 14) * S, w: w - 28 * S, h: h - (title ? 54 : 28) * S };
}

export function vrButton(game, gui, x, y, w, h) {
  if (!game.xrSupported) return;
  if (game.xr.active) {
    gui.button(x, y, w, h, 'Exit VR', () => game.xr.exit(), { icon: 'vr', kind: 'ghost' });
  } else {
    gui.button(x, y, w, h, 'Play in VR', () => {
      game.xr.enter().catch((e) => game.gui.toast(`VR failed: ${e.message}`, C.red));
    }, { icon: 'vr', kind: 'gold' });
  }
}

/** Draw a little ID-card portrait from a look. */
export function portrait(gui, x, y, w, h, look) {
  const c = gui.ctx;
  c.save();
  gui.rr(x, y, w, h, 6);
  c.clip();
  c.fillStyle = '#c9d6e3';
  c.fillRect(x, y, w, h);
  const cx = x + w / 2;
  const headR = w * 0.24;
  const hy = y + h * 0.42;
  // shoulders
  c.fillStyle = look.shirt;
  c.beginPath();
  c.ellipse(cx, y + h * 1.02, w * 0.46, h * 0.32, 0, 0, Math.PI * 2);
  c.fill();
  // neck + head
  c.fillStyle = look.skin;
  c.fillRect(cx - headR * 0.35, hy + headR * 0.6, headR * 0.7, headR * 0.7);
  c.beginPath();
  c.ellipse(cx, hy, headR, headR * 1.1, 0, 0, Math.PI * 2);
  c.fill();
  // hair styles
  c.fillStyle = look.style === 'hat_beanie' || look.style === 'hat_cap' ? look.hat : look.hair;
  const s = look.style;
  if (s === 'hair_long') {
    c.beginPath();
    c.ellipse(cx, hy - headR * 0.2, headR * 1.12, headR * 0.95, 0, Math.PI, 0);
    c.fill();
    c.fillRect(cx - headR * 1.12, hy - headR * 0.2, headR * 0.35, headR * 1.6);
    c.fillRect(cx + headR * 0.77, hy - headR * 0.2, headR * 0.35, headR * 1.6);
  } else if (s === 'hair_curly') {
    for (let i = 0; i < 9; i++) {
      const a = Math.PI + (i / 8) * Math.PI;
      c.beginPath();
      c.arc(cx + Math.cos(a) * headR * 0.95, hy - headR * 0.25 + Math.sin(a) * headR * 0.85, headR * 0.38, 0, Math.PI * 2);
      c.fill();
    }
  } else if (s === 'hair_bun') {
    c.beginPath();
    c.ellipse(cx, hy - headR * 0.25, headR * 1.05, headR * 0.85, 0, Math.PI, 0);
    c.fill();
    c.beginPath();
    c.arc(cx, hy - headR * 1.25, headR * 0.42, 0, Math.PI * 2);
    c.fill();
  } else if (s === 'hat_cap') {
    c.beginPath();
    c.ellipse(cx, hy - headR * 0.3, headR * 1.05, headR * 0.8, 0, Math.PI, 0);
    c.fill();
    c.fillRect(cx - headR * 0.2, hy - headR * 0.4, headR * 1.5, headR * 0.22);
  } else if (s === 'hat_beanie') {
    c.beginPath();
    c.ellipse(cx, hy - headR * 0.25, headR * 1.08, headR * 1.0, 0, Math.PI, 0);
    c.fill();
    c.fillRect(cx - headR * 1.08, hy - headR * 0.35, headR * 2.16, headR * 0.3);
  } else if (s === 'hair_short') {
    c.beginPath();
    c.ellipse(cx, hy - headR * 0.25, headR * 1.05, headR * 0.85, 0, Math.PI, 0);
    c.fill();
  }
  // face
  c.fillStyle = '#151515';
  c.beginPath();
  c.arc(cx - headR * 0.36, hy + headR * 0.05, headR * 0.1, 0, Math.PI * 2);
  c.arc(cx + headR * 0.36, hy + headR * 0.05, headR * 0.1, 0, Math.PI * 2);
  c.fill();
  c.fillRect(cx - headR * 0.25, hy + headR * 0.55, headR * 0.5, headR * 0.07);
  if (look.glasses) {
    c.strokeStyle = '#151515';
    c.lineWidth = Math.max(1.5, headR * 0.08);
    c.beginPath();
    c.arc(cx - headR * 0.36, hy + headR * 0.05, headR * 0.26, 0, Math.PI * 2);
    c.moveTo(cx + headR * 0.62, hy + headR * 0.05);
    c.arc(cx + headR * 0.36, hy + headR * 0.05, headR * 0.26, 0, Math.PI * 2);
    c.stroke();
  }
  if (look.beard) {
    c.fillStyle = look.hair;
    c.beginPath();
    c.ellipse(cx, hy + headR * 0.6, headR * 0.85, headR * 0.5, 0, 0, Math.PI);
    c.fill();
  }
  c.restore();
}

export function fmtPct(v) {
  return `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
}
