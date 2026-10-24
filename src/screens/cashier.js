import * as THREE from 'three';
import { C } from '../gui.js';
import { BaseScreen, topBar, panel, portrait } from './common.js';
import { CashierSim, CHANGE_UNITS } from '../sim/cashier.js';
import { Crowd } from '../sim/crowd.js';
import { clockText, dateText, euro, rng } from '../util.js';
import { sfx } from '../audio.js';

const TABS = [['weed', 'Wiet'], ['hash', 'Hasj'], ['extra', 'Extra']];

export class CashierScreen extends BaseScreen {
  enter() {
    const g = this.game;
    this.pausable = true;
    this.howtoTab = 'kassa';
    const all = new Set(this.data.upgrades.map((u) => u.id));
    this.sim = new CashierSim(this.data, this.L, { seed: Date.now() % 1e9, today: new Date() });
    this.world.clearPeople();
    this.world.setUpgrades(all);
    this.world.setView('cashier');
    this.crowd = new Crowd(this.L, this.sim.nav, rng(Date.now() % 9999), { upgrades: all });
    this.crowd.setStaff({ barista: 1 });
    this.crowd.fillSeats(7);
    this.crowd.addPoolPlayers();
    this.tab = 'weed';
    this.flash = 0;
    this.lastCall = false;
    if (!g.save.seenHowto.kassa) {
      g.save.seenHowto.kassa = true;
      g.persist();
      this.paused = true;
      this.openHowto('kassa', true);
    }
  }

  exit() {
    this.world.clearPeople();
  }

  vrAnchor() {
    return { x: 3.8, z: -4.75, yaw: Math.PI, panelY: 1.12, panelDist: 0.6, panelTilt: -0.55, panelScale: 0.95 };
  }

  onTab(d) {
    if (this.overlay) return this.overlay.onTab(d);
    const i = TABS.findIndex((t) => t[0] === this.tab);
    this.tab = TABS[(i + d + TABS.length) % TABS.length][0];
  }

  onAlt(btn) {
    const c = this.sim.current;
    if (!c || this.paused) return;
    if (btn === 'x') {
      if (c.step === 'id') this.sim.checkId(true);
      else if (c.step === 'order') this._checkout();
      else if (c.step === 'pay' && c.pay === 'pin') this.sim.payPin();
      else if (c.step === 'pay') this.sim.giveChange();
    } else if (btn === 'y') {
      if (c.step === 'id') this.sim.checkId(false);
      else if (c.step === 'order') this.sim.clearBag();
      else if (c.step === 'pay') this.sim.resetChange();
    }
  }

  _checkout() {
    const r = this.sim.checkout();
    if (!r.ok && r.reason === 'empty') this.toast('The bag is empty.', C.gold);
  }

  update(dt) {
    const sim = this.sim;
    if (!this.paused && !this.modal) {
      sim.update(dt);
      this.crowd.update(dt);
    }
    this.flash = Math.max(0, this.flash - dt * 2);
    for (const e of sim.events.splice(0)) this._event(e);
    if (!this.lastCall && sim.hour >= sim.closeHour) {
      this.lastCall = true;
      this.toast('01:00, last call! Serve the queue and close up.', C.gold);
    }
    this.world.setHour(sim.hour);
    const ents = sim.customers.map((c) => ({ id: `c${c.id}`, look: c.look, x: c.x, z: c.z, level: 0, yaw: c.yaw,
      anim: c.anim }));
    this.world.syncPeople([...ents, ...this.crowd.entities()], dt);
    this._props();
    const bubbles = [];
    for (const c of sim.customers) {
      if (c.phase === 'queue' && c.queuePatience < 30) {
        bubbles.push({ key: `q${c.id}`, icon: 'angry', mood: c.queuePatience / 30, x: c.x, y: 2.15, z: c.z, scale: 0.35 });
      }
    }
    this.world.syncBubbles(bubbles);
    if (sim.over) this._finish();
  }

  _props() {
    const c = this.sim.current;
    const list = [];
    const [rx, rz] = this.L.register;
    if (c && c.step === 'id') list.push({ key: 'id', name: 'idcard', x: rx + 0.05, y: 1.075, z: rz + 0.2, yaw: 0.3 });
    if (c && (c.step === 'order' || c.step === 'pay')) {
      let i = 0;
      for (const [id, q] of Object.entries(c.bag)) {
        const p = this.sim.products[id];
        const name = p.unit === 'g' ? 'baggie' : p.prop;
        for (let k = 0; k < Math.min(q, 3); k++) {
          list.push({ key: `b${id}${k}`, name, x: rx - 0.35 + (i % 6) * 0.13, y: 1.075 + Math.floor(i / 6) * 0.03,
            z: rz + 0.15 + (k % 2) * 0.05, yaw: i * 0.7 });
          i++;
        }
      }
      if (c.step === 'pay' && c.pay === 'cash') list.push({ key: 'note', name: 'banknote', x: rx + 0.35, y: 1.076, z: rz + 0.2, yaw: 0.2 });
    }
    this.world.syncProps(list);
  }

  _event(e) {
    const input = this.game.input;
    switch (e.type) {
      case 'door':
        sfx.door();
        break;
      case 'ok':
        sfx.ok();
        if (e.text) this.toast(e.text, C.accent);
        break;
      case 'refusedOk':
        sfx.ok();
        this.toast(e.text, C.accent);
        break;
      case 'strike':
        sfx.error();
        input.rumble(0.9, 0.6, 350);
        this.flash = 1;
        this.toast(`Strike ${this.sim.stats.strikes}/3: ${e.text}`, C.red);
        break;
      case 'wrongRefusal':
      case 'mistake':
        sfx.error();
        input.rumble(0.4, 0.3, 150);
        this.toast(e.text, C.gold);
        break;
      case 'walkout':
        sfx.sad();
        this.toast(e.text, C.red);
        break;
      case 'sale': {
        sfx.cash();
        const c = this.sim.customers.find((x) => x.phase === 'leave');
        const pos = new THREE.Vector3(3.8, 1.9, -2.8);
        this.game.gui.floatWorld(`+${euro(e.total)}`, pos, C.accent);
        if (e.tip > 0) this.game.gui.floatWorld(`fooi ${euro(e.tip)}`, pos.clone().add(new THREE.Vector3(0.4, -0.25, 0)), C.gold);
        void c;
        break;
      }
      case 'pin':
        sfx.pin();
        break;
      case 'coin':
        sfx.coin();
        break;
      default:
        break;
    }
  }

  _finish() {
    if (this.done) return;
    this.done = true;
    const g = this.game;
    const s = this.sim.stats;
    const score = this.sim.score();
    const stars = this.sim.reason === 'closed' ? Math.min(1, this.sim.starsFor(score)) : this.sim.starsFor(score);
    const best = g.save.best.cashier;
    const newBest = score > best;
    if (newBest) g.save.best.cashier = score;
    g.save.stars.cashier = Math.max(g.save.stars.cashier, stars);
    g.persist();
    const closed = this.sim.reason === 'closed';
    g.setScreen('results', {
      mode: 'cashier', closed,
      title: closed ? 'Handhaving closed the shop!' : 'Shift over!',
      subtitle: closed ? 'Three strikes. Always check IDs and stick to 5 gram.' : 'Kassa · 10:00 to 01:00',
      score, stars, best: newBest ? score : best, newBest,
      vrAnchor: this.vrAnchor(),
      lines: [
        ['Customers served', s.served], ['Revenue', euro(s.revenue)], ['Tips', euro(s.tips), C.gold],
        ['Good refusals', s.refusedOk, C.accent], ['Wrong refusals', s.wrongRefusals, s.wrongRefusals ? C.red : null],
        ['Walk-outs', s.walkouts, s.walkouts ? C.red : null], ['Strikes', `${s.strikes}/3`, s.strikes ? C.red : null],
      ],
    });
  }

  // ---------------------------------------------------------------- drawing
  draw(gui) {
    const S = gui.S;
    const sim = this.sim;
    const c = sim.current;
    if (this.flash > 0) gui.box(0, 0, gui.w, gui.h, { r: 0, fill: `rgba(255,60,60,${this.flash * 0.25})`, stroke: null });
    const strikes = sim.stats.strikes;
    const barBottom = topBar(gui, [
      { label: 'TIJD', value: clockText(sim.hour), color: sim.hour >= 24 ? C.gold : C.text },
      { label: 'OMZET', value: euro(sim.stats.revenue, 0), color: C.accent },
      { label: 'FOOI', value: euro(sim.stats.tips, 0), color: C.gold },
      { label: 'STRIKES', value: '●'.repeat(strikes) + '○'.repeat(3 - strikes), color: strikes ? C.red : C.dim, w: 86 },
      { label: 'RIJ', value: Math.max(0, sim.queue.length - (c ? 1 : 0)), w: 60 },
    ], { right: { w: 52 * S, label: '', icon: 'pause', onClick: () => this.onPause() } });
    const portraitMode = gui.portrait;
    const pad = 10 * S;
    const left = gui.safe.left + pad;
    const right = gui.w - gui.safe.right - pad;
    const bottom = gui.h - gui.safe.bottom - pad;
    // Speech bubble
    if (c && c.said) {
      const bw = Math.min(portraitMode ? gui.w - 2 * pad : 520 * S, gui.w - 2 * pad);
      const lines = gui.wrap(`${c.first}: ${c.said}`, bw - 32 * S, 15 * S, 600);
      const bh = lines.length * 21 * S + 34 * S;
      const bx = portraitMode ? left : gui.w / 2 - bw / 2;
      const by = barBottom + 8 * S;
      gui.box(bx, by, bw, bh, { r: 16, fill: C.panelLight, stroke: null, shadow: true });
      lines.forEach((l, i) => gui.text(l, bx + 16 * S, by + 26 * S + i * 21 * S, 15 * S, { color: C.dark, weight: 650 }));
      const frac = c.maxPatience ? c.patience / c.maxPatience : 1;
      gui.bar(bx + 16 * S, by + bh - 12 * S, bw - 32 * S, 5 * S, frac, frac > 0.5 ? C.accentDark : frac > 0.25 ? '#c99a20' : C.red,
        'rgba(0,0,0,0.12)');
    }
    // Panels
    if (portraitMode) {
      const ph = Math.min(gui.h * 0.56, 520 * S);
      this._mainPanel(gui, left, bottom - ph, right - left, ph);
    } else {
      const pw = Math.min(440 * S, (right - left) * 0.48);
      const top = barBottom + 8 * S;
      if (c && c.step === 'id') this._idPanel(gui, left, top + 60 * S, Math.min(400 * S, (right - left) * 0.45), null);
      const ptop = c && c.step !== 'id' && c.said && gui.w - pw - 2 * pad < 540 * S ? top + 60 * S : top + (c?.said ? 66 * S : 0);
      this._mainPanel(gui, right - pw, ptop, pw, bottom - ptop);
    }
    this.drawModal(gui);
    this.drawPause(gui);
  }

  _mainPanel(gui, x, y, w, h) {
    const c = this.sim.current;
    if (!c) {
      const p = panel(gui, x, y, w, Math.min(h, 120 * gui.S), 'Kassa');
      gui.paragraph(this.sim.queue.length ? 'Next customer is coming to the counter...' : 'Quiet moment. Waiting for customers.',
        p.x, p.y, p.w, 15 * gui.S, { color: C.dim });
      return;
    }
    if (c.step === 'id') {
      if (gui.portrait) this._idPanel(gui, x, y, w, h);
      else this._idButtonsOnly(gui, x, y, w);
    } else if (c.step === 'order') this._orderPanel(gui, x, y, w, h);
    else if (c.step === 'pay') this._payPanel(gui, x, y, w, h);
  }

  _idButtonsOnly(gui, x, y, w) {
    const S = gui.S;
    const p = panel(gui, x, y, w, 210 * S, 'ID check');
    gui.paragraph(`Today is ${dateText(this.sim.today)}. Is this customer 18+, is the ID still valid and does the photo match them?`,
      p.x, p.y - 4 * S, p.w, 14 * S, { color: C.text });
    const bw = (p.w - 10 * S) / 2;
    gui.button(p.x, p.y + 92 * S, bw, 54 * S, 'ID OK', () => this.sim.checkId(true), { kind: 'primary', icon: 'check',
      id: 'id-ok' });
    gui.button(p.x + bw + 10 * S, p.y + 92 * S, bw, 54 * S, 'Weigeren', () => this.sim.checkId(false), { kind: 'danger',
      icon: 'cross', id: 'id-no' });
  }

  _idPanel(gui, x, y, w, h) {
    const S = gui.S;
    const c = this.sim.current;
    const cardW = Math.min(w, 400 * S);
    const cardH = cardW * 0.63;
    const cx = x + (w - cardW) / 2;
    const cy = y;
    const ctx = gui.ctx;
    ctx.save();
    gui.rr(cx, cy, cardW, cardH, 16 * S);
    const grad = ctx.createLinearGradient(cx, cy, cx + cardW, cy + cardH);
    grad.addColorStop(0, '#e9f0f7');
    grad.addColorStop(1, '#c9d9ea');
    ctx.fillStyle = grad;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 20;
    ctx.fill();
    ctx.restore();
    const u = cardW / 400;
    gui.box(cx, cy, cardW, 34 * u, { r: 16 * S, fill: '#2b4c8c', stroke: null });
    gui.box(cx, cy + 18 * u, cardW, 16 * u, { r: 0, fill: '#2b4c8c', stroke: null });
    const nat = { NLD: 'NEDERLAND', DEU: 'DEUTSCHLAND', BEL: 'BELGIË', FRA: 'FRANCE', GBR: 'UNITED KINGDOM', ESP: 'ESPAÑA' }[c.nat];
    gui.text(`${nat} · IDENTITEITSKAART`, cx + 14 * u, cy + 23 * u, 13 * u, { color: '#fff', weight: 800, max: cardW - 28 * u });
    portrait(gui, cx + 14 * u, cy + 46 * u, 104 * u, 130 * u, c.idLook);
    const fx = cx + 134 * u;
    let fy = cy + 60 * u;
    const field = (label, value, color = '#10201a') => {
      gui.text(label, fx, fy, 10 * u, { color: '#5a6b7a', weight: 700 });
      gui.text(value, fx, fy + 19 * u, 17 * u, { color, weight: 800, max: cardW - (fx - cx) - 12 * u });
      fy += 42 * u;
    };
    const [first, ...rest] = c.name.split(' ');
    field('NAAM / NAME', `${rest.join(' ').toUpperCase()}, ${first}`);
    field('GEBOREN / DATE OF BIRTH', dateText(c.birth));
    field('GELDIG TOT / EXPIRES', dateText(c.expiry));
    gui.text(`<<<${c.nat}${c.name.replace(/ /g, '<').toUpperCase()}<<<<<<<<`, cx + 14 * u, cy + cardH - 12 * u, 11 * u,
      { color: '#4a5a6a', weight: 600, family: 'monospace', max: cardW - 28 * u });
    const by = cy + cardH + 10 * S;
    gui.box(x, by, w, 30 * S, { r: 15, fill: 'rgba(10,20,14,0.85)', stroke: C.line });
    gui.text(`Vandaag (today): ${dateText(this.sim.today)}`, x + w / 2, by + 20 * S, 14 * S, { align: 'center', weight: 800,
      color: C.gold });
    if (h != null) {
      const bw = (w - 10 * S) / 2;
      const bY = by + 40 * S;
      gui.button(x, bY, bw, 54 * S, 'ID OK', () => this.sim.checkId(true), { kind: 'primary', icon: 'check', id: 'id-ok' });
      gui.button(x + bw + 10 * S, bY, bw, 54 * S, 'Weigeren', () => this.sim.checkId(false), { kind: 'danger', icon: 'cross',
        id: 'id-no' });
    }
  }

  _orderPanel(gui, x, y, w, h) {
    const S = gui.S;
    const sim = this.sim;
    const c = sim.current;
    const p = panel(gui, x, y, w, h);
    const small = gui.portrait;
    // tabs
    const tw = (p.w - 16 * S) / 3;
    TABS.forEach(([id, label], i) => {
      gui.button(p.x + i * (tw + 8 * S), p.y, tw, 38 * S, label, () => { this.tab = id; }, { selected: this.tab === id,
        size: 14 * S, id: `tab-${id}` });
    });
    // product grid
    const prods = Object.values(sim.products).filter((pr) => pr.cat === this.tab);
    const cols = 2;
    const gw = (p.w - 8 * S) / cols;
    const rows = Math.ceil(prods.length / cols);
    const fixed = 46 * S + 70 * S + 48 * S + 60 * S + 14 * S; // tabs, bag, rule buttons, checkout, gaps
    const gh = Math.max(36 * S, Math.min((small ? 44 : 50) * S, (p.h - fixed) / rows - 6 * S));
    let gy = p.y + 46 * S;
    prods.forEach((pr, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const bx = p.x + col * (gw + 8 * S);
      const by = gy + row * (gh + 6 * S);
      gui.button(bx, by, gw, gh, pr.name, () => { sim.addItem(pr.id, 1); sfx.pop(); }, {
        sub: gh > 42 * S ? `${euro(pr.price)}${pr.unit === 'g' ? ' / gram' : ''}` : null, size: 14 * S, align: 'left',
        id: `p-${pr.id}`,
        badge: c.bag[pr.id] || null,
      });
    });
    gy += Math.ceil(prods.length / cols) * (gh + 6 * S) + 6 * S;
    // bag
    const bagH = Math.max(60 * S, p.y + p.h - gy - 108 * S);
    gui.box(p.x, gy, p.w, bagH, { r: 12, fill: 'rgba(255,255,255,0.05)', stroke: C.line });
    const entries = Object.entries(c.bag);
    gui.text('Tas / bag', p.x + 10 * S, gy + 20 * S, 12 * S, { color: C.dim, weight: 800 });
    gui.text(`${sim.bagGrams()} g`, p.x + p.w - 10 * S, gy + 20 * S, 12 * S, { color: sim.bagGrams() > 5 ? C.red : C.dim,
      weight: 800, align: 'right' });
    const rowH = 30 * S;
    const maxRows = Math.max(1, Math.floor((bagH - 30 * S) / rowH));
    entries.slice(0, maxRows).forEach(([id, q], i) => {
      const pr = sim.products[id];
      const ry = gy + 28 * S + i * rowH;
      gui.text(`${q}${pr.unit === 'g' ? ' g' : '×'} ${pr.name}`, p.x + 10 * S, ry + 19 * S, 14 * S, { weight: 700,
        max: p.w - 130 * S });
      gui.text(euro(pr.price * q), p.x + p.w - 52 * S, ry + 19 * S, 14 * S, { align: 'right', color: C.dim });
      gui.button(p.x + p.w - 44 * S, ry + 2 * S, 36 * S, 26 * S, '', () => sim.addItem(id, -1), { icon: 'minus',
        id: `minus-${id}`, size: 12 * S });
    });
    if (!entries.length) gui.text('Tap products to add them', p.x + 10 * S, gy + 48 * S, 13 * S, { color: C.dim });
    // rules + checkout
    let ry = gy + bagH + 8 * S;
    const rw = (p.w - 8 * S) / 2;
    gui.button(p.x, ry, rw, 40 * S, 'Max 5 gram', () => sim.sayRule('max5'), { size: 13 * S, color: '#4a3b1a', id: 'r-max5' });
    gui.button(p.x + rw + 8 * S, ry, rw, 40 * S, 'Geen alcohol', () => sim.sayRule('alcohol'), { size: 13 * S,
      color: '#4a3b1a', id: 'r-alc' });
    ry += 48 * S;
    gui.button(p.x, ry, 90 * S, 52 * S, 'Leeg', () => sim.clearBag(), { kind: 'ghost', size: 14 * S, id: 'clear' });
    gui.button(p.x + 98 * S, ry, p.w - 98 * S, 52 * S, `Afrekenen ${euro(sim.bagTotal())}`, () => this._checkout(), {
      kind: 'primary', size: 17 * S, id: 'checkout' });
  }

  _payPanel(gui, x, y, w, h) {
    const S = gui.S;
    const sim = this.sim;
    const c = sim.current;
    const p = panel(gui, x, y, w, Math.min(h, c.pay === 'pin' ? 220 * S : h), c.pay === 'pin' ? 'PIN' : 'Contant (cash)');
    gui.text(`Totaal ${euro(c.total)}`, p.x, p.y + 22 * S, 22 * S, { weight: 900 });
    if (c.pay === 'pin') {
      gui.paragraph('The customer wants to pay by card.', p.x, p.y + 30 * S, p.w, 14 * S, { color: C.dim });
      gui.button(p.x, p.y + 80 * S, p.w, 64 * S, c.payTimer > 0 ? 'Processing...' : `PIN ${euro(c.total)}`, () => sim.payPin(), {
        kind: 'primary', icon: 'card', size: 19 * S, disabled: c.payTimer > 0, id: 'pin' });
      return;
    }
    gui.text(`Ontvangen ${euro(c.cashGiven)}`, p.x + p.w, p.y + 22 * S, 16 * S, { align: 'right', color: C.gold, weight: 800 });
    gui.text('Count out the change:', p.x, p.y + 50 * S, 13 * S, { color: C.dim });
    const cols = 3;
    const gw = (p.w - 16 * S) / cols;
    const gh = 46 * S;
    CHANGE_UNITS.forEach((v, i) => {
      const bx = p.x + (i % cols) * (gw + 8 * S);
      const by = p.y + 62 * S + Math.floor(i / cols) * (gh + 6 * S);
      const note = v >= 5;
      gui.button(bx, by, gw, gh, euro(v, v < 1 ? 2 : 0), () => sim.addChange(v), { size: 15 * S, id: `ch-${v}`,
        color: note ? '#2d5a46' : '#5a4a2a', icon: note ? 'cash' : null });
    });
    let yy = p.y + 62 * S + 3 * (gh + 6 * S) + 8 * S;
    gui.box(p.x, yy, p.w, 48 * S, { r: 12, fill: 'rgba(255,255,255,0.06)', stroke: C.line });
    gui.text('Wisselgeld', p.x + 12 * S, yy + 30 * S, 14 * S, { color: C.dim, weight: 700 });
    gui.text(euro(c.change), p.x + p.w - 12 * S, yy + 32 * S, 22 * S, { align: 'right', weight: 900, color: C.gold });
    yy += 58 * S;
    gui.button(p.x, yy, 100 * S, 52 * S, 'Reset', () => sim.resetChange(), { kind: 'ghost', size: 14 * S, id: 'ch-reset' });
    gui.button(p.x + 108 * S, yy, p.w - 108 * S, 52 * S, 'Geef wisselgeld', () => sim.giveChange(), { kind: 'primary',
      size: 16 * S, id: 'give' });
  }
}
