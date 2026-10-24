// Shared screen plumbing in the Kronkel style: base class, HUD with the smiley mascot, cards,
// modals, the pause menu, receipts and the ID-card portrait.
import { C } from '../gui.js';
import { sfx } from '../audio.js';
import { t, LANGS, getLang } from '../i18n.js';

/** The logo smiley as a living HUD mascot: hops on good moments, shakes on bad ones. */
export class Mascot {
  constructor() {
    this.t = 0;
    this.kind = null;
    this.k = 0;
  }

  react(kind) {
    this.kind = kind;
    this.k = 1;
  }

  update(dt) {
    this.t += dt;
    this.k = Math.max(0, this.k - dt * 1.4);
  }

  draw(gui, x, y, size) {
    const S = gui.S;
    let dx = 0;
    let dy = Math.sin(this.t * 2.1) * 2 * S;
    let rot = Math.sin(this.t * 1.4) * 0.05;
    const k = this.k;
    if (this.kind === 'good' && k > 0) {
      dy -= Math.sin(k * Math.PI) * 16 * S;
      rot += Math.sin(k * Math.PI) * 0.35;
    } else if (this.kind === 'bad' && k > 0) {
      dx = Math.sin(this.t * 55) * 7 * S * k;
      rot -= 0.25 * k;
    }
    gui.image(gui.logo, x + dx, y + dy, size, size, rot);
    if (this.kind === 'bad' && k > 0.2) {
      gui.text('!', x + size * 0.92 + dx, y + size * 0.3 + dy, size * 0.5, { font: 'display', color: C.red, align: 'center',
        stroke: C.ink, strokeW: 5 * S });
    }
  }
}

export class BaseScreen {
  constructor(game, params = {}) {
    this.game = game;
    this.params = params;
    this.paused = false;
    this.modal = null;
    this.mascot = new Mascot();
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

  /** color: C.yellow good, C.red bad, anything else = info */
  toast(text, color = C.paper) {
    this.game.gui.toast(text, color);
    if (this.game.xr?.active) this.game.xr.gui.toast(text, color);
    if (color === C.yellow) this.mascot.react('good');
    if (color === C.red) this.mascot.react('bad');
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

  onPause() {
    if (!this.pausable) return;
    this.paused = !this.paused;
    sfx.pop();
  }

  drawPause(gui) {
    if (!this.paused) return;
    const S = gui.S;
    gui.blocker();
    if (this.overlay) {
      this.overlay.draw(gui);
      return;
    }
    gui.dim(0.65);
    const w = Math.min(gui.w - 32 * S, 380 * S);
    const h = 318 * S;
    const x = (gui.w - w) / 2;
    const y = (gui.h - h) / 2 + 10 * S;
    gui.card(x, y, w, h, { tone: 'ink' });
    gui.tiles(t('pause.title'), gui.w / 2, y - 24 * S, 46 * S, { align: 'center', tilt: -0.03 });
    gui.text(t('pause.sub'), gui.w / 2, y + 60 * S, 22 * S, { font: 'label', color: C.yellow, align: 'center', upper: true,
      max: w - 30 * S });
    const bw = w - 48 * S;
    const bh = 56 * S;
    let by = y + 86 * S;
    gui.button(x + 24 * S, by, bw, bh, t('pause.resume'), () => { this.paused = false; }, { kind: 'yellow', icon: 'play',
      size: 20 * S });
    by += bh + 16 * S;
    gui.button(x + 24 * S, by, bw, bh, t('btn.howto'), () => this.openHowto(this.howtoTab), { icon: 'book', size: 20 * S });
    by += bh + 16 * S;
    gui.button(x + 24 * S, by, bw, bh, t('pause.quit'), () => {
      this.onQuit?.();
      this.game.setScreen('title');
    }, { kind: 'red', icon: 'back', size: 20 * S });
  }

  drawModal(gui) {
    const m = this.modal;
    if (!m) return;
    const S = gui.S;
    gui.blocker();
    gui.dim(0.6);
    const w = Math.min(gui.w - 32 * S, (m.width || 470) * S);
    const lines = gui.wrap(m.text || '', w - 48 * S, 16 * S);
    const h = 150 * S + lines.length * 16 * S * 1.38;
    const x = (gui.w - w) / 2;
    const y = Math.max(16, (gui.h - h) / 2);
    gui.card(x, y, w, h, { tone: 'paper', label: m.title, labelColor: m.color === C.red ? C.red : C.ink, labelText: C.paper });
    gui.paragraph(m.text || '', x + 24 * S, y + 30 * S, w - 48 * S, 16 * S, { color: C.ink });
    const btns = m.buttons || [{ label: t('btn.ok'), kind: 'yellow' }];
    const bh = 52 * S;
    const by = y + h - bh - 22 * S;
    const gap = 12 * S;
    const bw = (w - 48 * S - gap * (btns.length - 1)) / btns.length;
    btns.forEach((b, i) => {
      gui.button(x + 24 * S + i * (bw + gap), by, bw, bh, b.label, () => {
        this.modal = null;
        b.onClick?.();
      }, { kind: b.kind || 'paper', size: 17 * S });
    });
  }
}

/**
 * The in-game HUD: smiley mascot on the left, stats as tilted paper stickers, pause button on the right.
 * items: [{label, value, color, w, draw}] — color tints the value (C.red for trouble).
 */
export function hud(gui, screen, items, { onPause = null } = {}) {
  const S = gui.S;
  const y = gui.safe.top + 10 * S;
  const h = 50 * S;
  let x = gui.safe.left + 10 * S;
  const ms = 54 * S;
  screen.mascot.draw(gui, x - 2 * S, y - 3 * S, ms);
  x += ms + 6 * S;
  const right = gui.w - gui.safe.right - 10 * S - (onPause ? h + 10 * S : 0);
  items.forEach((it, i) => {
    const w = it.w ? it.w * S : Math.max(66 * S, gui.measure(String(it.value), 20 * S, 'display') + 26 * S);
    if (x + w > right) return;
    const tilt = i % 2 ? 0.025 : -0.02;
    gui.tilted(x + w / 2, y + h / 2, tilt, () => {
      gui.sticker(x, y, w, h, { fill: it.fill || C.paper, r: 7, shadow: 4, outline: 2.5 });
      if (it.draw) it.draw(x, y, w, h);
      else {
        gui.text(it.label, x + w / 2, y + 15 * S, 11.5 * S, { font: 'label', color: C.red, align: 'center', upper: true });
        const vc = it.color === C.red ? C.red : C.ink;
        gui.text(String(it.value), x + w / 2, y + 40 * S, 20 * S, { font: 'display', color: vc, align: 'center',
          max: w - 10 * S });
      }
    });
    x += w + 8 * S;
  });
  if (onPause) {
    gui.button(gui.w - gui.safe.right - 10 * S - h, y, h, h, '', onPause, { kind: 'ink', icon: 'pause', size: 20 * S,
      id: 'hud-pause' });
  }
  return y + h;
}

/** Card with a tape label; returns the inner content rect. */
export function panel(gui, x, y, w, h, title = null, opts = {}) {
  return gui.card(x, y, w, h, { tone: opts.tone || 'ink', label: title, labelColor: opts.labelColor || C.yellow,
    labelText: opts.labelText || C.ink });
}

export function vrButton(game, gui, x, y, w, h) {
  if (!game.xrSupported) return;
  if (game.xr.active) {
    gui.button(x, y, w, h, t('vr.exit'), () => game.xr.exit(), { icon: 'vr', kind: 'ink' });
  } else {
    gui.button(x, y, w, h, t('vr.enter'), () => {
      game.xr.enter().catch((e) => game.gui.toast(t('vr.failed', { msg: e.message }), C.red));
    }, { icon: 'vr', kind: 'ink', textColor: C.yellow });
  }
}

/** NL / EN / DE sticker chips, right-aligned at `right`. Returns the left edge. */
export function langChips(gui, game, right, y, { size = 40, tilt = 0.02 } = {}) {
  const S = gui.S;
  const w = size * 1.25 * S;
  const h = size * S;
  const gap = 6 * S;
  let x = right - LANGS.length * w - (LANGS.length - 1) * gap;
  const left = x;
  for (const l of LANGS) {
    gui.button(x, y, w, h, l.short, () => game.setLang(l.id), { kind: 'ink', selected: getLang() === l.id,
      size: size * 0.42 * S, id: `lang-${l.id}`, tilt, font: 'display' });
    x += w + gap;
  }
  return left;
}

/** Little ID-card portrait from a look. */
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
  c.fillStyle = look.shirt;
  c.beginPath();
  c.ellipse(cx, y + h * 1.02, w * 0.46, h * 0.32, 0, 0, Math.PI * 2);
  c.fill();
  if (look.top === 'jacket') {
    // open jacket: two panels over the shirt
    c.fillStyle = look.jacket || '#2a2f3a';
    for (const side of [-1, 1]) {
      c.beginPath();
      c.ellipse(cx + side * w * 0.3, y + h * 1.04, w * 0.24, h * 0.33, 0, 0, Math.PI * 2);
      c.fill();
    }
  } else if (look.top === 'hoodie') {
    // hood rolled around the neck
    c.strokeStyle = look.shirt;
    c.lineWidth = w * 0.09;
    c.beginPath();
    c.ellipse(cx, y + h * 0.74, w * 0.2, h * 0.07, 0, Math.PI * 0.05, Math.PI * 0.95, true);
    c.stroke();
  }
  c.fillStyle = look.skin;
  c.fillRect(cx - headR * 0.35, hy + headR * 0.6, headR * 0.7, headR * 0.7);
  c.beginPath();
  c.ellipse(cx, hy, headR, headR * 1.1, 0, 0, Math.PI * 2);
  c.fill();
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
  } else if (s === 'hair_buzz') {
    c.globalAlpha = 0.75;
    c.beginPath();
    c.ellipse(cx, hy - headR * 0.3, headR * 1.0, headR * 0.78, 0, Math.PI, 0);
    c.fill();
    c.globalAlpha = 1;
  } else if (s === 'hair_pony') {
    c.beginPath();
    c.ellipse(cx, hy - headR * 0.25, headR * 1.04, headR * 0.86, 0, Math.PI, 0);
    c.fill();
    c.beginPath();
    c.ellipse(cx + headR * 1.0, hy + headR * 0.2, headR * 0.22, headR * 0.6, 0.3, 0, Math.PI * 2);
    c.fill();
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

/** Thermal-paper receipt (kassabon / dagafsluiting) with a torn zig-zag bottom edge. */
export function receipt(gui, x, y, w, h, { tilt = 0.012 } = {}) {
  const S = gui.S;
  const c = gui.ctx;
  gui.tilted(x + w / 2, y + h / 2, tilt, () => {
    const path = (ox, oy) => {
      c.beginPath();
      c.moveTo(x + ox, y + oy);
      c.lineTo(x + w + ox, y + oy);
      const n = Math.max(8, Math.round(w / (14 * S)));
      for (let i = 0; i <= n; i++) c.lineTo(x + w + ox - (w * i) / n, y + h + oy - (i % 2 ? 9 * S : 0));
      c.closePath();
    };
    path(6 * S, 6 * S);
    c.fillStyle = C.ink;
    c.fill();
    path(0, 0);
    c.fillStyle = '#fbf8f0';
    c.fill();
    c.lineWidth = 2.5 * S;
    c.strokeStyle = C.ink;
    c.stroke();
  });
}

/** Dashed rule line for receipts. */
export function dashes(gui, x, y, w, color = 'rgba(18,16,21,0.45)') {
  const c = gui.ctx;
  c.save();
  c.setLineDash([5 * gui.S, 4 * gui.S]);
  c.strokeStyle = color;
  c.lineWidth = 1.5 * gui.S;
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(x + w, y);
  c.stroke();
  c.restore();
}

/** Receipt line: label left, value right, in the receipt typewriter style. */
export function rline(gui, x, y, w, label, value, { size = 15, bold = false, color = C.ink } = {}) {
  const S = gui.S;
  gui.text(label, x, y, size * S, { font: RECEIPT, weight: bold ? 700 : 400, color, max: w * 0.66 });
  gui.text(value, x + w, y, size * S, { font: RECEIPT, weight: bold ? 700 : 400, color, align: 'right' });
}

export const RECEIPT = '"Courier New", Courier, monospace';
