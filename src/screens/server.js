import * as THREE from 'three';
import { C } from '../gui.js';
import { BaseScreen, hud, receipt } from './common.js';
import { ServerSim } from '../sim/server.js';
import { Crowd } from '../sim/crowd.js';
import { clamp, clockText, euro, rng } from '../util.js';
import { sfx } from '../audio.js';
import { t as tr } from '../i18n.js';


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
      this.toast(r.reason, C.paper);
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
    if (r.ok) this.toast(tr('srv.groupPick', { n: r.group.size }), C.yellow);
  }

  update(dt) {
    const sim = this.sim;
    this.mascot.update(dt);
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
        this._floatAt(e.table, `+${euro(e.total + e.tip)}`, C.yellow);
        this.mascot.react('good');
        break;
      case 'served':
        sfx.pop();
        break;
      case 'game':
        sfx.ok();
        this.toast(tr('srv.gotGame', { table: e.table, name: e.name }), C.yellow);
        break;
      case 'walkout':
        sfx.sad();
        this.game.input.rumble(0.6, 0.4, 250);
        this.toast(e.text, C.red);
        break;
      case 'terrace':
        sfx.fanfare();
        this.toast(tr('srv.terrace'), C.yellow);
        break;
      case 'info':
        this.toast(e.text, C.paper);
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
      mode: 'server', title: tr('res.receipt'), subtitle: tr('res.serverSub'), score, stars,
      best: newBest ? score : best, newBest, vrAnchor: this.vrAnchor(),
      lines: [
        [tr('res.groups'), s.groupsServed], [tr('res.items'), s.itemsServed], [tr('res.revenue'), euro(s.revenue)],
        [tr('res.tips'), euro(s.tips)], [tr('res.games'), s.gamesBrought], [tr('res.walkouts'), s.walkouts],
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
    hud(gui, this, [
      { label: tr('hud.time'), value: clockText(sim.hour) },
      { label: tr('hud.revenue'), value: euro(sim.stats.revenue, 0) },
      { label: tr('hud.tips'), value: euro(sim.stats.tips, 0) },
      { label: tr('hud.walkouts'), value: sim.stats.walkouts, color: sim.stats.walkouts ? C.red : C.ink, w: 98 },
      { label: tr('hud.kitchen'), value: tr(sim.kitchenOpen ? 'hud.open' : 'hud.closed'), color: sim.kitchenOpen ? C.ink : C.red, w: 84 },
    ], { onPause: () => this.onPause() });
    const bh = 58 * S;
    const by = gui.h - gui.safe.bottom - bh - 12 * S;
    const lx = gui.safe.left + 12 * S;
    const terraceNeeds = sim.tables.filter((t) => t.level === 1 && (t.state === 'dirty' || (t.group &&
      ['ready', 'wantsBill'].includes(sim.groups.find((g) => g.id === t.group)?.state)))).length;
    gui.button(lx, by, 168 * S, bh, tr(this.level === 0 ? 'srv.up' : 'srv.down'), () => this.setLevel(1 - this.level), {
      icon: 'stairs', size: 19 * S, kind: 'yellow', badge: this.level === 0 && terraceNeeds ? terraceNeeds : null,
      disabled: !sim.terraceOpen && this.level === 0, id: 'level', tilt: -0.02 });
    // the waiter's to-do list as order tickets
    let x = lx + 184 * S;
    const w = sim.waiter;
    const tasks = [w.action, ...w.queue].filter(Boolean);
    const maxX = gui.w - gui.safe.right - 12 * S - 120 * S;
    tasks.forEach((a, i) => {
      const label = `${tr(`task.${a.type}`)}${a.table ? ` ${a.table}` : ''}`;
      const tw = Math.max(70 * S, gui.measure(label, 16 * S, 'label') + 26 * S);
      if (x + tw > maxX) return;
      const now = i === 0;
      const ty = by + (now ? -6 : 4) * S;
      gui.tilted(x + tw / 2, ty + bh / 2, i % 2 ? 0.04 : -0.03, () => {
        receipt(gui, x, ty, tw, bh - 6 * S, { tilt: 0 });
        gui.text(now ? tr('srv.now') : `#${i}`, x + 10 * S, ty + 18 * S, 12 * S, { font: 'label', color: now ? C.red : C.grey });
        gui.text(label, x + 10 * S, ty + 40 * S, 16 * S, { font: 'label', color: C.ink, upper: true, max: tw - 16 * S });
      });
      x += tw + 8 * S;
    });
    if (tasks.length > 1) {
      gui.button(gui.w - gui.safe.right - 12 * S - 110 * S, by + 6 * S, 110 * S, bh - 12 * S, tr('srv.clearList'),
        () => sim.cancelQueue(), { kind: 'ink', size: 16 * S, id: 'clearq' });
    }
    // what's on the tray
    if (w.carry.length || w.game) {
      const items = w.carry.map((c) => [sim.menu.find((m) => m.id === c.item)?.name, c.table]);
      if (w.game) items.push([tr('srv.gameItem'), '']);
      const tw = Math.min(gui.w - 24 * S, 290 * S);
      const th = 40 * S + items.length * 24 * S;
      const ty = by - th - 18 * S;
      receipt(gui, lx, ty, tw, th, { tilt: -0.01 });
      gui.text(tr('srv.tray'), lx + 12 * S, ty + 22 * S, 14 * S, { font: 'label', color: C.red });
      items.forEach(([name, table], i) => {
        gui.text(String(name).toUpperCase(), lx + 12 * S, ty + 46 * S + i * 24 * S, 15 * S, { font: 'label', color: C.ink,
          max: tw - 70 * S });
        gui.text(table, lx + tw - 12 * S, ty + 46 * S + i * 24 * S, 15 * S, { font: 'display', color: C.red, align: 'right' });
      });
    }
    if (sim.selectedGroup) {
      const g = sim.groups.find((x2) => x2.id === sim.selectedGroup);
      if (g) {
        gui.tape(tr('srv.groupTape', { n: g.size }), gui.w / 2, gui.safe.top + 90 * S,
          { size: 19 * S, color: C.yellow, tilt: -0.015 });
        gui.toastShift = 48;
      }
    }
    this.drawModal(gui);
    this.drawPause(gui);
  }
}
