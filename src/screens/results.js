import { C, SERIF } from '../gui.js';
import { BaseScreen, panel } from './common.js';
import { sfx } from '../audio.js';

/** End-of-shift summary for Kassa and Bediening. params: {mode, title, subtitle, score, stars, lines, best, newBest} */
export class ResultsScreen extends BaseScreen {
  enter() {
    this.t = 0;
    const p = this.params;
    if (p.stars >= 3) sfx.fanfare();
    else if (p.closed) sfx.sad();
    else sfx.ok();
  }

  update(dt) {
    this.t += dt;
    this.params.backdrop?.(dt);
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
    gui.box(0, 0, gui.w, gui.h, { r: 0, fill: 'rgba(5,10,7,0.66)', stroke: null });
    const w = Math.min(gui.w - 24, 520 * S);
    const h = Math.min(gui.h - 24, (250 + p.lines.length * 28) * S + 90 * S);
    const x = (gui.w - w) / 2;
    const y = (gui.h - h) / 2;
    const q = panel(gui, x, y, w, h, null, { stroke: (p.closed ? C.red : C.gold) + '55' });
    gui.text(p.title, gui.w / 2, q.y + 30 * S, 30 * S, { align: 'center', family: SERIF, weight: 700,
      color: p.closed ? C.red : C.gold, max: w - 40 });
    if (p.subtitle) gui.text(p.subtitle, gui.w / 2, q.y + 56 * S, 14 * S, { align: 'center', color: C.dim, max: w - 40 });
    const shown = Math.min(p.stars, Math.floor(this.t * 3));
    const r = 18 * S;
    gui.stars(gui.w / 2 - (5 * r * 2.3) / 2, q.y + 92 * S, r, shown);
    gui.text(String(p.score), gui.w / 2, q.y + 150 * S, 38 * S, { align: 'center', weight: 900 });
    gui.text(p.newBest ? 'NEW PERSONAL BEST!' : `best ${p.best}`, gui.w / 2, q.y + 172 * S, 12 * S,
      { align: 'center', color: p.newBest ? C.accent : C.dim, weight: 800 });
    let ly = q.y + 200 * S;
    for (const [label, value, color] of p.lines) {
      gui.text(label, q.x + 10 * S, ly, 15 * S, { color: C.dim, weight: 600 });
      gui.text(String(value), q.x + q.w - 10 * S, ly, 15 * S, { align: 'right', weight: 800, color: color || C.text });
      ly += 28 * S;
    }
    const bw = (q.w - 12 * S) / 2;
    const by = y + h - 70 * S;
    gui.button(q.x, by, bw, 50 * S, 'Play again', () => this.game.setScreen(p.mode), { kind: 'primary', icon: 'play' });
    gui.button(q.x + bw + 12 * S, by, bw, 50 * S, 'Menu', () => this.game.setScreen('title'), { icon: 'back' });
  }
}
