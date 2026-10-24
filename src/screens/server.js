import * as THREE from 'three';
import { C } from '../gui.js';
import { BaseScreen, topBar } from './common.js';
import { ServerSim } from '../sim/server.js';
import { Crowd } from '../sim/crowd.js';
import { clamp, clockText, euro, rng } from '../util.js';
import { sfx } from '../audio.js';

const TASK_LABEL = { order: 'Order', pickup: 'Pick up', serve: 'Serve', bill: 'Bill', clean: 'Clean', game: 'Game',
  gameDeliver: 'Game', fetchGame: 'Get game' };

export class ServerScreen extends BaseScreen {
  enter() {
    const g = this.game;
    this.pausable = true;
    this.howtoTab = 'bediening';
    const all = new Set(this.data.upgrades.map((u) => u.id));
    this.sim = new ServerSim(this.data, this.L, { seed: Date.now() % 1e9, upgrades: all });
    this.world.clearPeople();
    this.world.setUpgrades(all);
    this.level = 0;
    this.world.setView('floor');
    const busyTables = new Set(this.L.tables.map((t) => t.id));
    this.crowd = new Crowd(this.L, this.sim.nav, rng(Date.now() % 7777), { upgrades: all, reserved: busyTables });
    this.crowd.setStaff({ barista: 1, cook: 1, cashier: 1 });
    this.crowd.addPoolPlayers();
    this.v3 = new THREE.Vector3();
    if (!g.save.seenHowto.bediening) {
      g.save.seenHowto.bediening = true;
      g.persist();
      this.paused = true;
      this.openHowto('bediening', true);
    }
  }

  exit() {
    this.world.clearPeople();
  }

  vrAnchor() {
    if (this.level === 1) return { x: 0, y: this.L.terrace.y, z: 1.6, yaw: 0, panelY: 1.0, panelDist: 0.65, panelTilt: -0.6, panelScale: 0.85 };
    return { x: 0.6, z: 4.4, yaw: 0, panelY: 1.0, panelDist: 0.65, panelTilt: -0.6, panelScale: 0.85 };
  }

  setLevel(l) {
    if (this.level === l) return;
    this.level = l;
    this.world.setView(l === 1 ? 'terrace' : 'floor', { snap: false });
    if (this.game.xr?.active) this.game.xr.placeForScreen();
  }

  onDrag(dx) {
    this.world.pan = clamp(this.world.pan - dx * 0.025, -4.5, 4.5);
  }

  onLook(x, y, dt) {
    this.world.pan = clamp(this.world.pan + x * dt * 6, -4.5, 4.5);
    void y;
  }

  onZoom(d) {
    this.world.zoom = clamp(this.world.zoom * (d > 0 ? 0.92 : 1.08), 0.8, 1.8);
  }

  onAlt(btn) {
    if (btn === 'x') this._tapPass();
    if (btn === 'y') this.setLevel(1 - this.level);
  }

  onWorldPick(hit) {
    if (!hit || this.paused) return;
    if (hit.kind === 'table') this._tapTable(hit.id);
    else if (hit.kind === 'pass') this._tapPass();
    else if (hit.kind === 'shelf') this._result(this.sim.tapShelf());
    else if (hit.kind === 'host') this._tapHost();
    else if (hit.kind === 'stairs') this.setLevel(1 - this.level);
  }

  _result(r) {
    if (r.ok) sfx.pop();
    else if (r.reason) {
      sfx.error();
      this.toast(r.reason, C.gold);
    }
    return r;
  }

  _tapTable(id) {
    const r = this._result(this.sim.tapTable(id));
    if (r.seated) sfx.ok();
  }

  _tapPass() {
    this._result(this.sim.tapPass());
  }

  _tapHost() {
    const r = this._result(this.sim.selectHost());
    if (r.ok) this.toast(`Group of ${r.group.size}: tap a free table that fits them`, C.blue);
  }

  update(dt) {
    const sim = this.sim;
    if (!this.paused && !this.modal) {
      sim.update(dt);
      this.crowd.update(dt);
    }
    for (const e of sim.events.splice(0)) this._event(e);
    const w = sim.waiter;
    if (w.level !== this._lastWaiterLevel && !w.hidden) {
      this._lastWaiterLevel = w.level;
      this.setLevel(w.level);
    }
    this.world.setHour(sim.hour);
    const ents = [];
    for (const g of sim.groups) {
      for (const m of g.members) ents.push({ id: m.id, look: m.look, x: m.x, z: m.z, level: m.level, yaw: m.yaw, anim: m.anim });
    }
    const carry = w.carry.map((c) => ({ name: c.name, color: c.color }));
    if (w.game) carry.push({ name: 'gamebox' });
    ents.push({ id: 'waiter', look: w.look, x: w.x, z: w.z, level: w.level, yaw: w.yaw, anim: w.anim, carry, hidden: w.hidden });
    this.world.syncPeople([...ents, ...this.crowd.entities()], dt);
    this._syncProps();
    this._syncBubbles();
    if (sim.over) this._finish();
  }

  _tableTop(t) {
    return { y: (t.level ? this.L.terrace.y : 0) + (t.type === 'lounge' ? 0.47 : 0.765) };
  }

  _syncProps() {
    const sim = this.sim;
    const list = [];
    for (const t of sim.tables) {
      const { y } = this._tableTop(t);
      const g = t.group ? sim.groups.find((x) => x.id === t.group) : null;
      if (t.state === 'dirty') {
        list.push({ key: `d${t.id}`, name: 'dirty', x: t.x, y, z: t.z });
        continue;
      }
      if (!g) continue;
      const served = g.order.filter((o) => o.served);
      served.forEach((o, i) => {
        const it = sim.menu.find((m) => m.id === o.item);
        const seat = t.seats[i % t.seats.length];
        const dx = seat[0] - t.x;
        const dz = seat[1] - t.z;
        const d = Math.hypot(dx, dz) || 1;
        const r = t.type === 'lounge' ? 0.25 : 0.22;
        const off = i >= t.seats.length ? 0.1 : 0;
        list.push({ key: `p${t.id}${i}`, name: it.prop, color: it.color, x: t.x + (dx / d) * (r - off) + off * 0.5,
          y, z: t.z + (dz / d) * (r - off), yaw: i });
      });
      if (g.hadGame) list.push({ key: `gm${t.id}`, name: 'gamebox', color: '#b8322f', x: t.x, y, z: t.z, yaw: 0.4, scale: 0.8 });
      if (g.state === 'wantsBill') list.push({ key: `bl${t.id}`, name: 'bill', x: t.x + 0.05, y, z: t.z - 0.05 });
    }
    // Ready items on the bar next to the pass
    const [px, pz] = this.L.pass;
    sim.ready.forEach((it, i) => {
      list.push({ key: `r${i}${it.item}${it.table}`, name: it.name, color: it.color, x: px - 0.9 + (i % 8) * 0.24,
        y: this.L.bar.height + 0.01, z: pz - 0.72 - Math.floor(i / 8) * 0.2 - Math.abs(px - 0.9 + (i % 8) * 0.24 - px) * 0.04 });
    });
    this.world.syncProps(list);
  }

  _syncBubbles() {
    const sim = this.sim;
    const out = [];
    for (const t of sim.tables) {
      const y0 = (t.level ? this.L.terrace.y : 0) + 1.9;
      const g = t.group ? sim.groups.find((x) => x.id === t.group) : null;
      let icon = null;
      if (t.state === 'dirty') icon = 'dirty';
      else if (g) {
        if (g.state === 'ready') icon = 'order';
        else if (g.state === 'wantsBill') icon = 'bill';
        else if (g.wantsGame && !g.hadGame && (g.state === 'waitFood' || g.state === 'eating')) icon = 'game';
        else if (g.state === 'waitFood') icon = sim.ready.some((r) => r.table === t.id) || sim.waiter.carry.some((c) => c.table === t.id)
          ? 'food' : 'wait';
      }
      if (icon && (t.level === this.level || this.game.xr?.active)) {
        out.push({ key: `t${t.id}`, icon, mood: g ? g.mood : null, x: t.x, y: y0, z: t.z, scale: 0.6 });
      }
    }
    if (this.level === 1 && !this.game.xr?.active) {
      this.world.syncBubbles(out);
      return;
    }
    sim.waiting.forEach((g, i) => {
      const m = g.members[0];
      out.push({ key: `w${g.id}`, icon: 'seat', mood: g.mood, x: m.x, y: 2.15, z: m.z,
        scale: sim.selectedGroup === g.id ? 0.75 : 0.5 });
      void i;
    });
    if (sim.ready.length) {
      const [px, pz] = this.L.pass;
      out.push({ key: 'pass', icon: 'food', mood: null, x: px, y: 2.0, z: pz - 0.3, scale: 0.55 });
    }
    this.world.syncBubbles(out);
  }

  _event(e) {
    switch (e.type) {
      case 'door':
        sfx.door();
        break;
      case 'ding':
        sfx.ding();
        break;
      case 'paid':
        sfx.cash();
        this._floatAt(e.table, `+${euro(e.total + e.tip)}`, C.accent);
        break;
      case 'served':
        sfx.pop();
        break;
      case 'game':
        sfx.ok();
        this.toast(`${e.table} got ${e.name}`, C.accent);
        break;
      case 'walkout':
        sfx.sad();
        this.game.input.rumble(0.6, 0.4, 250);
        this.toast(e.text, C.red);
        break;
      case 'terrace':
        sfx.fanfare();
        this.toast('14:00: the rooftop terrace is open! Tap Dakterras to go up.', C.gold);
        break;
      case 'info':
        this.toast(e.text, C.dim);
        break;
      default:
        break;
    }
  }

  _floatAt(tid, text, color) {
    const t = this.sim.table(tid);
    if (!t) return;
    this.game.gui.floatWorld(text, new THREE.Vector3(t.x, (t.level ? this.L.terrace.y : 0) + 1.4, t.z), color);
  }

  _finish() {
    if (this.done) return;
    this.done = true;
    const g = this.game;
    const s = this.sim.stats;
    const score = this.sim.score();
    const stars = this.sim.starsFor(score);
    const best = g.save.best.server;
    const newBest = score > best;
    if (newBest) g.save.best.server = score;
    g.save.stars.server = Math.max(g.save.stars.server, stars);
    g.persist();
    g.setScreen('results', {
      mode: 'server', title: 'Shift over!', subtitle: 'Bediening · 12:00 to 01:00', score, stars,
      best: newBest ? score : best, newBest, vrAnchor: this.vrAnchor(),
      lines: [
        ['Groups served', s.groupsServed], ['Items served', s.itemsServed], ['Revenue', euro(s.revenue)],
        ['Tips', euro(s.tips), C.gold], ['Board games brought', s.gamesBrought, C.accent],
        ['Walk-outs', s.walkouts, s.walkouts ? C.red : null],
      ],
    });
  }

  // ---------------------------------------------------------------- drawing
  _targets(gui) {
    // Clickable / focusable regions over 3D things, so touch, mouse and gamepad share one path.
    const sim = this.sim;
    const proj = (x, y, z) => this.world.project(this.v3.set(x, y, z));
    const S = gui.S;
    const r = 34 * S;
    const add = (id, p, onClick) => {
      if (!p.visible || p.x < 0 || p.y < 0 || p.x > gui.w || p.y > gui.h) return;
      gui.region(p.x - r, p.y - r, r * 2, r * 2, onClick, { id, focusable: true, r: r });
    };
    for (const t of sim.tables) {
      if (t.level !== this.level) continue;
      const y = (t.level ? this.L.terrace.y : 0) + 0.8;
      add(`T${t.id}`, proj(t.x, y, t.z), () => this._tapTable(t.id));
    }
    if (this.level === 0) {
      const [px, pz] = this.L.pass;
      add('pass', proj(px, 1.2, pz - 0.4), () => this._tapPass());
      const [hx, hz] = this.L.host;
      add('host', proj(hx, 1.0, hz), () => this._tapHost());
      const s = this.L.gameShelf;
      add('shelf', proj(6.6, 1.2, (s.minZ + s.maxZ) / 2), () => this._result(this.sim.tapShelf()));
    }
  }

  draw(gui) {
    const S = gui.S;
    const sim = this.sim;
    if (!this.game.xr?.active) this._targets(gui);
    topBar(gui, [
      { label: 'TIJD', value: clockText(sim.hour) },
      { label: 'OMZET', value: euro(sim.stats.revenue, 0), color: C.accent },
      { label: 'FOOI', value: euro(sim.stats.tips, 0), color: C.gold },
      { label: 'WEGGELOPEN', value: sim.stats.walkouts, color: sim.stats.walkouts ? C.red : C.dim, w: 96 },
      { label: 'KEUKEN', value: sim.kitchenOpen ? 'open' : 'dicht', color: sim.kitchenOpen ? C.accent : C.dim, w: 80 },
    ], { right: { w: 52 * S, label: '', icon: 'pause', onClick: () => this.onPause() } });
    // bottom: level switch + task list
    const bh = 50 * S;
    const by = gui.h - gui.safe.bottom - bh - 10 * S;
    const lx = gui.safe.left + 10 * S;
    const terraceNeeds = sim.tables.filter((t) => t.level === 1 && (t.state === 'dirty' || (t.group &&
      ['ready', 'wantsBill'].includes(sim.groups.find((g) => g.id === t.group)?.state)))).length;
    gui.button(lx, by, 150 * S, bh, this.level === 0 ? 'Dakterras' : 'Beneden', () => this.setLevel(1 - this.level), {
      icon: 'stairs', size: 15 * S, kind: 'gold', badge: this.level === 0 && terraceNeeds ? terraceNeeds : null,
      disabled: !sim.terraceOpen && this.level === 0, id: 'level' });
    let x = lx + 160 * S;
    const w = sim.waiter;
    const tasks = [w.action, ...w.queue].filter(Boolean);
    const maxX = gui.w - gui.safe.right - 10 * S - 110 * S;
    tasks.forEach((a, i) => {
      const label = `${i === 0 ? '▶ ' : `${i}. `}${TASK_LABEL[a.type] || a.type}${a.table ? ` ${a.table}` : ''}`;
      const tw = gui.measure(label, 13 * S, 800) + 22 * S;
      if (x + tw > maxX) return;
      gui.box(x, by + 8 * S, tw, bh - 16 * S, { r: 12, fill: i === 0 ? C.accent : 'rgba(10,20,14,0.85)', stroke: C.line });
      gui.text(label, x + tw / 2, by + bh / 2 + 5 * S, 13 * S, { align: 'center', weight: 800, color: i === 0 ? C.dark : C.text });
      x += tw + 6 * S;
    });
    if (tasks.length > 1) {
      gui.button(gui.w - gui.safe.right - 110 * S, by, 100 * S, bh, 'Wis lijst', () => sim.cancelQueue(), { kind: 'ghost',
        size: 13 * S, id: 'clearq' });
    }
    // tray summary
    if (w.carry.length || w.game) {
      const items = w.carry.map((c) => `${sim.menu.find((m) => m.id === c.item)?.name} → ${c.table}`);
      if (w.game) items.push('Board game');
      const tw = Math.min(gui.w - 20 * S, 300 * S);
      const ty = by - 12 * S - items.length * 20 * S - 14 * S;
      gui.box(lx, ty, tw, items.length * 20 * S + 12 * S, { r: 12, fill: 'rgba(10,20,14,0.85)', stroke: C.line });
      items.forEach((s, i) => gui.text(s, lx + 12 * S, ty + 22 * S + i * 20 * S, 13 * S, { weight: 700, max: tw - 24 * S }));
    }
    if (sim.selectedGroup) {
      const g = sim.groups.find((x) => x.id === sim.selectedGroup);
      if (g) {
        const t = `Seat the group of ${g.size}: tap a free table`;
        const tw = gui.measure(t, 15 * S, 800) + 40 * S;
        gui.box(gui.w / 2 - tw / 2, gui.safe.top + 66 * S, tw, 38 * S, { r: 19, fill: C.blue, stroke: null });
        gui.text(t, gui.w / 2, gui.safe.top + 90 * S, 15 * S, { align: 'center', weight: 800, color: C.dark });
      }
    }
    this.drawModal(gui);
    this.drawPause(gui);
  }
}
