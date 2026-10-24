// Kassa mode: you're behind the counter. Check IDs, enforce the 5 gram rule, ring up orders,
// take PIN or count out change. Pure logic: the screen renders it, tests drive it directly.
import { ageOn, clamp, euro, randomLook, rng as makeRng, round2, HAIR_STYLES } from '../util.js';
import { Nav, stepAlong } from './nav.js';
import { t as tr, tl, td } from '../i18n.js';

export const NOTES = [100, 50, 20, 10, 5];
export const CHANGE_UNITS = [50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1];

export class CashierSim {
  constructor(data, layout, { seed = Date.now(), today = new Date(), shiftSeconds = 240, upgrades = null } = {}) {
    this.data = data;
    this.L = layout;
    this.rules = data.rules;
    this.rng = makeRng(seed);
    this.today = today;
    this.hour = this.rules.openHour;
    this.closeHour = this.rules.closeHour;
    this.rate = (this.closeHour - this.rules.openHour) / shiftSeconds;
    this.upgrades = upgrades;
    this.nav = new Nav(layout, { upgrades: upgrades || new Set(data.upgrades.map((u) => u.id)) });
    this.products = this._products();
    this.customers = [];
    this.current = null;
    this.uid = 0;
    this.time = 0;
    this.spawnIn = 2;
    this.stats = { revenue: 0, tips: 0, served: 0, refusedOk: 0, wrongRefusals: 0, strikes: 0, walkouts: 0,
      mistakes: 0, changeLost: 0, ruleCalls: 0 };
    this.events = [];
    this.over = false;
    this.reason = null;
  }

  _products() {
    const has = (u) => !u || !this.upgrades || this.upgrades.has(u);
    const all = {};
    const add = (p, cat, unit) => { all[p.id] = { ...p, name: td('item', p), cat, unit }; };
    for (const p of this.data.weed.filter((p) => has(p.unlock))) add(p, 'weed', 'g');
    for (const p of this.data.hash.filter((p) => has(p.unlock))) add(p, 'hash', 'g');
    for (const p of this.data.extras) add(p, 'extra', 'st');
    return all;
  }

  get progress() {
    return clamp((this.hour - this.rules.openHour) / (this.closeHour - this.rules.openHour), 0, 1);
  }

  get queue() {
    return this.customers.filter((c) => c.phase === 'enter' || c.phase === 'queue' || c.phase === 'counter')
      .sort((a, b) => a.order - b.order);
  }

  emit(type, extra = {}) {
    this.events.push({ type, ...extra });
  }

  // -------------------------------------------------------------- customers
  _birthForAge(age, sameDayOffset = null) {
    const t = this.today;
    if (sameDayOffset === 0) return new Date(t.getFullYear() - age, t.getMonth(), t.getDate());
    const d = new Date(t.getFullYear() - age, t.getMonth(), t.getDate());
    // move back 1..360 days so they're safely `age` years old (not a birthday edge case)
    d.setDate(d.getDate() - this.rng.int(1, 360));
    return d;
  }

  _makeCustomer() {
    const r = this.rng;
    const diff = this.progress;
    const look = randomLook(r);
    const kind = r.weighted([['ok', 1], ['minor', 0.05 + 0.1 * diff], ['expired', 0.03 + 0.07 * diff],
      ['fake', 0.02 + 0.07 * diff], ['birthday', 0.025]]);
    let birth;
    if (kind === 'minor') {
      const age = r.chance(0.6) ? 17 : 16;
      birth = new Date(this.today.getFullYear() - age, this.today.getMonth(), this.today.getDate());
      birth.setDate(birth.getDate() - r.int(1, 300));
      if (ageOn(birth, this.today) >= 18) birth.setFullYear(birth.getFullYear() + 1);
    } else if (kind === 'birthday') {
      birth = this._birthForAge(18, 0);
    } else {
      birth = this._birthForAge(r.weighted([[r.int(18, 22), 3], [r.int(23, 35), 4], [r.int(36, 70), 2]]));
    }
    const expiry = new Date(this.today);
    if (kind === 'expired') expiry.setDate(expiry.getDate() - r.int(3, 500));
    else expiry.setDate(expiry.getDate() + r.int(60, 3000));
    let idLook = look;
    if (kind === 'fake') {
      idLook = { ...look };
      idLook.style = r.pick(HAIR_STYLES.filter((s) => s !== look.style && s !== 'none'));
      const hairs = ['#151010', '#d9b46a', '#b03a2e', '#e8d5a0', '#6b3a1e'].filter((h) => h !== look.hair);
      idLook.hair = r.pick(hairs);
      idLook.glasses = !look.glasses;
      idLook.skin = r.pick(['#f3d2b8', '#c68a5e', '#8a5a3c'].filter((s) => s !== look.skin));
    }
    const nat = r.weighted([['NLD', 6], ['DEU', 2.2], ['BEL', 1], ['FRA', 0.4], ['GBR', 0.5], ['ESP', 0.3]]);
    const first = r.pick(this.data.names.first);
    const last = r.pick(this.data.names.last);
    // Order
    const lines = [];
    const gramProducts = Object.values(this.products).filter((p) => p.unit === 'g');
    const nGram = r.weighted([[1, 6], [2, 3]]);
    for (let i = 0; i < nGram; i++) {
      let p = r.pick(gramProducts);
      if (lines.some((l) => l.id === p.id)) p = r.pick(gramProducts);
      if (lines.some((l) => l.id === p.id)) continue;
      lines.push({ id: p.id, qty: r.weighted([[1, 3], [2, 4], [3, 2]]) });
    }
    if (r.chance(0.3)) lines.push({ id: 'preroll', qty: r.weighted([[1, 3], [2, 1]]) });
    if (r.chance(0.15)) lines.push({ id: 'spacecake', qty: 1 });
    if (r.chance(0.18)) lines.push({ id: 'papers', qty: 1 });
    if (r.chance(0.1)) lines.push({ id: 'lighter', qty: 1 });
    let grams = lines.filter((l) => this.products[l.id].unit === 'g').reduce((s, l) => s + l.qty, 0);
    const overLimit = r.chance(0.07 + 0.12 * diff);
    if (overLimit) {
      const gl = lines.filter((l) => this.products[l.id].unit === 'g');
      while (grams <= 5) {
        const l = r.pick(gl);
        l.qty += r.int(1, 3);
        grams = gl.reduce((s, x) => s + x.qty, 0);
      }
    } else if (grams > 5) {
      const gl = lines.filter((l) => this.products[l.id].unit === 'g');
      while (grams > 5) {
        const l = gl.find((x) => x.qty > 1) || gl[0];
        l.qty -= 1;
        grams -= 1;
      }
    }
    const alcohol = r.chance(0.05 + 0.06 * diff);
    const pay = r.chance(0.55) ? 'pin' : 'cash';
    const id = ++this.uid;
    const side = r.chance(0.5) ? 1 : -1;
    const spawnX = this.L.street[0] + side * r.range(5, 10);
    const spawnZ = this.L.street[1] + r.range(-0.6, 0.6);
    return {
      id, order: id, look, idLook, kind, birth, expiry, nat, name: `${first} ${last}`, first,
      lines, alcohol, overLimit, pay, saidMax5: false, saidNoAlcohol: false,
      x: spawnX, z: spawnZ, yaw: 0, path: [], level: 0,
      phase: 'enter', step: null, slot: -1,
      patience: 34 + r.range(0, 12) - diff * 8, maxPatience: 0, queuePatience: 95 + r.range(0, 30),
      bag: {}, change: 0, cashGiven: 0, payTimer: 0, said: null, saidT: 0, mood: 1,
      greeting: r.pick(tl('line.greet')), anim: 'Walk',
    };
  }

  wantLines(c) {
    let lines = c.lines.map((l) => ({ ...l }));
    if (c.overLimit && c.saidMax5) lines = this.reduceTo5(lines);
    return lines;
  }

  /** Deterministic: trim the biggest gram lines until the total is the legal max. */
  reduceTo5(lines) {
    const max = this.rules.maxGrams;
    const out = lines.map((l) => ({ ...l }));
    const grams = () => out.filter((l) => this.products[l.id].unit === 'g').reduce((s, l) => s + l.qty, 0);
    while (grams() > max) {
      const gl = out.filter((l) => this.products[l.id].unit === 'g' && l.qty > 0).sort((a, b) => b.qty - a.qty);
      gl[0].qty -= 1;
    }
    return out.filter((l) => l.qty > 0);
  }

  orderText(c) {
    const lines = this.wantLines(c);
    const parts = lines.map((l) => {
      const p = this.products[l.id];
      const key = p.unit === 'g' ? (l.qty === 1 ? 'order.gram1' : 'order.gram') : 'order.piece';
      return tr(key, { n: l.qty, name: p.name });
    });
    return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} ${tr('order.and')} ${parts[parts.length - 1]}` : parts[0];
  }

  isValidId(c) {
    const age = ageOn(c.birth, this.today);
    const notExpired = c.expiry >= startOfDay(this.today);
    return age >= this.rules.minAge && notExpired && c.kind !== 'fake';
  }

  // -------------------------------------------------------------- player actions
  checkId(accept) {
    const c = this.current;
    if (!c || c.step !== 'id') return;
    const valid = this.isValidId(c);
    if (accept) {
      if (!valid) {
        this._strike(tr(c.kind === 'minor' ? 'strike.minor' : c.kind === 'expired' ? 'strike.expired' : 'strike.fake'));
      } else {
        this.emit('ok');
      }
      c.step = 'order';
      const beer = c.alcohol && !c.saidNoAlcohol ? ` ${this.rng.pick(tl('line.alcohol'))}` : tr('order.askEnd');
      this.say(c, tr('order.ask', { greet: c.greeting, order: this.orderText(c), end: beer }));
    } else if (valid) {
      this.stats.wrongRefusals++;
      this.say(c, tr(c.kind === 'birthday' ? 'say.birthday' : 'say.idFine'));
      this.emit('wrongRefusal', { text: tr(c.kind === 'birthday' ? 'msg.wasBirthday' : 'msg.wasValid') });
      this._leave(c, true);
    } else {
      this.stats.refusedOk++;
      this.say(c, tr(c.kind === 'minor' ? 'say.minorRefused' : 'say.refused'));
      this.emit('refusedOk', { text: tr('msg.goodCatch', { why: tr(`why.${c.kind}`) }) });
      this._leave(c, false);
    }
  }

  sayRule(rule) {
    const c = this.current;
    if (!c || c.step !== 'order') return;
    if (rule === 'max5') {
      if (c.overLimit && !c.saidMax5) {
        c.saidMax5 = true;
        this.stats.ruleCalls++;
        this.emit('ok', { text: tr('msg.max5') });
        this.say(c, tr('say.max5ok', { order: this.orderText(c) }));
      } else {
        this.say(c, tr('say.under5'));
        c.patience -= 3;
      }
    } else if (rule === 'alcohol') {
      if (c.alcohol && !c.saidNoAlcohol) {
        c.saidNoAlcohol = true;
        this.stats.ruleCalls++;
        this.emit('ok', { text: tr('msg.noAlcohol') });
        this.say(c, tr('say.noBeerOk', { order: this.orderText(c) }));
      } else {
        this.say(c, tr('say.noAlcAsked'));
        c.patience -= 3;
      }
    }
  }

  addItem(id, n = 1) {
    const c = this.current;
    if (!c || c.step !== 'order' || !this.products[id]) return;
    c.bag[id] = Math.max(0, (c.bag[id] || 0) + n);
    if (!c.bag[id]) delete c.bag[id];
  }

  clearBag() {
    if (this.current) this.current.bag = {};
  }

  bagTotal(c = this.current) {
    if (!c) return 0;
    return round2(Object.entries(c.bag).reduce((s, [id, q]) => s + this.products[id].price * q, 0));
  }

  bagGrams(c = this.current) {
    if (!c) return 0;
    return Object.entries(c.bag).reduce((s, [id, q]) => s + (this.products[id].unit === 'g' ? q : 0), 0);
  }

  checkout() {
    const c = this.current;
    if (!c || c.step !== 'order') return { ok: false };
    if (!Object.keys(c.bag).length) return { ok: false, reason: 'empty' };
    const want = this.wantLines(c);
    const wantMap = Object.fromEntries(want.map((l) => [l.id, l.qty]));
    const grams = this.bagGrams(c);
    if (grams > this.rules.maxGrams) {
      this._strike(tr('strike.overMax', { g: grams, max: this.rules.maxGrams }));
    } else {
      const same = Object.keys({ ...wantMap, ...c.bag }).every((id) => (wantMap[id] || 0) === (c.bag[id] || 0));
      if (!same) {
        // If they wanted >5 g and the player trimmed it to exactly the legal version, that's fine too.
        const legal = c.overLimit ? Object.fromEntries(this.reduceTo5(c.lines).map((l) => [l.id, l.qty])) : null;
        const legalSame = legal && Object.keys({ ...legal, ...c.bag }).every((id) => (legal[id] || 0) === (c.bag[id] || 0));
        if (!legalSame) {
          this.stats.mistakes++;
          c.patience -= 6;
          this.say(c, tr('say.wrong', { order: this.orderText(c) }));
          this.emit('mistake', { text: tr('msg.wrongOrder') });
          return { ok: false, reason: 'mismatch' };
        }
        c.saidMax5 = true;
      }
    }
    if (c.alcohol && !c.saidNoAlcohol) {
      c.patience -= 4;
      this.say(c, tr('say.noBeer'));
    }
    c.step = 'pay';
    c.total = this.bagTotal(c);
    if (c.pay === 'cash') {
      const t = c.total;
      const options = NOTES.filter((n) => n >= t);
      c.cashGiven = options.length ? options[options.length - 1 - (this.rng.chance(0.3) && options.length > 1 ? 1 : 0)] :
        Math.ceil(t / 50) * 50;
      if (c.cashGiven === t) c.cashGiven = t; // exact
      c.change = 0;
      this.say(c, tr('say.cash', { amt: euro(c.cashGiven, 0) }));
    } else {
      this.say(c, tr('say.pin'));
    }
    return { ok: true };
  }

  addChange(v) {
    const c = this.current;
    if (!c || c.step !== 'pay' || c.pay !== 'cash') return;
    c.change = round2(c.change + v);
    this.emit('coin');
  }

  resetChange() {
    if (this.current) this.current.change = 0;
  }

  giveChange() {
    const c = this.current;
    if (!c || c.step !== 'pay' || c.pay !== 'cash') return { ok: false };
    const due = round2(c.cashGiven - c.total);
    const diff = round2(c.change - due);
    if (Math.abs(diff) < 0.001) {
      this._complete(c);
      return { ok: true };
    }
    if (diff > 0) {
      this.stats.changeLost = round2(this.stats.changeLost + diff);
      this.emit('mistake', { text: tr('msg.overChange', { amt: euro(diff) }) });
      this._complete(c);
      return { ok: true, over: diff };
    }
    this.stats.mistakes++;
    c.patience -= 6;
    this.say(c, tr('say.missing', { amt: euro(-diff) }));
    this.emit('mistake', { text: tr('msg.notEnough') });
    return { ok: false, short: -diff };
  }

  payPin() {
    const c = this.current;
    if (!c || c.step !== 'pay' || c.pay !== 'pin' || c.payTimer > 0) return;
    c.payTimer = 1.1;
    this.emit('pin');
  }

  say(c, text) {
    c.said = text;
    c.saidT = 0;
  }

  _strike(text) {
    this.stats.strikes++;
    this.emit('strike', { text });
    if (this.stats.strikes >= 3) {
      this.over = true;
      this.reason = 'closed';
    }
  }

  _complete(c) {
    const frac = clamp(c.patience / c.maxPatience, 0, 1);
    const tip = Math.round((c.total * (0.03 + 0.12 * frac) + (frac > 0.6 ? 1 : 0)) * 2) / 2;
    this.stats.revenue = round2(this.stats.revenue + c.total);
    this.stats.tips = round2(this.stats.tips + tip);
    this.stats.served++;
    this.say(c, this.rng.pick(tl('line.thanks')));
    this.emit('sale', { total: c.total, tip });
    this._leave(c, false);
  }

  _leave(c, angry) {
    if (angry) c.mood = 0;
    c.phase = 'leave';
    c.step = null;
    c.anim = 'Walk';
    if (this.current === c) this.current = null;
    const [sx, sz] = this.L.streetEnter;
    const exitX = c.x > 0 ? -sx : sx;
    const door = this.L.street;
    c.path = [...this.nav.path(0, c.x, c.z, door[0], door[1]), ...this.nav.path(0, door[0], door[1], exitX, sz).slice(1)];
    this._reslot();
  }

  _reslot() {
    const q = this.queue;
    q.forEach((c, i) => {
      const slot = Math.min(i, this.L.queue.length - 1);
      if (c.slot !== slot) {
        c.slot = slot;
        const [x, z] = this.L.queue[slot];
        c.path = this.nav.path(0, c.x, c.z, x, z);
        c.anim = 'Walk';
      }
    });
  }

  // -------------------------------------------------------------- tick
  _spawnRate(h) {
    // customers per game hour
    if (h < 12) return 1.6;
    if (h < 16) return 2.2;
    if (h < 18) return 2.8;
    if (h < 22) return 3.4;
    return 2.6;
  }

  update(dt) {
    if (this.over) return;
    this.time += dt;
    this.hour += this.rate * dt;
    if (this.hour < this.closeHour) {
      this.spawnIn -= dt;
      if (this.spawnIn <= 0 && this.queue.length < this.L.queue.length) {
        const c = this._makeCustomer();
        this.customers.push(c);
        this.emit('door');
        this._reslot();
        const gameSecPerHour = 1 / this.rate;
        this.spawnIn = (gameSecPerHour / this._spawnRate(this.hour)) * this.rng.range(0.6, 1.4);
      }
    } else if (!this.queue.length) {
      this.over = true;
      this.reason = 'closing';
    } else if (this.hour > this.closeHour + 0.75) {
      this.over = true;
      this.reason = 'closing';
    }
    for (const c of [...this.customers]) this._tickCustomer(c, dt);
  }

  _tickCustomer(c, dt) {
    if (c.said) c.saidT += dt;
    const speed = c.phase === 'leave' ? 1.6 : 1.4;
    const arrived = stepAlong(c, speed, dt);
    if (c.phase === 'leave') {
      c.anim = 'Walk';
      if (arrived) this.customers.splice(this.customers.indexOf(c), 1);
      return;
    }
    if (!arrived) {
      c.anim = 'Walk';
    } else {
      c.anim = c.phase === 'counter' && c.step === 'order' && c.saidT < 3 ? 'Talk' : 'Idle';
      if (c.slot === 0 && (c.phase === 'queue' || c.phase === 'enter') && !this.current) {
        c.phase = 'counter';
        c.step = 'id';
        c.maxPatience = c.patience;
        this.current = c;
        c.yaw = 0;
        const [rx, rz] = this.L.register;
        c.yaw = Math.atan2(rx - c.x, rz - c.z);
        this.say(c, tr('say.hereId', { greet: c.greeting }));
        this.emit('arrive', { id: c.id });
      } else if (c.phase === 'enter') {
        c.phase = 'queue';
      }
      if (c.phase === 'queue') c.yaw = Math.PI; // face the counter
    }
    if (c.phase === 'counter') {
      if (c.step === 'pay' && c.payTimer > 0) {
        c.payTimer -= dt;
        if (c.payTimer <= 0) this._complete(c);
        return;
      }
      c.patience -= dt;
      if (c.patience <= 0) {
        this.stats.walkouts++;
        this.say(c, this.rng.pick(tl('line.angry')));
        this.emit('walkout', { text: tr('msg.tired', { name: c.first }) });
        this._leave(c, true);
      }
    } else if (c.phase === 'queue') {
      c.queuePatience -= dt;
      if (c.queuePatience <= 0) {
        this.stats.walkouts++;
        this.emit('walkout', { text: tr('msg.leftQueue') });
        this._leave(c, true);
      }
    }
  }

  score() {
    const s = this.stats;
    return Math.max(0, Math.round(s.revenue + s.tips * 2 + s.refusedOk * 8 + s.ruleCalls * 4 - s.wrongRefusals * 6 - s.walkouts * 4 -
      s.strikes * 30 - s.mistakes * 2 - s.changeLost));
  }

  starsFor(score) {
    return [150, 400, 700, 1000, 1350].filter((t) => score >= t).length;
  }
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
