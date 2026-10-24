// Run with: npm test   (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CashierSim, CHANGE_UNITS } from '../src/sim/cashier.js';
import { ServerSim } from '../src/sim/server.js';
import { TycoonSim, newTycoon, dateOf } from '../src/sim/tycoon.js';
import { Nav, pathLength } from '../src/sim/nav.js';
import { euro, ageOn, round2 } from '../src/util.js';

const data = JSON.parse(readFileSync(new URL('../assets/gamedata.json', import.meta.url)));
const layout = JSON.parse(readFileSync(new URL('../assets/layout.json', import.meta.url)));
const ALL = new Set(data.upgrades.map((u) => u.id));

test('euro formatting is Dutch', () => {
  assert.equal(euro(12.5), '€12,50');
  assert.equal(euro(1234.5), '€1.234,50');
  assert.equal(euro(-3), '-€3,00');
});

test('age calculation handles birthdays', () => {
  const today = new Date(2026, 9, 23);
  assert.equal(ageOn(new Date(2008, 9, 23), today), 18);
  assert.equal(ageOn(new Date(2008, 9, 24), today), 17);
});

test('nav finds a path from the alley to the counter without crossing obstacles', () => {
  const nav = new Nav(layout, { upgrades: ALL });
  const [sx, sz] = layout.streetEnter;
  const [qx, qz] = layout.queue[0];
  const p = nav.path(0, sx, sz, qx, qz);
  assert.ok(p.length >= 2);
  assert.deepEqual(p[p.length - 1], [qx, qz]);
  assert.ok(pathLength(p) < 40, `path too long: ${pathLength(p)}`);
  for (let i = 1; i < p.length; i++) {
    for (let k = 1; k < 10; k++) {
      const t = k / 10;
      const x = p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t;
      const z = p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t;
      assert.ok(!nav.blocked(0, x, z), `path crosses an obstacle at ${x.toFixed(2)},${z.toFixed(2)}`);
    }
  }
});

test('every table can be reached by the waiter', () => {
  const nav = new Nav(layout, { upgrades: ALL });
  for (const t of layout.tables) {
    const start = t.level === 0 ? layout.pass : layout.stairs.terrace;
    const p = nav.path(t.level, start[0], start[1], t.x, t.z, layout.tableReach);
    const end = p[p.length - 1];
    assert.ok(Math.hypot(end[0] - t.x, end[1] - t.z) <= layout.tableReach + 0.01, `cannot reach ${t.id}`);
  }
});

function autoCashier(sim, { lazyIds = false } = {}) {
  let guard = 0;
  while (!sim.over && guard++ < 20000) {
    sim.update(0.1);
    const c = sim.current;
    if (!c) continue;
    if (c.step === 'id') sim.checkId(lazyIds ? true : sim.isValidId(c));
    else if (c.step === 'order') {
      if (c.overLimit) sim.sayRule('max5');
      if (c.alcohol) sim.sayRule('alcohol');
      sim.clearBag();
      for (const l of sim.wantLines(c)) sim.addItem(l.id, l.qty);
      const r = sim.checkout();
      assert.ok(r.ok, `checkout failed: ${r.reason}`);
    } else if (c.step === 'pay') {
      if (c.pay === 'pin') sim.payPin();
      else {
        let due = round2(c.cashGiven - c.total);
        for (const u of CHANGE_UNITS) {
          while (due >= u - 1e-9) {
            sim.addChange(u);
            due = round2(due - u);
          }
        }
        assert.ok(sim.giveChange().ok);
      }
    }
  }
  return sim;
}

test('a perfect cashier gets through a shift without strikes', () => {
  const sim = autoCashier(new CashierSim(data, layout, { seed: 7, today: new Date(2026, 9, 23) }));
  assert.equal(sim.stats.strikes, 0);
  assert.ok(sim.stats.served > 20, `served only ${sim.stats.served}`);
  assert.ok(sim.score() > 0);
  console.log('cashier perfect score', sim.score(), 'stars', sim.starsFor(sim.score()), sim.stats);
});

test('accepting every ID eventually gets the shop closed', () => {
  let closed = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const sim = autoCashier(new CashierSim(data, layout, { seed, today: new Date(2026, 9, 23) }), { lazyIds: true });
    if (sim.reason === 'closed') closed++;
  }
  assert.ok(closed >= 3, `only ${closed}/6 lazy shifts got closed`);
});

test('the 5 gram rule trims the order to exactly 5 g', () => {
  const sim = new CashierSim(data, layout, { seed: 3 });
  const lines = sim.reduceTo5([{ id: 'amnesia', qty: 4 }, { id: 'maroc', qty: 3 }, { id: 'preroll', qty: 1 }]);
  const grams = lines.filter((l) => sim.products[l.id].unit === 'g').reduce((s, l) => s + l.qty, 0);
  assert.equal(grams, 5);
  assert.ok(lines.some((l) => l.id === 'preroll'));
});

function autoServer(sim) {
  let guard = 0;
  while (!sim.over && guard++ < 40000) {
    sim.update(0.1);
    const w = sim.waiter;
    if (w.queue.length > 2) continue;
    // seat someone if possible
    const g = sim.waiting.find((x) => x.state === 'waiting');
    if (g) {
      const t = sim.tables.find((t) => t.state === 'free' && t.seats.length >= g.size && (t.level === 0 || sim.terraceOpen));
      if (t) {
        sim.selectHost();
        sim.tapTable(t.id);
      }
    }
    if (sim.ready.length && w.carry.length < 4) sim.tapPass();
    for (const t of sim.tables) {
      const grp = t.group && sim.groups.find((x) => x.id === t.group);
      if (t.state === 'dirty' || (grp && ['ready', 'wantsBill'].includes(grp.state)) ||
        (grp && grp.state === 'waitFood' && w.carry.some((c) => c.table === t.id)) || (grp && grp.wantsGame && !grp.hadGame)) {
        sim.tapTable(t.id);
      }
    }
  }
  return sim;
}

test('an attentive waiter serves groups and earns money', () => {
  const sim = autoServer(new ServerSim(data, layout, { seed: 11 }));
  assert.ok(sim.over);
  assert.ok(sim.stats.groupsServed > 8, `served ${sim.stats.groupsServed}`);
  assert.ok(sim.stats.revenue > 100);
  console.log('server score', sim.score(), 'stars', sim.starsFor(sim.score()), sim.stats);
});

test('tycoon runs 60 days without NaN and keeps stock under the legal cap', () => {
  const state = newTycoon(42);
  const sim = new TycoonSim(data, layout, state);
  sim.prepareDay();
  let sawVierdaagse = false;
  for (let d = 0; d < 60; d++) {
    if (state.event?.pending) sim.acceptOffer(true);
    for (const kind of ['weed', 'hash']) sim.buyStock(kind, kind === 'weed' ? 300 : 150);
    if (state.cash > 2500 && state.staff.cashier < 2) sim.hire('cashier', 1);
    if (state.cash > 2500 && state.staff.cook < 1) sim.hire('cook', 1);
    for (const u of data.upgrades) if (state.cash > u.cost + 1500) sim.buyUpgrade(u.id);
    sim.startDay();
    while (state.phase === 'run') {
      sim.simulateHour();
      assert.ok(sim.stockTotal() <= data.rules.maxStockGrams);
    }
    const r = state.lastReport;
    for (const v of [r.revenue, r.profit, state.cash, state.rep]) assert.ok(Number.isFinite(v));
    assert.ok(state.rep >= 0 && state.rep <= 5);
    if (r.event === 'De Vierdaagse!') sawVierdaagse = true;
    sim.nextDay();
  }
  assert.ok(sawVierdaagse, 'the Vierdaagse should happen in July');
  console.log('tycoon after 60 days', { cash: state.cash, rep: state.rep, upgrades: state.upgrades.length,
    best: Math.max(...state.history.map((h) => h.revenue)) });
});

test('Vierdaagse 2026 falls on 21-24 July', () => {
  const state = newTycoon(1);
  const sim = new TycoonSim(data, layout, state);
  const days = [];
  for (let d = 1; d <= 70; d++) {
    state.day = d;
    sim.prepareDay();
    if (state.event?.id === 'vierdaagse') days.push(dateOf(state).toISOString().slice(0, 10));
  }
  assert.deepEqual(days, ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24']);
});
