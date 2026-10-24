// Ambient people: staff at their stations, pool players, and (in Tycoon) a stream of visitors who
// queue at the counter and sometimes sit down. Pure logic producing entities for World.syncPeople.
import { randomLook, staffLook } from '../util.js';
import { stepAlong } from './nav.js';

export class Crowd {
  constructor(layout, nav, rng, { upgrades = new Set(), reserved = new Set() } = {}) {
    this.L = layout;
    this.nav = nav;
    this.rng = rng;
    this.upgrades = upgrades;
    this.reserved = reserved; // table ids the gameplay sim owns
    this.people = [];
    this.uid = 0;
    this.spawnAcc = 0;
    this.rate = 0; // visitors per second
    this.taken = new Set();
    this.staff = { cashier: 0, server: 0, cook: 0, barista: 0, musician: false };
  }

  setStaff(staff) {
    this.staff = { ...this.staff, ...staff };
    // rebuild staff entities
    this.people = this.people.filter((p) => p.role !== 'staff');
    const add = (kind, x, z, yaw, anim = 'Idle', level = 0) => {
      this.people.push({ id: `staff_${kind}_${++this.uid}`, role: 'staff', kind, look: staffLook(this.rng), x, z, level,
        yaw, anim, path: [], timer: this.rng.range(1, 4) });
    };
    const [cx, cz] = this.L.cashierStaff;
    for (let i = 0; i < this.staff.cashier; i++) add('cashier', cx + (i - (this.staff.cashier - 1) / 2) * 1.3, cz, 0);
    const [bx, bz] = this.L.barStaff;
    for (let i = 0; i < (this.staff.barista || 0); i++) add('barista', bx - 1.0 + i * 2, bz, 0);
    for (let i = 0; i < this.staff.server; i++) add('server', this.L.pass[0] + 0.8 * i, this.L.pass[1] + 0.4, Math.PI, 'Idle');
    const [kx, kz] = this.L.kitchen.cook;
    for (let i = 0; i < this.staff.cook; i++) add('cook', kx - 0.8 * i, kz, Math.PI);
    if (this.staff.musician && this.upgrades.has('stage')) {
      const [mx, mz] = this.L.stage.musician;
      this.people.push({ id: 'musician', role: 'staff', kind: 'musician', look: randomLook(this.rng), x: mx, z: mz, level: 0,
        y: this.L.stage.height, yaw: Math.PI, anim: 'Sit', path: [] });
    }
  }

  addPoolPlayers() {
    if (!this.upgrades.has('pool')) return;
    for (const [i, p] of this.L.pool.entries()) {
      if (this.rng.chance(0.25)) continue;
      for (const side of [-1, 1]) {
        this.people.push({ id: `pool${i}${side}`, role: 'ambient', look: randomLook(this.rng), x: p.x + side * 1.55,
          z: p.z + this.rng.range(-0.3, 0.3), level: 0, yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2, anim: 'Idle', path: [] });
      }
    }
  }

  freeSeats() {
    const out = [];
    for (const t of this.L.tables) {
      if (this.reserved.has(t.id) || t.level !== 0) continue;
      if (t.unlock && !this.upgrades.has(t.unlock)) continue;
      t.seats.forEach((s, i) => {
        if (!this.taken.has(`${t.id}:${i}`)) out.push({ t, i, s });
      });
    }
    return out;
  }

  /** Instantly fill some seats with relaxed guests (background life). */
  fillSeats(n) {
    const free = this.freeSeats();
    for (let k = 0; k < n && free.length; k++) {
      const { t, i, s } = free.splice(Math.floor(this.rng() * free.length), 1)[0];
      this.taken.add(`${t.id}:${i}`);
      this.people.push({ id: `seat${++this.uid}`, role: 'ambient', look: randomLook(this.rng), x: s[0], z: s[1], level: 0,
        yaw: (s[2] * Math.PI) / 180, anim: 'Sit', path: [], seat: `${t.id}:${i}`, table: t.id, timer: Infinity });
    }
  }

  setRate(perSecond) {
    this.rate = perSecond;
  }

  _spawnVisitor() {
    const [sx, sz] = this.L.streetEnter;
    const side = this.rng.chance(0.5) ? 1 : -1;
    const q = this.L.queue;
    const inQueue = this.people.filter((p) => p.state === 'queue' || p.state === 'toQueue').length;
    if (inQueue >= q.length - 1) return;
    const slot = q[Math.min(inQueue, q.length - 1)];
    const p = { id: `v${++this.uid}`, role: 'visitor', look: randomLook(this.rng), x: side * -sx, z: sz, level: 0,
      yaw: 0, anim: 'Walk', state: 'toQueue', timer: 0, path: [] };
    p.path = this.nav.path(0, p.x, p.z, slot[0], slot[1]);
    this.people.push(p);
  }

  _requeue() {
    const q = this.L.queue;
    const line = this.people.filter((p) => p.state === 'queue' || p.state === 'toQueue');
    line.forEach((p, i) => {
      const [x, z] = q[Math.min(i, q.length - 1)];
      if (Math.hypot((p.goal?.[0] ?? 99) - x, (p.goal?.[1] ?? 99) - z) > 0.05) {
        p.goal = [x, z];
        p.path = this.nav.path(0, p.x, p.z, x, z);
        p.state = 'toQueue';
      }
    });
  }

  _leave(p) {
    const [sx, sz] = this.L.streetEnter;
    const door = this.L.street;
    if (p.seat) this.taken.delete(p.seat);
    p.seat = null;
    p.state = 'leave';
    p.path = [...this.nav.path(0, p.x, p.z, door[0], door[1]),
      ...this.nav.path(0, door[0], door[1], this.rng.chance(0.5) ? sx : -sx, sz).slice(1)];
  }

  update(dt) {
    if (this.rate > 0) {
      this.spawnAcc += dt * this.rate;
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        this._spawnVisitor();
      }
    }
    let first = true;
    for (const p of [...this.people]) {
      if (p.role === 'staff') {
        this._tickStaff(p, dt);
        continue;
      }
      if (p.role === 'ambient') continue;
      const arrived = stepAlong(p, 1.4, dt);
      p.anim = arrived ? (p.seat && p.state === 'sit' ? 'Sit' : 'Idle') : 'Walk';
      if (p.state === 'toQueue' && arrived) {
        p.state = 'queue';
        p.yaw = Math.PI;
        p.timer = this.rng.range(2.5, 5);
      }
      if (p.state === 'queue') {
        if (first) {
          p.timer -= dt;
          p.anim = 'Talk';
          if (p.timer <= 0) {
            const free = this.freeSeats();
            if (free.length && this.rng.chance(0.45)) {
              const { t, i, s } = this.rng.pick(free);
              p.seat = `${t.id}:${i}`;
              this.taken.add(p.seat);
              p.target = s;
              p.state = 'toSeat';
              p.path = this.nav.path(0, p.x, p.z, s[0], s[1]);
            } else {
              this._leave(p);
            }
            this._requeue();
          }
        }
        first = false;
      }
      if (p.state === 'toSeat' && arrived) {
        p.state = 'sit';
        p.x = p.target[0];
        p.z = p.target[1];
        p.yaw = (p.target[2] * Math.PI) / 180;
        p.timer = this.rng.range(20, 45);
      }
      if (p.state === 'sit') {
        p.anim = 'Sit';
        p.timer -= dt;
        if (p.timer <= 0) this._leave(p);
      }
      if (p.state === 'leave' && arrived) this.people.splice(this.people.indexOf(p), 1);
    }
  }

  _tickStaff(p, dt) {
    if (p.kind === 'server') {
      const arrived = stepAlong(p, 1.8, dt);
      p.anim = arrived ? 'Idle' : 'Walk';
      p.carry = p.goingTo === 'table' && !arrived ? [{ name: this.rng() < 0.5 ? 'shake' : 'coffee' }] : null;
      if (arrived) {
        p.timer -= dt;
        if (p.timer <= 0) {
          p.timer = this.rng.range(2, 5);
          if (p.goingTo === 'table') {
            p.goingTo = 'pass';
            p.path = this.nav.path(0, p.x, p.z, this.L.pass[0], this.L.pass[1]);
          } else {
            const tables = this.L.tables.filter((t) => t.level === 0 && (!t.unlock || this.upgrades.has(t.unlock)));
            const t = this.rng.pick(tables);
            p.goingTo = 'table';
            p.path = this.nav.path(0, p.x, p.z, t.x, t.z, this.L.tableReach);
          }
        }
      }
    } else if (p.kind === 'cashier' || p.kind === 'barista') {
      p.timer -= dt;
      if (p.timer <= 0) {
        p.timer = this.rng.range(2, 6);
        p.anim = this.rng.chance(0.5) ? 'Talk' : 'Idle';
      }
    }
  }

  entities() {
    return this.people;
  }
}
