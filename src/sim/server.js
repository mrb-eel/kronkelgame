// Bediening mode: you are the floor staff. Seat groups, take orders, run food and shakes from the
// pass, bring board games, settle the bill, clean up. Pure logic; the screen renders it.
import { clamp, randomLook, rng as makeRng, round2, staffLook } from '../util.js';
import { Nav, stepAlong } from './nav.js';
import { t as tr, tl, td } from '../i18n.js';

const WAITER_SPEED = 3.0;
const GUEST_SPEED = 1.35;
const TRAY = 4;

export class ServerSim {
  constructor(data, layout, { seed = Date.now(), shiftSeconds = 260, upgrades = null, startHour = 12 } = {}) {
    this.data = data;
    this.L = layout;
    this.rng = makeRng(seed);
    this.upgrades = upgrades || new Set(data.upgrades.map((u) => u.id));
    this.hour = startHour;
    this.startHour = startHour;
    this.closeHour = data.rules.closeHour;
    this.rate = (this.closeHour - startHour) / shiftSeconds;
    this.nav = new Nav(layout, { upgrades: this.upgrades, tables: this._tablesAvail() });
    this.tables = this._tablesAvail().map((t) => ({ ...t, state: 'free', group: null, props: [] }));
    this.terraceOpen = false;
    this.menu = data.kitchen.filter((k) => !k.unlock || this.upgrades.has(k.unlock)).map((k) => ({ ...k, name: td('item', k) }));
    this.groups = [];
    this.tickets = [];
    this.ready = []; // items waiting on the pass
    this.uid = 0;
    this.time = 0;
    this.spawnIn = 3;
    this.selectedGroup = null;
    const [hx, hz] = layout.pass;
    this.waiter = { id: 'waiter', look: staffLook(this.rng), x: hx + 1.2, z: hz + 0.6, level: 0, yaw: Math.PI, path: [],
      carry: [], game: false, queue: [], action: null, busy: 0, anim: 'Idle' };
    this.stats = { revenue: 0, tips: 0, groupsServed: 0, walkouts: 0, itemsServed: 0, gamesBrought: 0, missed: 0 };
    this.events = [];
    this.over = false;
  }

  _tablesAvail() {
    return this.L.tables.filter((t) => !t.unlock || this.upgrades.has(t.unlock));
  }

  emit(type, extra = {}) {
    this.events.push({ type, ...extra });
  }

  get kitchenOpen() {
    return this.hour >= this.data.rules.kitchenOpen && this.hour < this.data.rules.kitchenClose;
  }

  get waiting() {
    return this.groups.filter((g) => g.state === 'waiting' || g.state === 'arriving');
  }

  table(id) {
    return this.tables.find((t) => t.id === id);
  }

  // -------------------------------------------------------------- spawning
  _spawnGroup() {
    const r = this.rng;
    const size = r.weighted([[1, 2], [2, 5], [3, 2], [4, 2]]);
    const id = `g${++this.uid}`;
    const [sx, sz] = this.L.streetEnter;
    const side = r.chance(0.5) ? -1 : 1;
    const [hx, hz] = this.L.host;
    const slot = this.waiting.length;
    const members = [];
    for (let i = 0; i < size; i++) {
      const m = { id: `${id}m${i}`, look: randomLook(r), x: side * sx + i * 0.6 * -side, z: sz + (i % 2) * 0.4,
        level: 0, yaw: 0, path: [], anim: 'Walk', seat: null };
      const tx = hx - 0.55 * (i % 2) - slot * 0.25;
      const tz = hz - 0.55 * Math.floor(i / 2) - slot * 1.05;
      m.path = this.nav.path(0, m.x, m.z, tx, tz);
      members.push(m);
    }
    const g = { id, size, members, state: 'arriving', mood: 1, timer: 0, table: null, order: [], wantsGame: false,
      hadGame: false, eatT: 0, bill: 0 };
    this.groups.push(g);
    this.emit('door');
    return g;
  }

  _rateFor(h) {
    if (h < 14) return 1.0;
    if (h < 17) return 1.3;
    if (h < 22) return 1.75;
    return 1.3;
  }

  // -------------------------------------------------------------- player input
  /** Tap on the host area: select the longest-waiting group. */
  selectHost() {
    const g = this.waiting.find((x) => x.state === 'waiting') || this.waiting[0];
    if (!g) return { ok: false, reason: tr('srv.noGroup') };
    this.selectedGroup = g.id;
    this.emit('select', { group: g.id });
    return { ok: true, group: g };
  }

  /** Tap on a table. Seats the selected group, or queues a waiter task. */
  tapTable(id) {
    const t = this.table(id);
    if (!t) return { ok: false };
    if (t.level === 1 && !this.terraceOpen) return { ok: false, reason: tr('srv.terraceLater') };
    if (this.selectedGroup) {
      const g = this.groups.find((x) => x.id === this.selectedGroup);
      if (g && (g.state === 'waiting' || g.state === 'arriving')) {
        if (t.state !== 'free') return { ok: false, reason: tr('srv.taken') };
        if (t.seats.length < g.size) return { ok: false, reason: tr('srv.tooSmall', { n: t.seats.length }) };
        this._seat(g, t);
        this.selectedGroup = null;
        return { ok: true, seated: true };
      }
      this.selectedGroup = null;
    }
    const g = t.group ? this.groups.find((x) => x.id === t.group) : null;
    let type = null;
    if (t.state === 'dirty') type = 'clean';
    else if (g) {
      if (g.state === 'ready') type = 'order';
      else if (g.state === 'wantsBill') type = 'bill';
      else if (g.wantsGame && !g.hadGame) type = 'game';
      else if (g.state === 'waitFood' || g.state === 'eating') {
        if (this.waiter.carry.some((c) => c.table === t.id) || this._queued('pickup')) type = 'serve';
        else return { ok: false, reason: tr('srv.notReady') };
      }
    }
    if (!type) return { ok: false, reason: t.state === 'free' ? tr('srv.doorFirst') : tr('srv.nothing') };
    return this._enqueue({ type, table: t.id });
  }

  tapPass() {
    if (!this.ready.length && !this.tickets.length) return { ok: false, reason: tr('srv.passEmpty') };
    return this._enqueue({ type: 'pickup' });
  }

  tapShelf() {
    return this._enqueue({ type: 'fetchGame' });
  }

  _queued(type, table) {
    const all = [this.waiter.action, ...this.waiter.queue].filter(Boolean);
    return all.some((a) => a.type === type && (!table || a.table === table));
  }

  _enqueue(a) {
    if (this._queued(a.type, a.table)) return { ok: false, reason: tr('srv.queued') };
    if (this.waiter.queue.length >= 6) return { ok: false, reason: tr('srv.listFull') };
    this.waiter.queue.push({ ...a, id: ++this.uid });
    this.emit('queued', { action: a.type, table: a.table });
    return { ok: true };
  }

  cancelQueue() {
    this.waiter.queue = [];
  }

  // -------------------------------------------------------------- group flow
  _seat(g, t) {
    g.state = 'walking';
    g.table = t.id;
    t.state = 'taken';
    t.group = g.id;
    g.members.forEach((m, i) => {
      const [sx, sz, face] = t.seats[i];
      m.seat = { x: sx, z: sz, yaw: (face * Math.PI) / 180 };
      m.level = 0;
      const pts = [];
      if (t.level === 1) {
        const st = this.L.stairs;
        pts.push(...this.nav.path(0, m.x, m.z, st.ground[0], st.ground[1]));
        m.stairs = true;
      } else {
        pts.push(...this.nav.path(0, m.x, m.z, sx, sz, 0));
      }
      m.path = pts;
    });
    g.mood = Math.min(1, g.mood + 0.1);
    this.emit('seated', { table: t.id });
  }

  _makeOrder(g) {
    const r = this.rng;
    const drinks = this.menu.filter((m) => m.station === 'bar' && m.prop !== 'pie');
    const food = this.menu.filter((m) => m.station === 'kitchen');
    const items = [];
    for (let i = 0; i < g.size; i++) {
      items.push(r.pick(drinks));
      if (this.kitchenOpen && food.length && r.chance(0.45)) items.push(r.pick(food));
      else if (r.chance(0.15)) items.push(this.menu.find((m) => m.prop === 'pie') || r.pick(drinks));
    }
    g.order = items.map((it) => ({ item: it.id, served: false }));
    for (const o of g.order) {
      const it = this.menu.find((m) => m.id === o.item);
      const station = it.station;
      const busy = this.tickets.filter((t) => t.station === station).length;
      const speed = station === 'kitchen' && this.upgrades.has('proKitchen') ? 0.75 : 1;
      this.tickets.push({ id: ++this.uid, item: it.id, table: g.table, station,
        left: it.time * speed + busy * (station === 'bar' ? 2.5 : 4) });
    }
    g.wantsGame = this.upgrades.has('gameShelf') && r.chance(0.25);
  }

  _tickGroup(g, dt) {
    const decay = { waiting: 0.014, arriving: 0.008, ready: 0.017, waitFood: 0.008, wantsBill: 0.02, eating: -0.012 }[g.state] ?? 0;
    const t = g.table ? this.table(g.table) : null;
    if (g.wantsGame && !g.hadGame && (g.state === 'eating' || g.state === 'waitFood')) g.mood -= 0.006 * dt;
    g.mood = clamp(g.mood - decay * dt, 0, 1);
    let allArrived = true;
    for (const m of g.members) {
      const speed = GUEST_SPEED;
      const arrived = stepAlong(m, speed, dt);
      if (arrived && m.stairs && m.level === 0 && g.state === 'walking') {
        const tt = this.table(g.table);
        const st = this.L.stairs;
        m.level = 1;
        m.x = st.terrace[0];
        m.z = st.terrace[1];
        m.stairs = false;
        m.path = this.nav.path(1, m.x, m.z, m.seat.x, m.seat.z);
        if (tt) allArrived = false;
        continue;
      }
      if (!arrived) {
        allArrived = false;
        m.anim = 'Walk';
      } else if (g.state === 'walking' && m.seat) {
        m.x = m.seat.x;
        m.z = m.seat.z;
        m.yaw = m.seat.yaw;
        m.anim = 'Sit';
      } else if (g.state === 'leaving' || g.state === 'angry') {
        m.anim = 'Walk';
      } else if (m.seat && g.state !== 'waiting' && g.state !== 'arriving') {
        m.anim = 'Sit';
      } else {
        m.anim = 'Idle';
        m.yaw = Math.PI;
      }
    }
    if (g.state === 'arriving' && allArrived) g.state = 'waiting';
    if (g.state === 'walking' && allArrived) {
      g.state = 'menu';
      g.timer = this.rng.range(3, 6);
    }
    if (g.state === 'menu') {
      g.timer -= dt;
      if (g.timer <= 0) {
        g.state = 'ready';
        this.emit('ready', { table: g.table });
      }
    }
    if (g.state === 'eating') {
      g.eatT -= dt;
      if (g.eatT <= 0) {
        g.state = 'wantsBill';
        this.emit('bill', { table: g.table });
      }
    }
    if ((g.state === 'leaving' || g.state === 'angry') && allArrived) {
      this.groups.splice(this.groups.indexOf(g), 1);
      return;
    }
    if (g.mood <= 0 && g.state !== 'leaving' && g.state !== 'angry') this._walkout(g, t);
  }

  _walkout(g, t) {
    this.stats.walkouts++;
    this.emit('walkout', { text: g.table ? tr('srv.tableLeft', { t: g.table }) : tr('srv.doorLeft') });
    if (t) {
      t.state = g.order.some((o) => o.served) ? 'dirty' : 'free';
      t.group = null;
    }
    this.tickets = this.tickets.filter((x) => x.table !== g.table);
    this.ready = this.ready.filter((x) => x.table !== g.table);
    if (this.selectedGroup === g.id) this.selectedGroup = null;
    this._sendHome(g, 'angry');
  }

  _sendHome(g, state) {
    g.state = state;
    const [sx, sz] = this.L.streetEnter;
    for (const m of g.members) {
      m.anim = 'Walk';
      const exitX = this.rng.chance(0.5) ? sx : -sx;
      if (m.level === 1) {
        const st = this.L.stairs;
        m.x = st.ground[0];
        m.z = st.ground[1];
        m.level = 0;
      }
      const door = this.L.street;
      m.path = [...this.nav.path(0, m.x, m.z, door[0], door[1]), ...this.nav.path(0, door[0], door[1], exitX, sz).slice(1)];
    }
  }

  // -------------------------------------------------------------- waiter
  _goal(a) {
    if (a.type === 'pickup') return { level: 0, x: this.L.pass[0], z: this.L.pass[1], reach: 0 };
    if (a.type === 'fetchGame' || (a.type === 'game' && !this.waiter.game)) {
      const s = this.L.gameShelf.spot;
      return { level: 0, x: s[0], z: s[1], reach: 0 };
    }
    const t = this.table(a.table);
    return { level: t.level, x: t.x, z: t.z, reach: this.L.tableReach };
  }

  _routeTo(goal) {
    const w = this.waiter;
    const st = this.L.stairs;
    if (goal.level === w.level) {
      w.path = this.nav.path(w.level, w.x, w.z, goal.x, goal.z, goal.reach);
      w.stairsAfter = false;
    } else {
      const from = w.level === 0 ? st.ground : st.terrace;
      w.path = this.nav.path(w.level, w.x, w.z, from[0], from[1]);
      w.stairsAfter = true;
    }
  }

  _tickWaiter(dt) {
    const w = this.waiter;
    if (w.busy > 0) {
      w.busy -= dt;
      w.anim = w.stairsAfter === 'climbing' ? 'Walk' : 'Idle';
      if (w.busy <= 0) {
        if (w.stairsAfter === 'climbing') {
          const st = this.L.stairs;
          w.level = 1 - w.level;
          const p = w.level === 1 ? st.terrace : st.ground;
          w.x = p[0];
          w.z = p[1];
          w.hidden = false;
          w.stairsAfter = false;
          if (w.action) this._routeTo(this._goal(w.action));
        } else if (w.action) {
          this._finish(w.action);
          w.action = null;
        }
      }
      return;
    }
    if (!w.action && w.queue.length) {
      w.action = w.queue.shift();
      this._routeTo(this._goal(w.action));
    }
    if (!w.action) {
      w.anim = 'Idle';
      return;
    }
    const arrived = stepAlong(w, WAITER_SPEED, dt);
    w.anim = arrived ? 'Idle' : 'Walk';
    if (!arrived) return;
    if (w.stairsAfter === true) {
      w.stairsAfter = 'climbing';
      w.busy = 1.2;
      w.hidden = true;
      return;
    }
    // Arrived: some actions take a moment
    const a = w.action;
    if (a.type === 'game' && !w.game) {
      w.game = true;
      w.action = { ...a, type: 'gameDeliver' };
      this._routeTo(this._goal(a));
      return;
    }
    if (a.type === 'gameDeliver') {
      w.busy = 0.5;
      w.action = { ...a, type: 'game' };
      return;
    }
    const t = a.table ? this.table(a.table) : null;
    if (t) w.yaw = Math.atan2(t.x - w.x, t.z - w.z);
    w.busy = { order: 0.7, bill: 0.7, clean: 1.0, serve: 0.4, pickup: 0.35, fetchGame: 0.4, game: 0.4 }[a.type] ?? 0.4;
  }

  _finish(a) {
    const w = this.waiter;
    const t = a.table ? this.table(a.table) : null;
    const g = t?.group ? this.groups.find((x) => x.id === t.group) : null;
    switch (a.type) {
      case 'order':
        if (g && g.state === 'ready') {
          this._makeOrder(g);
          g.state = 'waitFood';
          g.mood = Math.min(1, g.mood + 0.1);
          this.emit('ordered', { table: t.id, n: g.order.length });
        }
        break;
      case 'pickup': {
        const space = TRAY - w.carry.length;
        const take = this.ready.splice(0, Math.max(0, space));
        w.carry.push(...take);
        if (take.length) this.emit('pickup', { n: take.length });
        else this.emit('info', { text: tr('srv.nothingReady') });
        break;
      }
      case 'serve': {
        if (!g) break;
        const mine = w.carry.filter((c) => c.table === t.id);
        if (!mine.length) {
          this.emit('info', { text: tr('srv.nothingFor', { t: t.id }) });
          break;
        }
        w.carry = w.carry.filter((c) => c.table !== t.id);
        for (const c of mine) {
          const o = g.order.find((x) => x.item === c.item && !x.served);
          if (o) o.served = true;
          this.stats.itemsServed++;
        }
        t.props = g.order.filter((o) => o.served).map((o) => o.item);
        g.mood = Math.min(1, g.mood + 0.12);
        this.emit('served', { table: t.id, n: mine.length });
        if (g.order.every((o) => o.served) && g.state === 'waitFood') {
          g.state = 'eating';
          g.eatT = this.rng.range(10, 16) + (g.hadGame ? 5 : 0);
        }
        break;
      }
      case 'fetchGame':
        if (!w.game) {
          w.game = true;
          this.emit('info', { text: tr('srv.grabbedGame') });
        }
        break;
      case 'game':
        if (g && g.wantsGame && !g.hadGame && w.game) {
          w.game = false;
          g.hadGame = true;
          g.mood = Math.min(1, g.mood + 0.3);
          g.eatT += 6;
          this.stats.gamesBrought++;
          g.gameName = this.rng.pick(tl('games'));
          this.emit('game', { table: t.id, name: g.gameName });
        }
        break;
      case 'bill':
        if (g && g.state === 'wantsBill') {
          const total = round2(g.order.filter((o) => o.served)
            .reduce((s, o) => s + this.menu.find((m) => m.id === o.item).price, 0));
          const tip = Math.round(total * (0.04 + 0.22 * g.mood) * 2) / 2;
          this.stats.revenue = round2(this.stats.revenue + total);
          this.stats.tips = round2(this.stats.tips + tip);
          this.stats.groupsServed++;
          this.emit('paid', { table: t.id, total, tip });
          t.state = 'dirty';
          t.group = null;
          this._sendHome(g, 'leaving');
        }
        break;
      case 'clean':
        if (t && t.state === 'dirty') {
          t.state = 'free';
          t.props = [];
          this.emit('clean', { table: t.id });
        }
        break;
      default:
        break;
    }
  }

  // -------------------------------------------------------------- tick
  update(dt) {
    if (this.over) return;
    this.time += dt;
    this.hour += this.rate * dt;
    if (!this.terraceOpen && this.hour >= 14 && this.tables.some((t) => t.level === 1)) {
      this.terraceOpen = true;
      this.emit('terrace');
    }
    if (this.hour < this.closeHour - 0.5) {
      this.spawnIn -= dt;
      if (this.spawnIn <= 0) {
        if (this.waiting.length < 4) this._spawnGroup();
        else {
          this.stats.missed++;
          this.emit('info', { text: tr('srv.sawQueue') });
        }
        const secPerHour = 1 / this.rate;
        this.spawnIn = (secPerHour / this._rateFor(this.hour)) * this.rng.range(0.65, 1.35);
      }
    } else if (!this.groups.some((g) => g.state !== 'leaving' && g.state !== 'angry') || this.hour > this.closeHour + 0.6) {
      this.over = true;
    }
    for (const tk of [...this.tickets]) {
      tk.left -= dt;
      if (tk.left <= 0) {
        this.tickets.splice(this.tickets.indexOf(tk), 1);
        this.ready.push({ item: tk.item, table: tk.table, name: this.menu.find((m) => m.id === tk.item).prop,
          color: this.menu.find((m) => m.id === tk.item).color });
        this.emit('ding');
      }
    }
    for (const g of [...this.groups]) this._tickGroup(g, dt);
    this._tickWaiter(dt);
  }

  score() {
    const s = this.stats;
    return Math.max(0, Math.round(s.revenue + s.tips * 2 + s.gamesBrought * 5 - s.walkouts * 15 - s.missed * 3));
  }

  starsFor(score) {
    return [60, 160, 300, 450, 620].filter((t) => score >= t).length;
  }
}
