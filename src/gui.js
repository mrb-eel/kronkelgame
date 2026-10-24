// Immediate-mode canvas GUI.
// Screens redraw every frame and register widgets with click callbacks. Clicks are dispatched
// synchronously inside the pointer/XR event handler (so things like requestSession, audio unlock
// and vibration keep their user activation). The same Gui class draws to the full-screen overlay
// canvas and to the 1280x800 canvas used as the VR panel texture.
import { clamp } from './util.js';

export const C = {
  panel: 'rgba(12, 26, 18, 0.9)',
  panel2: 'rgba(24, 46, 32, 0.94)',
  panelLight: 'rgba(246, 239, 217, 0.96)',
  line: 'rgba(255,255,255,0.09)',
  text: '#f6efd9',
  dim: '#aebba5',
  dark: '#10201a',
  accent: '#9fe07a',
  accentDark: '#4f8f3a',
  gold: '#ffcf5a',
  red: '#ff6b6b',
  blue: '#7ab8ff',
  pink: '#ff7fb6',
  btn: '#2b5a3c',
  btnHi: '#377050',
  btnDisabled: '#26332b',
};
export const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const SERIF = '"Kronkel Serif", "DejaVu Serif", Georgia, serif';

export class Gui {
  constructor(canvas, { fixed = null, dprCap = 2 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fixed = fixed; // {w,h} logical size for offscreen (VR) canvases
    this.dprCap = dprCap;
    this.w = fixed ? fixed.w : 800;
    this.h = fixed ? fixed.h : 600;
    this.dpr = 1;
    this.widgets = [];
    this.prevWidgets = [];
    this.focusId = null;
    this.navMode = false; // show focus ring (keyboard / gamepad / VR stick)
    this.pointer = { x: -1, y: -1, down: false, id: null, sx: 0, sy: 0, moved: 0, touch: false };
    this.pressedId = null;
    this.toasts = [];
    this.floats = [];
    this.time = 0;
    this.onWorldClick = null;
    this.onWorldDrag = null;
    this.onClickSound = null;
    this.project = null; // (vec3) => {x,y,visible}
    this.safe = { top: 0, bottom: 0, left: 0, right: 0 };
    if (fixed) this.resize(fixed.w, fixed.h, 1);
  }

  get S() {
    return clamp(Math.min(this.w / 1.6, this.h) / 560, 0.78, 1.3);
  }

  get portrait() {
    return this.h > this.w * 1.05;
  }

  resize(w, h, dpr = 1) {
    this.w = w;
    this.h = h;
    this.dpr = Math.min(dpr, this.dprCap);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    if (!this.fixed) {
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
    }
  }

  begin(dt) {
    this.time += dt;
    this.prevWidgets = this.widgets;
    this.widgets = [];
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    c.textBaseline = 'alphabetic';
  }

  end(dt) {
    this._drawFloats(dt);
    this._drawToasts(dt);
    if (this.navMode) {
      const f = this.widgets.find((w) => w.id === this.focusId);
      if (f && f.ring !== false) {
        const c = this.ctx;
        const pulse = 0.6 + 0.4 * Math.sin(this.time * 6);
        c.save();
        c.strokeStyle = `rgba(255, 207, 90, ${pulse})`;
        c.lineWidth = 3;
        this.rr(f.x - 4, f.y - 4, f.w + 8, f.h + 8, (f.r || 12) + 4);
        c.stroke();
        c.restore();
      } else if (!f) {
        this._ensureFocus();
      }
    }
  }

  // ------------------------------------------------------------------ drawing
  rr(x, y, w, h, r) {
    const c = this.ctx;
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  box(x, y, w, h, { r = 14, fill = C.panel, stroke = C.line, lw = 1, shadow = false } = {}) {
    const c = this.ctx;
    if (shadow) {
      c.save();
      c.shadowColor = 'rgba(0,0,0,0.45)';
      c.shadowBlur = 18;
      c.shadowOffsetY = 6;
    }
    this.rr(x, y, w, h, r);
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (shadow) c.restore();
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = lw;
      c.stroke();
    }
  }

  font(size, weight = 600, family = FONT) {
    return `${weight} ${Math.round(size)}px ${family}`;
  }

  text(s, x, y, size = 16, { color = C.text, weight = 600, align = 'left', base = 'alphabetic', family = FONT,
    max = 0, shadow = false } = {}) {
    const c = this.ctx;
    c.font = this.font(size, weight, family);
    c.fillStyle = color;
    c.textAlign = align;
    c.textBaseline = base;
    if (shadow) {
      c.save();
      c.shadowColor = 'rgba(0,0,0,0.6)';
      c.shadowBlur = 6;
      c.shadowOffsetY = 2;
    }
    if (max > 0) {
      // shrink to fit
      let sz = size;
      while (sz > 8 && c.measureText(s).width > max) {
        sz -= 1;
        c.font = this.font(sz, weight, family);
      }
    }
    c.fillText(s, x, y);
    if (shadow) c.restore();
    c.textBaseline = 'alphabetic';
  }

  measure(s, size = 16, weight = 600, family = FONT) {
    this.ctx.font = this.font(size, weight, family);
    return this.ctx.measureText(s).width;
  }

  wrap(s, maxW, size = 16, weight = 500) {
    const out = [];
    for (const para of String(s).split('\n')) {
      const words = para.split(' ');
      let line = '';
      for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (this.measure(test, size, weight) > maxW && line) {
          out.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      out.push(line);
    }
    return out;
  }

  paragraph(s, x, y, maxW, size = 15, { color = C.dim, weight = 500, lh = 1.4, align = 'left' } = {}) {
    const lines = this.wrap(s, maxW, size, weight);
    lines.forEach((l, i) => this.text(l, x, y + size + i * size * lh, size, { color, weight, align }));
    return lines.length * size * lh;
  }

  bar(x, y, w, h, frac, color = C.accent, bg = 'rgba(255,255,255,0.12)') {
    this.box(x, y, w, h, { r: h / 2, fill: bg, stroke: null });
    if (frac > 0) this.box(x, y, Math.max(h, w * clamp(frac, 0, 1)), h, { r: h / 2, fill: color, stroke: null });
  }

  star(cx, cy, r, fill = C.gold, stroke = null) {
    const c = this.ctx;
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 ? r * 0.45 : r;
      c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    c.closePath();
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = 1.5;
      c.stroke();
    }
  }

  stars(x, y, r, value, max = 5) {
    for (let i = 0; i < max; i++) {
      const cx = x + i * r * 2.3 + r;
      this.star(cx, y, r, 'rgba(255,255,255,0.15)');
      const f = clamp(value - i, 0, 1);
      if (f > 0) {
        const c = this.ctx;
        c.save();
        c.beginPath();
        c.rect(cx - r, y - r, r * 2 * f, r * 2);
        c.clip();
        this.star(cx, y, r, C.gold);
        c.restore();
      }
    }
  }

  /** KRONKEL wordmark; pass the logo image to put the sunglasses smiley above it. */
  logo(cx, cy, size, img = null) {
    if (img?.complete && img.naturalWidth) {
      const s = size * 1.6;
      this.ctx.drawImage(img, cx - s / 2, cy - size * 0.95 - s, s, s);
    }
    this.text('KRONKEL', cx, cy, size, { color: C.gold, weight: 700, align: 'center', family: SERIF, shadow: true });
  }

  image(img, x, y, w, h) {
    if (img?.complete && img.naturalWidth) this.ctx.drawImage(img, x, y, w, h);
  }

  // ------------------------------------------------------------------ widgets
  _register(w) {
    this.widgets.push(w);
    return w;
  }

  /** Invisible clickable region. */
  region(x, y, w, h, onClick, { id, focusable = false, r = 12, ring = true, data } = {}) {
    return this._register({ id: id || `region@${x | 0},${y | 0}`, x, y, w, h, r, onClick, focusable, ring, data });
  }

  /** Swallow clicks below this point (modal backdrop). */
  blocker(onClick = null) {
    this.widgets = this.widgets.filter((w) => w.keepAboveBlocker);
    return this._register({ id: 'blocker', x: 0, y: 0, w: this.w, h: this.h, onClick, focusable: false, blocker: true });
  }

  isHot(id) {
    return this.pointer.id === id;
  }

  button(x, y, w, h, label, onClick, opts = {}) {
    const {
      id = `${label}@${x | 0},${y | 0}`,
      kind = 'normal', // normal | primary | danger | ghost | gold
      disabled = false,
      size = 16 * this.S,
      sub = null,
      icon = null,
      align = 'center',
      r = 12,
      selected = false,
      badge = null,
      color = null,
    } = opts;
    const hover = !this.pointer.touch && this._inside(x, y, w, h) && !disabled;
    const pressed = this.pressedId === id && this.pointer.down && this._inside(x, y, w, h);
    let fill = C.btn;
    let tc = C.text;
    if (kind === 'primary') {
      fill = C.accent;
      tc = C.dark;
    } else if (kind === 'danger') {
      fill = '#7a2b2b';
    } else if (kind === 'gold') {
      fill = C.gold;
      tc = C.dark;
    } else if (kind === 'ghost') {
      fill = 'rgba(255,255,255,0.06)';
    }
    if (color) fill = color;
    if (selected) {
      fill = C.accent;
      tc = C.dark;
    }
    if (disabled) {
      fill = C.btnDisabled;
      tc = 'rgba(246,239,217,0.35)';
    }
    const off = pressed ? 2 : 0;
    const c = this.ctx;
    c.save();
    if (!disabled && kind !== 'ghost') {
      this.rr(x, y + 3, w, h, r);
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.fill();
    }
    this.rr(x, y + off, w, h, r);
    c.fillStyle = fill;
    c.fill();
    if (hover) {
      c.fillStyle = 'rgba(255,255,255,0.10)';
      c.fill();
    }
    c.restore();
    const ty = y + off + h / 2 + (sub ? -size * 0.25 : size * 0.35);
    let tx = align === 'center' ? x + w / 2 : x + 14 * this.S;
    if (icon) {
      const iw = size * 1.2;
      if (align === 'center') {
        const tw = this.measure(label, size, 700) + iw;
        this._icon(icon, x + w / 2 - tw / 2 + iw * 0.4, y + off + h / 2, size, tc);
        tx = x + w / 2 + iw / 2;
      } else {
        this._icon(icon, tx + iw * 0.4, y + off + h / 2, size, tc);
        tx += iw;
      }
    }
    this.text(label, tx, ty, size, { color: tc, weight: 700, align, max: w - 16 - (icon ? size * 1.2 : 0) });
    if (sub) {
      this.text(sub, align === 'center' ? x + w / 2 : tx, ty + size * 1.05, size * 0.72,
        { color: kind === 'primary' || selected ? 'rgba(16,32,26,0.75)' : C.dim, weight: 600, align, max: w - 16 });
    }
    if (badge !== null && badge !== undefined) {
      const bw = Math.max(22, this.measure(String(badge), 12 * this.S, 800) + 12);
      this.box(x + w - bw * 0.75, y - 8, bw, 22, { r: 11, fill: C.red, stroke: null });
      this.text(String(badge), x + w - bw * 0.75 + bw / 2, y + 7, 12 * this.S, { color: '#fff', weight: 800, align: 'center' });
    }
    return this._register({ id, x, y, w, h, r, onClick: disabled ? null : onClick, focusable: !disabled, disabled,
      primary: kind === 'primary' });
  }

  _icon(name, cx, cy, size, color) {
    const c = this.ctx;
    c.save();
    c.fillStyle = color;
    c.strokeStyle = color;
    c.lineWidth = Math.max(2, size * 0.12);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const s = size * 0.5;
    switch (name) {
      case 'play':
        c.beginPath();
        c.moveTo(cx - s * 0.6, cy - s * 0.8);
        c.lineTo(cx + s * 0.8, cy);
        c.lineTo(cx - s * 0.6, cy + s * 0.8);
        c.closePath();
        c.fill();
        break;
      case 'pause':
        c.fillRect(cx - s * 0.7, cy - s * 0.8, s * 0.5, s * 1.6);
        c.fillRect(cx + s * 0.2, cy - s * 0.8, s * 0.5, s * 1.6);
        break;
      case 'check':
        c.beginPath();
        c.moveTo(cx - s * 0.8, cy);
        c.lineTo(cx - s * 0.2, cy + s * 0.6);
        c.lineTo(cx + s * 0.9, cy - s * 0.7);
        c.stroke();
        break;
      case 'cross':
        c.beginPath();
        c.moveTo(cx - s * 0.7, cy - s * 0.7);
        c.lineTo(cx + s * 0.7, cy + s * 0.7);
        c.moveTo(cx + s * 0.7, cy - s * 0.7);
        c.lineTo(cx - s * 0.7, cy + s * 0.7);
        c.stroke();
        break;
      case 'back':
        c.beginPath();
        c.moveTo(cx + s * 0.5, cy - s * 0.8);
        c.lineTo(cx - s * 0.4, cy);
        c.lineTo(cx + s * 0.5, cy + s * 0.8);
        c.stroke();
        break;
      case 'plus':
      case 'minus':
        c.beginPath();
        c.moveTo(cx - s * 0.7, cy);
        c.lineTo(cx + s * 0.7, cy);
        if (name === 'plus') {
          c.moveTo(cx, cy - s * 0.7);
          c.lineTo(cx, cy + s * 0.7);
        }
        c.stroke();
        break;
      case 'vr':
        this.rr(cx - s, cy - s * 0.55, s * 2, s * 1.1, s * 0.4);
        c.fill();
        c.fillStyle = 'rgba(0,0,0,0.45)';
        c.beginPath();
        c.arc(cx - s * 0.45, cy, s * 0.28, 0, Math.PI * 2);
        c.arc(cx + s * 0.45, cy, s * 0.28, 0, Math.PI * 2);
        c.fill();
        break;
      case 'gear':
        c.beginPath();
        c.arc(cx, cy, s * 0.55, 0, Math.PI * 2);
        c.stroke();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          c.beginPath();
          c.moveTo(cx + Math.cos(a) * s * 0.7, cy + Math.sin(a) * s * 0.7);
          c.lineTo(cx + Math.cos(a) * s * 0.95, cy + Math.sin(a) * s * 0.95);
          c.stroke();
        }
        break;
      case 'card':
        this.rr(cx - s, cy - s * 0.65, s * 2, s * 1.3, s * 0.2);
        c.fill();
        c.fillStyle = 'rgba(0,0,0,0.35)';
        c.fillRect(cx - s, cy - s * 0.35, s * 2, s * 0.3);
        break;
      case 'cash':
        this.rr(cx - s, cy - s * 0.55, s * 2, s * 1.1, s * 0.15);
        c.fill();
        c.fillStyle = 'rgba(0,0,0,0.35)';
        c.beginPath();
        c.arc(cx, cy, s * 0.32, 0, Math.PI * 2);
        c.fill();
        break;
      case 'stairs':
        c.beginPath();
        c.moveTo(cx - s, cy + s * 0.8);
        c.lineTo(cx - s * 0.33, cy + s * 0.8);
        c.lineTo(cx - s * 0.33, cy + s * 0.1);
        c.lineTo(cx + s * 0.33, cy + s * 0.1);
        c.lineTo(cx + s * 0.33, cy - s * 0.6);
        c.lineTo(cx + s, cy - s * 0.6);
        c.stroke();
        break;
      case 'id':
        this.rr(cx - s, cy - s * 0.65, s * 2, s * 1.3, s * 0.2);
        c.stroke();
        c.beginPath();
        c.arc(cx - s * 0.45, cy - s * 0.1, s * 0.25, 0, Math.PI * 2);
        c.fill();
        c.fillRect(cx + s * 0.05, cy - s * 0.3, s * 0.65, s * 0.15);
        c.fillRect(cx + s * 0.05, cy + s * 0.05, s * 0.5, s * 0.15);
        break;
      default:
        break;
    }
    c.restore();
  }

  // ------------------------------------------------------------------ feedback
  toast(msg, color = C.text, dur = 2.6) {
    this.toasts.push({ msg, color, t: 0, dur });
    if (this.toasts.length > 4) this.toasts.shift();
  }

  float(text, x, y, color = C.gold) {
    this.floats.push({ text, x, y, color, t: 0 });
  }

  floatWorld(text, pos, color = C.gold) {
    this.floats.push({ text, pos: pos.clone ? pos.clone() : pos, color, t: 0 });
  }

  _drawToasts(dt) {
    let y = this.safe.top + 70 * this.S;
    for (const t of this.toasts) {
      t.t += dt;
      const a = clamp(Math.min(t.t * 6, (t.dur - t.t) * 3), 0, 1);
      if (a <= 0) continue;
      const size = 16 * this.S;
      const w = Math.min(this.w - 40, this.measure(t.msg, size, 700) + 36);
      const c = this.ctx;
      c.save();
      c.globalAlpha = a;
      this.box(this.w / 2 - w / 2, y, w, size * 2.3, { r: size * 1.15, fill: 'rgba(10,20,14,0.92)', stroke: t.color + '66' });
      this.text(t.msg, this.w / 2, y + size * 1.5, size, { color: t.color, weight: 700, align: 'center', max: w - 24 });
      c.restore();
      y += size * 2.7;
    }
    this.toasts = this.toasts.filter((t) => t.t < t.dur);
  }

  _drawFloats(dt) {
    for (const f of this.floats) {
      f.t += dt;
      let x = f.x;
      let y = f.y;
      if (f.pos && this.project) {
        const p = this.project(f.pos);
        if (!p.visible) continue;
        x = p.x;
        y = p.y;
      }
      const c = this.ctx;
      c.save();
      c.globalAlpha = clamp(1.6 - f.t, 0, 1);
      this.text(f.text, x, y - f.t * 40, 20 * this.S, { color: f.color, weight: 800, align: 'center', shadow: true });
      c.restore();
    }
    this.floats = this.floats.filter((f) => f.t < 1.6);
  }

  // ------------------------------------------------------------------ input
  _inside(x, y, w, h, px = this.pointer.x, py = this.pointer.y) {
    return px >= x && px <= x + w && py >= y && py <= y + h;
  }

  _hit(px, py) {
    const list = this.widgets.length ? this.widgets : this.prevWidgets;
    for (let i = list.length - 1; i >= 0; i--) {
      const w = list[i];
      if (px >= w.x && px <= w.x + w.w && py >= w.y && py <= w.y + w.h) return w;
    }
    return null;
  }

  pointerDown(x, y, touch = false) {
    this.navMode = false;
    this.pointer = { ...this.pointer, x, y, down: true, sx: x, sy: y, moved: 0, touch };
    const w = this._hit(x, y);
    this.pressedId = w ? w.id : null;
    this.pointer.id = this.pressedId;
    this.pointer.world = !w;
  }

  pointerMove(x, y, touch = false) {
    const dx = x - this.pointer.x;
    const dy = y - this.pointer.y;
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.touch = touch;
    if (this.pointer.down) {
      this.pointer.moved += Math.abs(dx) + Math.abs(dy);
      if (this.pointer.world && this.onWorldDrag) this.onWorldDrag(dx, dy);
    }
  }

  pointerUp(x, y) {
    const wasWorld = this.pointer.world;
    const moved = this.pointer.moved;
    this.pointer.down = false;
    this.pointer.x = x;
    this.pointer.y = y;
    const w = this._hit(x, y);
    const pressed = this.pressedId;
    this.pressedId = null;
    this.pointer.id = null;
    if (w && w.id === pressed && w.onClick) {
      this.onClickSound?.(w);
      w.onClick(w);
      return true;
    }
    if (wasWorld && !w && moved < 14 && this.onWorldClick) {
      this.onWorldClick(x, y);
      return true;
    }
    return false;
  }

  pointerCancel() {
    this.pointer.down = false;
    this.pressedId = null;
  }

  _focusables() {
    const list = this.widgets.length ? this.widgets : this.prevWidgets;
    // Only widgets above the last blocker are reachable.
    let start = 0;
    list.forEach((w, i) => {
      if (w.blocker) start = i + 1;
    });
    return list.slice(start).filter((w) => w.focusable && w.onClick);
  }

  _ensureFocus() {
    const f = this._focusables();
    if (!f.length) return null;
    if (!f.some((w) => w.id === this.focusId)) {
      const p = f.find((w) => w.primary) || f[0];
      this.focusId = p.id;
    }
    return f.find((w) => w.id === this.focusId);
  }

  nav(dx, dy) {
    const wasNav = this.navMode;
    this.navMode = true;
    const cur = this._ensureFocus();
    if (!cur || !wasNav) return;
    const cx = cur.x + cur.w / 2;
    const cy = cur.y + cur.h / 2;
    let best = null;
    let bestScore = Infinity;
    for (const w of this._focusables()) {
      if (w.id === cur.id) continue;
      const wx = w.x + w.w / 2;
      const wy = w.y + w.h / 2;
      const ddx = wx - cx;
      const ddy = wy - cy;
      const along = ddx * dx + ddy * dy;
      if (along <= 4) continue;
      const across = Math.abs(ddx * dy) + Math.abs(ddy * dx);
      const score = along + across * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = w;
      }
    }
    if (best) this.focusId = best.id;
  }

  activate() {
    this.navMode = true;
    const cur = this._ensureFocus();
    if (cur && cur.onClick) {
      this.onClickSound?.(cur);
      cur.onClick(cur);
    }
  }
}
