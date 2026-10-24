import { C } from '../gui.js';
import { BaseScreen, hud, receipt, dashes, rline, RECEIPT } from './common.js';
import { TycoonSim, newTycoon, dateOf, weekday, GOAL_LIST, TYCOON_HOURS, goalText } from '../sim/tycoon.js';
import { Crowd } from '../sim/crowd.js';
import { Nav } from '../sim/nav.js';
import { clamp, clockText, euro, rng } from '../util.js';
import { sfx } from '../audio.js';
import { t, tl, td } from '../i18n.js';

const TABS = ['overview', 'stock', 'staff', 'upgrades', 'prices'];
const SEC_PER_HOUR = 6;

export class TycoonScreen extends BaseScreen {
  enter() {
    const g = this.game;
    this.pausable = true;
    this.howtoTab = 'tycoon';
    if (!g.save.tycoon) {
      g.save.tycoon = newTycoon(Date.now() % 1e9);
      this.sim = new TycoonSim(this.data, this.L, g.save.tycoon);
      this.sim.prepareDay();
      g.persist();
    } else {
      this.sim = new TycoonSim(this.data, this.L, g.save.tycoon);
      if (g.save.tycoon.phase === 'run') {
        // A day was interrupted: replay it from the morning.
        g.save.tycoon.phase = 'plan';
      }
    }
    this.tab = 'overview';
    this.upPage = 0;
    this.speed = 1;
    this.hourT = 0;
    this.world.clearPeople();
    this.world.setView('tycoon');
    this._rebuildWorld();
    if (!g.save.seenHowto.tycoon) {
      g.save.seenHowto.tycoon = true;
      g.persist();
      this.paused = true;
      this.openHowto('tycoon', true);
    }
  }

  exit() {
    this.world.clearPeople();
    this.game.persist();
  }

  get s() {
    return this.sim.s;
  }

  _rebuildWorld() {
    const up = this.sim.upgradeSet;
    this.world.setUpgrades(up);
    this.world.clearPeople();
    this.nav = new Nav(this.L, { upgrades: up });
    this.crowd = new Crowd(this.L, this.nav, rng(this.s.day * 31 + 7), { upgrades: up });
    const band = this.s.event?.id === 'band' && this.s.event.accepted;
    this.crowd.setStaff({ cashier: this.s.staff.cashier, server: this.s.staff.server, cook: this.s.staff.cook,
      musician: band });
    if (this.s.phase !== 'plan') this.crowd.addPoolPlayers();
    this.world.setHour(this.s.phase === 'run' ? this.sim.hourLabel() : 9.5);
  }

  vrAnchor() {
    return { x: 0.6, z: 4.4, yaw: 0, panelY: 1.2, panelDist: 0.9, panelTilt: -0.25, panelScale: 1 };
  }

  onTab(d) {
    if (this.overlay) return this.overlay.onTab(d);
    if (this.s.phase !== 'plan') return;
    const i = TABS.indexOf(this.tab);
    this.tab = TABS[(i + d + TABS.length) % TABS.length];
  }

  onDrag(dx) {
    this.world.orbit = clamp(this.world.orbit - dx * 0.004, -0.9, 0.9);
  }

  onLook(x, y, dt) {
    this.world.orbit = clamp(this.world.orbit + x * dt * 1.2, -0.9, 0.9);
    void y;
  }

  onZoom(d) {
    this.world.zoom = clamp(this.world.zoom * (d > 0 ? 0.92 : 1.08), 0.8, 2.2);
  }

  // ---------------------------------------------------------------- flow
  openShop() {
    sfx.door();
    this.sim.startDay();
    this.hourT = 0;
    this.speed = 1;
    this._rebuildWorld();
    this.game.persist();
  }

  update(dt) {
    const s = this.s;
    this.mascot.update(dt);
    for (const e of this.sim.events.splice(0)) this._event(e);
    if (s.phase === 'run' && !this.paused) {
      this.hourT += dt * this.speed;
      while (this.hourT >= SEC_PER_HOUR && s.phase === 'run') {
        this.hourT -= SEC_PER_HOUR;
        const h = this.sim.simulateHour();
        this.lastHour = h;
        // show roughly a third of the visitors as people walking in
        this.crowd.setRate(Math.min(1.5, (h.visitors / SEC_PER_HOUR) * 0.35));
        if (s.phase === 'report') {
          this.crowd.setRate(0);
          sfx.ok();
          this.game.persist();
        }
      }
      const hourNow = s.phase === 'run' ? TYCOON_HOURS[this.sim.run.hourIdx] + this.hourT / SEC_PER_HOUR : 25;
      this.world.setHour(hourNow);
    }
    if (!this.paused) this.crowd.update(dt * (s.phase === 'run' ? this.speed : 1));
    this.world.syncPeople(this.crowd.entities(), dt);
  }

  _event(e) {
    switch (e.type) {
      case 'soldout':
      case 'queue':
        sfx.error();
        this.toast(e.text, C.red);
        break;
      case 'fine':
        sfx.sad();
        this.game.input.rumble(0.8, 0.5, 300);
        this.toast(e.text, C.red);
        break;
      case 'ok':
        this.toast(e.text, C.yellow);
        break;
      case 'goal':
        sfx.fanfare();
        (this.newGoals ||= []).push(goalText(e.id));
        break;
      default:
        break;
    }
  }

  nextDay() {
    if (this.s.bankrupt) return;
    this.newGoals = [];
    this.sim.nextDay();
    this.tab = 'overview';
    this._rebuildWorld();
    this.game.persist();
    sfx.whoosh();
  }

  // ---------------------------------------------------------------- drawing
  draw(gui) {
    const S = gui.S;
    const s = this.s;
    const d = dateOf(s);
    const dateStr = `${tl('days')[weekday(s)].slice(0, 2)} ${d.getDate()} ${tl('months')[d.getMonth()]}`;
    const run = s.phase === 'run';
    hud(gui, this, [
      { label: t('hud.day', { n: s.day }), value: dateStr, w: 112 },
      { label: t('hud.time'), value: run ? clockText(TYCOON_HOURS[Math.min(this.sim.run.hourIdx, 14)] + this.hourT / SEC_PER_HOUR) :
        s.phase === 'plan' ? '09:30' : '01:00' },
      { label: t('hud.cash'), value: euro(s.cash, 0), color: s.cash < 0 ? C.red : C.ink, w: 112 },
      { label: t('hud.rep'), w: 136, draw: (x, y, w) => {
        gui.text(t('hud.rep'), x + w / 2, y + 15 * S, 11.5 * S, { font: 'label', color: C.red, align: 'center', upper: true });
        gui.ctx.fillStyle = C.ink;
        gui.rr(x + 8 * S, y + 21 * S, w - 16 * S, 24 * S, 12 * S);
        gui.ctx.fill();
        gui.smileys(x + 12 * S, y + 33 * S, 10 * S, s.rep);
      } },
      { label: t('hud.stock'), value: `${Math.round(this.sim.stockTotal())}g`, w: 96,
        color: this.sim.stockTotal() < 80 ? C.red : C.ink },
    ], { onPause: () => this.onPause() });
    if (s.phase === 'plan') this._drawPlan(gui);
    else if (s.phase === 'run') this._drawRun(gui);
    else this._drawReport(gui);
    if (s.bankrupt) this._drawBankrupt(gui);
    this.drawModal(gui);
    this.drawPause(gui);
  }

  _drawPlan(gui) {
    const S = gui.S;
    const portrait = gui.portrait;
    const top = gui.safe.top + 78 * S;
    const bottom = gui.h - gui.safe.bottom - 12 * S;
    const left = gui.safe.left + 12 * S;
    const w = portrait ? gui.w - left * 2 : Math.min(580 * S, gui.w * 0.54);
    const h = portrait ? (bottom - top) * 0.66 : bottom - top - 6 * S;
    const y = portrait ? bottom - h - 78 * S : top;
    const s = this.s;
    const p = gui.card(left, y, w, h, { tone: 'ink', label: t('ty.morning', { day: tl('days')[weekday(s)] }), labelColor: C.yellow,
      labelText: C.ink });
    const tw = (p.w - 6 * S * (TABS.length - 1)) / TABS.length;
    TABS.forEach((id, i) => {
      gui.button(p.x + i * (tw + 6 * S), p.y, tw, 40 * S, t(`ty.tab.${id}`), () => { this.tab = id; }, { selected: this.tab === id,
        size: 15 * S, id: `tt-${id}`, kind: 'ink' });
    });
    const body = { x: p.x, y: p.y + 56 * S, w: p.w, h: p.h - 56 * S };
    ({ overview: this._tabOverview, stock: this._tabStock, staff: this._tabStaff, upgrades: this._tabUpgrades,
      prices: this._tabPrices })[this.tab].call(this, gui, body);
    const bw = portrait ? gui.w - left * 2 : Math.min(330 * S, gui.w * 0.3);
    gui.button(portrait ? left : gui.w - gui.safe.right - 12 * S - bw, bottom - 66 * S, bw, 66 * S, t('ty.open'), () => this.openShop(),
      { kind: 'yellow', icon: 'play', size: 24 * S, sub: t('ty.openSub', { w: euro(this.sim.wages(), 0), r: euro(380, 0) }), id: 'open', tilt: -0.015 });
  }

  _tabOverview(gui, b) {
    const S = gui.S;
    const s = this.s;
    let y = b.y;
    const d = dateOf(s);
    gui.text(`${d.getDate()} ${tl('months')[d.getMonth()]} · ${t(`weather.${s.weather}`)}`, b.x, y + 18 * S, 22 * S, { font: 'display',
      color: C.paper });
    y += 34 * S;
    if (s.event) {
      const e = s.event;
      const text = td('ev', e, 'text').replace('{amt}', euro(e.offer || 0, 0));
      const lines = gui.wrap(text, b.w - 32 * S, 15 * S, 'body', 600);
      const eh = 54 * S + lines.length * 21 * S + (e.pending ? 58 * S : 0);
      gui.card(b.x + 4 * S, y + 10 * S, b.w - 8 * S, eh, { tone: 'paper', label: td('ev', e, 'title'), labelColor: C.red, labelText: C.paper,
        shadow: 5, tilt: -0.008 });
      lines.forEach((l, i) => gui.text(l, b.x + 20 * S, y + 50 * S + i * 21 * S, 15 * S, { weight: 600, color: C.ink }));
      if (e.pending) {
        const bw = (b.w - 50 * S) / 2;
        gui.button(b.x + 20 * S, y + eh - 52 * S, bw, 44 * S, t('ty.yesAmt', { amt: euro(e.offer, 0) }), () => {
          this.sim.acceptOffer(true);
          this._rebuildWorld();
        }, { kind: 'yellow', size: 16 * S, id: 'ev-yes' });
        gui.button(b.x + 30 * S + bw, y + eh - 52 * S, bw, 44 * S, t('btn.no'), () => this.sim.acceptOffer(false),
          { size: 16 * S, id: 'ev-no', kind: 'paper' });
      }
      y += eh + 24 * S;
    } else {
      gui.text(t('ty.normalDay'), b.x, y + 14 * S, 16 * S, { color: C.dim, weight: 600 });
      y += 32 * S;
    }
    const r = s.lastReport;
    if (r) {
      gui.text(t('ty.yesterday', { v: r.visitors, p: euro(r.profit, 0) }), b.x, y + 14 * S, 16 * S,
        { font: 'label', color: r.profit >= 0 ? C.yellow : C.red });
      y += 30 * S;
    }
    gui.text(t('ty.goals'), b.x, y + 16 * S, 15 * S, { font: 'label', color: C.yellow });
    y += 26 * S;
    for (const id of GOAL_LIST) {
      const label = goalText(id);
      if (y > b.y + b.h - 16 * S) break;
      const done = !!s.goals[id];
      gui.ctx.lineWidth = 2 * S;
      gui.ctx.strokeStyle = C.paper;
      gui.rr(b.x + 2 * S, y + 1 * S, 16 * S, 16 * S, 3 * S);
      gui.ctx.stroke();
      if (done) gui.icon('check', b.x + 10 * S, y + 9 * S, 18 * S, C.yellow);
      gui.text(label, b.x + 28 * S, y + 15 * S, 15 * S, { color: done ? C.yellow : C.paper, weight: done ? 700 : 500 });
      y += 24 * S;
    }
  }

  _tabStock(gui, b) {
    const S = gui.S;
    const s = this.s;
    const max = this.data.rules.maxStockGrams;
    let y = b.y;
    gui.paragraph(t('ty.stockLaw', { max, fee: euro(80, 0) }),
      b.x, y - 6 * S, b.w, 14 * S, { color: C.dim, weight: 600 });
    y += 64 * S;
    const total = this.sim.stockTotal();
    gui.bar(b.x, y, b.w, 18 * S, total / max, total > max * 0.9 ? C.red : C.yellow, 'rgba(245,239,225,0.12)');
    gui.text(`${Math.round(total)} / ${max} G`, b.x + b.w, y - 8 * S, 15 * S, { font: 'label', color: C.paper, align: 'right' });
    y += 36 * S;
    for (const [kind, price] of [['weed', 5.2], ['hash', 4.8]]) {
      const label = t(`ty.${kind}`);
      gui.text(label.toUpperCase(), b.x, y + 26 * S, 24 * S, { font: 'display', color: C.paper });
      gui.text(t('ty.buyPrice', { g: Math.round(s.stock[kind]), p: euro(price) }), b.x, y + 48 * S, 14 * S, { color: C.dim, weight: 600 });
      const bw = 96 * S;
      [50, 100].forEach((g, i) => {
        gui.button(b.x + b.w - (2 - i) * (bw + 10 * S) + 10 * S, y + 6 * S, bw, 50 * S, `+${g} g`, () => {
          const r = this.sim.buyStock(kind, g);
          if (!r.ok) {
            sfx.error();
            this.toast(r.reason, C.red);
          } else sfx.coin();
        }, { size: 17 * S, sub: euro(g * price, 0), id: `buy-${kind}-${g}`, kind: 'paper' });
      });
      y += 74 * S;
    }
    gui.button(b.x, y + 4 * S, b.w, 48 * S, t('ty.autoRestock', { state: t(s.policy.restock ? 'on' : 'off') }), () => {
      s.policy.restock = !s.policy.restock;
    }, { selected: s.policy.restock, size: 17 * S, id: 'restock', kind: 'ink' });
  }

  _tabStaff(gui, b) {
    const S = gui.S;
    const s = this.s;
    let y = b.y;
    for (const st of this.data.staff) {
      const n = s.staff[st.id];
      gui.text(`${td('staff', st).toUpperCase()} ×${n}`, b.x, y + 24 * S, 22 * S, { font: 'display', color: C.paper });
      gui.text(t('ty.wage', { w: euro(st.wage, 0) }), b.x, y + 44 * S, 13 * S, { color: C.dim, weight: 600 });
      const bw = 46 * S;
      gui.button(b.x + b.w - bw * 2 - 10 * S, y + 6 * S, bw, 42 * S, '', () => { this.sim.hire(st.id, -1); this._rebuildWorld(); },
        { icon: 'minus', id: `st-${st.id}-`, kind: 'paper' });
      gui.button(b.x + b.w - bw, y + 6 * S, bw, 42 * S, '', () => { this.sim.hire(st.id, 1); this._rebuildWorld(); },
        { icon: 'plus', id: `st-${st.id}+`, kind: 'yellow' });
      y += 54 * S;
      y += gui.paragraph(td('staff', st, 'desc'), b.x, y - 10 * S, b.w - 8 * S, 13 * S, { color: C.dim }) + 6 * S;
    }
    y += 4 * S;
    const strict = s.policy.id === 'strict';
    gui.button(b.x, y, b.w, 54 * S, t(strict ? 'ty.idStrict' : 'ty.idQuick'), () => {
      s.policy.id = strict ? 'quick' : 'strict';
    }, { size: 18 * S, sub: t(strict ? 'ty.idStrictSub' : 'ty.idQuickSub'),
      kind: strict ? 'paper' : 'red', id: 'idpolicy' });
  }

  _tabUpgrades(gui, b) {
    const S = gui.S;
    const ups = this.data.upgrades;
    const rowH = 66 * S;
    const per = Math.max(1, Math.floor((b.h - 54 * S) / (rowH + 10 * S)));
    const pages = Math.ceil(ups.length / per);
    this.upPage = clamp(this.upPage, 0, pages - 1);
    let y = b.y;
    ups.slice(this.upPage * per, this.upPage * per + per).forEach((u, i) => {
      const owned = this.sim.has(u.id);
      const needs = u.requires && !this.sim.has(u.requires);
      gui.tilted(b.x + b.w / 2, y + rowH / 2, i % 2 ? 0.006 : -0.006, () => {
        gui.sticker(b.x, y, b.w, rowH, { fill: owned ? C.yellow : C.paper, r: 8, shadow: 4, outline: 2.5 });
      });
      gui.text(td('up', u).toUpperCase(), b.x + 14 * S, y + 24 * S, 18 * S, { font: 'label', color: C.ink, max: b.w - 150 * S });
      const desc = gui.wrap(td('up', u, 'desc'), b.w - 150 * S, 13 * S, 'body', 600);
      desc.slice(0, 2).forEach((l, k) => gui.text(l, b.x + 14 * S, y + (desc.length > 1 ? 43 : 48) * S + k * 15 * S, 13 * S,
        { color: 'rgba(18,16,21,0.72)', max: b.w - 150 * S, weight: 600 }));
      if (owned) gui.stamp(t('ty.built'), b.x + b.w - 70 * S, y + rowH / 2, 15 * S, C.ink, -0.1, 0.8);
      else {
        gui.button(b.x + b.w - 124 * S, y + 12 * S, 110 * S, rowH - 24 * S, euro(u.cost, 0), () => {
          const r = this.sim.buyUpgrade(u.id);
          if (r.ok) {
            sfx.fanfare();
            this.toast(t('ty.builtToast', { name: td('up', u) }), C.yellow);
            this._rebuildWorld();
            this.game.persist();
          } else {
            sfx.error();
            this.toast(r.reason || t('ty.notYet'), C.red);
          }
        }, { kind: this.s.cash >= u.cost && !needs ? 'red' : 'ink', size: 18 * S, disabled: needs, id: `up-${u.id}`,
          font: 'display' });
      }
      y += rowH + 10 * S;
    });
    if (pages > 1) {
      const by = b.y + b.h - 44 * S;
      gui.button(b.x, by, 110 * S, 40 * S, t('ty.prev'), () => { this.upPage--; }, { disabled: this.upPage === 0, size: 15 * S,
        id: 'up-prev', kind: 'ink' });
      gui.text(`${this.upPage + 1} / ${pages}`, b.x + b.w / 2, by + 27 * S, 16 * S, { align: 'center', font: 'label',
        color: C.paper });
      gui.button(b.x + b.w - 110 * S, by, 110 * S, 40 * S, t('ty.next'), () => { this.upPage++; }, {
        disabled: this.upPage >= pages - 1, size: 15 * S, id: 'up-next', kind: 'ink' });
    }
  }

  _tabPrices(gui, b) {
    const S = gui.S;
    const s = this.s;
    let y = b.y;
    const row = (kind, label, example) => {
      const v = s.prices[kind];
      gui.text(label.toUpperCase(), b.x, y + 26 * S, 22 * S, { font: 'display', color: C.paper });
      gui.text(example(v), b.x, y + 48 * S, 14 * S, { color: C.dim, weight: 600 });
      const bw = 46 * S;
      gui.button(b.x + b.w - bw * 2 - 80 * S, y + 6 * S, bw, 44 * S, '', () => this.sim.setPrice(kind, v - 0.05),
        { icon: 'minus', id: `pr-${kind}-`, kind: 'paper' });
      gui.text(`${Math.round(v * 100)}%`, b.x + b.w - bw - 40 * S, y + 36 * S, 22 * S, { align: 'center', font: 'display',
        color: v > 1.15 ? C.red : C.yellow });
      gui.button(b.x + b.w - bw, y + 6 * S, bw, 44 * S, '', () => this.sim.setPrice(kind, v + 0.05), { icon: 'plus',
        id: `pr-${kind}+`, kind: 'paper' });
      y += 78 * S;
    };
    row('cannabis', t('ty.priceCannabis'), (v) => t('ty.priceEx1', { p: euro(12 * v) }));
    row('food', t('ty.priceFood'), (v) => t('ty.priceEx2', { a: euro(5.5 * v), b: euro(5 * v) }));
    gui.paragraph(t('ty.priceHelp'),
      b.x, y, b.w, 14 * S, { color: C.dim, weight: 600 });
  }

  _drawRun(gui) {
    const S = gui.S;
    const R = this.sim.run;
    const left = gui.safe.left + 12 * S;
    const bottom = gui.h - gui.safe.bottom - 12 * S;
    const w = Math.min(gui.w - 24 * S, 500 * S);
    const p = gui.card(left, bottom - 150 * S, w, 150 * S, { tone: 'ink', label: t('ty.live'), labelColor: C.red, labelText: C.paper });
    const stat = (label, value, x, color = C.paper) => {
      gui.text(label, x, p.y + 12 * S, 13 * S, { font: 'label', color: C.dim });
      gui.text(String(value), x, p.y + 40 * S, 24 * S, { font: 'display', color });
    };
    const cw = p.w / 4;
    stat(t('ty.visitors'), R?.visitors ?? 0, p.x);
    stat(t('ty.served'), R?.served ?? 0, p.x + cw, C.yellow);
    stat(t('ty.missed'), (R?.lost ?? 0) + (R?.soldOut ?? 0), p.x + cw * 2, (R?.lost || R?.soldOut) ? C.red : C.paper);
    stat(t('ty.revenue'), euro((R?.revCannabis ?? 0) + (R?.revFood ?? 0), 0), p.x + cw * 3, C.yellow);
    const by = p.y + 58 * S;
    const bw = (p.w - 24 * S) / 4;
    [1, 2, 4].forEach((sp, i) => {
      gui.button(p.x + i * (bw + 8 * S), by, bw, 48 * S, `${sp}×`, () => { this.speed = sp; }, { selected: this.speed === sp,
        size: 19 * S, id: `sp-${sp}`, kind: 'paper', font: 'display' });
    });
    gui.button(p.x + 3 * (bw + 8 * S), by, bw, 48 * S, t('ty.skip'), () => {
      while (this.s.phase === 'run') this.sim.simulateHour();
      this.crowd.setRate(0);
      this.game.persist();
    }, { size: 18 * S, kind: 'ink', id: 'skip' });
  }

  _drawReport(gui) {
    const S = gui.S;
    const r = this.s.lastReport;
    if (!r) return;
    // Size the receipt to its content; on short screens drop the logo and tighten the lines.
    const nRows = 9 + (r.restock ? 1 : 0) + (r.fines ? 1 : 0);
    const goals = (this.newGoals || []).slice(0, 3);
    const avail = (gui.h - gui.safe.top - gui.safe.bottom - 88 * S) / S;
    const body = (rh) => 20 + nRows * rh + 14 + rh + 32 + goals.length * 30 + 106;
    const compact = 146 + body(21) > avail;
    const head = compact ? 84 : 146;
    const rh = clamp((avail - head - body(0)) / (nRows + 1), 16, 21);
    const h = Math.min(avail, head + body(rh)) * S;
    const w = Math.min(gui.w - 28 * S, 440 * S);
    const x = (gui.w - w) / 2;
    const y = gui.safe.top + 76 * S + Math.max(0, (avail * S - h) / 2);
    receipt(gui, x, y, w, h);
    const ix = x + 22 * S;
    const iw = w - 44 * S;
    if (!compact) gui.image(gui.logo, x + w / 2 - 28 * S, y + 12 * S, 56 * S, 56 * S);
    const hy = y + (compact ? -60 : 0) * S;
    gui.text('KRONKEL', x + w / 2, hy + 90 * S, 22 * S, { font: 'display', color: C.ink, align: 'center' });
    gui.text('VLAAMSEGAS · NIJMEGEN', x + w / 2, hy + 108 * S, 12 * S, { font: RECEIPT, color: C.ink, align: 'center' });
    gui.text(t('rep.title', { d: r.day }), x + w / 2, hy + 130 * S, 16 * S, { font: RECEIPT, weight: 700, color: C.ink,
      align: 'center' });
    let ly = y + head * S;
    dashes(gui, ix, ly, iw);
    ly += 20 * S;
    const size = rh < 19 ? 13.5 : 15;
    const L = (a, b, opts = {}) => {
      rline(gui, ix, ly, iw, a, b, { size, ...opts });
      ly += rh * S;
    };
    L(t('rep.visitors'), `${r.visitors}`);
    L(t('rep.served'), `${r.served}`);
    L(t('rep.lost'), `${r.lost}/${r.soldOut}`, { color: r.lost + r.soldOut ? C.red : C.ink });
    L(t('rep.seated'), `${r.seated}`);
    dashes(gui, ix, ly - 8 * S, iw);
    ly += 6 * S;
    L(t('rep.cannabis'), euro(r.revCannabis));
    L(t('rep.food'), euro(r.revFood));
    L(t('rep.wages'), `-${euro(r.wages)}`);
    L(t('rep.rent'), `-${euro(r.rent)}`);
    L(t('rep.foodCost'), `-${euro(r.foodCost)}`);
    if (r.restock) L(t('rep.deliveries'), `-${euro(r.restock)}`);
    if (r.fines) L(t('rep.fines'), `-${euro(r.fines)}`, { color: C.red });
    dashes(gui, ix, ly - 8 * S, iw);
    ly += 8 * S;
    L(t('rep.profit'), euro(r.profit), { size: 20, bold: true, color: r.profit >= 0 ? C.ink : C.red });
    ly += 8 * S;
    gui.text(t('rep.happy', { p: Math.round(r.satisfaction * 100) }), ix, ly, 15 * S, { font: RECEIPT, weight: 700, color: C.ink,
      max: iw - 190 * S });
    const delta = r.repAfter - r.repBefore;
    gui.text(`${delta >= 0 ? '+' : '-'}${Math.abs(delta).toFixed(2)}`, ix + iw - 140 * S, ly, 13 * S, { font: RECEIPT,
      color: delta >= 0 ? C.ink : C.red, align: 'right' });
    gui.ctx.fillStyle = C.ink;
    gui.rr(ix + iw - 132 * S, ly - 18 * S, 132 * S, 26 * S, 13 * S);
    gui.ctx.fill();
    gui.smileys(ix + iw - 128 * S, ly - 5 * S, 11 * S, r.repAfter);
    ly += 24 * S;
    for (const goal of goals) {
      gui.tape(t('rep.goal', { g: goal }), x + w / 2, ly + 14 * S, { size: 14 * S, color: C.yellow, tilt: -0.02 });
      ly += 30 * S;
    }
    gui.text(t('rep.thanks'), x + w / 2, y + h - 88 * S, 13 * S, { font: RECEIPT, weight: 700, color: C.ink,
      align: 'center' });
    gui.button(ix, y + h - 76 * S, iw, 56 * S, t('rep.next'), () => this.nextDay(), { kind: 'yellow', icon: 'play',
      size: 22 * S, id: 'next' });
  }

  _drawBankrupt(gui) {
    if (this.modal) return;
    this.modal = {
      title: t('bankrupt.title'), color: C.red,
      text: t('bankrupt.text'),
      buttons: [{ label: t('btn.menu'), onClick: () => this.game.setScreen('title') },
        { label: t('bankrupt.again'), kind: 'yellow', onClick: () => {
          this.game.save.tycoon = null;
          this.game.persist();
          this.game.setScreen('tycoon');
        } }],
    };
  }
}
