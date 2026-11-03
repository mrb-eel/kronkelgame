import * as THREE from 'three';
import { C } from '../gui.js';
import { BaseScreen, hud, portrait, receipt, dashes, RECEIPT } from './common.js';
import { CashierSim, CHANGE_UNITS, COMBO_STEPS, MAX_MULT, STAR_SCORES, multFor } from '../sim/cashier.js';
import { Crowd } from '../sim/crowd.js';
import { clamp, clockText, dateText, euro, num, rng } from '../util.js';
import { sfx } from '../audio.js';
import { t } from '../i18n.js';

const TABS = ['weed', 'hash', 'extra'];
// Euro note colours, so counting change feels like the real drawer
const NOTE = { 5: '#9aa59a', 10: '#d8655a', 20: '#5f8fd0', 50: '#f0a24a', 100: '#5fae6e' };

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
    this.stampT = 9;
    this.v3 = new THREE.Vector3();
    // arcade layer: rolling score, bump on points, screen shake, big centre popups
    this.shown = 0;
    this.bump = 0;
    this.shake = 0;
    this.pops = [];
    this.best = g.save.best.cashier;
    this.passedBest = false;
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
    const i = TABS.indexOf(this.tab);
    this.tab = TABS[(i + d + TABS.length) % TABS.length];
  }

  onAlt(btn) {
    const c = this.sim.current;
    if (!c || this.paused) return;
    if (btn === 'x') {
      if (c.step === 'id') this._decide(true);
      else if (c.step === 'order') this._checkout();
      else if (c.step === 'pay' && c.pay === 'pin') this.sim.payPin();
      else if (c.step === 'pay') this.sim.giveChange();
    } else if (btn === 'y') {
      if (c.step === 'id') this._decide(false);
      else if (c.step === 'order') this.sim.clearBag();
      else if (c.step === 'pay') this.sim.resetChange();
    }
  }

  _decide(ok) {
    const c = this.sim.current;
    if (!c || c.step !== 'id') return;
    this.stamped = { c, ok, valid: this.sim.isValidId(c) };
    this.stampT = 0;
    this.sim.checkId(ok);
  }

  _checkout() {
    const r = this.sim.checkout();
    if (!r.ok && r.reason === 'empty') this.toast(t('cash.empty'), C.paper);
  }

  update(dt) {
    const sim = this.sim;
    this.mascot.update(dt);
    this.stampT += dt;
    if (!this.paused && !this.modal) {
      sim.update(dt);
      this.crowd.update(dt);
    }
    this.flash = Math.max(0, this.flash - dt * 2);
    this.bump = Math.max(0, this.bump - dt * 4);
    this.shake = Math.max(0, this.shake - dt * 3);
    this.shown += (sim.points - this.shown) * Math.min(1, dt * 9);
    if (Math.abs(sim.points - this.shown) < 1) this.shown = sim.points;
    for (const p of this.pops) p.t += dt;
    this.pops = this.pops.filter((p) => p.t < p.dur);
    for (const e of sim.events.splice(0)) this._event(e);
    if (!this.passedBest && this.best > 0 && sim.points > this.best) {
      this.passedBest = true;
      this._pop(t('arc.record'), C.yellow, { size: 40, dur: 2 });
      sfx.record();
    }
    if (!this.lastCall && sim.hour >= sim.closeHour) {
      this.lastCall = true;
      this.toast(t('cash.lastCall'), C.yellow);
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

  /** Big centre-screen word that punches in and fades: PERFECT!, x3 COMBO!, COMBO BROKEN... */
  _pop(text, color, { size = 34, dur = 1.1 } = {}) {
    this.pops.unshift({ text, color, size, dur, t: 0, tilt: (Math.random() - 0.5) * 0.12 });
    if (this.pops.length > 3) this.pops.length = 3;
  }

  _event(e) {
    const input = this.game.input;
    switch (e.type) {
      case 'points': {
        this.bump = 1;
        this.floatN = ((this.floatN || 0) + 1) % 3;
        const pos = new THREE.Vector3(3.8 + (this.floatN - 1) * 0.32, 1.9 + this.floatN * 0.08, -2.8);
        this.game.gui.floatWorld(`+${num(e.pts)}`, pos, e.grade ? C.yellow : C.paper);
        if (e.grade) {
          const col = { perfect: C.yellow, catch: C.yellow, nice: C.paper, ok: C.dim }[e.grade];
          this._pop(t(`arc.${e.grade}`), col, { size: e.grade === 'ok' ? 26 : 36 });
          if (e.combo >= 2) sfx.combo(e.combo);
        }
        break;
      }
      case 'multUp':
        this._pop(e.mult >= MAX_MULT ? t('arc.onFire') : t('arc.mult', { n: e.mult }), e.mult >= MAX_MULT ? C.red : C.pink,
          { size: 44, dur: 1.5 });
        sfx.multUp(e.mult);
        input.rumble(0.3, 0.5, 120);
        break;
      case 'comboBreak':
        if (e.combo >= 3) this._pop(t('arc.comboBreak'), C.red, { size: 34, dur: 1.3 });
        sfx.comboBreak();
        this.shake = Math.max(this.shake, e.combo >= 6 ? 1 : 0.6);
        break;
      case 'door':
        sfx.door();
        break;
      case 'ok':
        sfx.ok();
        if (e.text) this.toast(e.text, C.yellow);
        else this.mascot.react('good');
        break;
      case 'refusedOk':
        sfx.ok();
        this.toast(e.text, C.yellow);
        break;
      case 'strike':
        sfx.error();
        input.rumble(0.9, 0.6, 350);
        this.flash = 1;
        this.shake = 1.2;
        this.toast(t('cash.strike', { n: this.sim.stats.strikes, text: e.text }), C.red);
        break;
      case 'wrongRefusal':
      case 'mistake':
        sfx.error();
        input.rumble(0.4, 0.3, 150);
        this.toast(e.text, C.red);
        break;
      case 'walkout':
        sfx.sad();
        this.toast(e.text, C.red);
        break;
      case 'sale': {
        sfx.cash();
        this.mascot.react('good');
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
    const sim = this.sim;
    const s = sim.stats;
    const score = sim.score();
    const closed = this.sim.reason === 'closed';
    const stars = closed ? Math.min(1, sim.starsFor(score)) : sim.starsFor(score);
    const next = closed ? null : (STAR_SCORES.find((n) => n > score) ?? 0) - score;
    const best = g.save.best.cashier;
    const newBest = score > best;
    if (newBest) g.save.best.cashier = score;
    g.save.stars.cashier = Math.max(g.save.stars.cashier, stars);
    g.persist();
    g.setScreen('results', {
      mode: 'cashier', closed,
      title: t(closed ? 'res.closed' : 'res.receipt'),
      subtitle: t(closed ? 'res.closedSub' : 'res.cashierSub'),
      score, stars, best: newBest ? score : best, newBest, vrAnchor: this.vrAnchor(), next,
      lines: [
        [t('res.served'), s.served], [t('res.perfect'), s.perfect], [t('res.bestCombo'), sim.bestCombo],
        [t('res.refusedOk'), s.refusedOk], [t('res.wrongRefusals'), s.wrongRefusals],
        [t('res.walkouts'), s.walkouts], [t('res.strikes'), `${s.strikes}/3`], [t('res.revenue'), euro(s.revenue)],
        ...(sim.cleanBonus() ? [[t('res.cleanBonus'), `+${num(sim.cleanBonus())}`]] : []),
      ],
    });
  }

  // ---------------------------------------------------------------- drawing
  draw(gui) {
    const S = gui.S;
    const sim = this.sim;
    const c = sim.current;
    const ctx = gui.ctx;
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(213,31,43,${this.flash * 0.28})`;
      ctx.fillRect(0, 0, gui.w, gui.h);
    }
    const mult = multFor(sim.combo);
    if (mult >= MAX_MULT) this._fireGlow(gui);
    ctx.save();
    if (this.shake > 0) ctx.translate((Math.random() - 0.5) * 14 * S * this.shake, (Math.random() - 0.5) * 10 * S * this.shake);
    const strikes = sim.stats.strikes;
    const barBottom = hud(gui, this, [
      { label: t('hud.score'), w: 132, fill: mult >= MAX_MULT ? C.yellow : C.paper,
        draw: (x, y, w, h) => this._score(gui, x, y, w, h, mult) },
      { label: t('hud.strikes'), w: 98, draw: (x, y, w) => this._strikes(gui, x, y, w, strikes) },
      { label: t('hud.time'), value: clockText(sim.hour), color: sim.hour >= 24 ? C.red : C.ink },
      { label: t('hud.queue'), value: Math.max(0, sim.queue.length - (c ? 1 : 0)), w: 58 },
    ], { onPause: () => this.onPause() });
    const pad = 12 * S;
    const left = gui.safe.left + pad;
    const right = gui.w - gui.safe.right - pad;
    const bottom = gui.h - gui.safe.bottom - pad;
    const portraitMode = gui.portrait;
    if (portraitMode) {
      const ph = Math.min(gui.h * 0.56, 530 * S);
      this._balloon(gui, c, left, right, barBottom + 12 * S, bottom - ph - 20 * S);
      this._mainPanel(gui, left, bottom - ph, right - left, ph);
    } else {
      const pw = Math.min(450 * S, (right - left) * 0.48);
      const top = barBottom + 16 * S;
      const idW = Math.min(400 * S, (right - left) * 0.42);
      this._balloon(gui, c, left, right - pw - 16 * S, top, gui.h * 0.62);
      if (c && c.step === 'id') this._idCard(gui, left, top + 92 * S, idW, c);
      else if (this.stamped && this.stampT < 1.1) this._idCard(gui, left, top + 92 * S, idW, this.stamped.c, true);
      this._mainPanel(gui, right - pw, top, pw, bottom - top);
    }
    // pops go where nothing important is: above the order panel on phones, over the counter top in landscape
    const popX = portraitMode ? gui.w / 2 : (left + right - Math.min(450 * S, (right - left) * 0.48) - 16 * S) / 2;
    this._drawPops(gui, popX, portraitMode ? bottom - Math.min(gui.h * 0.56, 530 * S) - 26 * S : bottom - 24 * S);
    ctx.restore();
    this.drawModal(gui);
    this.drawPause(gui);
  }

  /** Score sticker: rolling number, x-multiplier tag on the corner, combo bar to the next multiplier. */
  _score(gui, x, y, w, h, mult) {
    const S = gui.S;
    const sim = this.sim;
    const record = this.passedBest && Math.floor(gui.time * 4) % 2 === 0;
    gui.text(this.passedBest ? t('hud.newBest') : t('hud.score'), x + w / 2, y + 15 * S, 11.5 * S,
      { font: 'label', color: record ? C.ink : C.red, align: 'center', upper: true, max: w - 12 * S });
    gui.text(num(this.shown), x + w / 2, y + 39 * S, 21 * S * (1 + this.bump * 0.22), { font: 'display', color: C.ink,
      align: 'center', max: w - 12 * S });
    const lo = mult > 1 ? COMBO_STEPS[mult - 2] : 0;
    const hi = COMBO_STEPS[mult - 1];
    const frac = hi ? (sim.combo - lo) / (hi - lo) : 1;
    gui.bar(x + 8 * S, y + h - 8 * S, w - 16 * S, 4 * S, frac, mult >= MAX_MULT ? C.red : C.pink, 'rgba(18,16,21,0.15)');
    if (mult > 1) {
      const pulse = mult >= MAX_MULT ? 1 + Math.sin(gui.time * 12) * 0.08 : 1;
      const tw = 42 * S * pulse;
      const th = 28 * S * pulse;
      const tx = x + w - tw * 0.55;
      const ty = y - th * 0.55;
      gui.tilted(tx + tw / 2, ty + th / 2, 0.14, () => {
        gui.sticker(tx, ty, tw, th, { fill: mult >= MAX_MULT ? C.red : C.ink, r: 6, shadow: 0, outline: 2 });
        gui.text(`x${mult}`, tx + tw / 2, ty + th * 0.74, 18 * S * pulse, { font: 'display', color: C.yellow, align: 'center' });
      });
    }
    if (sim.combo >= 2) {
      gui.text(`${t('arc.combo')} ${sim.combo}`, x + 8 * S, y + h + 15 * S, 12 * S, { font: 'label', color: C.yellow,
        upper: true, stroke: C.ink, strokeW: 4 * S });
    }
  }

  /** At x5 the screen edges burn: a pulsing orange vignette. */
  _fireGlow(gui) {
    const ctx = gui.ctx;
    const a = 0.5 + Math.sin(gui.time * 6) * 0.12;
    const r = Math.hypot(gui.w, gui.h) / 2;
    const g = ctx.createRadialGradient(gui.w / 2, gui.h / 2, r * 0.5, gui.w / 2, gui.h / 2, r);
    g.addColorStop(0, 'rgba(255,110,0,0)');
    g.addColorStop(0.6, `rgba(255,110,0,${a * 0.45})`);
    g.addColorStop(1, `rgba(230,40,10,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, gui.w, gui.h);
  }

  /** Newest pop sits on `base`, older ones are pushed up above it. */
  _drawPops(gui, cx, base) {
    const S = gui.S;
    let y = base;
    for (const p of this.pops) {
      const punch = 1 + Math.max(0, 0.16 - p.t) * 5;
      const alpha = clamp(Math.min(p.t * 12, (p.dur - p.t) * 4), 0, 1);
      const size = p.size * S * punch;
      gui.ctx.save();
      gui.ctx.globalAlpha = alpha;
      gui.tilted(cx, y - size * 0.35, p.tilt, () => {
        gui.text(p.text, cx, y - p.t * 14 * S, size, { font: 'display', color: p.color, align: 'center', stroke: C.ink,
          strokeW: 7 * S, max: gui.w - 30 * S });
      });
      gui.ctx.restore();
      y -= p.size * S * 1.15;
    }
  }

  _strikes(gui, x, y, w, n) {
    const S = gui.S;
    gui.text(t('hud.strikes'), x + w / 2, y + 15 * S, 11.5 * S, { font: 'label', color: C.red, align: 'center', upper: true });
    for (let i = 0; i < 3; i++) {
      const bx = x + w / 2 + (i - 1) * 24 * S;
      const by = y + 33 * S;
      gui.ctx.lineWidth = 2 * S;
      gui.ctx.strokeStyle = C.ink;
      gui.rr(bx - 9 * S, by - 9 * S, 18 * S, 18 * S, 3 * S);
      gui.ctx.stroke();
      if (i < n) gui.icon('cross', bx, by, 22 * S, C.red);
    }
  }

  /** Comic balloon over the customer's head, with their patience as a burning fuse. */
  _balloon(gui, c, left, right, top, maxBottom) {
    if (!c || !c.said) return;
    const S = gui.S;
    const head = this.world.project(this.v3.set(c.x, 1.95, c.z));
    const w = Math.min(right - left, 460 * S);
    const lines = gui.wrap(c.said, w - 40 * S, 18 * S, 'body', 700);
    const h = lines.length * 24 * S + 50 * S;
    let x = head.visible ? head.x - w / 2 : (left + right) / 2 - w / 2;
    x = clamp(x, left, right - w);
    let y = head.visible ? head.y - h - 34 * S : top;
    y = clamp(y, top, maxBottom - h);
    const tail = head.visible && head.y > y + h + 6 * S ? [head.x, Math.min(head.y - 8 * S, y + h + 40 * S)] : [x + w * 0.3, y + h];
    gui.balloon(x, y, w, h, tail[0], tail[1]);
    gui.text(c.first.toUpperCase(), x + 18 * S, y + 22 * S, 13 * S, { font: 'label', color: C.red });
    lines.forEach((l, i) => gui.text(l, x + 18 * S, y + 46 * S + i * 24 * S, 18 * S, { color: C.ink, weight: 700 }));
    const frac = c.maxPatience ? clamp(c.patience / c.maxPatience, 0, 1) : 1;
    const fy = y + 30 * S;
    const fx = x + w - 110 * S;
    gui.bar(fx, fy - 9 * S, 92 * S, 8 * S, frac, frac > 0.5 ? C.yellow : frac > 0.25 ? '#ff9a2e' : C.red, 'rgba(18,16,21,0.15)');
    if (frac < 0.3) gui.text('!', fx - 10 * S, fy, 16 * S, { font: 'display', color: C.red, align: 'center' });
  }

  _mainPanel(gui, x, y, w, h) {
    const c = this.sim.current;
    const S = gui.S;
    if (!c) {
      const p = gui.card(x, y, w, Math.min(h, 120 * S), { tone: 'ink', label: t('cash.panel'), labelColor: C.yellow, labelText: C.ink });
      gui.text(t(this.sim.queue.length ? 'cash.next' : 'cash.quiet'), p.x,
        p.y + 34 * S, 18 * S, { color: C.paper, weight: 700, max: p.w });
      gui.text(t('cash.walking'), p.x, p.y + 58 * S, 14 * S, { color: C.dim, weight: 600 });
      return;
    }
    if (c.step === 'id') {
      if (gui.portrait) {
        const cardW = Math.min(w, 380 * S);
        this._idCard(gui, x + (w - cardW) / 2, y, cardW, c);
        this._idButtons(gui, x, y + cardW * 0.63 + 60 * S, w);
      } else {
        this._idPrompt(gui, x, y, w);
      }
    } else if (c.step === 'order') this._order(gui, x, y, w, h);
    else if (c.step === 'pay') this._pay(gui, x, y, w, h);
  }

  _idPrompt(gui, x, y, w) {
    const S = gui.S;
    const p = gui.card(x, y, w, 222 * S, { tone: 'ink', label: t('cash.idPanel'), labelColor: C.yellow, labelText: C.ink });
    gui.text(t('cash.idQ'), p.x, p.y + 26 * S, 21 * S, { font: 'label', color: C.paper, upper: true,
      max: p.w });
    gui.paragraph(t('cash.today', { date: dateText(this.sim.today) }), p.x, p.y + 34 * S, p.w,
      15 * S, { color: C.dim, weight: 600 });
    this._idButtons(gui, p.x, p.y + 96 * S, p.w);
  }

  _idButtons(gui, x, y, w) {
    const S = gui.S;
    const bw = (w - 14 * S) / 2;
    gui.button(x, y, bw, 62 * S, t('cash.idOk'), () => this._decide(true), { kind: 'yellow', icon: 'check', id: 'id-ok', size: 22 * S });
    gui.button(x + bw + 14 * S, y, bw, 62 * S, t('cash.refuse'), () => this._decide(false), { kind: 'red', icon: 'cross',
      id: 'id-no', size: 22 * S });
  }

  _idCard(gui, x, y, cardW, c, stampOnly = false) {
    const S = gui.S;
    const cardH = cardW * 0.63;
    const ctx = gui.ctx;
    const u = cardW / 400;
    const tilt = -0.025;
    gui.tilted(x + cardW / 2, y + cardH / 2, tilt, () => {
      gui.rr(x + 6 * S, y + 6 * S, cardW, cardH, 16 * u);
      ctx.fillStyle = C.ink;
      ctx.fill();
      gui.rr(x, y, cardW, cardH, 16 * u);
      const grad = ctx.createLinearGradient(x, y, x + cardW, y + cardH);
      grad.addColorStop(0, '#eef3f8');
      grad.addColorStop(1, '#c8d8ea');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = 3 * S;
      ctx.strokeStyle = C.ink;
      ctx.stroke();
      ctx.save();
      gui.rr(x, y, cardW, cardH, 16 * u);
      ctx.clip();
      ctx.fillStyle = '#2b4c8c';
      ctx.fillRect(x, y, cardW, 36 * u);
      ctx.restore();
      const nat = { NLD: 'NEDERLAND', DEU: 'DEUTSCHLAND', BEL: 'BELGIË', FRA: 'FRANCE', GBR: 'UNITED KINGDOM', ESP: 'ESPAÑA' }[c.nat];
      gui.text(`${nat} · IDENTITEITSKAART`, x + 14 * u, y + 25 * u, 15 * u, { font: 'label', color: '#fff', max: cardW - 28 * u });
      portrait(gui, x + 14 * u, y + 48 * u, 104 * u, 130 * u, c.idLook);
      ctx.lineWidth = 2 * u;
      ctx.strokeStyle = 'rgba(18,16,21,0.5)';
      gui.rr(x + 14 * u, y + 48 * u, 104 * u, 130 * u, 6);
      ctx.stroke();
      const fx = x + 134 * u;
      let fy = y + 64 * u;
      const field = (label, value) => {
        gui.text(label, fx, fy, 12 * u, { font: 'label', color: '#5a6b7a' });
        gui.text(value, fx, fy + 21 * u, 19 * u, { font: 'display', color: C.ink, max: cardW - (fx - x) - 12 * u });
        fy += 44 * u;
      };
      const [first, ...rest] = c.name.split(' ');
      field('NAAM / NAME', `${rest.join(' ').toUpperCase()}, ${first}`);
      field('GEBOREN / BORN', dateText(c.birth));
      field('GELDIG TOT / EXPIRES', dateText(c.expiry));
      gui.text(`<<<${c.nat}${c.name.replace(/ /g, '<').toUpperCase()}<<<<<<<<`, x + 14 * u, y + cardH - 12 * u, 12 * u,
        { font: RECEIPT, color: '#4a5a6a', max: cardW - 28 * u });
    });
    if (!stampOnly) {
      gui.tape(t('cash.todayTape', { date: dateText(this.sim.today) }), x + cardW / 2, y + cardH + 26 * S, { size: 17 * S, color: C.yellow,
        tilt: 0.02 });
    }
    if (stampOnly && this.stamped) {
      const k = clamp(this.stampT * 5, 0, 1);
      const scale = 1.6 - 0.6 * k;
      const ok = this.stamped.ok;
      gui.ctx.save();
      gui.ctx.globalAlpha = k;
      gui.stamp(t(ok ? 'stamp.approved' : 'stamp.refused'), x + cardW * 0.62, y + cardH * 0.55, 30 * S * scale,
        ok ? '#1f6f5a' : C.red, ok ? -0.14 : 0.12);
      gui.ctx.restore();
    }
  }

  _order(gui, x, y, w, h) {
    const S = gui.S;
    const sim = this.sim;
    const c = sim.current;
    const p = gui.card(x, y, w, h, { tone: 'ink', label: t('cash.panel'), labelColor: C.yellow, labelText: C.ink });
    const small = gui.portrait;
    const tw = (p.w - 16 * S) / 3;
    TABS.forEach((id, i) => {
      gui.button(p.x + i * (tw + 8 * S), p.y, tw, 40 * S, t(`cash.tab.${id}`), () => { this.tab = id; }, { selected: this.tab === id,
        size: 17 * S, id: `tab-${id}`, kind: 'ink' });
    });
    const prods = Object.values(sim.products).filter((pr) => pr.cat === this.tab);
    const cols = 2;
    const gw = (p.w - 10 * S) / cols;
    const rows = Math.ceil(prods.length / cols);
    // leave the bag receipt room for every line in it (2 to 4 rows) before sizing the product buttons
    const BOTTOM = 112 * S; // rule buttons + checkout under the bag
    const bagFor = (n) => (46 + n * 22) * S;
    const bagRows = clamp(Object.keys(c.bag).length, 2, 4);
    const fixed = 52 * S + bagFor(bagRows) + 6 * S + BOTTOM;
    const gh = Math.max(32 * S, Math.min((small ? 46 : 54) * S, (p.h - fixed) / rows - 8 * S));
    let gy = p.y + 52 * S;
    prods.forEach((pr, i) => {
      const bx = p.x + (i % cols) * (gw + 10 * S);
      const by = gy + Math.floor(i / cols) * (gh + 8 * S);
      gui.button(bx, by, gw, gh, pr.name, () => { sim.addItem(pr.id, 1); sfx.pop(); }, {
        sub: gh > 46 * S ? (pr.unit === 'g' ? t('cash.perGram', { kind: t(`kind.${pr.kind}`) }) : t('cash.each')) : null, size: 17 * S, align: 'left',
        id: `p-${pr.id}`, kind: c.bag[pr.id] ? 'yellow' : 'paper' });
      // red price sticker
      gui.tilted(bx + gw - 34 * S, by + gh / 2, 0.12, () => {
        gui.sticker(bx + gw - 60 * S, by + gh / 2 - 13 * S, 52 * S, 26 * S, { fill: C.red, r: 5, shadow: 0, outline: 2 });
        gui.text(euro(pr.price, pr.price % 1 ? 2 : 0), bx + gw - 34 * S, by + gh / 2 + 6 * S, 14 * S, { font: 'display',
          color: C.paper, align: 'center', max: 46 * S });
      });
      // how many are in the bag, as a round ink counter inside the button (not on its edge)
      const q = c.bag[pr.id];
      if (q) {
        const qx = bx + gw - 78 * S;
        const qy = by + gh / 2;
        gui.ctx.beginPath();
        gui.ctx.arc(qx, qy, 12 * S, 0, Math.PI * 2);
        gui.ctx.fillStyle = C.ink;
        gui.ctx.fill();
        gui.text(`${q}${pr.unit === 'g' ? 'g' : '×'}`, qx, qy + 4.5 * S, 12 * S, { font: 'display', color: C.yellow,
          align: 'center', max: 22 * S });
      }
    });
    gy += rows * (gh + 8 * S) + 6 * S;
    // the bag prints as a receipt
    const bagH = Math.max(bagFor(2), p.y + p.h - gy - BOTTOM);
    receipt(gui, p.x, gy, p.w, bagH, { tilt: 0.006 });
    const entries = Object.entries(c.bag);
    const grams = sim.bagGrams();
    gui.text(t('cash.bag'), p.x + 12 * S, gy + 20 * S, 14 * S, { font: 'label', color: C.ink });
    const gw2 = 90 * S;
    gui.bar(p.x + p.w - gw2 - 56 * S, gy + 10 * S, gw2, 10 * S, grams / 5, grams > 5 ? C.red : C.yellow, 'rgba(18,16,21,0.12)');
    gui.text(`${grams}/5 g`, p.x + p.w - 12 * S, gy + 20 * S, 14 * S, { font: 'label', color: grams > 5 ? C.red : C.ink,
      align: 'right' });
    dashes(gui, p.x + 10 * S, gy + 28 * S, p.w - 20 * S);
    const rowH = 22 * S;
    const maxRows = Math.max(1, Math.floor((bagH - 46 * S) / rowH));
    if (entries.length > maxRows) {
      gui.text(`+${entries.length - maxRows + 1}…`, p.x + p.w - 12 * S, gy + bagH - 16 * S, 14 * S, { font: RECEIPT, weight: 700,
        color: C.red, align: 'right' });
    }
    entries.slice(0, entries.length > maxRows ? maxRows - 1 : maxRows).forEach(([id, q], i) => {
      const pr = sim.products[id];
      const ry = gy + 33 * S + i * rowH;
      gui.text(`${q}${pr.unit === 'g' ? 'g' : 'x'} ${pr.name.toUpperCase()}`, p.x + 12 * S, ry + 15 * S, 14 * S,
        { font: RECEIPT, weight: 700, color: C.ink, max: p.w - 140 * S });
      gui.text(euro(pr.price * q), p.x + p.w - 54 * S, ry + 15 * S, 14 * S, { font: RECEIPT, color: C.ink, align: 'right' });
      gui.button(p.x + p.w - 44 * S, ry + 1 * S, 34 * S, 20 * S, '', () => sim.addItem(id, -1), { icon: 'minus',
        id: `minus-${id}`, size: 12 * S, kind: 'ink' });
    });
    if (!entries.length) gui.text(t('cash.tapProduct'), p.x + 12 * S, gy + 50 * S, 15 * S, { font: RECEIPT, color: C.grey });
    let ry = gy + bagH + 12 * S;
    const rw = (p.w - 10 * S) / 2;
    gui.button(p.x, ry, rw, 40 * S, t('cash.max5'), () => sim.sayRule('max5'), { size: 16 * S, id: 'r-max5', kind: 'paper',
      textColor: C.red });
    gui.button(p.x + rw + 10 * S, ry, rw, 40 * S, t('cash.noAlcohol'), () => sim.sayRule('alcohol'), { size: 16 * S, id: 'r-alc',
      kind: 'paper', textColor: C.red });
    ry += 48 * S;
    gui.button(p.x, ry, 86 * S, 52 * S, t('cash.clear'), () => sim.clearBag(), { kind: 'ink', size: 16 * S, id: 'clear' });
    gui.button(p.x + 96 * S, ry, p.w - 96 * S, 52 * S, t('cash.checkout', { amt: euro(sim.bagTotal()) }), () => this._checkout(), {
      kind: 'yellow', size: 21 * S, id: 'checkout' });
  }

  _pay(gui, x, y, w, h) {
    const S = gui.S;
    const sim = this.sim;
    const c = sim.current;
    if (c.pay === 'pin') {
      const ph = Math.min(h, 290 * S);
      const p = gui.card(x, y, w, ph, { tone: 'ink', label: t('cash.pin'), labelColor: C.yellow, labelText: C.ink });
      // the card terminal's little screen
      const sw = p.w;
      gui.sticker(p.x, p.y + 6 * S, sw, 88 * S, { fill: '#203b2c', r: 8, shadow: 0, outline: 3 });
      gui.text(t('cash.toPay'), p.x + 14 * S, p.y + 30 * S, 14 * S, { font: RECEIPT, color: '#9fe0b8' });
      gui.text(euro(c.total), p.x + sw - 14 * S, p.y + 76 * S, 36 * S, { font: RECEIPT, weight: 700, color: '#c9ffd9',
        align: 'right' });
      if (c.payTimer > 0) {
        const dots = '.'.repeat(1 + (Math.floor(gui.time * 4) % 3));
        gui.text(`${t('cash.busy')}${dots}`, p.x + 14 * S, p.y + 76 * S, 18 * S, { font: RECEIPT, color: '#9fe0b8' });
      }
      gui.button(p.x, p.y + 114 * S, p.w, 74 * S, c.payTimer > 0 ? t('cash.wait') : t('cash.pin'), () => sim.payPin(), {
        kind: 'yellow', icon: 'card', size: 26 * S, disabled: c.payTimer > 0, id: 'pin',
        sub: c.payTimer > 0 ? null : t('cash.pinSub') });
      return;
    }
    const p = gui.card(x, y, w, h, { tone: 'ink', label: t('cash.cashPanel'), labelColor: C.yellow, labelText: C.ink });
    gui.text(t('cash.received'), p.x, p.y + 20 * S, 14 * S, { font: 'label', color: C.dim });
    this._note(gui, p.x, p.y + 28 * S, 118 * S, 58 * S, c.cashGiven, null, 'recv');
    gui.text(t('cash.total'), p.x + p.w, p.y + 20 * S, 14 * S, { font: 'label', color: C.dim, align: 'right' });
    gui.text(euro(c.total), p.x + p.w, p.y + 74 * S, 32 * S, { font: 'display', color: C.paper, align: 'right' });
    gui.text(t('cash.count'), p.x, p.y + 116 * S, 15 * S, { font: 'label', color: C.yellow, upper: true });
    const notes = CHANGE_UNITS.filter((v) => v >= 5);
    const coins = CHANGE_UNITS.filter((v) => v < 5);
    const nw = (p.w - 3 * 10 * S) / 4;
    const nh = Math.min(58 * S, nw * 0.55);
    let yy = p.y + 128 * S;
    notes.forEach((v, i) => this._note(gui, p.x + i * (nw + 10 * S), yy, nw, nh, v, () => sim.addChange(v), `ch-${v}`));
    yy += nh + 14 * S;
    const cr = Math.min(28 * S, (p.w - 4 * 10 * S) / 10);
    coins.forEach((v, i) => this._coin(gui, p.x + cr + i * ((p.w - 2 * cr) / (coins.length - 1)), yy + cr, cr, v,
      () => sim.addChange(v), `ch-${v}`));
    yy += cr * 2 + 18 * S;
    receipt(gui, p.x, yy, p.w, 58 * S, { tilt: -0.006 });
    gui.text(t('cash.change'), p.x + 14 * S, yy + 36 * S, 16 * S, { font: RECEIPT, weight: 700, color: C.ink });
    gui.text(euro(c.change), p.x + p.w - 14 * S, yy + 38 * S, 28 * S, { font: 'display', color: C.red, align: 'right' });
    yy += 74 * S;
    gui.button(p.x, yy, 100 * S, 56 * S, t('cash.reset'), () => sim.resetChange(), { kind: 'ink', size: 16 * S, id: 'ch-reset' });
    gui.button(p.x + 110 * S, yy, p.w - 110 * S, 56 * S, t('cash.give'), () => sim.giveChange(), { kind: 'yellow',
      size: 20 * S, id: 'give' });
  }

  /** A euro note as a clickable sticker. */
  _note(gui, x, y, w, h, value, onClick, id) {
    const S = gui.S;
    const pressed = onClick && gui.pressedId === id && gui.pointer.down && gui._inside(x, y, w, h);
    const off = pressed ? 4 * S : 0;
    const col = NOTE[value] || '#ccc';
    gui.sticker(x + off, y + off, w, h, { fill: col, r: 5, shadow: pressed || !onClick ? 0 : 4, outline: 2.5 });
    const c = gui.ctx;
    c.save();
    gui.rr(x + off, y + off, w, h, 5 * S);
    c.clip();
    c.fillStyle = 'rgba(255,255,255,0.28)';
    c.beginPath();
    c.arc(x + off + w * 0.72, y + off + h * 0.5, h * 0.42, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 4; i++) c.fillRect(x + off + w * 0.08, y + off + h * (0.25 + i * 0.15), w * 0.35, 1.5 * S);
    c.restore();
    gui.text(String(value), x + off + 8 * S, y + off + h * 0.42, Math.min(22 * S, h * 0.42), { font: 'display', color: C.ink });
    gui.text('EURO', x + off + w - 8 * S, y + off + h - 7 * S, 10 * S, { font: 'label', color: 'rgba(18,16,21,0.7)',
      align: 'right' });
    if (onClick) gui.region(x, y, w, h, onClick, { id, focusable: true, r: 5 * S });
  }

  _coin(gui, cx, cy, r, value, onClick, id) {
    const S = gui.S;
    const pressed = gui.pressedId === id && gui.pointer.down && gui._inside(cx - r, cy - r, r * 2, r * 2);
    const off = pressed ? 3 * S : 0;
    const c = gui.ctx;
    const gold = '#e2b84a';
    const silver = '#cfd2d4';
    const outer = value === 2 ? silver : value === 1 ? gold : gold;
    const inner = value === 2 ? gold : value === 1 ? silver : gold;
    if (!pressed) {
      c.beginPath();
      c.arc(cx + 3.5 * S, cy + 3.5 * S, r, 0, Math.PI * 2);
      c.fillStyle = C.ink;
      c.fill();
    }
    c.beginPath();
    c.arc(cx + off, cy + off, r, 0, Math.PI * 2);
    c.fillStyle = outer;
    c.fill();
    c.lineWidth = 2.5 * S;
    c.strokeStyle = C.ink;
    c.stroke();
    c.beginPath();
    c.arc(cx + off, cy + off, r * 0.72, 0, Math.PI * 2);
    c.fillStyle = inner;
    c.fill();
    c.lineWidth = 1.2 * S;
    c.strokeStyle = 'rgba(18,16,21,0.35)';
    c.stroke();
    const label = value >= 1 ? `€${value}` : `${Math.round(value * 100)}c`;
    gui.text(label, cx + off, cy + off + r * 0.22, r * 0.62, { font: 'display', color: C.ink, align: 'center' });
    gui.region(cx - r, cy - r, r * 2, r * 2, onClick, { id, focusable: true, r });
  }
}
