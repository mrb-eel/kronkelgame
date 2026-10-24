import { C } from '../gui.js';
import { BaseScreen, hud, portrait, RECEIPT } from './common.js';
import { BarSim, STATIONS } from '../sim/bar.js';
import { clamp, clockText, euro, rng } from '../util.js';
import { sfx } from '../audio.js';
import { t, tl, td } from '../i18n.js';

// Station label and colour
const STATION_INFO = {
  glass:  { label: () => t('bar.glass'),  color: '#5a8fb8' },
  cup:    { label: () => t('bar.cup'),    color: '#b87a42' },
  fridge: { label: () => t('bar.fridge'), color: '#4a8fa8' },
  coffee: { label: () => t('bar.coffee'), color: '#5c3520' },
  blend:  { label: () => t('bar.blend'),  color: '#7a4ab0' },
  syrup:  { label: () => t('bar.syrup'),  color: '#c0384a' },
  cream:  { label: () => t('bar.cream'),  color: '#d8d0b8' },
};

export class BarScreen extends BaseScreen {
  enter() {
    const g = this.game;
    this.pausable = true;
    this.howtoTab = 'bar';
    this.sim = new BarSim(this.data, { seed: Date.now() % 1e9 });
    this.world.clearPeople();
    this.world.setUpgrades(new Set());
    this.world.setView('bar');
    this.flash = null;   // { station, ok, t }
    this.serveFlash = null; // { id, t }
    this.toasts = [];
    if (!g.save.seenHowto.bar) {
      g.save.seenHowto.bar = true;
      g.persist();
      this.paused = true;
      this.openHowto('bar', true);
    }
  }

  exit() {
    this.world.clearPeople();
  }

  vrAnchor() {
    return { x: 3.8, z: -3.0, yaw: Math.PI, panelY: 1.12, panelDist: 0.7, panelTilt: -0.5, panelScale: 0.95 };
  }

  onTab(d) {
    if (this.overlay) return this.overlay.onTab(d);
    const tickets = this.sim.tickets;
    if (!tickets.length) return;
    const cur = tickets.findIndex((t) => t.id === this.sim.activeId);
    this.sim.selectTicket(tickets[(cur + d + tickets.length) % tickets.length].id);
  }

  onAlt(btn) {
    if (this.paused) return;
    if (btn === 'x') this._tryServe();
  }

  _tapStation(station) {
    const res = this.sim.tapStation(station);
    this.flash = { station, ok: res.ok, t: 0 };
    if (res.ok) sfx.click();
    else sfx.error();
  }

  _tryServe() {
    const t = this.sim.activeTicket;
    if (!t || !t.done) return;
    const res = this.sim.serve(t.id);
    if (res) {
      this.serveFlash = { t: 0 };
      if (res.perfect) sfx.ok();
      else sfx.click();
      if (res.tip > 0) this._toast(`+${euro(res.tip)} tip!`, C.yellow);
    }
  }

  _toast(msg, color = C.paper) {
    this.toasts.push({ msg, color, t: 0 });
  }

  _endShift(closed = false) {
    const g = this.game;
    const sim = this.sim;
    const score = sim.score();
    const stars = closed ? Math.min(1, sim.starsFor(score)) : sim.starsFor(score);
    const best = g.save.best.bar || 0;
    const newBest = score > best;
    if (newBest) g.save.best.bar = score;
    g.save.stars.bar = Math.max(g.save.stars.bar || 0, stars);
    g.persist();
    const r = sim.results();
    g.setScreen('results', {
      title: t('res.bar.title'),
      subtitle: t('res.bar.sub', { n: r.served }),
      closed,
      lines: [
        [t('res.served'), r.served],
        [t('res.perfect'), r.perfect],
        [t('res.mistakes'), r.mistakes],
        [t('res.walkouts'), r.walkouts],
        [t('res.revenue'), euro(r.revenue)],
        [t('res.tips'), euro(r.tips)],
      ],
      score, stars, best: newBest ? score : best, newBest, vrAnchor: this.vrAnchor(),
    });
  }

  update(dt) {
    if (this.paused) return;
    const evs = this.sim.update(dt);
    for (const ev of evs) {
      if (ev.type === 'walkout') { sfx.sad(); this._toast(t('bar.walkout'), C.red); }
      else if (ev.type === 'lastCall') { this._toast(t('bar.lastCall'), C.yellow); sfx.error(); }
      else if (ev.type === 'close') { this._endShift(false); return; }
    }
    if (this.flash) { this.flash.t += dt; if (this.flash.t > 0.35) this.flash = null; }
    if (this.serveFlash) { this.serveFlash.t += dt; if (this.serveFlash.t > 0.5) this.serveFlash = null; }
    this.toasts = this.toasts.filter((t) => (t.t += dt) < 2.8);
  }

  draw(gui) {
    const S = gui.S;
    const sim = this.sim;
    const isPortrait = gui.portrait;

    // HUD
    hud(gui, this.game, this, sim.progress, () => this._endShift(true));

    const safeTop = gui.safe.top + 52 * S;
    const safeBot = gui.safe.bottom + 4 * S;
    const safeLeft = gui.safe.left + 10 * S;
    const safeRight = gui.safe.right + 10 * S;

    // Layout: portrait = tickets top, stations bottom; landscape = tickets left, stations right
    const stationH = isPortrait ? Math.min(gui.h * 0.38, 220 * S) : gui.h - safeTop - safeBot;
    const stationY = isPortrait ? gui.h - safeBot - stationH : safeTop;
    const stationX = isPortrait ? safeLeft : gui.w - safeRight - Math.min(gui.w * 0.48, 340 * S);
    const stationW = isPortrait ? gui.w - safeLeft - safeRight : gui.w - safeRight - stationX;
    const ticketAreaY = safeTop;
    const ticketAreaH = isPortrait ? stationY - ticketAreaY - 8 * S : gui.h - safeTop - safeBot;
    const ticketAreaX = safeLeft;
    const ticketAreaW = isPortrait ? gui.w - safeLeft - safeRight : stationX - safeLeft - 10 * S;

    this._drawTickets(gui, ticketAreaX, ticketAreaY, ticketAreaW, ticketAreaH);
    this._drawStations(gui, stationX, stationY, stationW, stationH);
    this._drawToasts(gui);
  }

  _drawTickets(gui, x, y, w, h) {
    const S = gui.S;
    const sim = this.sim;
    const tickets = sim.tickets;

    if (tickets.length === 0) {
      const msg = sim.over ? t('bar.done') : (sim.lastCall ? t('bar.lastCall') : t('bar.quiet'));
      gui.text(msg, x + w / 2, y + h / 2, 17 * S, { font: 'label', color: 'rgba(245,239,225,0.45)', align: 'center', upper: true });
      return;
    }

    const gap = 8 * S;
    const th = Math.min((h - gap * (tickets.length - 1)) / tickets.length, 130 * S);
    let ty = y + (h - tickets.length * th - gap * (tickets.length - 1)) / 2;
    ty = Math.max(y, ty);

    for (const ticket of tickets) {
      this._drawTicket(gui, x, ty, w, th, ticket);
      ty += th + gap;
    }
  }

  _drawTicket(gui, x, y, w, h, ticket) {
    const S = gui.S;
    const sim = this.sim;
    const active = ticket.id === sim.activeId;
    const pRatio = clamp(ticket.patience / ticket.maxPatience, 0, 1);
    const urgent = pRatio < 0.35;

    // Card
    const tone = active ? 'yellow' : 'paper';
    gui.sticker(x, y, w, h, { fill: active ? C.yellow : C.paper, r: 10, outline: active ? 3 : 1,
      shadow: active ? 5 : 3 });

    // Patience bar along top
    const pb = 6 * S;
    const pColor = urgent ? C.red : pRatio > 0.65 ? '#5cb85c' : '#e8a020';
    gui.ctx.fillStyle = pColor;
    gui.rr(x + 3, y + 3, (w - 6) * pRatio, pb, 4 * S);

    const pad = 10 * S;
    const cx = x + pad;
    // Drink name
    const nameSize = Math.min(16 * S, h * 0.2);
    const name = ticket.item.name;
    gui.text(name, cx, y + pb + nameSize * 0.85 + 6 * S, nameSize, { font: 'display', color: C.ink,
      max: w - pad * 2 - (active ? 60 * S : 0) });

    // Recipe steps — compact checklist
    const stepSize = Math.min(12 * S, h * 0.14);
    const stepGap = stepSize * 1.35;
    const stepsY = y + pb + nameSize + 10 * S;
    const stepsPerRow = Math.floor((w - pad * 2) / (stepSize * 5.5));
    ticket.steps.forEach((step, i) => {
      const done = i < ticket.stepIdx;
      const current = i === ticket.stepIdx && !ticket.done;
      const col = i % stepsPerRow;
      const row = Math.floor(i / stepsPerRow);
      const sx = cx + col * (stepSize * 5.5);
      const sy = stepsY + row * stepGap + stepSize * 0.85;
      const label = STATION_INFO[step]?.label() || step;
      const color = done ? 'rgba(18,16,21,0.35)' : current ? C.red : C.ink;
      const prefix = done ? '✓ ' : current ? '▶ ' : '  ';
      gui.text(prefix + label, sx, sy, stepSize, { font: RECEIPT, weight: done ? 400 : 700, color, max: stepSize * 5.2 });
    });
    if (ticket.done) {
      const sw = 70 * S, sh = 32 * S;
      gui.button(x + w - sw - 8 * S, y + h - sh - 8 * S, sw, sh, t('bar.serve'), () => {
        sim.serve(ticket.id);
        this.serveFlash = { t: 0 };
        sfx.ok();
      }, { kind: 'yellow', size: 14 * S, id: `serve-${ticket.id}` });
    }

    gui.region(x, y, w, h, () => sim.selectTicket(ticket.id), { id: `ticket-${ticket.id}`, focusable: true });
  }

  _drawStations(gui, x, y, w, h) {
    const S = gui.S;
    const sim = this.sim;
    const active = sim.activeTicket;
    const nextStep = active && !active.done ? active.steps[active.stepIdx] : null;
    const cols = 4;
    const rows = 2;
    const gap = 8 * S;
    const bw = (w - gap * (cols - 1)) / cols;
    const bh = (h - gap * (rows - 1)) / rows;
    STATIONS.forEach((station, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const bx = x + col * (bw + gap);
      const by = y + row * (bh + gap);
      const info = STATION_INFO[station];
      const isNext = station === nextStep;
      const isFlash = this.flash?.station === station;
      const flashOk = this.flash?.ok;
      let outline = isNext ? 3 : 1;
      let fill = isNext ? info.color : C.ink;
      let textColor = isNext ? C.paper : C.paper;
      if (isFlash) {
        fill = flashOk ? '#4a9a5a' : C.red;
        outline = 3;
      }
      gui.sticker(bx, by, bw, bh, { fill, r: 10, outline, shadow: isNext ? 4 : 2 });
      const labelText = info.label();
      gui.text(labelText, bx + bw / 2, by + bh / 2 + 7 * S, Math.min(14 * S, bh * 0.26), {
        font: 'label', color: textColor, align: 'center', upper: true });
      gui.region(bx, by, bw, bh, () => this._tapStation(station), { id: `st-${station}`, focusable: true });
    });
  }

  _drawToasts(gui) {
    const S = gui.S;
    const cx = gui.w / 2;
    let ty = gui.safe.top + 62 * S;
    for (const toast of this.toasts) {
      const a = Math.min(1, 2.8 - toast.t) * Math.min(1, toast.t * 4);
      gui.ctx.globalAlpha = a;
      gui.tape(toast.msg, cx, ty, { size: 15 * S, color: toast.color });
      gui.ctx.globalAlpha = 1;
      ty += 28 * S;
    }
  }
}
