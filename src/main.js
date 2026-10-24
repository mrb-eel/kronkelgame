import { World, detectQuality } from './world.js';
import { Gui } from './gui.js';
import { Input } from './input.js';
import { XR } from './xr.js';
import { loadSave, writeSave } from './save.js';
import * as audio from './audio.js';
import { clamp } from './util.js';
import { setLang, detectLang, t } from './i18n.js';
import { AgeScreen, TitleScreen } from './screens/title.js';
import { HowtoScreen, SettingsScreen, CreditsScreen } from './screens/menus.js';
import { CashierScreen } from './screens/cashier.js';
import { ServerScreen } from './screens/server.js';
import { TycoonScreen } from './screens/tycoon.js';
import { ResultsScreen } from './screens/results.js';

const SCREENS = {
  age: AgeScreen,
  title: TitleScreen,
  howto: HowtoScreen,
  settings: SettingsScreen,
  credits: CreditsScreen,
  cashier: CashierScreen,
  server: ServerScreen,
  tycoon: TycoonScreen,
  results: ResultsScreen,
};

class Game {
  constructor() {
    this.gl = document.getElementById('gl');
    this.ui = document.getElementById('ui');
    this.screen = null;
    this.Screens = SCREENS;
    this.last = performance.now();
    this.fps = 60;
    this.musicStarted = false;
  }

  async boot() {
    const [layout, data] = await Promise.all([
      fetch('assets/layout.json').then((r) => r.json()),
      fetch('assets/gamedata.json').then((r) => r.json()),
    ]);
    this.layout = layout;
    this.data = data;
    this.logo = new Image();
    this.logo.src = 'assets/images/kronkel-logo.png';
    this.save = loadSave();
    setLang(this.save.settings.lang || detectLang(navigator.languages || [navigator.language]));
    audio.setVolumes(this.save.settings);
    const urlQ = new URLSearchParams(location.search).get('q');
    const q = urlQ || (this.save.settings.quality === 'auto' ? detectQuality() : this.save.settings.quality);
    this.world = new World(this.gl, layout, q);
    this.gui = new Gui(this.ui);
    this.gui.logo = this.logo;
    this.input = new Input(this, this.ui);
    this.gui.onClickSound = () => audio.sfx.click();
    this.gui.project = (p) => this.world.project(p);
    this.gui.onWorldClick = (x, y) => this.screen?.onWorldPick?.(this.world.pickScreen(x, y), x, y);
    this.gui.onWorldDrag = (dx, dy) => this.screen?.onDrag?.(dx, dy);
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
    this.resize();
    try {
      await Promise.all(['16px "Archivo Black"', '800 16px "Barlow Condensed"', '700 16px "Barlow Condensed"',
        '500 16px Barlow', '700 16px Barlow'].map((f) => document.fonts.load(f)));
    } catch {
      /* system font fallback */
    }
    const tiles = [...document.querySelectorAll('#boottiles span')];
    await this.world.load((p) => {
      tiles.forEach((t, i) => t.classList.toggle('on', i < Math.ceil(p * tiles.length)));
    });
    this.xr = new XR(this);
    this.xrSupported = await this.xr.supported();
    document.getElementById('boot').classList.add('hide');
    this.setScreen(this.save.ageOk ? 'title' : 'age');
    this.world.renderer.setAnimationLoop((t, frame) => this.frame(t, frame));
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  resize() {
    const vv = window.visualViewport;
    const w = Math.round(vv?.width || window.innerWidth);
    const h = Math.round(vv?.height || window.innerHeight);
    const dpr = window.devicePixelRatio || 1;
    this.world.resize(w, h, dpr);
    this.gui.resize(w, h, dpr);
    this.gui.safe = readSafeArea();
  }

  /** Switch language for the whole game and remember it. */
  setLang(id) {
    this.save.settings.lang = setLang(id);
    this.persist();
  }

  setScreen(name, params = {}) {
    const S = SCREENS[name];
    if (!S) throw new Error(`Unknown screen ${name}`);
    this.screen?.exit?.();
    this.gui.focusId = null;
    this.screen = new S(this, params);
    this.screenName = name;
    this.screen.enter?.();
    if (this.xr?.active) this.xr.placeForScreen();
  }

  onFirstGesture() {
    if (this.musicStarted) return;
    this.musicStarted = true;
    audio.startMusic();
  }

  persist() {
    writeSave();
  }

  toggleFullscreen() {
    const el = document.documentElement;
    try {
      if (!document.fullscreenElement) el.requestFullscreen?.({ navigationUI: 'hide' });
      else document.exitFullscreen?.();
    } catch {
      /* not allowed */
    }
  }

  frame(t) {
    const now = performance.now();
    const dt = clamp((now - this.last) / 1000, 0, 0.1);
    this.last = now;
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
    const inXR = this.world.renderer.xr.isPresenting;
    this.input.update(dt);
    audio.musicTick();
    this.screen?.update?.(dt);
    this.world.update(dt, inXR);
    if (inXR) this.xr.update(dt);
    this.world.render();
    this.gui.begin(dt);
    if (!inXR) this.screen?.draw?.(this.gui);
    this.gui.end(dt);
  }
}

function readSafeArea() {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);visibility:hidden;pointer-events:none';
  document.body.appendChild(d);
  const s = getComputedStyle(d);
  const out = {
    top: parseFloat(s.paddingTop) || 0,
    right: parseFloat(s.paddingRight) || 0,
    bottom: parseFloat(s.paddingBottom) || 0,
    left: parseFloat(s.paddingLeft) || 0,
  };
  d.remove();
  return out;
}

const game = new Game();
window.kronkel = game; // handy for debugging and automated tests
game.boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('booterr');
  if (el) el.textContent = t('boot.error', { msg: err.message });
});
