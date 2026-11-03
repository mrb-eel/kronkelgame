import { C } from '../gui.js';
import { BaseScreen } from './common.js';
import { setVolumes, sfx } from '../audio.js';
import { resetSave } from '../save.js';
import { t, tl, LANGS, getLang } from '../i18n.js';

const HOWTO_TABS = ['kassa', 'controls'];

export class HowtoScreen extends BaseScreen {
  enter() {
    this.tabs = HOWTO_TABS;
    this.tab = HOWTO_TABS.includes(this.params.tab) ? this.params.tab : 'kassa';
  }

  onBack() {
    this._back();
  }

  _back() {
    const p = this.params;
    if (p.onClose) p.onClose();
    else this.game.setScreen(p.back || 'title');
  }

  onTab(d) {
    const i = (this.tabs.indexOf(this.tab) + d + this.tabs.length) % this.tabs.length;
    this.tab = this.tabs[i];
  }

  draw(gui) {
    const S = gui.S;
    gui.dim(0.72);
    const w = Math.min(gui.w - 24 * S, 780 * S);
    const h = Math.min(gui.h - gui.safe.top - gui.safe.bottom - 40 * S, 620 * S);
    const x = (gui.w - w) / 2;
    const y = Math.max(gui.safe.top + 26 * S, (gui.h - h) / 2);
    gui.card(x, y, w, h, { tone: 'paper', label: t('btn.howto'), labelColor: C.red, labelText: C.paper });
    gui.button(x + w - 118 * S, y + 16 * S, 100 * S, 40 * S, t('btn.back'), () => this._back(), { kind: 'ink', icon: 'back',
      size: 16 * S });
    const px = x + 20 * S;
    const pw = w - 40 * S;
    const tw = (pw - 10 * S * 3) / 4;
    this.tabs.forEach((id, i) => {
      gui.button(px + i * (tw + 10 * S), y + 70 * S, tw, 42 * S, t(`howto.tab.${id}`), () => { this.tab = id; },
        { selected: this.tab === id, size: 16 * S, id: `howto-${id}`, kind: 'paper' });
    });
    let ty = y + 140 * S;
    gui.text(t(`howto.${this.tab}.title`), px, ty, 22 * S, { font: 'display', color: C.ink, max: pw });
    ty += 8 * S;
    const size = (gui.portrait ? 14.5 : 16) * S;
    tl(`howto.${this.tab}.body`).forEach((para, i) => {
      if (ty > y + h - 40 * S) return;
      gui.text(`${i + 1}`, px + 9 * S, ty + size * 1.05, size, { font: 'display', color: C.red, align: 'center' });
      ty += gui.paragraph(para, px + 28 * S, ty, pw - 28 * S, size, { color: C.ink, weight: 500 }) + 10 * S;
    });
  }
}

export class SettingsScreen extends BaseScreen {
  onBack() {
    this.game.setScreen('title');
  }

  draw(gui) {
    const S = gui.S;
    const g = this.game;
    const st = g.save.settings;
    gui.dim(0.72);
    const w = Math.min(gui.w - 24 * S, 520 * S);
    const h = Math.min(gui.h - 40 * S, 540 * S);
    const x = (gui.w - w) / 2;
    const y = (gui.h - h) / 2;
    gui.card(x, y, w, h, { tone: 'paper', label: t('btn.settings'), labelColor: C.ink, labelText: C.yellow });
    gui.button(x + w - 118 * S, y + 16 * S, 100 * S, 40 * S, t('btn.back'), () => this.onBack(), { kind: 'ink', icon: 'back',
      size: 16 * S });
    const px = x + 22 * S;
    const pw = w - 44 * S;
    let ry = y + 72 * S;
    const row = (label, value, onMinus, onPlus, id) => {
      gui.text(label, px, ry + 29 * S, 20 * S, { font: 'label', color: C.ink, upper: true });
      const bw = 46 * S;
      const vx = px + pw - bw * 2 - 104 * S;
      gui.button(vx, ry + 4 * S, bw, 42 * S, '', onMinus, { icon: 'minus', id: `${id}-`, kind: 'ink' });
      gui.text(value, vx + bw + 52 * S, ry + 33 * S, 19 * S, { align: 'center', font: 'display', color: C.red });
      gui.button(vx + bw + 104 * S, ry + 4 * S, bw, 42 * S, '', onPlus, { icon: 'plus', id: `${id}+`, kind: 'ink' });
      ry += 60 * S;
    };
    const vol = (k, d) => {
      st[k] = Math.round(Math.min(1, Math.max(0, st[k] + d)) * 10) / 10;
      setVolumes(st);
      g.persist();
      sfx.click();
    };
    // language: three stickers in a row
    gui.text(t('lang.label'), px, ry + 29 * S, 20 * S, { font: 'label', color: C.ink, upper: true });
    const lw = Math.min(118 * S, (pw - 120 * S - 16 * S) / 3);
    LANGS.forEach((l, i) => {
      gui.button(px + pw - (3 - i) * lw - (2 - i) * 8 * S, ry + 4 * S, lw, 42 * S, l.name, () => g.setLang(l.id),
        { kind: 'ink', selected: getLang() === l.id, size: 15 * S, id: `set-lang-${l.id}` });
    });
    ry += 60 * S;
    row(t('set.music'), `${Math.round(st.music * 100)}%`, () => vol('music', -0.1), () => vol('music', 0.1), 'music');
    row(t('set.sfx'), `${Math.round(st.sfx * 100)}%`, () => vol('sfx', -0.1), () => vol('sfx', 0.1), 'sfx');
    const qs = ['auto', 'low', 'medium', 'high'];
    const cycle = (d) => {
      st.quality = qs[(qs.indexOf(st.quality) + d + qs.length) % qs.length];
      g.persist();
      this.toast(t('set.reload'), C.yellow);
    };
    row(t('set.graphics'), t(`set.q.${st.quality}`), () => cycle(-1), () => cycle(1), 'quality');
    row(t('set.haptics'), t(st.haptics ? 'on' : 'off'), () => { st.haptics = !st.haptics; g.persist(); },
      () => { st.haptics = !st.haptics; g.persist(); }, 'haptics');
    ry += 6 * S;
    const bw = (pw - 12 * S) / 2;
    gui.button(px, ry, bw, 50 * S, t('set.fullscreen'), () => g.toggleFullscreen(), { size: 17 * S, kind: 'yellow' });
    gui.button(px + bw + 12 * S, ry, bw, 50 * S, t('set.reset'), () => {
      this.modal = {
        title: t('set.resetTitle'), color: C.red,
        text: t('set.resetText'),
        buttons: [{ label: t('btn.no') }, { label: t('set.erase'), kind: 'red', onClick: () => {
          g.save = resetSave();
          this.toast(t('set.resetDone'), C.yellow);
        } }],
      };
    }, { kind: 'red', size: 17 * S });
    gui.text(`${Math.round(g.fps)} fps · ${t(`set.q.${g.world.quality}`)} · ${t(g.xrSupported ? 'set.vrReady' : 'set.noVr')}`,
      px, y + h - 18 * S, 14 * S, { font: 'label', color: C.grey, weight: 700 });
    this.drawModal(gui);
  }
}

export class CreditsScreen extends BaseScreen {
  onBack() {
    this.game.setScreen('title');
  }

  draw(gui) {
    const S = gui.S;
    gui.dim(0.72);
    const w = Math.min(gui.w - 24 * S, 640 * S);
    const h = Math.min(gui.h - 40 * S, 560 * S);
    const x = (gui.w - w) / 2;
    const y = (gui.h - h) / 2;
    gui.card(x, y, w, h, { tone: 'paper', label: t('about.title'), labelColor: C.red, labelText: C.paper });
    gui.button(x + w - 118 * S, y + 16 * S, 100 * S, 40 * S, t('btn.back'), () => this.onBack(), { kind: 'ink', icon: 'back',
      size: 16 * S });
    gui.image(gui.logo, x + w - 120 * S, y + h - 130 * S, 100 * S, 100 * S, 0.12);
    let ty = y + 66 * S;
    const paras = tl('about.body');
    for (const para of paras) ty += gui.paragraph(para, x + 22 * S, ty, w - 160 * S, 15.5 * S, { color: C.ink, weight: 500 }) + 12 * S;
  }
}
