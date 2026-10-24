// Bar mode: build drinks to order. Multiple concurrent tickets, recipe steps in sequence.
import { clamp, randomLook, rng as makeRng, round2 } from '../util.js';

export const STATIONS = ['glass', 'cup', 'fridge', 'coffee', 'blend', 'syrup', 'cream'];

export class BarSim {
  constructor(data, { seed = Date.now(), shiftSeconds = 300 } = {}) {
    this.data = data;
    this.rng = makeRng(seed);
    this.hour = 12;
    this.closeHour = 25;
    this.rate = (this.closeHour - 12) / shiftSeconds;
    this.menu = data.bar;
    this.tickets = [];
    this.uid = 0;
    this.time = 0;
    this.spawnIn = 2.5;
    this.activeId = null;
    this.stats = { served: 0, perfect: 0, mistakes: 0, walkouts: 0, revenue: 0, tips: 0 };
    this.events = [];
    this.over = false;
    this.lastCall = false;
    this.MAX = 3;
  }

  get progress() {
    return clamp((this.hour - 12) / (this.closeHour - 12), 0, 1);
  }

  get activeTicket() {
    return this.tickets.find((t) => t.id === this.activeId) || this.tickets[0] || null;
  }

  update(dt) {
    if (this.over) return [];
    this.time += dt;
    this.hour += this.rate * dt;
    const evs = this.events;
    this.events = [];

    this.spawnIn -= dt;
    if (this.spawnIn <= 0 && this.tickets.length < this.MAX && this.hour < this.closeHour - 0.12) {
      this._spawn();
    }

    for (const t of this.tickets) {
      if (!t.done) t.patience -= dt;
      if (t.patience <= 0 && !t.gone) {
        t.gone = true;
        this.stats.walkouts++;
        evs.push({ type: 'walkout', id: t.id });
      }
    }
    this.tickets = this.tickets.filter((t) => !t.gone || t.patience > -1.5);

    if (!this.activeId || !this.tickets.find((t) => t.id === this.activeId)) {
      this.activeId = this.tickets[0]?.id ?? null;
    }

    if (!this.lastCall && this.hour >= this.closeHour - 0.25) {
      this.lastCall = true;
      evs.push({ type: 'lastCall' });
    }

    if (this.hour >= this.closeHour && this.tickets.length === 0) {
      this.over = true;
      evs.push({ type: 'close' });
    }

    return evs;
  }

  _spawn() {
    const r = this.rng;
    const available = this.hour >= 24.5
      ? this.menu.filter((m) => !m.noLateOrder)
      : this.menu;
    if (!available.length) return;
    const item = r.pick(available);
    const id = this.uid++;
    const look = randomLook(r);
    const names = this.data.names?.first || ['Gast'];
    const name = r.pick(names);
    const steps = [...item.recipe];
    this.tickets.push({ id, item, steps, stepIdx: 0, done: false,
      mistakes: 0, patience: item.patience, maxPatience: item.patience, look, name });
    if (!this.activeId) this.activeId = id;
    const base = 10 + 14 * (1 - this.progress);
    this.spawnIn = r.range(base * 0.6, base * 1.4);
    this.events.push({ type: 'order', id });
  }

  selectTicket(id) {
    if (this.tickets.find((t) => t.id === id)) this.activeId = id;
  }

  tapStation(station) {
    const t = this.activeTicket;
    if (!t || t.done || t.gone) return { ok: false, reason: 'no_active' };
    const expected = t.steps[t.stepIdx];
    if (station === expected) {
      t.stepIdx++;
      if (t.stepIdx >= t.steps.length) {
        t.done = true;
        this.events.push({ type: 'ready', id: t.id });
      }
      return { ok: true };
    }
    t.mistakes++;
    this.stats.mistakes++;
    this.events.push({ type: 'mistake', id: t.id, got: station, expected });
    return { ok: false, reason: 'wrong', expected, got: station };
  }

  serve(id) {
    const idx = this.tickets.findIndex((t) => t.id === id);
    if (idx < 0) return null;
    const t = this.tickets[idx];
    if (!t.done) return null;
    const perfect = t.mistakes === 0;
    const speedRatio = clamp(t.patience / t.maxPatience, 0, 1);
    const tip = perfect && speedRatio > 0.4 ? round2(t.item.price * 0.18) : 0;
    this.stats.served++;
    if (perfect) this.stats.perfect++;
    this.stats.revenue += t.item.price;
    this.stats.tips += tip;
    this.tickets.splice(idx, 1);
    if (this.activeId === id) this.activeId = this.tickets[0]?.id ?? null;
    this.events.push({ type: 'served', id, tip, perfect });
    if (this.tickets.length < 2 && this.spawnIn > 5) this.spawnIn = Math.min(this.spawnIn, 4);
    return { tip, perfect };
  }

  score() {
    const { served, perfect, mistakes, walkouts, revenue, tips } = this.stats;
    if (served === 0) return 0;
    const base = revenue + tips;
    const perfBonus = (perfect / served) * base * 0.35;
    const mis = mistakes * 9;
    const wlk = walkouts * 22;
    return Math.max(0, Math.round(base + perfBonus - mis - wlk));
  }

  starsFor(score) {
    if (score >= 280) return 5;
    if (score >= 180) return 4;
    if (score >= 100) return 3;
    if (score >= 50) return 2;
    if (score >= 15) return 1;
    return 0;
  }

  results() {
    const s = this.stats;
    return {
      served: s.served,
      perfect: s.perfect,
      mistakes: s.mistakes,
      walkouts: s.walkouts,
      revenue: round2(s.revenue),
      tips: round2(s.tips),
    };
  }
}
