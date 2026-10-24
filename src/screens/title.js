import { C, SERIF } from '../gui.js';
import { BaseScreen, vrButton } from './common.js';
import { Crowd } from '../sim/crowd.js';
import { Nav } from '../sim/nav.js';
import { rng } from '../util.js';
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

export class AgeScreen extends BaseScreen {
  enter() {
    this.world.setView('title');
    this.world.setUpgrades(this.data.upgrades.map((u) => u.id));
    this.world.setHour(22.5);
    this.under = false;
  }

  draw(gui) {
    const S = gui.S;
    gui.box(0, 0, gui.w, gui.h, { r: 0, fill: 'rgba(5,10,7,0.55)', stroke: null });
    const w = Math.min(gui.w - 32, 480 * S);
    const h = 360 * S;
    const x = (gui.w - w) / 2;
    const y = (gui.h - h) / 2;
    gui.box(x, y, w, h, { r: 24, fill: C.panel2, shadow: true, stroke: C.gold + '44' });
    gui.image(this.game.logo, gui.w / 2 - 230 * S, y + 22 * S, 62 * S, 62 * S);
    gui.logo(gui.w / 2 + 34 * S, y + 70 * S, 52 * S);
    gui.text('18+', gui.w / 2, y + 108 * S, 20 * S, { align: 'center', color: C.red, weight: 800 });
    const text = this.under
      ? 'No problem! Kronkel will still be there when you turn 18. Come back then.'
      : 'This game is set in a real Dutch coffeeshop and is about selling cannabis legally in the Netherlands. It is meant for adults. Are you 18 or older?';
    gui.paragraph(text, gui.w / 2, y + 124 * S, w - 56 * S, 15 * S, { color: C.text, align: 'center' });
    if (this.under) return;
    const bw = (w - 60 * S) / 2;
    gui.button(x + 24 * S, y + h - 76 * S, bw, 52 * S, "I'm 18 or older", () => {
      this.game.save.ageOk = true;
      this.game.persist();
      sfx.ok();
      this.game.setScreen('title');
    }, { kind: 'primary' });
    gui.button(x + 36 * S + bw, y + h - 76 * S, bw, 52 * S, "I'm younger", () => {
      this.under = true;
    });
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

  draw(gui) {
    const S = gui.S;
    const g = this.game;
    const save = g.save;
    const portrait = gui.portrait;
    const sl = gui.safe.left + 20 * S;
    // darken the side the menu sits on
    const c = gui.ctx;
    const grad = portrait ? c.createLinearGradient(0, gui.h, 0, gui.h * 0.25) : c.createLinearGradient(0, 0, gui.w * 0.6, 0);
    grad.addColorStop(0, 'rgba(6,12,9,0.88)');
    grad.addColorStop(1, 'rgba(6,12,9,0)');
    c.fillStyle = grad;
    c.fillRect(0, 0, gui.w, gui.h);

    const colW = portrait ? gui.w - sl * 2 : Math.min(420 * S, gui.w * 0.44);
    const cx = portrait ? gui.w / 2 : sl + colW / 2;
    const face = (portrait ? 92 : 86) * S;
    const logoY = portrait ? gui.safe.top + 120 * S + face : gui.safe.top + 70 * S + face * 0.55;
    const bob = Math.sin(this.t * 2.2) * 3 * S;
    if (portrait) gui.image(g.logo, cx - face / 2, logoY - 58 * S - face + bob, face, face);
    else gui.image(g.logo, sl - 6 * S, logoY - face * 0.86 + bob, face, face);
    const wordX = portrait ? cx : sl + face + (colW - face) / 2 - 4 * S;
    gui.text('KRONKEL', wordX, logoY, (portrait ? 58 : 60) * S, { align: 'center', family: SERIF, color: C.gold,
      weight: 700, shadow: true, max: portrait ? colW : colW - face });
    gui.text('THE COFFEESHOP GAME', wordX, logoY + 26 * S, 13 * S, { align: 'center', color: C.text, weight: 800 });
    gui.text('Vlaamsegas · Nijmegen · since 1986', wordX, logoY + 46 * S, 12 * S, { align: 'center', color: C.dim, weight: 600 });

    const bh = 58 * S;
    const gap = 10 * S;
    const buttons = 3;
    let y = portrait ? gui.h - gui.safe.bottom - 24 * S - (bh * buttons + gap * buttons + 46 * S + (g.xrSupported ? 56 * S : 0))
      : logoY + 80 * S;
    const x = portrait ? sl : sl;
    gui.button(x, y, colW, bh, 'Kassa', () => g.setScreen('cashier'), {
      kind: 'primary', sub: `Sell at the counter · ${save.best.cashier ? `best ${save.best.cashier}` : 'new'}`,
      align: 'left', size: 20 * S, id: 'm-cashier' });
    this._stars(gui, x + colW - 18 * S, y + bh / 2, save.stars.cashier);
    y += bh + gap;
    gui.button(x, y, colW, bh, 'Bediening', () => g.setScreen('server'), {
      sub: `Serve the tables · ${save.best.server ? `best ${save.best.server}` : 'new'}`, align: 'left', size: 20 * S,
      id: 'm-server' });
    this._stars(gui, x + colW - 18 * S, y + bh / 2, save.stars.server);
    y += bh + gap;
    gui.button(x, y, colW, bh, 'Tycoon', () => g.setScreen('tycoon'), {
      sub: save.tycoon ? `Your Kronkel · day ${save.tycoon.day}` : 'Build and run your own Kronkel', align: 'left',
      size: 20 * S, id: 'm-tycoon' });
    y += bh + gap;
    const half = (colW - gap) / 2;
    gui.button(x, y, half, 40 * S, 'How to play', () => g.setScreen('howto', { back: 'title' }), { size: 14 * S });
    gui.button(x + half + gap, y, half, 40 * S, 'Settings', () => g.setScreen('settings'), { size: 14 * S, icon: 'gear' });
    y += 40 * S + gap;
    if (g.xrSupported) vrButton(g, gui, x, y, colW, 46 * S);
    // footer
    const fy = gui.h - gui.safe.bottom - 14 * S;
    if (!portrait) {
      gui.text('Fan-made game. Not affiliated with or endorsed by Coffeeshop Kronkel. 18+ only.', sl, fy, 11 * S,
        { color: 'rgba(246,239,217,0.55)', weight: 600 });
      gui.button(gui.w - gui.safe.right - 110 * S, fy - 26 * S, 96 * S, 32 * S, 'About', () => g.setScreen('credits'),
        { kind: 'ghost', size: 12 * S });
      const hint = this._hint();
      if (hint) gui.text(hint, gui.w - gui.safe.right - 20 * S, gui.safe.top + 28 * S, 12 * S, { align: 'right', color: C.dim });
    }
  }

  _stars(gui, rx, cy, n) {
    if (!n) return;
    const r = 6 * gui.S;
    gui.stars(rx - 5 * r * 2.3, cy - 8 * gui.S, r, n);
  }

  _hint() {
    const d = this.game.input.lastDevice;
    if (d === 'gamepad') return 'Ⓐ select · Ⓑ back · stick to move';
    if (d === 'keyboard') return 'Arrows + Enter · Esc to go back';
    return null;
  }
}
