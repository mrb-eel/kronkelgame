// Tycoon mode: run your own Kronkel. Plan the morning (stock, staff, prices, upgrades), watch the
// day play out hour by hour, read the report, repeat. Pure logic; saved as plain JSON.
import { clamp, euro, rng as makeRng, round2 } from '../util.js';
import { t as tr, td } from '../i18n.js';

export const START_DATE = '2026-06-01'; // a Monday
const HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
const HOUR_CURVE = [0.45, 0.6, 0.85, 0.9, 0.9, 1.0, 1.1, 1.35, 1.45, 1.6, 1.8, 1.9, 1.85, 1.55, 1.05];
const WEEKDAY = [0.85, 0.85, 0.9, 1.0, 1.25, 1.35, 1.05]; // Mon..Sun
const RENT = 380;
const BUY_PRICE = { weed: 5.2, hash: 4.8 };
const DELIVERY_FEE = 80;
const MAX_RESTOCKS = 2;

export function newTycoon(seed = Date.now()) {
  return {
    v: 1,
    seed,
    day: 1,
    cash: 4000,
    rep: 2.4,
    stock: { weed: 180, hash: 80 },
    staff: { cashier: 1, server: 1, cook: 0 },
    upgrades: [],
    prices: { cannabis: 1.0, food: 1.0 },
    policy: { id: 'strict', restock: true },
    phase: 'plan',
    event: null,
    weather: 'cloudy',
    history: [],
    totals: { revenue: 0, visitors: 0, days: 0 },
    goals: {},
    lastReport: null,
    bankrupt: false,
  };
}

export function dateOf(state) {
  const d = new Date(`${START_DATE}T12:00:00`);
  d.setDate(d.getDate() + state.day - 1);
  return d;
}

export function weekday(state) {
  return (state.day - 1) % 7; // 0 = Monday
}

export class TycoonSim {
  constructor(data, layout, state) {
    this.data = data;
    this.L = layout;
    this.s = state;
    this.rng = makeRng(state.seed + state.day * 7919);
    this.events = [];
    this.run = null;
  }

  emit(type, extra = {}) {
    this.events.push({ type, ...extra });
  }

  has(id) {
    return this.s.upgrades.includes(id);
  }

  get upgradeSet() {
    return new Set(this.s.upgrades);
  }

  stockTotal() {
    return this.s.stock.weed + this.s.stock.hash;
  }

  seats() {
    let n = 0;
    for (const t of this.L.tables) {
      if (t.unlock && !this.has(t.unlock)) continue;
      if (t.level === 1 && (this.s.weather === 'rain' || this.s.event?.terraceClosed)) continue;
      n += t.seats.length;
    }
    return n;
  }

  // -------------------------------------------------------------- morning
  /** Pick today's weather and event. Called when a new day starts. */
  prepareDay() {
    const s = this.s;
    const d = dateOf(s);
    const month = d.getMonth();
    const r = this.rng;
    const rainP = month === 6 || month === 7 ? 0.2 : 0.35;
    s.weather = r.chance(rainP) ? 'rain' : r.chance(0.45) ? 'sunny' : 'cloudy';
    s.event = null;
    const events = this.data.events;
    const ev = (id) => ({ ...events.find((e) => e.id === id) });
    // Vierdaagse: third week of July, Tuesday to Friday
    const monday = d.getDate() - ((d.getDay() + 6) % 7);
    const isVierdaagse = month === 6 && monday >= 14 && monday <= 20 && [2, 3, 4, 5].includes(d.getDay());
    if (isVierdaagse) s.event = ev('vierdaagse');
    else if (s.weather === 'rain' && r.chance(0.6)) s.event = ev('rain');
    else if (s.weather === 'sunny' && r.chance(0.4)) s.event = ev('sunny');
    else if ([5, 6].includes(weekday(s)) && r.chance(0.35)) s.event = ev('nec');
    else if (r.chance(0.12)) s.event = ev('inspection');
    else if (r.chance(0.08)) s.event = ev('students');
    else if (r.chance(0.07) && this.has('milkshakeBar')) s.event = ev('fridge');
    else if (r.chance(0.25) && this.has('stage')) s.event = { ...ev('band'), pending: true };
    if (s.event?.cost) {
      s.cash = round2(s.cash - s.event.cost);
    }
    if (s.weather === 'rain' && s.event?.id === 'sunny') s.weather = 'sunny';
    s.phase = 'plan';
  }

  acceptOffer(yes) {
    const e = this.s.event;
    if (!e?.pending) return;
    e.pending = false;
    e.accepted = !!yes;
    if (yes) this.s.cash = round2(this.s.cash - e.offer);
  }

  buyStock(kind, grams) {
    const s = this.s;
    const room = this.data.rules.maxStockGrams - this.stockTotal();
    const g = Math.max(0, Math.min(grams, room));
    const cost = round2(g * BUY_PRICE[kind]);
    if (g <= 0) return { ok: false, reason: tr('ty.stockMax') };
    if (cost > s.cash) return { ok: false, reason: tr('ty.noCash') };
    s.stock[kind] += g;
    s.cash = round2(s.cash - cost);
    return { ok: true, grams: g, cost };
  }

  hire(role, delta) {
    const spec = this.data.staff.find((x) => x.id === role);
    const n = clamp(this.s.staff[role] + delta, role === 'cashier' ? 1 : 0, spec.max);
    this.s.staff[role] = n;
  }

  buyUpgrade(id) {
    const u = this.data.upgrades.find((x) => x.id === id);
    if (!u || this.has(id)) return { ok: false };
    if (u.requires && !this.has(u.requires)) {
      return { ok: false, reason: tr('ty.needs', { name: td('up', this.data.upgrades.find((x) => x.id === u.requires)) }) };
    }
    if (this.s.cash < u.cost) return { ok: false, reason: tr('ty.noCash') };
    this.s.cash = round2(this.s.cash - u.cost);
    this.s.upgrades.push(id);
    return { ok: true };
  }

  setPrice(kind, v) {
    this.s.prices[kind] = clamp(round2(v), 0.7, 1.5);
  }

  wages() {
    return this.data.staff.reduce((sum, st) => sum + st.wage * this.s.staff[st.id], 0);
  }

  // -------------------------------------------------------------- the day
  startDay() {
    const s = this.s;
    s.phase = 'run';
    this.run = {
      hourIdx: 0, frac: 0,
      visitors: 0, buyers: 0, served: 0, lost: 0, soldOut: 0,
      seated: 0, seatTurned: 0, foodOrders: 0, foodMissed: 0,
      revCannabis: 0, revFood: 0, grams: { weed: 0, hash: 0 }, restockCost: 0, restocks: 0,
      fines: 0, satisfactionSum: 0, satisfactionN: 0, log: [], hourly: [],
    };
  }

  trafficMult() {
    const s = this.s;
    let m = WEEKDAY[weekday(s)];
    m *= 0.55 + s.rep * 0.22; // 2.4 stars ~ 1.08, 5 stars ~ 1.65
    for (const id of s.upgrades) m *= 1 + (this.data.upgrades.find((u) => u.id === id)?.traffic || 0);
    if (s.event?.traffic && (!s.event.offer || s.event.accepted)) m *= 1 + s.event.traffic;
    if (s.weather === 'rain') m *= 0.85;
    if (s.weather === 'sunny' && this.has('terrace')) m *= 1.1;
    // price elasticity
    m *= clamp(1.6 - s.prices.cannabis * 0.6, 0.5, 1.3);
    return m;
  }

  /** Simulate one in-game hour. Returns that hour's numbers (also used to drive the 3D crowd). */
  simulateHour() {
    const s = this.s;
    const R = this.run;
    const r = this.rng;
    const h = HOURS[R.hourIdx];
    const base = 3.4 * HOUR_CURVE[R.hourIdx] * this.trafficMult();
    const visitors = Math.max(0, Math.round(base * r.range(0.8, 1.2)));
    const buyers = Math.round(visitors * 0.9);
    const idFactor = s.policy.id === 'strict' ? 0.88 : 1.0;
    const capacity = Math.round(this.data.staff.find((x) => x.id === 'cashier').perHour * s.staff.cashier * idFactor);
    let served = Math.min(buyers, capacity);
    const lost = buyers - served;
    // stock
    let soldOut = 0;
    let soldCount = 0;
    const priceW = this._avgPrice('weed') * s.prices.cannabis;
    const priceH = this._avgPrice('hash') * s.prices.cannabis;
    for (let i = 0; i < served; i++) {
      const kind = r.chance(0.7) ? 'weed' : 'hash';
      const g = r.weighted([[1, 3], [2, 4], [3, 2], [5, 1]]);
      if (s.stock[kind] < g) {
        if (s.policy.restock && this._restock()) {
          /* restocked mid-day */
        }
      }
      if (s.stock[kind] >= g) {
        s.stock[kind] -= g;
        R.grams[kind] += g;
        const extra = r.chance(0.25) ? 6 * s.prices.cannabis : 0; // pre-roll / spacecake
        R.revCannabis += g * (kind === 'weed' ? priceW : priceH) + extra;
        soldCount++;
      } else {
        soldOut++;
      }
    }
    if (soldOut && !R.soldOutWarned) {
      R.soldOutWarned = true;
      this.emit('soldout', { text: tr('ty.soldOut', { h: h % 24 }) });
    }
    served = soldCount;
    // seated guests
    const stay = clamp(0.32 + (this.has('gameShelf') ? 0.08 : 0) + (this.has('lounge') ? 0.04 : 0) +
      (this.has('pool') ? 0.06 : 0) + (this.has('vaporizer') ? 0.04 : 0) + (s.weather === 'sunny' && this.has('terrace') ? 0.08 : 0),
    0, 0.75);
    const wantSeat = Math.round(visitors * stay);
    const seatCap = Math.round(this.seats() * 1.15);
    const seated = Math.min(wantSeat, seatCap);
    const serverCap = this.data.staff.find((x) => x.id === 'server').perHour * s.staff.server;
    const attended = Math.min(seated, serverCap);
    const kitchenOpen = h >= this.data.rules.kitchenOpen && h < this.data.rules.kitchenClose;
    const foodWant = kitchenOpen ? Math.round(attended * 0.5) : 0;
    const cookCap = this.data.staff.find((x) => x.id === 'cook').perHour * s.staff.cook *
      (this.has('proKitchen') ? 1.3 : 1);
    const food = Math.min(foodWant, cookCap);
    const drinks = attended;
    const drinkPrice = (this.has('milkshakeBar') ? 5.2 : 4.4) * s.prices.food;
    R.revFood += drinks * drinkPrice + food * (this.has('proKitchen') ? 7.5 : 5.5) * s.prices.food;
    R.foodOrders += food;
    R.foodMissed += foodWant - food;
    // satisfaction this hour (0..1)
    const serviceOk = buyers ? served / buyers : 1;
    const seatOk = wantSeat ? seated / wantSeat : 1;
    const attendOk = seated ? attended / seated : 1;
    const foodOk = foodWant ? food / foodWant : 1;
    const priceOk = clamp(1.35 - s.prices.cannabis * 0.45 - (s.prices.food - 1) * 0.2, 0.3, 1);
    const sat = clamp(serviceOk * 0.35 + seatOk * 0.15 + attendOk * 0.15 + foodOk * 0.1 + priceOk * 0.25, 0, 1);
    R.satisfactionSum += sat * visitors;
    R.satisfactionN += visitors;
    R.visitors += visitors;
    R.buyers += buyers;
    R.served += served;
    R.lost += lost;
    R.soldOut += soldOut;
    R.seated += seated;
    const hour = { h, visitors, served, seated, lost: lost + soldOut };
    R.hourly.push(hour);
    if (lost > 3 && !R.queueWarned) {
      R.queueWarned = true;
      this.emit('queue', { text: tr('ty.queueOut', { h: h % 24 }) });
    }
    // inspection
    if (s.event?.inspection && R.hourIdx === 6) {
      if (this.stockTotal() > this.data.rules.maxStockGrams) {
        R.fines += 5000;
        this.emit('fine', { text: tr('ty.fineStock', { amt: euro(5000, 0) }) });
      } else if (s.policy.id === 'quick' && r.chance(0.5)) {
        R.fines += 2500;
        s.rep = clamp(s.rep - 0.4, 0, 5);
        this.emit('fine', { text: tr('ty.fineMinor', { amt: euro(2500, 0) }) });
      } else {
        this.emit('ok', { text: tr('ty.inspectionOk') });
      }
    }
    R.hourIdx++;
    if (R.hourIdx >= HOURS.length) this._endDay();
    return hour;
  }

  _avgPrice(kind) {
    const list = this.data[kind].filter((p) => !p.unlock || this.has(p.unlock));
    return list.reduce((sum, p) => sum + p.price, 0) / list.length;
  }

  _restock() {
    const s = this.s;
    const room = this.data.rules.maxStockGrams - this.stockTotal();
    if (room < 60 || this.run.restocks >= MAX_RESTOCKS) return false;
    const w = Math.round(room * 0.7);
    const hh = room - w;
    const cost = w * BUY_PRICE.weed + hh * BUY_PRICE.hash + DELIVERY_FEE;
    if (s.cash < cost) return false;
    s.stock.weed += w;
    s.stock.hash += hh;
    s.cash = round2(s.cash - cost);
    this.run.restockCost += cost;
    this.run.restocks++;
    return true;
  }

  _endDay() {
    const s = this.s;
    const R = this.run;
    const wages = this.wages();
    const foodCost = R.revFood * 0.32;
    const bandCost = 0;
    const revenue = round2(R.revCannabis + R.revFood);
    const costs = round2(RENT + wages + foodCost + R.fines + bandCost);
    s.cash = round2(s.cash + revenue - RENT - wages - foodCost - R.fines);
    const sat = R.satisfactionN ? R.satisfactionSum / R.satisfactionN : 0.5;
    let target = 1 + sat * 3.6;
    for (const id of s.upgrades) target += this.data.upgrades.find((u) => u.id === id)?.rep || 0;
    if (s.event?.accepted && s.event.rep) target += s.event.rep;
    const repBefore = s.rep;
    s.rep = clamp(s.rep + (Math.min(5, target) - s.rep) * 0.25, 0, 5);
    const profit = round2(revenue - costs - R.restockCost);
    const report = {
      day: s.day, date: dateOf(s).toISOString().slice(0, 10), visitors: R.visitors, served: R.served, lost: R.lost,
      soldOut: R.soldOut, seated: R.seated, revCannabis: round2(R.revCannabis), revFood: round2(R.revFood), revenue,
      wages, rent: RENT, foodCost: round2(foodCost), restock: round2(R.restockCost), fines: R.fines, profit,
      satisfaction: round2(sat), repBefore: round2(repBefore), repAfter: round2(s.rep), grams: R.grams, hourly: R.hourly,
      event: s.event?.id || null, weather: s.weather,
    };
    s.lastReport = report;
    s.history.push({ day: s.day, revenue, profit, rep: round2(s.rep), visitors: R.visitors });
    if (s.history.length > 60) s.history.shift();
    s.totals.revenue = round2(s.totals.revenue + revenue);
    s.totals.visitors += R.visitors;
    s.totals.days++;
    this._goals(report);
    if (s.cash < -2000) s.bankrupt = true;
    s.phase = 'report';
    this.run = null;
    this.emit('dayEnd', { report });
  }

  _goals(rep) {
    const g = this.s.goals;
    const hit = (id) => {
      if (!g[id]) {
        g[id] = this.s.day;
        this.emit('goal', { id });
      }
    };
    if (rep.revenue >= 1000) hit('rev1000');
    if (rep.revenue >= 2500) hit('rev2500');
    if (this.s.rep >= 4) hit('rep4');
    if (this.s.rep >= 4.8) hit('rep5');
    if (this.has('terrace')) hit('terrace');
    if (this.s.event?.id === 'vierdaagse' && rep.lost < rep.visitors * 0.15) hit('vierdaagse');
    if (this.data.upgrades.every((u) => this.has(u.id))) hit('full');
  }

  nextDay() {
    this.s.day++;
    this.rng = makeRng(this.s.seed + this.s.day * 7919);
    this.prepareDay();
  }

  hourLabel() {
    if (!this.run) return 10;
    return HOURS[Math.min(this.run.hourIdx, HOURS.length - 1)];
  }
}

export const TYCOON_HOURS = HOURS;
/** Goals in the order the overview lists them; the text comes from the goal.<id> translation. */
export const GOAL_LIST = ['rev1000', 'rep4', 'terrace', 'rev2500', 'vierdaagse', 'rep5', 'full'];

export function goalText(id) {
  return tr(`goal.${id}`, { amt: euro(id === 'rev2500' ? 2500 : 1000, 0) });
}
