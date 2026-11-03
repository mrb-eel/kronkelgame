import { C } from '../gui.js';
import { BaseScreen, vrButton, langChips } from './common.js';
import { t } from '../i18n.js';
import { Crowd } from '../sim/crowd.js';
import { Nav } from '../sim/nav.js';
import { num, rng } from '../util.js';
import { sfx } from '../audio.js';

function alleyLife(screen) {
  const game = screen.game;
  const up = new Set(game.data.upgrades.map((u) => u.id));
  const nav = new Nav(game.layout, { upgrades: up });
  const crowd = new Crowd(game.layout, nav, rng(5), { upgrades: up });
  crowd.setRate(0.12);
  for (let i = 0; i < 40; i++) crowd.update(0.5); // pre-warm so the alley isn't empty
  crowd.fillSeats(6);
  crowd.addPoolPlayers();
  return crowd;
}

/** The black COFFEESHOP strip from under the alley sign. */
function signStrip(gui, cx, y, text, { size = 14, tilt = -0.015, maxW = 0 } = {}) {
  const S = gui.S;
  const w = Math.min(maxW || 9999, gui.measure(text, size * S, 'label') + text.length * 2.2 * S + 28 * S);
  const h = size * 1.9 * S;
  gui.tilted(cx, y + h / 2, tilt, () => {
    gui.ctx.fillStyle = '#000';
    gui.ctx.fillRect(cx - w / 2, y, w, h);
    gui.text(text, cx, y + h * 0.68, size * S, { font: 'label', color: C.paper, align: 'center', spacing: 2.2 * S,
      max: w - 16 * S });
  });
  return h;
}

/** Wordmark: smiley + KRONKEL tiles + strip. Returns the bottom y. */
function wordmark(gui, cx, top, width, time, scale = 1) {
  const S = gui.S * scale;
  const face = Math.min(120 * S, width * 0.3);
  const tileSize = Math.min(48 * S, (width - 10 * S) / 7.7);
  gui.image(gui.logo, cx - face / 2, top + Math.sin(time * 2.2) * 3 * S, face, face, Math.sin(time * 1.3) * 0.08 - 0.06);
  const ty = top + face * 0.92;
  gui.tiles('KRONKEL', cx, ty, tileSize, { align: 'center', tilt: -0.02, wobble: 1.2 * S });
  const sy = ty + tileSize + 14 * S;
  signStrip(gui, cx, sy, 'COFFEESHOP · NIJMEGEN · SINDS 1986', { size: 13.5 * scale, maxW: width });
  gui.tape(t('title.tape'), cx + tileSize * 3.1, ty - 8 * S, { size: 14 * S, color: C.yellow, tilt: 0.12 });
  return sy + 28 * S;
}

/** Rough height of the wordmark at a given scale, for layout. */
function wordmarkHeight(gui, width, scale = 1) {
  const S = gui.S * scale;
  return Math.min(120 * S, width * 0.3) * 0.92 + Math.min(48 * S, (width - 10 * S) / 7.7) + 42 * S;
}

export class AgeScreen extends BaseScreen {
  enter() {
    this.world.setView('title');
    this.world.setUpgrades(this.data.upgrades.map((u) => u.id));
    this.world.setHour(22.5);
    this.under = false;
    this.t = 0;
  }

  update(dt) {
    this.t += dt;
  }

  draw(gui) {
    const S = gui.S;
    gui.dim(0.55);
    const w = Math.min(gui.w - 32 * S, 470 * S);
    const x = (gui.w - w) / 2;
    const text = t(this.under ? 'age.under' : 'age.text');
    const badge = 74 * S;
    const pw = w - 48 * S - badge - 14 * S;
    const ph = gui.wrap(text, pw, 16 * S, 'body', 600).length * 16 * S * 1.38;
    const h = Math.max(badge + 30 * S, ph + 34 * S) + 54 * S + 88 * S;
    const avail = gui.h - gui.safe.top - gui.safe.bottom - h - 36 * S;
    const scale = Math.max(0.55, Math.min(1, avail / wordmarkHeight(gui, w)));
    const top = gui.safe.top + Math.max(10 * S, (avail - wordmarkHeight(gui, w, scale)) / 2);
    const y = wordmark(gui, gui.w / 2, top, w, this.t, scale) + 22 * S;
    gui.card(x, y, w, h, { tone: 'paper', label: t('age.label'), labelColor: C.red, labelText: C.paper });
    // 18+ as a round door sticker
    const bx = x + w - 24 * S - badge / 2;
    const by = y + 26 * S + badge / 2;
    gui.tilted(bx, by, 0.12, () => {
      const c = gui.ctx;
      c.beginPath();
      c.arc(bx + 4 * S, by + 4 * S, badge / 2, 0, Math.PI * 2);
      c.fillStyle = C.ink;
      c.fill();
      c.beginPath();
      c.arc(bx, by, badge / 2, 0, Math.PI * 2);
      c.fillStyle = C.red;
      c.fill();
      c.lineWidth = 3 * S;
      c.strokeStyle = C.ink;
      c.stroke();
      gui.text('18+', bx, by + 10 * S, 28 * S, { font: 'display', color: C.paper, align: 'center' });
    });
    gui.paragraph(text, x + 24 * S, y + 22 * S, pw, 16 * S, { color: C.ink, weight: 600 });
    langChips(gui, this.game, gui.w - gui.safe.right - 14 * S, gui.safe.top + 14 * S);
    const qy = y + Math.max(badge + 30 * S, ph + 34 * S);
    if (this.under) {
      gui.stamp(t('stamp.refused'), gui.w / 2, qy + 70 * S, 34 * S, C.red, -0.12);
      return;
    }
    gui.text(t('age.q'), x + 24 * S, qy + 30 * S, 24 * S, { font: 'display', color: C.ink, max: w - 48 * S });
    const bw = (w - 60 * S) / 2;
    gui.button(x + 24 * S, y + h - 82 * S, bw, 58 * S, t('age.yes'), () => {
      this.game.save.ageOk = true;
      this.game.persist();
      sfx.ok();
      this.game.setScreen('title');
    }, { kind: 'yellow', icon: 'check', size: 21 * S });
    gui.button(x + 36 * S + bw, y + h - 82 * S, bw, 58 * S, t('age.no'), () => {
      this.under = true;
      sfx.error();
    }, { size: 21 * S });
  }
}

export class TitleScreen extends BaseScreen {
  enter() {
    this.world.clearPeople();
    this.world.setView('title');
    this.world.setUpgrades(this.data.upgrades.map((u) => u.id));
    this.world.setHour(22.5);
    this.crowd = alleyLife(this);
    this.t = 0;
  }

  update(dt) {
    this.t += dt;
    this.crowd.update(dt);
    this.world.syncPeople(this.crowd.entities(), dt);
  }

  vrAnchor() {
    return { x: 11.6, z: 8.2, yaw: Math.PI / 2, panelY: 1.35, panelDist: 1.1 };
  }

  /** Big tilted sticker card for a game mode: number tile, title, one-line pitch. */
  _mode(gui, x, y, w, h, { id, title, sub, fill, tilt, stars, onClick, tag, tape }) {
    const S = gui.S;
    const pressed = gui.pressedId === id && gui.pointer.down && gui._inside(x, y, w, h);
    const hover = !gui.pointer.touch && gui._inside(x, y, w, h);
    const off = pressed ? 5 * S : hover ? -2 * S : 0;
    gui.tilted(x + w / 2, y + h / 2, tilt, () => {
      const ox = x + off;
      const oy = y + off;
      gui.sticker(ox, oy, w, h, { fill, r: 12, shadow: pressed ? 0 : hover ? 8 : 6, outline: 3 });
      // number as a sign tile
      const ts = Math.min(h - 26 * S, 54 * S);
      const tx = ox + 14 * S;
      const tyy = oy + (h - ts) / 2;
      gui.ctx.fillStyle = C.ink;
      gui.rr(tx, tyy, ts, ts, 8 * S);
      gui.ctx.fill();
      gui.text(tag, tx + ts / 2, tyy + ts * 0.68, ts * 0.5, { font: 'display', align: 'center',
        color: fill === C.yellow ? C.yellow : C.red });
      const lx = tx + ts + 14 * S;
      const titleSize = Math.min(30 * S, h * 0.36);
      const subSize = Math.min(14.5 * S, h * 0.2);
      const block = titleSize * 0.74 + 8 * S + subSize * 0.8;
      const by = oy + (h - block) / 2 + titleSize * 0.74;
      const right = stars ? 5 * 11 * S * 2.25 + 24 * S : 44 * S;
      gui.text(title, lx, by, titleSize, { font: 'display', color: C.ink, max: w - (lx - ox) - right });
      gui.text(sub, lx, by + 8 * S + subSize * 0.85, subSize, { color: 'rgba(18,16,21,0.75)', weight: 600,
        max: w - (lx - ox) - 40 * S });
      if (stars) gui.smileys(ox + w - 5 * 11 * S * 2.25 - 14 * S, oy + 20 * S, 11 * S, stars);
      gui.icon('play', ox + w - 26 * S, oy + h / 2 + (stars ? 8 * S : 0), 18 * S, C.ink);
    });
    if (tape) gui.tape(tape, x + w * 0.42, y + 2 * S, { size: 14 * S, color: C.red, textColor: C.paper, tilt: 0.05 });
    gui.region(x, y, w, h, onClick, { id, focusable: true, r: 12 * S });
  }

  draw(gui) {
    const S = gui.S;
    const g = this.game;
    const save = g.save;
    const portrait = gui.portrait;
    const c = gui.ctx;
    const grad = portrait ? c.createLinearGradient(0, gui.h, 0, gui.h * 0.3) : c.createLinearGradient(0, 0, gui.w * 0.62, 0);
    grad.addColorStop(0, 'rgba(10,8,14,0.92)');
    grad.addColorStop(0.55, 'rgba(10,8,14,0.6)');
    grad.addColorStop(1, 'rgba(10,8,14,0)');
    c.fillStyle = grad;
    c.fillRect(0, 0, gui.w, gui.h);

    const sl = gui.safe.left + 22 * S;
    const colW = portrait ? gui.w - sl * 2 : Math.min(460 * S, gui.w * 0.44);
    const cx = sl + colW / 2;
    const extra = 58 * S + (g.xrSupported ? 60 * S : 0);
    const footer = portrait ? 18 * S : 44 * S;
    const minCard = portrait ? 80 * S : 76 * S;
    const top = gui.safe.top + (portrait ? 26 : 16) * S;
    const room = gui.h - gui.safe.bottom - footer - extra - minCard - 14 * S - top;
    const scale = Math.max(0.55, Math.min(1, room / wordmarkHeight(gui, colW)));
    const markBottom = wordmark(gui, cx, top, colW, this.t, scale);
    const free = gui.h - gui.safe.bottom - footer - extra - (markBottom + 14 * S);
    const bh = Math.max(minCard * 0.85, Math.min(portrait ? 132 * S : 128 * S, free));
    let y = portrait ? gui.h - gui.safe.bottom - footer - extra - bh : markBottom + 14 * S;
    this._mode(gui, sl, y, colW, bh, { id: 'm-cashier', tag: '01', tape: save.best.cashier ? t('res.record', { n: num(save.best.cashier) }) : null, title: t('mode.cashier'), fill: C.yellow, tilt: -0.012,
      sub: t('mode.cashier.sub'), stars: save.stars.cashier, onClick: () => g.setScreen('cashier') });
    y += bh + 16 * S;
    const half = (colW - 12 * S) / 2;
    gui.button(sl, y, half, 44 * S, t('btn.howto'), () => g.setScreen('howto', { back: 'title' }), { kind: 'ink',
      icon: 'book', size: 16 * S });
    gui.button(sl + half + 12 * S, y, half, 44 * S, t('btn.settings'), () => g.setScreen('settings'), { kind: 'ink',
      icon: 'gear', size: 16 * S });
    y += 44 * S + 14 * S;
    if (g.xrSupported) vrButton(g, gui, sl, y, colW, 46 * S);
    langChips(gui, g, gui.w - gui.safe.right - 14 * S, gui.safe.top + 14 * S, { size: portrait ? 34 : 40 });
    if (!portrait) {
      const fy = gui.h - gui.safe.bottom - 14 * S;
      gui.text(t('title.footer'), sl, fy, 13 * S,
        { font: 'label', color: 'rgba(245,239,225,0.5)', weight: 700 });
      gui.button(gui.w - gui.safe.right - 112 * S, fy - 30 * S, 96 * S, 36 * S, t('btn.about'), () => g.setScreen('credits'),
        { kind: 'ghost', size: 15 * S });
      const hint = this._hint();
      if (hint) gui.tape(hint, gui.w - gui.safe.right - 150 * S, gui.safe.top + 80 * S, { size: 14 * S, color: C.paper,
        tilt: 0.02 });
    }
  }

  _hint() {
    const d = this.game.input.lastDevice;
    if (d === 'gamepad') return t('hint.gamepad');
    if (d === 'keyboard') return t('hint.keyboard');
    return null;
  }
}
