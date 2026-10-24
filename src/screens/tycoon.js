import { C, SERIF } from '../gui.js';
import { BaseScreen, topBar, panel } from './common.js';
import { TycoonSim, newTycoon, dateOf, weekday, DAY_NAMES, GOAL_LIST, TYCOON_HOURS } from '../sim/tycoon.js';
import { Crowd } from '../sim/crowd.js';
import { Nav } from '../sim/nav.js';
import { clamp, clockText, euro, rng } from '../util.js';
import { sfx } from '../audio.js';

const TABS = [['overview', 'Vandaag'], ['stock', 'Voorraad'], ['staff', 'Personeel'], ['upgrades', 'Upgrades'],
  ['prices', 'Prijzen']];
const SEC_PER_HOUR = 6;
const WEATHER = { sunny: 'Zonnig', cloudy: 'Bewolkt', rain: 'Regen' };
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

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
    const i = TABS.findIndex((t) => t[0] === this.tab);
    this.tab = TABS[(i + d + TABS.length) % TABS.length][0];
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
        this.toast(e.text, C.gold);
        break;
      case 'fine':
        sfx.sad();
        this.game.input.rumble(0.8, 0.5, 300);
        this.toast(e.text, C.red);
        break;
      case 'ok':
        this.toast(e.text, C.accent);
        break;
      case 'goal':
        sfx.fanfare();
        (this.newGoals ||= []).push(e.text.replace(/^Goal: /, ''));
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
    const dateStr = `${DAY_NAMES[weekday(s)].slice(0, 2)} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
    const run = s.phase === 'run';
    topBar(gui, [
      { label: `DAG ${s.day}`, value: dateStr, w: 108 },
      { label: 'TIJD', value: run ? clockText(TYCOON_HOURS[Math.min(this.sim.run.hourIdx, 14)] + this.hourT / SEC_PER_HOUR) :
        s.phase === 'plan' ? '09:30' : '01:00' },
      { label: 'KAS', value: euro(s.cash, 0), color: s.cash < 0 ? C.red : C.accent, w: 104 },
      { label: 'REPUTATIE', w: 120, draw: (x, y, w) => {
        gui.text('REPUTATIE', x + w / 2, y + 15 * S, 10 * S, { align: 'center', color: C.dim, weight: 700 });
        gui.stars(x + 12 * S, y + 30 * S, 7 * S, s.rep);
      } },
      { label: 'VOORRAAD', value: `${Math.round(this.sim.stockTotal())} g`, w: 92,
        color: this.sim.stockTotal() < 80 ? C.red : C.text },
    ], { right: { w: 52 * S, label: '', icon: 'pause', onClick: () => this.onPause() } });
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
    const top = gui.safe.top + 64 * S;
    const bottom = gui.h - gui.safe.bottom - 10 * S;
    const left = gui.safe.left + 10 * S;
    const w = portrait ? gui.w - left * 2 : Math.min(560 * S, gui.w * 0.52);
    const h = portrait ? (bottom - top) * 0.62 : bottom - top - 70 * S;
    const y = portrait ? bottom - h - 66 * S : top;
    const p = panel(gui, left, y, w, h);
    const tw = (p.w - 6 * S * (TABS.length - 1)) / TABS.length;
    TABS.forEach(([id, label], i) => {
      gui.button(p.x + i * (tw + 6 * S), p.y, tw, 38 * S, label, () => { this.tab = id; }, { selected: this.tab === id,
        size: 13 * S, id: `tt-${id}` });
    });
    const body = { x: p.x, y: p.y + 50 * S, w: p.w, h: p.h - 50 * S };
    ({ overview: this._tabOverview, stock: this._tabStock, staff: this._tabStaff, upgrades: this._tabUpgrades,
      prices: this._tabPrices })[this.tab].call(this, gui, body);
    const bw = portrait ? gui.w - left * 2 : Math.min(320 * S, gui.w * 0.3);
    gui.button(portrait ? left : gui.w - gui.safe.right - 10 * S - bw, bottom - 58 * S, bw, 58 * S, 'Open de winkel', () => this.openShop(),
      { kind: 'primary', icon: 'play', size: 19 * S, sub: `wages ${euro(this.sim.wages(), 0)} · rent €380`, id: 'open' });
  }

  _tabOverview(gui, b) {
    const S = gui.S;
    const s = this.s;
    let y = b.y;
    gui.text(`${DAY_NAMES[weekday(s)]} ${dateOf(s).getDate()} ${MONTHS[dateOf(s).getMonth()]} · ${WEATHER[s.weather]}`, b.x, y + 16 * S,
      16 * S, { weight: 800 });
    y += 30 * S;
    if (s.event) {
      const e = s.event;
      const lines = gui.wrap(e.text, b.w - 24 * S, 14 * S, 500);
      const eh = 40 * S + lines.length * 20 * S + (e.pending ? 52 * S : 0);
      gui.box(b.x, y, b.w, eh, { r: 14, fill: 'rgba(255,207,90,0.12)', stroke: C.gold + '66' });
      gui.text(e.title, b.x + 12 * S, y + 26 * S, 16 * S, { color: C.gold, weight: 800 });
      lines.forEach((l, i) => gui.text(l, b.x + 12 * S, y + 48 * S + i * 20 * S, 14 * S, { weight: 500 }));
      if (e.pending) {
        const bw = (b.w - 34 * S) / 2;
        gui.button(b.x + 12 * S, y + eh - 48 * S, bw, 38 * S, `Yes (${euro(e.offer, 0)})`, () => { this.sim.acceptOffer(true);
          this._rebuildWorld(); }, { kind: 'primary', size: 14 * S, id: 'ev-yes' });
        gui.button(b.x + 22 * S + bw, y + eh - 48 * S, bw, 38 * S, 'No thanks', () => this.sim.acceptOffer(false),
          { size: 14 * S, id: 'ev-no' });
      }
      y += eh + 10 * S;
    } else {
      gui.text('A normal day in Nijmegen.', b.x, y + 14 * S, 14 * S, { color: C.dim });
      y += 30 * S;
    }
    const r = s.lastReport;
    if (r) {
      gui.text(`Yesterday: ${r.visitors} visitors · profit ${euro(r.profit, 0)}`, b.x, y + 14 * S, 14 * S,
        { color: r.profit >= 0 ? C.accent : C.red, weight: 700 });
      y += 28 * S;
    }
    gui.text('Goals', b.x, y + 16 * S, 14 * S, { color: C.gold, weight: 800 });
    y += 24 * S;
    for (const [id, label] of GOAL_LIST) {
      if (y > b.y + b.h - 18 * S) break;
      const done = !!s.goals[id];
      gui.text(`${done ? '✓' : '○'}  ${label}`, b.x + 4 * S, y + 14 * S, 14 * S, { color: done ? C.accent : C.text,
        weight: done ? 800 : 500 });
      y += 22 * S;
    }
  }

  _tabStock(gui, b) {
    const S = gui.S;
    const s = this.s;
    const max = this.data.rules.maxStockGrams;
    let y = b.y;
    gui.paragraph(`Dutch law: a coffeeshop may never hold more than ${max} gram. Buy in the morning, and let auto-restock call a delivery when you run low (max 2 a day, €80 each).`,
      b.x, y - 6 * S, b.w, 13 * S, { color: C.dim });
    y += 62 * S;
    const total = this.sim.stockTotal();
    gui.bar(b.x, y, b.w, 14 * S, total / max, total > max * 0.9 ? C.gold : C.accent);
    gui.text(`${Math.round(total)} / ${max} g`, b.x + b.w, y - 6 * S, 12 * S, { align: 'right', color: C.dim, weight: 800 });
    y += 30 * S;
    for (const [kind, label, price] of [['weed', 'Wiet', 5.2], ['hash', 'Hasj', 4.8]]) {
      gui.text(`${label}: ${Math.round(s.stock[kind])} g`, b.x, y + 24 * S, 17 * S, { weight: 800 });
      gui.text(`inkoop ${euro(price)} / g`, b.x, y + 44 * S, 12 * S, { color: C.dim });
      const bw = 92 * S;
      [50, 100].forEach((g, i) => {
        gui.button(b.x + b.w - (2 - i) * (bw + 8 * S) + 8 * S, y + 6 * S, bw, 44 * S, `+${g} g`, () => {
          const r = this.sim.buyStock(kind, g);
          if (!r.ok) {
            sfx.error();
            this.toast(r.reason, C.gold);
          } else sfx.coin();
        }, { size: 14 * S, sub: euro(g * price, 0), id: `buy-${kind}-${g}` });
      });
      y += 66 * S;
    }
    gui.button(b.x, y + 4 * S, b.w, 44 * S, `Auto-restock: ${s.policy.restock ? 'ON' : 'OFF'}`, () => {
      s.policy.restock = !s.policy.restock;
    }, { selected: s.policy.restock, size: 14 * S, id: 'restock' });
  }

  _tabStaff(gui, b) {
    const S = gui.S;
    const s = this.s;
    let y = b.y;
    for (const st of this.data.staff) {
      const n = s.staff[st.id];
      gui.text(`${st.name} × ${n}`, b.x, y + 20 * S, 17 * S, { weight: 800 });
      gui.text(`${euro(st.wage, 0)} per day each`, b.x, y + 40 * S, 12 * S, { color: C.dim });
      const bw = 44 * S;
      gui.button(b.x + b.w - bw * 2 - 8 * S, y + 6 * S, bw, 40 * S, '', () => { this.sim.hire(st.id, -1); this._rebuildWorld(); },
        { icon: 'minus', id: `st-${st.id}-` });
      gui.button(b.x + b.w - bw, y + 6 * S, bw, 40 * S, '', () => { this.sim.hire(st.id, 1); this._rebuildWorld(); },
        { icon: 'plus', id: `st-${st.id}+` });
      y += 52 * S;
      y += gui.paragraph(st.desc, b.x, y - 10 * S, b.w - 8 * S, 12 * S, { color: C.dim }) + 2 * S;
    }
    y += 4 * S;
    const strict = s.policy.id === 'strict';
    gui.button(b.x, y, b.w, 48 * S, strict ? 'ID check: strict' : 'ID check: quick', () => {
      s.policy.id = strict ? 'quick' : 'strict';
    }, { size: 14 * S, sub: strict ? 'slower, safe during inspections' : 'faster, but risky if Handhaving visits',
      color: strict ? '#2b5a3c' : '#6a3a1a', id: 'idpolicy' });
  }

  _tabUpgrades(gui, b) {
    const S = gui.S;
    const ups = this.data.upgrades;
    const rowH = 64 * S;
    const per = Math.max(1, Math.floor((b.h - 50 * S) / (rowH + 6 * S)));
    const pages = Math.ceil(ups.length / per);
    this.upPage = clamp(this.upPage, 0, pages - 1);
    let y = b.y;
    for (const u of ups.slice(this.upPage * per, this.upPage * per + per)) {
      const owned = this.sim.has(u.id);
      const needs = u.requires && !this.sim.has(u.requires);
      gui.box(b.x, y, b.w, rowH, { r: 12, fill: owned ? 'rgba(159,224,122,0.10)' : 'rgba(255,255,255,0.04)', stroke: C.line });
      gui.text(u.name, b.x + 12 * S, y + 22 * S, 15 * S, { weight: 800, color: owned ? C.accent : C.text, max: b.w - 140 * S });
      gui.text(u.desc, b.x + 12 * S, y + 42 * S, 12 * S, { color: C.dim, max: b.w - 140 * S, weight: 500 });
      if (owned) gui.text('✓ owned', b.x + b.w - 14 * S, y + rowH / 2 + 5 * S, 14 * S, { align: 'right', color: C.accent, weight: 800 });
      else {
        gui.button(b.x + b.w - 116 * S, y + 10 * S, 104 * S, rowH - 20 * S, euro(u.cost, 0), () => {
          const r = this.sim.buyUpgrade(u.id);
          if (r.ok) {
            sfx.fanfare();
            this.toast(`${u.name} built!`, C.accent);
            this._rebuildWorld();
            this.game.persist();
          } else {
            sfx.error();
            this.toast(r.reason || 'Cannot buy that yet.', C.gold);
          }
        }, { kind: this.s.cash >= u.cost && !needs ? 'gold' : 'normal', size: 14 * S, disabled: needs, id: `up-${u.id}` });
      }
      y += rowH + 6 * S;
    }
    if (pages > 1) {
      const by = b.y + b.h - 42 * S;
      gui.button(b.x, by, 100 * S, 38 * S, 'Vorige', () => { this.upPage--; }, { disabled: this.upPage === 0, size: 13 * S,
        id: 'up-prev' });
      gui.text(`${this.upPage + 1} / ${pages}`, b.x + b.w / 2, by + 25 * S, 13 * S, { align: 'center', color: C.dim });
      gui.button(b.x + b.w - 100 * S, by, 100 * S, 38 * S, 'Volgende', () => { this.upPage++; }, {
        disabled: this.upPage >= pages - 1, size: 13 * S, id: 'up-next' });
    }
  }

  _tabPrices(gui, b) {
    const S = gui.S;
    const s = this.s;
    let y = b.y;
    const row = (kind, label, example) => {
      const v = s.prices[kind];
      gui.text(label, b.x, y + 22 * S, 17 * S, { weight: 800 });
      gui.text(example(v), b.x, y + 44 * S, 12 * S, { color: C.dim });
      const bw = 44 * S;
      gui.button(b.x + b.w - bw * 2 - 70 * S, y + 6 * S, bw, 40 * S, '', () => this.sim.setPrice(kind, v - 0.05),
        { icon: 'minus', id: `pr-${kind}-` });
      gui.text(`${Math.round(v * 100)}%`, b.x + b.w - bw - 35 * S, y + 32 * S, 16 * S, { align: 'center', weight: 900,
        color: v > 1.15 ? C.gold : v < 0.95 ? C.blue : C.accent });
      gui.button(b.x + b.w - bw, y + 6 * S, bw, 40 * S, '', () => this.sim.setPrice(kind, v + 0.05), { icon: 'plus',
        id: `pr-${kind}+` });
      y += 70 * S;
    };
    row('cannabis', 'Wiet & hasj', (v) => `Amnesia Haze ${euro(12 * v)} / gram`);
    row('food', 'Keuken & bar', (v) => `Milkshake ${euro(5.5 * v)} · Tosti ${euro(5 * v)}`);
    gui.paragraph('Higher prices earn more per sale but fewer people come in and they are less happy. Cheap prices fill the shop but stretch your staff.',
      b.x, y, b.w, 13 * S, { color: C.dim });
  }

  _drawRun(gui) {
    const S = gui.S;
    const R = this.sim.run;
    const left = gui.safe.left + 10 * S;
    const bottom = gui.h - gui.safe.bottom - 10 * S;
    const w = Math.min(gui.w - 20 * S, 470 * S);
    const p = panel(gui, left, bottom - 128 * S, w, 128 * S);
    const stat = (label, value, x, color = C.text) => {
      gui.text(label, x, p.y + 12 * S, 11 * S, { color: C.dim, weight: 800 });
      gui.text(String(value), x, p.y + 38 * S, 20 * S, { weight: 900, color });
    };
    const cw = p.w / 4;
    stat('BEZOEKERS', R?.visitors ?? 0, p.x);
    stat('GEHOLPEN', R?.served ?? 0, p.x + cw, C.accent);
    stat('GEMIST', (R?.lost ?? 0) + (R?.soldOut ?? 0), p.x + cw * 2, (R?.lost || R?.soldOut) ? C.red : C.dim);
    stat('OMZET', euro((R?.revCannabis ?? 0) + (R?.revFood ?? 0), 0), p.x + cw * 3, C.gold);
    const by = p.y + 52 * S;
    const bw = (p.w - 18 * S) / 4;
    [1, 2, 4].forEach((sp, i) => {
      gui.button(p.x + i * (bw + 6 * S), by, bw, 44 * S, `${sp}×`, () => { this.speed = sp; }, { selected: this.speed === sp,
        size: 15 * S, id: `sp-${sp}` });
    });
    gui.button(p.x + 3 * (bw + 6 * S), by, bw, 44 * S, 'Skip', () => {
      while (this.s.phase === 'run') this.sim.simulateHour();
      this.crowd.setRate(0);
      this.game.persist();
    }, { size: 15 * S, kind: 'ghost', id: 'skip' });
  }

  _drawReport(gui) {
    const S = gui.S;
    const r = this.s.lastReport;
    if (!r) return;
    const w = Math.min(gui.w - 24 * S, 480 * S);
    const h = Math.min(gui.h - gui.safe.top - 80 * S, 560 * S);
    const x = (gui.w - w) / 2;
    const y = gui.safe.top + 64 * S + Math.max(0, (gui.h - gui.safe.top - 80 * S - h) / 2);
    const p = panel(gui, x, y, w, h);
    gui.text(`Dag ${r.day} afgesloten`, p.x, p.y + 24 * S, 24 * S, { family: SERIF, color: C.gold, weight: 700 });
    if (r.event) gui.text(r.event, p.x + p.w, p.y + 22 * S, 13 * S, { align: 'right', color: C.dim, max: p.w * 0.45 });
    let ly = p.y + 54 * S;
    const line = (label, value, color = C.text, bold = false) => {
      gui.text(label, p.x, ly, 14 * S, { color: bold ? C.text : C.dim, weight: bold ? 800 : 600 });
      gui.text(value, p.x + p.w, ly, 14 * S, { align: 'right', color, weight: bold ? 900 : 700 });
      ly += 23 * S;
    };
    line('Visitors', `${r.visitors}`);
    line('Helped at the counter', `${r.served}`, C.accent);
    line('Gave up (queue / sold out)', `${r.lost} / ${r.soldOut}`, r.lost + r.soldOut ? C.red : C.dim);
    line('Sat down', `${r.seated}`);
    ly += 6 * S;
    line('Wiet & hasj', euro(r.revCannabis, 0), C.accent);
    line('Bar & keuken', euro(r.revFood, 0), C.accent);
    line('Wages', `-${euro(r.wages, 0)}`, C.red);
    line('Rent', `-${euro(r.rent, 0)}`, C.red);
    line('Food & drinks cost', `-${euro(r.foodCost, 0)}`, C.red);
    if (r.restock) line('Deliveries', `-${euro(r.restock, 0)}`, C.red);
    if (r.fines) line('Fines', `-${euro(r.fines, 0)}`, C.red);
    ly += 4 * S;
    line('Profit', euro(r.profit, 0), r.profit >= 0 ? C.gold : C.red, true);
    ly += 6 * S;
    gui.text(`Happiness ${Math.round(r.satisfaction * 100)}%`, p.x, ly, 14 * S, { weight: 700 });
    gui.stars(p.x + p.w - 7 * S * 2.3 * 5 - 6 * S, ly - 5 * S, 7 * S, r.repAfter);
    ly += 8 * S;
    const delta = r.repAfter - r.repBefore;
    gui.text(`${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(2)} stars`, p.x + p.w, ly + 14 * S, 12 * S,
      { align: 'right', color: delta >= 0 ? C.accent : C.red, weight: 800 });
    ly += 30 * S;
    for (const goal of this.newGoals || []) {
      if (ly > y + h - 90 * S) break;
      gui.text(`★ Goal reached: ${goal}`, p.x, ly, 14 * S, { color: C.gold, weight: 800, max: p.w });
      ly += 22 * S;
    }
    gui.button(p.x, y + h - 70 * S, p.w, 54 * S, 'Volgende dag', () => this.nextDay(), { kind: 'primary', icon: 'play',
      size: 18 * S, id: 'next' });
  }

  _drawBankrupt(gui) {
    if (this.modal) return;
    this.modal = {
      title: 'Failliet!', color: C.red,
      text: 'The bank pulled the plug: your Kronkel ran out of money. Every coffeeshop legend has a rough start. Try again?',
      buttons: [{ label: 'Menu', onClick: () => this.game.setScreen('title') },
        { label: 'Start over', kind: 'primary', onClick: () => {
          this.game.save.tycoon = null;
          this.game.persist();
          this.game.setScreen('tycoon');
        } }],
    };
  }
}
