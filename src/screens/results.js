import { C } from '../gui.js';
import { BaseScreen, receipt, dashes, rline, RECEIPT } from './common.js';
import { sfx } from '../audio.js';
import { clamp, dateText, clockText } from '../util.js';
import { t } from '../i18n.js';

/** End of a Kassa / Bediening shift, printed as a Kronkel receipt. */
export class ResultsScreen extends BaseScreen {
  enter() {
    this.t = 0;
    this.printed = new Date();
    const p = this.params;
    if (p.stars >= 3) sfx.fanfare();
    else if (p.closed) sfx.sad();
    else sfx.ok();
  }

  update(dt) {
    this.t += dt;
    this.mascot.update(dt);
  }

  onBack() {
    this.game.setScreen('title');
  }

  vrAnchor() {
    return this.params.vrAnchor || null;
  }

  draw(gui) {
    const S = gui.S;
    const p = this.params;
    gui.dim(0.62);
    const w = Math.min(gui.w - 28 * S, 420 * S);
    const bh = 60 * S;
    // Fit the receipt to the screen: drop the logo and tighten the lines when it's short (phone landscape, 720p).
    const avail = (gui.h - gui.safe.top - gui.safe.bottom - bh - 44 * S) / S;
    const n = p.lines.length;
    const compact = 188 + n * 23 + 182 > avail;
    const head = compact ? 124 : 188;
    const lh = clamp((avail - head - 182) / n, 17, 23);
    const h = Math.min(avail, head + n * lh + 182) * S;
    // receipt slides out of the printer
    const slide = 1 - Math.pow(1 - clamp(this.t * 1.6, 0, 1), 3);
    const x = (gui.w - w) / 2;
    const y0 = gui.safe.top + 14 * S;
    const y = y0 - (1 - slide) * h * 0.6;
    receipt(gui, x, y, w, h);
    const ix = x + 22 * S;
    const iw = w - 44 * S;
    if (!compact) gui.image(gui.logo, x + w / 2 - 30 * S, y + 12 * S, 60 * S, 60 * S);
    const hy = y - (compact ? 64 : 0) * S;
    gui.text('KRONKEL', x + w / 2, hy + 94 * S, 24 * S, { font: 'display', color: C.ink, align: 'center' });
    gui.text('VLAAMSEGAS · NIJMEGEN · SINDS 1986', x + w / 2, hy + 113 * S, 12 * S, { font: RECEIPT, color: C.ink,
      align: 'center' });
    gui.text(`${dateText(this.printed)}  ${clockText(this.printed.getHours() + this.printed.getMinutes() / 60)}`, x + w / 2,
      hy + 131 * S, 12 * S, { font: RECEIPT, color: C.ink, align: 'center' });
    gui.text(p.title, x + w / 2, hy + 156 * S, 18 * S, { font: RECEIPT, weight: 700, color: p.closed ? C.red : C.ink,
      align: 'center' });
    gui.text(p.subtitle || '', x + w / 2, hy + 174 * S, 12 * S, { font: RECEIPT, color: C.ink, align: 'center', max: iw });
    let ly = y + head * S;
    dashes(gui, ix, ly, iw);
    ly += 22 * S;
    for (const [label, value] of p.lines) {
      rline(gui, ix, ly, iw, String(label).toUpperCase(), String(value), { size: lh < 20 ? 13.5 : 15 });
      ly += lh * S;
    }
    dashes(gui, ix, ly - 8 * S, iw);
    ly += 18 * S;
    rline(gui, ix, ly, iw, t('res.score'), '', { size: 20, bold: true });
    const shown = Math.round(p.score * clamp(this.t * 1.2, 0, 1));
    gui.text(String(shown), ix + iw, ly + 2 * S, 30 * S, { font: 'display', color: C.ink, align: 'right' });
    const scoreY = ly;
    ly += 26 * S;
    gui.ctx.fillStyle = C.ink;
    gui.rr(x + w / 2 - 82 * S, ly - 2 * S, 164 * S, 34 * S, 17 * S);
    gui.ctx.fill();
    gui.smileys(x + w / 2 - 78 * S, ly + 15 * S, 14 * S, Math.min(p.stars, Math.floor(this.t * 3)));
    ly += 50 * S;
    if (p.newBest && this.t > 1) {
      gui.stamp(t('res.newRecord'), ix + iw * 0.5, scoreY - 8 * S, 18 * S, C.red, -0.08, clamp((this.t - 1) * 4, 0, 1));
    } else {
      gui.text(t('res.record', { n: p.best }), x + w / 2, ly - 4 * S, 12 * S, { font: RECEIPT, color: C.ink, align: 'center' });
    }
    // barcode
    const c = gui.ctx;
    const bcy = y + h - 58 * S;
    let bx = x + w / 2 - 80 * S;
    for (let i = 0; i < 46 && bx < x + w / 2 + 80 * S; i++) {
      const bw = ((i * 7919) % 3) + 1;
      c.fillStyle = C.ink;
      c.fillRect(bx, bcy, bw * S, 22 * S);
      bx += (bw + 1.6) * S;
    }
    gui.text(t('res.thanks'), x + w / 2, y + h - 20 * S, 13 * S, { font: RECEIPT, weight: 700, color: C.ink,
      align: 'center' });
    if (p.closed && this.t > 0.6) {
      gui.stamp(t('res.closed'), x + w / 2, y + h * 0.48, 40 * S, C.red, -0.2, clamp((this.t - 0.6) * 4, 0, 1));
    }
    const by = Math.min(gui.h - gui.safe.bottom - bh - 14 * S, y + h + 24 * S);
    const half = (w - 12 * S) / 2;
    gui.button(x, by, half, bh, t('res.again'), () => this.game.setScreen(p.mode), { kind: 'yellow', icon: 'play',
      size: 19 * S });
    gui.button(x + half + 12 * S, by, half, bh, t('btn.menu'), () => this.game.setScreen('title'), { kind: 'ink', icon: 'back',
      size: 19 * S });
  }
}
