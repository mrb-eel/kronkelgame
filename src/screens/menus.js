import { C, SERIF } from '../gui.js';
import { BaseScreen, panel } from './common.js';
import { setVolumes, sfx } from '../audio.js';
import { resetSave } from '../save.js';

const HOWTO = {
  kassa: {
    title: 'Kassa (cashier)',
    body: [
      'You work the counter behind the glass. Customers queue up and hand you their ID first.',
      'Check the ID card against today\'s date: 18 or older? Not expired? Does the photo match the person standing there? Someone who turns 18 today is allowed. Approve with ✓ or refuse with ✗.',
      'Then they order. Tap products to put grams or items in the bag, use − to remove. Dutch rules: max 5 gram per customer, and a coffeeshop never sells alcohol. If someone asks for too much or for a beer, tap the rule button so they adjust their order.',
      'Checkout. PIN: tap the PIN button. Cash: work out the change, tap the coins and notes until it matches, then hand it over.',
      'Be quick: fast service means bigger tips. Three mistakes with the rules and Handhaving shuts the shop down.',
    ],
  },
  bediening: {
    title: 'Bediening (server)',
    body: [
      'You run the floor. Groups wait at the door: tap the door area to pick the next group, then tap a free table that fits them.',
      'Bubbles show what tables want: ! means ready to order, the clock means waiting for their order, the die means they want a board game, € means they want the bill, and wavy lines mean the table needs cleaning.',
      'Tap a table to send yourself there. Orders go to the bar (shakes, tea, coffee) and the kitchen (tosti, fries, burgers; kitchen open 12:00 to 22:00). When the pass dings, tap it to pick up, up to 4 items on your tray, then tap the table to serve.',
      'Board games come from the shelf by the right wall. The rooftop terrace opens at 14:00: the stairs take a moment.',
      'Your taps queue up as a to-do list, so plan routes. The ring around a bubble is their mood. Empty ring: they walk out.',
    ],
  },
  tycoon: {
    title: 'Tycoon',
    body: [
      'Run your own Kronkel, day by day. Each morning: buy stock (by law never more than 500 gram in the shop), hire staff, set prices and buy upgrades.',
      'Open the shop and watch the day. Too few cashiers means a queue out the door, no cook means no food, running out of stock means unhappy customers. Auto-restock calls a delivery when you run low (max 2 per day).',
      'Strict ID checks are a bit slower but keep you safe when Handhaving inspects. Quick checks are faster but risky.',
      'Watch the calendar: weekends are busy, rain empties the terrace, NEC home games bring a rush, and the Vierdaagse in July turns Nijmegen upside down.',
      'Goals: grow to 5 stars and build the full Kronkel: pool tables, fireplace lounge, milkshake bar, live music and the rooftop terrace.',
    ],
  },
  controls: {
    title: 'Controls',
    body: [
      'Touch / mouse: tap buttons and tap things in the shop. Drag to pan the camera in Bediening and Tycoon, scroll or pinch to zoom.',
      'Keyboard: arrows or WASD to move between buttons, Enter or Space to press, Esc to go back or pause, Q/E to switch tabs, F for fullscreen.',
      'Controller: stick or d-pad to move, Ⓐ press, Ⓑ back, Ⓧ/Ⓨ quick actions, bumpers switch tabs, triggers zoom, right stick moves the camera, Start pauses. Controllers rumble on mistakes.',
      'VR (Quest, Pico, Vision Pro and other WebXR browsers): press Play in VR. Point at the floating panel and pull the trigger. Point at tables and the pass to send the waiter. Thumbstick turns, B goes back.',
      'Phone: add the game to your home screen (Share → Add to Home Screen) to play full screen and offline.',
    ],
  },
};

export class HowtoScreen extends BaseScreen {
  enter() {
    this.tabs = Object.keys(HOWTO);
    this.tab = this.params.tab && HOWTO[this.params.tab] ? this.params.tab : 'kassa';
  }

  onBack() {
    this._back();
  }

  _back() {
    const p = this.params;
    if (p.onClose) p.onClose();
    else this.game.setScreen(p.back || 'title');
  }

  onTab(d) {
    const i = (this.tabs.indexOf(this.tab) + d + this.tabs.length) % this.tabs.length;
    this.tab = this.tabs[i];
  }

  draw(gui) {
    const S = gui.S;
    gui.box(0, 0, gui.w, gui.h, { r: 0, fill: 'rgba(5,10,7,0.72)', stroke: null });
    const w = Math.min(gui.w - 24, 760 * S);
    const h = Math.min(gui.h - gui.safe.top - gui.safe.bottom - 24, 620 * S);
    const x = (gui.w - w) / 2;
    const y = Math.max(gui.safe.top + 12, (gui.h - h) / 2);
    const p = panel(gui, x, y, w, h);
    gui.text('How to play', p.x + 4, p.y + 26 * S, 26 * S, { family: SERIF, color: C.gold, weight: 700 });
    gui.button(x + w - 110 * S, y + 14 * S, 96 * S, 38 * S, 'Back', () => this._back(), { icon: 'back', kind: 'ghost',
      size: 14 * S });
    const tw = (p.w - 8 * S * 3) / 4;
    this.tabs.forEach((t, i) => {
      gui.button(p.x + i * (tw + 8 * S), p.y + 46 * S, tw, 40 * S, HOWTO[t].title.split(' ')[0], () => { this.tab = t; },
        { selected: this.tab === t, size: 14 * S, id: `howto-${t}` });
    });
    const H = HOWTO[this.tab];
    let ty = p.y + 104 * S;
    gui.text(H.title, p.x + 4, ty + 6 * S, 18 * S, { color: C.accent, weight: 800 });
    ty += 18 * S;
    const size = (gui.portrait ? 14 : 15) * S;
    for (const para of H.body) {
      ty += gui.paragraph(para, p.x + 4, ty, p.w - 8, size, { color: C.text }) + 8 * S;
    }
  }
}

export class SettingsScreen extends BaseScreen {
  onBack() {
    this.game.setScreen('title');
  }

  draw(gui) {
    const S = gui.S;
    const g = this.game;
    const st = g.save.settings;
    gui.box(0, 0, gui.w, gui.h, { r: 0, fill: 'rgba(5,10,7,0.72)', stroke: null });
    const w = Math.min(gui.w - 24, 520 * S);
    const h = Math.min(gui.h - 24, 560 * S);
    const x = (gui.w - w) / 2;
    const y = (gui.h - h) / 2;
    const p = panel(gui, x, y, w, h);
    gui.text('Settings', p.x + 4, p.y + 26 * S, 26 * S, { family: SERIF, color: C.gold, weight: 700 });
    gui.button(x + w - 110 * S, y + 14 * S, 96 * S, 38 * S, 'Back', () => this.onBack(), { icon: 'back', kind: 'ghost',
      size: 14 * S });
    let ry = p.y + 64 * S;
    const row = (label, value, onMinus, onPlus, id) => {
      gui.text(label, p.x + 4, ry + 27 * S, 16 * S, { weight: 700 });
      const bw = 44 * S;
      const vx = p.x + p.w - bw * 2 - 110 * S;
      gui.button(vx, ry + 4 * S, bw, 40 * S, '', onMinus, { icon: 'minus', id: `${id}-` });
      gui.text(value, vx + bw + 55 * S, ry + 30 * S, 16 * S, { align: 'center', weight: 800, color: C.accent });
      gui.button(vx + bw + 110 * S, ry + 4 * S, bw, 40 * S, '', onPlus, { icon: 'plus', id: `${id}+` });
      ry += 56 * S;
    };
    const vol = (k, d) => {
      st[k] = Math.round(Math.min(1, Math.max(0, st[k] + d)) * 10) / 10;
      setVolumes(st);
      g.persist();
      sfx.click();
    };
    row('Music', `${Math.round(st.music * 100)}%`, () => vol('music', -0.1), () => vol('music', 0.1), 'music');
    row('Sound effects', `${Math.round(st.sfx * 100)}%`, () => vol('sfx', -0.1), () => vol('sfx', 0.1), 'sfx');
    const qs = ['auto', 'low', 'medium', 'high'];
    const cycle = (d) => {
      st.quality = qs[(qs.indexOf(st.quality) + d + qs.length) % qs.length];
      g.persist();
      this.toast('Graphics quality applies after a reload.', C.gold);
    };
    row('Graphics', st.quality, () => cycle(-1), () => cycle(1), 'quality');
    row('Vibration', st.haptics ? 'on' : 'off', () => { st.haptics = !st.haptics; g.persist(); },
      () => { st.haptics = !st.haptics; g.persist(); }, 'haptics');
    ry += 8 * S;
    const bw = (p.w - 12 * S) / 2;
    gui.button(p.x, ry, bw, 46 * S, 'Fullscreen', () => g.toggleFullscreen(), { size: 15 * S });
    gui.button(p.x + bw + 12 * S, ry, bw, 46 * S, 'Reset progress', () => {
      this.modal = {
        title: 'Reset everything?', color: C.red,
        text: 'This deletes your best scores and your Tycoon shop. Settings stay.',
        buttons: [{ label: 'Cancel' }, { label: 'Reset', kind: 'danger', onClick: () => {
          g.save = resetSave();
          this.toast('Progress reset.', C.gold);
        } }],
      };
    }, { kind: 'danger', size: 15 * S });
    ry += 62 * S;
    gui.text(`FPS ${Math.round(g.fps)} · ${g.world.quality} · ${g.xrSupported ? 'VR ready' : 'no VR device'}`, p.x + 4,
      ry + 10 * S, 12 * S, { color: C.dim });
    this.drawModal(gui);
  }
}

export class CreditsScreen extends BaseScreen {
  onBack() {
    this.game.setScreen('title');
  }

  draw(gui) {
    const S = gui.S;
    gui.box(0, 0, gui.w, gui.h, { r: 0, fill: 'rgba(5,10,7,0.72)', stroke: null });
    const w = Math.min(gui.w - 24, 620 * S);
    const h = Math.min(gui.h - 24, 560 * S);
    const x = (gui.w - w) / 2;
    const y = (gui.h - h) / 2;
    const p = panel(gui, x, y, w, h);
    gui.text('About', p.x + 4, p.y + 26 * S, 26 * S, { family: SERIF, color: C.gold, weight: 700 });
    gui.button(x + w - 110 * S, y + 14 * S, 96 * S, 38 * S, 'Back', () => this.onBack(), { icon: 'back', kind: 'ghost',
      size: 14 * S });
    let ty = p.y + 50 * S;
    const paras = [
      'Kronkel: The Coffeeshop Game is a fan-made game set in Coffeeshop Kronkel on Vlaamsegas in Nijmegen, a local institution since 1986.',
      'It is not an advertisement and it is not made, endorsed or checked by the shop. Products, prices and people in the game are made up.',
      'In the Netherlands coffeeshops may sell small amounts of cannabis to adults under strict rules: 18+ with ID, max 5 gram per person, no alcohol, no hard drugs, no advertising and max 500 gram in stock. The game follows those rules.',
      '3D models: made in Blender (build scripts in /blender). Engine: three.js. Fonts: Inter (OFL) and DejaVu Serif. Music and sound: synthesised in the browser.',
    ];
    for (const t of paras) ty += gui.paragraph(t, p.x + 4, ty, p.w - 8, 15 * S, { color: C.text }) + 10 * S;
  }
}
