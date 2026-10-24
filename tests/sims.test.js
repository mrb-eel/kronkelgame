// Run with: npm test   (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CashierSim, CHANGE_UNITS } from '../src/sim/cashier.js';
import { BarSim, STATIONS } from '../src/sim/bar.js';
import { Nav, pathLength } from '../src/sim/nav.js';
import { euro, ageOn, round2, dateText } from '../src/util.js';
import { setLang, t, td, dictionaries, detectLang } from '../src/i18n.js';

const data = JSON.parse(readFileSync(new URL('../assets/gamedata.json', import.meta.url)));
const layout = JSON.parse(readFileSync(new URL('../assets/layout.json', import.meta.url)));
const ALL = new Set(data.upgrades.map((u) => u.id));

test('euro and dates follow the language', () => {
  setLang('nl');
  assert.equal(euro(12.5), '€12,50');
  assert.equal(euro(1234.5), '€1.234,50');
  assert.equal(euro(-3), '-€3,00');
  assert.equal(dateText(new Date(2026, 6, 4)), '04-07-2026');
  setLang('de');
  assert.equal(euro(1234.5), '€1.234,50');
  assert.equal(dateText(new Date(2026, 6, 4)), '04.07.2026');
  setLang('en');
  assert.equal(euro(1234.5), '€1,234.50');
  assert.equal(euro(5000, 0), '€5,000');
  assert.equal(dateText(new Date(2026, 6, 4)), '04/07/2026');
});

test('every language has every key, the same placeholders and same-length lists', () => {
  const { en } = dictionaries;
  const holes = (s) => (Array.isArray(s) ? s.join(' ') : s).match(/\{\w+\}/g)?.sort().join() || '';
  for (const id of ['nl', 'de']) {
    const d = dictionaries[id];
    assert.deepEqual(Object.keys(d).sort(), Object.keys(en).sort(), `${id} keys differ from en`);
    for (const k of Object.keys(en)) {
      assert.equal(Array.isArray(d[k]), Array.isArray(en[k]), `${id}.${k} type`);
      // lists are picked with the seeded rng, so equal length keeps runs identical across languages
      if (Array.isArray(en[k])) assert.equal(d[k].length, en[k].length, `${id}.${k} length`);
      assert.equal(holes(d[k]), holes(en[k]), `${id}.${k} placeholders`);
    }
  }
  setLang('de');
  assert.equal(t('hud.day', { n: 3 }), 'Tag 3');
  assert.equal(td('up', data.upgrades.find((u) => u.id === 'terrace')), 'Dachterrasse');
  assert.equal(td('item', data.weed[0]), 'Amnesia Haze'); // strain names stay as they are
  setLang('en');
  assert.equal(detectLang(['de-DE', 'en']), 'de');
  assert.equal(detectLang(['fr-FR']), 'en');
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

function autoBar(sim) {
  let guard = 0;
  while (!sim.over && guard++ < 60000) {
    sim.update(0.1);
    const t = sim.activeTicket;
    if (!t || t.done) continue;
    const step = t.steps[t.stepIdx];
    sim.tapStation(step);
    if (sim.activeTicket?.done) sim.serve(sim.activeTicket.id);
  }
  return sim;
}

test('a bar shift serving all orders earns revenue', () => {
  setLang('en');
  const sim = autoBar(new BarSim(data, { seed: 77 }));
  assert.ok(sim.over);
  assert.ok(sim.stats.served > 10, `only ${sim.stats.served} served`);
  assert.equal(sim.stats.mistakes, 0, 'perfect autobar should make no mistakes');
  assert.ok(sim.stats.revenue > 0);
  assert.ok(sim.score() > 0);
  console.log('bar score', sim.score(), 'stars', sim.starsFor(sim.score()), sim.stats);
});

test('tapping the wrong station counts as a mistake', () => {
  const sim = new BarSim(data, { seed: 3 });
  for (let i = 0; i < 20; i++) sim.update(0.5);
  const t = sim.activeTicket;
  assert.ok(t, 'should have a ticket by now');
  const wrong = STATIONS.find((s) => s !== t.steps[0]);
  const res = sim.tapStation(wrong);
  assert.equal(res.ok, false);
  assert.equal(sim.stats.mistakes, 1);
  assert.equal(t.stepIdx, 0, 'progress should not advance on wrong tap');
});

test('shakes are not spawned after hour 24.5', () => {
  const sim = new BarSim(data, { seed: 5, shiftSeconds: 60 });
  sim.hour = 24.6;
  for (let i = 0; i < 100; i++) sim.update(0.1);
  const shakeIds = data.bar.filter((m) => m.noLateOrder).map((m) => m.id);
  for (const t of sim.tickets) {
    assert.ok(!shakeIds.includes(t.item.id), `late shake order: ${t.item.id}`);
  }
});

