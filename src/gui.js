// Immediate-mode canvas GUI in Kronkel's own visual language.
//
// The look comes straight from the shop's identity: the yellow smiley with its thick black outline,
// the red-on-white letter tiles of the tall alley sign, the black "COFFEESHOP" strip, and the purple /
// pink neon inside. So: sticker shapes with heavy ink outlines and hard offset shadows, sign tiles for
// headings, masking-tape labels, comic speech balloons, receipts, smileys instead of stars.
//
// Screens redraw every frame and register widgets with click callbacks. Clicks are dispatched inside
// the pointer / XR event handler (keeps user activation for XR, audio, vibration). The same Gui draws
// to the full-screen overlay and to the 1280x800 canvas used as the VR panel texture.
import { clamp } from './util.js';

export const C = {
  ink: '#121015',
  ink2: '#221d27',
  paper: '#f5efe1',
  paper2: '#e6dcc7',
  yellow: '#ffc814',
  yellowDeep: '#e3a600',
  red: '#d51f2b',
  redDeep: '#8f1019',
  purple: '#9a45ff',
  pink: '#ff4f8a',
  teal: '#3f8a86',
  grey: '#6d665d',
  dim: '#b3aa9c',
  white: '#ffffff',
  // legacy names kept for readability at call sites
  text: '#f5efe1',
  gold: '#ffc814',
};

export const F = {
  display: '"Archivo Black", Impact, "Arial Black", sans-serif',
  label: '"Barlow Condensed", "Arial Narrow", sans-serif',
  body: 'Barlow, system-ui, -apple-system, "Segoe UI", sans-serif',
};

export class Gui {
  constructor(canvas, { fixed = null, dprCap = 2 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fixed = fixed;
    this.dprCap = dprCap;
    this.w = fixed ? fixed.w : 800;
    this.h = fixed ? fixed.h : 600;
    this.dpr = 1;
    this.widgets = [];
    this.prevWidgets = [];
    this.focusId = null;
    this.navMode = false;
    this.pointer = { x: -1, y: -1, down: false, id: null, sx: 0, sy: 0, moved: 0, touch: false };
    this.pressedId = null;
    this.toasts = [];
    this.toastShift = 0;
    this.floats = [];
    this.time = 0;
    this.onWorldClick = null;
    this.onWorldDrag = null;
    this.onClickSound = null;
    this.project = null;
    this.logo = null; // HTMLImageElement of the Kronkel smiley
    this.safe = { top: 0, bottom: 0, left: 0, right: 0 };
    this._dots = null;
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
    c.lineJoin = 'round';
    c.lineCap = 'round';
  }

  end(dt) {
    this._drawFloats(dt);
    this._drawToasts(dt);
    if (this.navMode) {
      const f = this.widgets.find((w) => w.id === this.focusId);
      if (f && f.ring !== false) this._focusRing(f);
      else if (!f) this._ensureFocus();
    }
  }

  // Neon focus ring, like the pink drum lamps in the shop
  _focusRing(f) {
    const c = this.ctx;
    const pulse = 0.65 + 0.35 * Math.sin(this.time * 7);
    const o = 5 * this.S;
    c.save();
    c.shadowColor = C.pink;
    c.shadowBlur = 16 * pulse;
    c.strokeStyle = C.pink;
    c.lineWidth = 3.5 * this.S;
    this.rr(f.x - o, f.y - o, f.w + o * 2, f.h + o * 2, (f.r || 10) + o);
    c.stroke();
    c.restore();
  }

  // ------------------------------------------------------------------ primitives
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

  /** Run fn rotated by `tilt` radians around (cx, cy). */
  tilted(cx, cy, tilt, fn) {
    if (!tilt) return fn();
    const c = this.ctx;
    c.save();
    c.translate(cx, cy);
    c.rotate(tilt);
    c.translate(-cx, -cy);
    const r = fn();
    c.restore();
    return r;
  }

  /** The house shape: filled block, heavy ink outline, hard offset shadow (no blur). */
  sticker(x, y, w, h, { fill = C.paper, r = 10, shadow = 5, outline = 3, ink = C.ink, dashed = false } = {}) {
    const c = this.ctx;
    const S = this.S;
    const sh = shadow * S;
    if (sh > 0) {
      this.rr(x + sh, y + sh, w, h, r * S);
      c.fillStyle = ink;
      c.fill();
    }
    this.rr(x, y, w, h, r * S);
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (outline) {
      c.lineWidth = outline * S;
      c.strokeStyle = ink;
      if (dashed) c.setLineDash([6 * S, 5 * S]);
      c.stroke();
      if (dashed) c.setLineDash([]);
    }
  }

  /** Back-compat simple box used by a few overlays. */
  box(x, y, w, h, { r = 10, fill = C.paper, stroke = C.ink, lw = 2 } = {}) {
    const c = this.ctx;
    this.rr(x, y, w, h, r);
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = lw;
      c.stroke();
    }
  }

  dim(alpha = 0.6) {
    const c = this.ctx;
    c.fillStyle = `rgba(10,8,14,${alpha})`;
    c.fillRect(0, 0, this.w, this.h);
    this.halftone(0, 0, this.w, this.h, 'rgba(154,69,255,0.10)', 9);
  }

  /** Print-style dot screen, used on dark panels and backdrops. */
  halftone(x, y, w, h, color = 'rgba(255,255,255,0.05)', step = 7) {
    const key = `${color}|${step}`;
    if (!this._dots || this._dots.key !== key) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = step * 2;
      const g = cv.getContext('2d');
      g.fillStyle = color;
      g.beginPath();
      g.arc(step / 2, step / 2, step * 0.16, 0, Math.PI * 2);
      g.arc(step * 1.5, step * 1.5, step * 0.16, 0, Math.PI * 2);
      g.fill();
      this._dots = { key, pattern: this.ctx.createPattern(cv, 'repeat') };
    }
    const c = this.ctx;
    c.save();
    c.fillStyle = this._dots.pattern;
    c.fillRect(x, y, w, h);
    c.restore();
  }

  font(size, kind = 'body', weight = null) {
    const fam = F[kind] || kind;
    const wgt = weight ?? (kind === 'display' ? 400 : kind === 'label' ? 800 : 500);
    return `${wgt} ${Math.round(size)}px ${fam}`;
  }

  text(s, x, y, size = 16, { color = C.ink, font = 'body', weight = null, align = 'left', base = 'alphabetic', max = 0,
    stroke = null, strokeW = 0, upper = false, spacing = 0 } = {}) {
    const c = this.ctx;
    s = upper ? String(s).toUpperCase() : String(s);
    let sz = size;
    c.font = this.font(sz, font, weight);
    if (max > 0) {
      while (sz > 8 && c.measureText(s).width > max) {
        sz -= 1;
        c.font = this.font(sz, font, weight);
      }
    }
    c.textAlign = align;
    c.textBaseline = base;
    if (spacing && 'letterSpacing' in c) c.letterSpacing = `${spacing}px`;
    if (stroke) {
      c.lineWidth = strokeW || Math.max(2, sz * 0.18);
      c.strokeStyle = stroke;
      c.strokeText(s, x, y);
    }
    c.fillStyle = color;
    c.fillText(s, x, y);
    if (spacing && 'letterSpacing' in c) c.letterSpacing = '0px';
    c.textBaseline = 'alphabetic';
  }

  measure(s, size = 16, font = 'body', weight = null) {
    this.ctx.font = this.font(size, font, weight);
    return this.ctx.measureText(String(s)).width;
  }

  wrap(s, maxW, size = 16, font = 'body', weight = null) {
    const out = [];
    for (const para of String(s).split('\n')) {
      const words = para.split(' ');
      let line = '';
      for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (this.measure(test, size, font, weight) > maxW && line) {
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

  paragraph(s, x, y, maxW, size = 15, { color = C.ink, font = 'body', weight = null, lh = 1.38, align = 'left' } = {}) {
    const lines = this.wrap(s, maxW, size, font, weight);
    lines.forEach((l, i) => this.text(l, x, y + size + i * size * lh, size, { color, font, weight, align }));
    return lines.length * size * lh;
  }

  /** Words as the tall alley sign: red letters on white tiles with a dark red frame. */
  tiles(word, x, y, size, { align = 'left', tilt = 0, gap = 0.1, lit = 0, wobble = 0 } = {}) {
    const letters = [...String(word).toUpperCase()];
    const step = size * (1 + gap);
    const total = letters.length * step - size * gap;
    let x0 = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    const c = this.ctx;
    this.tilted(x0 + total / 2, y + size / 2, tilt, () => {
      letters.forEach((ch, i) => {
        const tx = x0 + i * step;
        const ty = y + (wobble ? Math.sin(this.time * 3 + i * 0.9) * wobble : 0);
        if (ch === ' ') return;
        const on = lit === 0 || i < lit;
        c.save();
        this.rr(tx + size * 0.08, ty + size * 0.08, size, size, size * 0.1);
        c.fillStyle = C.ink;
        c.fill();
        this.rr(tx, ty, size, size, size * 0.1);
        c.fillStyle = C.redDeep;
        c.fill();
        this.rr(tx + size * 0.07, ty + size * 0.07, size * 0.86, size * 0.86, size * 0.06);
        c.fillStyle = on ? C.paper : '#8a8174';
        if (on && lit) {
          c.shadowColor = '#fff3c0';
          c.shadowBlur = size * 0.4;
        }
        c.fill();
        c.restore();
        this.text(ch, tx + size / 2, ty + size * 0.79, size * 0.74, { font: 'display', color: on ? C.red : '#5a5249',
          align: 'center' });
      });
    });
    return total;
  }

  /** Masking-tape label with torn ends. */
  tape(label, cx, cy, { size = 15, color = C.yellow, textColor = C.ink, tilt = -0.03, pad = 14, minW = 0 } = {}) {
    const S = this.S;
    const w = Math.max(minW, this.measure(label, size, 'label') + pad * 2 * S);
    const h = size * 1.75;
    const c = this.ctx;
    this.tilted(cx, cy, tilt, () => {
      const x = cx - w / 2;
      const y = cy - h / 2;
      const teeth = 5;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + w, y);
      for (let i = 1; i <= teeth; i++) c.lineTo(x + w + (i % 2 ? 4 : 0) * S, y + (h * i) / teeth);
      c.lineTo(x, y + h);
      for (let i = teeth - 1; i >= 0; i--) c.lineTo(x + (i % 2 ? -4 : 0) * S, y + (h * i) / teeth);
      c.closePath();
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.save();
      c.translate(3 * S, 3 * S);
      c.fill();
      c.restore();
      c.fillStyle = color;
      c.fill();
      c.lineWidth = 2 * S;
      c.strokeStyle = C.ink;
      c.stroke();
      this.text(label, cx, cy + size * 0.36, size, { font: 'label', color: textColor, align: 'center', upper: true });
    });
    return w;
  }

  /** Comic speech balloon with a tail pointing at (tx, ty). */
  balloon(x, y, w, h, tx, ty) {
    const c = this.ctx;
    const S = this.S;
    const r = 18 * S;
    const bx = clamp(tx, x + r + 12 * S, x + w - r - 26 * S);
    const tailDown = ty > y + h;
    const draw = () => {
      this.rr(x, y, w, h, r);
      if (tailDown) {
        c.moveTo(bx - 12 * S, y + h);
        c.lineTo(tx, ty);
        c.lineTo(bx + 14 * S, y + h);
      }
    };
    c.save();
    c.translate(5 * S, 5 * S);
    draw();
    c.fillStyle = C.ink;
    c.fill();
    c.restore();
    draw();
    c.fillStyle = C.paper;
    c.fill();
    c.lineWidth = 3 * S;
    c.strokeStyle = C.ink;
    c.stroke();
    if (tailDown) {
      // hide the outline seam where the tail joins
      c.beginPath();
      c.moveTo(bx - 10 * S, y + h - 1.6 * S);
      c.lineTo(bx + 12 * S, y + h - 1.6 * S);
      c.lineWidth = 4 * S;
      c.strokeStyle = C.paper;
      c.stroke();
    }
  }

  /** Rubber stamp (GOEDGEKEURD / GEWEIGERD on the ID card). */
  stamp(label, cx, cy, size, color = C.red, tilt = -0.18, alpha = 0.9) {
    const c = this.ctx;
    const w = this.measure(label, size, 'display') + size * 1.1;
    const h = size * 1.6;
    c.save();
    c.globalAlpha = alpha;
    this.tilted(cx, cy, tilt, () => {
      c.lineWidth = size * 0.13;
      c.strokeStyle = color;
      this.rr(cx - w / 2, cy - h / 2, w, h, size * 0.25);
      c.stroke();
      this.rr(cx - w / 2 + size * 0.18, cy - h / 2 + size * 0.18, w - size * 0.36, h - size * 0.36, size * 0.15);
      c.lineWidth = size * 0.05;
      c.stroke();
      this.text(label, cx, cy + size * 0.36, size, { font: 'display', color, align: 'center' });
    });
    c.restore();
  }

  /** Ratings use the Kronkel smiley instead of stars. */
  smileys(x, cy, r, value, max = 5) {
    const c = this.ctx;
    for (let i = 0; i < max; i++) {
      const cx = x + r + i * r * 2.25;
      const f = clamp(value - i, 0, 1);
      c.beginPath();
      c.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.fill();
      c.setLineDash([3, 3]);
      c.lineWidth = Math.max(1.5, r * 0.12);
      c.strokeStyle = 'rgba(245,239,225,0.45)';
      c.stroke();
      c.setLineDash([]);
      if (f > 0 && this.logo?.complete && this.logo.naturalWidth) {
        c.save();
        c.beginPath();
        c.rect(cx - r * 1.2, cy - r * 1.2, r * 2.4 * f, r * 2.4);
        c.clip();
        c.drawImage(this.logo, cx - r * 1.12, cy - r * 1.12, r * 2.24, r * 2.24);
        c.restore();
      }
    }
    return max * r * 2.25;
  }

  /** Back-compat: stars() now draws smileys. */
  stars(x, y, r, value, max = 5) {
    return this.smileys(x, y, r * 1.1, value, max);
  }

  image(img, x, y, w, h, tilt = 0) {
    if (!(img?.complete && img.naturalWidth)) return;
    this.tilted(x + w / 2, y + h / 2, tilt, () => this.ctx.drawImage(img, x, y, w, h));
  }

  bar(x, y, w, h, frac, color = C.yellow, track = 'rgba(0,0,0,0.35)') {
    const c = this.ctx;
    const S = this.S;
    this.rr(x, y, w, h, h / 2);
    c.fillStyle = track;
    c.fill();
    if (frac > 0) {
      this.rr(x, y, Math.max(h, w * clamp(frac, 0, 1)), h, h / 2);
      c.fillStyle = color;
      c.fill();
    }
    this.rr(x, y, w, h, h / 2);
    c.lineWidth = 2 * S;
    c.strokeStyle = C.ink;
    c.stroke();
  }

  /** Card: paper (flyer), ink (night) or yellow. Optional tape label sticking out of the top-left. */
  card(x, y, w, h, { tone = 'paper', label = null, labelColor = C.red, labelText = C.paper, shadow = 6, tilt = 0 } = {}) {
    const S = this.S;
    const fill = tone === 'ink' ? C.ink2 : tone === 'yellow' ? C.yellow : C.paper;
    this.tilted(x + w / 2, y + h / 2, tilt, () => {
      this.sticker(x, y, w, h, { fill, r: 12, shadow, outline: 3 });
      if (tone === 'ink') {
        const c = this.ctx;
        c.save();
        this.rr(x, y, w, h, 12 * S);
        c.clip();
        this.halftone(x, y, w, h, 'rgba(154,69,255,0.13)', 8);
        c.restore();
      }
    });
    if (label) this.tape(label, x + 18 * S + this.measure(label, 15 * S, 'label') / 2 + 14 * S, y + 1 * S,
      { size: 15 * S, color: labelColor, textColor: labelText, tilt: -0.04 });
    return { x: x + 16 * S, y: y + (label ? 26 : 16) * S, w: w - 32 * S, h: h - (label ? 40 : 30) * S };
  }

  /** Back-compat for older call sites. */
  logo(cx, cy, size, img = null) {
    if (img) this.image(img, cx - size * 0.8, cy - size * 1.8, size * 1.6, size * 1.6);
    this.tiles('KRONKEL', cx, cy - size * 0.8, size * 0.8, { align: 'center' });
  }

  // ------------------------------------------------------------------ widgets
  _register(w) {
    this.widgets.push(w);
    return w;
  }

  region(x, y, w, h, onClick, { id, focusable = false, r = 12, ring = true, data } = {}) {
    return this._register({ id: id || `region@${x | 0},${y | 0}`, x, y, w, h, r, onClick, focusable, ring, data });
  }

  blocker(onClick = null) {
    return this._register({ id: 'blocker', x: 0, y: 0, w: this.w, h: this.h, onClick, focusable: false, blocker: true });
  }

  isHot(id) {
    return this.pointer.id === id;
  }

  /**
   * Sticker button. kind: yellow (main action) | paper | ink | red | ghost.
   * Older kind names (primary, gold, danger, normal) map onto these.
   */
  button(x, y, w, h, label, onClick, opts = {}) {
    const {
      id = `${label}@${x | 0},${y | 0}`,
      disabled = false,
      sub = null,
      icon = null,
      align = 'center',
      selected = false,
      badge = null,
      color = null,
      textColor = null,
      tilt = 0,
      font = 'label',
    } = opts;
    let { kind = 'paper', size = 17 * this.S } = opts;
    kind = { primary: 'yellow', gold: 'yellow', danger: 'red', normal: 'paper' }[kind] || kind;
    const S = this.S;
    const inside = this._inside(x, y, w, h);
    const hover = !this.pointer.touch && inside && !disabled;
    const pressed = this.pressedId === id && this.pointer.down && inside;
    let fill = { yellow: C.yellow, paper: C.paper, ink: C.ink2, red: C.red, ghost: 'rgba(18,16,21,0.55)' }[kind];
    let tc = { yellow: C.ink, paper: C.ink, ink: C.paper, red: C.paper, ghost: C.paper }[kind];
    if (selected) {
      fill = C.yellow;
      tc = C.ink;
    }
    if (color) fill = color;
    if (textColor) tc = textColor;
    if (disabled) {
      fill = 'rgba(40,36,44,0.75)';
      tc = 'rgba(245,239,225,0.4)';
    }
    const shadow = disabled || kind === 'ghost' ? 0 : pressed ? 0 : hover ? 6.5 : 4.5;
    const off = pressed ? 4.5 * S : hover ? -1.5 * S : 0;
    this.tilted(x + w / 2, y + h / 2, tilt, () => {
      this.sticker(x + off, y + off, w, h, { fill, r: 9, shadow, outline: kind === 'ghost' ? 2 : 3, dashed: disabled,
        ink: kind === 'ghost' ? 'rgba(245,239,225,0.5)' : C.ink });
      const cx = x + off;
      const cy = y + off;
      const ty = cy + h / 2 + (sub ? -size * 0.22 : size * 0.36);
      const upper = font === 'label';
      let tx = align === 'center' ? cx + w / 2 : cx + 14 * S;
      let talign = align;
      const iw = icon ? size * 1.5 : 0;
      if (icon) {
        if (align === 'center' && label) {
          const lw = Math.min(this.measure(upper ? String(label).toUpperCase() : label, size, font), w - 24 * S - iw);
          const left = cx + w / 2 - (lw + iw) / 2;
          this.icon(icon, left + size * 0.5, cy + h / 2 + (sub ? -size * 0.5 : 0), size, tc);
          tx = left + iw;
          talign = 'left';
        } else if (align === 'center') {
          this.icon(icon, cx + w / 2, cy + h / 2, size, tc);
        } else {
          this.icon(icon, tx + size * 0.5, cy + h / 2, size, tc);
          tx += iw;
        }
      }
      if (label) {
        this.text(label, tx, ty, size, { color: tc, font, align: talign, upper, max: w - 24 * S - iw });
      }
      if (sub) {
        this.text(sub, align === 'center' ? cx + w / 2 : tx, ty + size * 0.98, size * 0.68, {
          color: kind === 'yellow' || kind === 'paper' || selected ? 'rgba(18,16,21,0.7)' : C.dim, font: 'body', weight: 600,
          align, max: w - 18 * S - (align === 'center' ? 0 : tx - cx) });
      }
      if (badge !== null && badge !== undefined) {
        const bs = 24 * S;
        const bx = cx + w - bs * 0.55;
        const by = cy - bs * 0.45;
        const c = this.ctx;
        c.beginPath();
        c.arc(bx + 2 * S, by + 2 * S, bs / 2, 0, Math.PI * 2);
        c.fillStyle = C.ink;
        c.fill();
        c.beginPath();
        c.arc(bx, by, bs / 2, 0, Math.PI * 2);
        c.fillStyle = C.red;
        c.fill();
        c.lineWidth = 2 * S;
        c.strokeStyle = C.ink;
        c.stroke();
        this.text(String(badge), bx, by + 5 * S, 13 * S, { font: 'display', color: C.paper, align: 'center' });
      }
    });
    return this._register({ id, x, y, w, h, r: 9 * S, onClick: disabled ? null : onClick, focusable: !disabled, disabled,
      primary: kind === 'yellow' });
  }

  icon(name, cx, cy, size, color) {
    const c = this.ctx;
    c.save();
    c.fillStyle = color;
    c.strokeStyle = color;
    c.lineWidth = Math.max(2.5, size * 0.16);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const s = size * 0.5;
    switch (name) {
      case 'play':
        c.beginPath();
        c.moveTo(cx - s * 0.55, cy - s * 0.75);
        c.lineTo(cx + s * 0.75, cy);
        c.lineTo(cx - s * 0.55, cy + s * 0.75);
        c.closePath();
        c.fill();
        break;
      case 'pause':
        c.fillRect(cx - s * 0.65, cy - s * 0.75, s * 0.48, s * 1.5);
        c.fillRect(cx + s * 0.17, cy - s * 0.75, s * 0.48, s * 1.5);
        break;
      case 'check':
        c.beginPath();
        c.moveTo(cx - s * 0.75, cy);
        c.lineTo(cx - s * 0.2, cy + s * 0.6);
        c.lineTo(cx + s * 0.85, cy - s * 0.7);
        c.stroke();
        break;
      case 'cross':
        c.beginPath();
        c.moveTo(cx - s * 0.65, cy - s * 0.65);
        c.lineTo(cx + s * 0.65, cy + s * 0.65);
        c.moveTo(cx + s * 0.65, cy - s * 0.65);
        c.lineTo(cx - s * 0.65, cy + s * 0.65);
        c.stroke();
        break;
      case 'back':
        c.beginPath();
        c.moveTo(cx + s * 0.45, cy - s * 0.75);
        c.lineTo(cx - s * 0.35, cy);
        c.lineTo(cx + s * 0.45, cy + s * 0.75);
        c.stroke();
        break;
      case 'plus':
      case 'minus':
        c.beginPath();
        c.moveTo(cx - s * 0.65, cy);
        c.lineTo(cx + s * 0.65, cy);
        if (name === 'plus') {
          c.moveTo(cx, cy - s * 0.65);
          c.lineTo(cx, cy + s * 0.65);
        }
        c.stroke();
        break;
      case 'vr':
        this.rr(cx - s, cy - s * 0.55, s * 2, s * 1.1, s * 0.4);
        c.fill();
        c.fillStyle = 'rgba(0,0,0,0.5)';
        c.beginPath();
        c.arc(cx - s * 0.45, cy, s * 0.28, 0, Math.PI * 2);
        c.arc(cx + s * 0.45, cy, s * 0.28, 0, Math.PI * 2);
        c.fill();
        break;
      case 'gear':
        c.lineWidth = Math.max(2, size * 0.12);
        c.beginPath();
        c.arc(cx, cy, s * 0.5, 0, Math.PI * 2);
        c.stroke();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          c.beginPath();
          c.moveTo(cx + Math.cos(a) * s * 0.65, cy + Math.sin(a) * s * 0.65);
          c.lineTo(cx + Math.cos(a) * s * 0.92, cy + Math.sin(a) * s * 0.92);
          c.stroke();
        }
        break;
      case 'card':
        this.rr(cx - s, cy - s * 0.65, s * 2, s * 1.3, s * 0.2);
        c.fill();
        c.fillStyle = 'rgba(0,0,0,0.4)';
        c.fillRect(cx - s, cy - s * 0.32, s * 2, s * 0.28);
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
      case 'book':
        c.lineWidth = Math.max(2, size * 0.12);
        c.beginPath();
        c.moveTo(cx, cy - s * 0.55);
        c.quadraticCurveTo(cx - s * 0.5, cy - s * 0.8, cx - s, cy - s * 0.55);
        c.lineTo(cx - s, cy + s * 0.7);
        c.quadraticCurveTo(cx - s * 0.5, cy + s * 0.45, cx, cy + s * 0.7);
        c.quadraticCurveTo(cx + s * 0.5, cy + s * 0.45, cx + s, cy + s * 0.7);
        c.lineTo(cx + s, cy - s * 0.55);
        c.quadraticCurveTo(cx + s * 0.5, cy - s * 0.8, cx, cy - s * 0.55);
        c.lineTo(cx, cy + s * 0.7);
        c.stroke();
        break;
      default:
        break;
    }
    c.restore();
  }

  // ------------------------------------------------------------------ feedback
  /** Toasts are tape strips: yellow = good, red = bad, paper = info. */
  toast(msg, color = C.paper, dur = 2.6) {
    this.toasts.push({ msg, color, t: 0, dur, tilt: (Math.random() - 0.5) * 0.05 });
    if (this.toasts.length > 3) this.toasts.shift();
  }

  float(text, x, y, color = C.yellow) {
    this.floats.push({ text, x, y, color, t: 0 });
  }

  floatWorld(text, pos, color = C.yellow) {
    this.floats.push({ text, pos: pos.clone ? pos.clone() : pos, color, t: 0 });
  }

  _drawToasts(dt) {
    const S = this.S;
    let y = this.safe.top + (86 + this.toastShift) * S;
    this.toastShift = 0; // screens set it each frame to keep toasts clear of their own banners
    for (const t of this.toasts) {
      t.t += dt;
      const a = clamp(Math.min(t.t * 7, (t.dur - t.t) * 3), 0, 1);
      if (a <= 0) continue;
      const c = this.ctx;
      const known = { [C.red]: [C.red, C.paper], [C.yellow]: [C.yellow, C.ink], [C.pink]: [C.pink, C.ink],
        [C.purple]: [C.purple, C.paper] };
      const [bg, fg] = known[t.color] || [C.paper, C.ink];
      c.save();
      c.globalAlpha = a;
      const slide = (1 - Math.min(1, t.t * 6)) * -30 * S;
      const size = 17 * S;
      const maxW = this.w - 40 * S;
      let label = t.msg;
      while (this.measure(label, size, 'label') + 28 * S > maxW && label.length > 8) label = label.slice(0, -2);
      if (label !== t.msg) label = label.trimEnd() + '…';
      this.tape(label, this.w / 2, y + slide, { size, color: bg, textColor: fg, tilt: t.tilt });
      c.restore();
      y += size * 2.25;
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
      const pop = 1 + Math.max(0, 0.25 - f.t) * 1.6;
      this.text(f.text, x, y - f.t * 46, 24 * this.S * pop, { font: 'display', color: f.color, align: 'center',
        stroke: C.ink, strokeW: 6 * this.S });
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
      const ddx = w.x + w.w / 2 - cx;
      const ddy = w.y + w.h / 2 - cy;
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
