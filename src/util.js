// Small shared helpers. Nothing here touches the DOM or three.js so the sims can run in Node tests.
import { getLang } from './i18n.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
// Frame-rate independent smoothing: move `a` toward `b` with half-life `h` seconds.
export const damp = (a, b, h, dt) => b + (a - b) * Math.pow(2, -dt / Math.max(1e-4, h));

export function rng(seed = Date.now()) {
  // mulberry32
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (a, b) => a + (b - a) * next();
  next.int = (a, b) => Math.floor(a + (b - a + 1) * next());
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.chance = (p) => next() < p;
  next.weighted = (pairs) => {
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let r = next() * total;
    for (const [v, w] of pairs) {
      if ((r -= w) <= 0) return v;
    }
    return pairs[pairs.length - 1][0];
  };
  return next;
}

// Money in the player's language: €1.234,50 (nl, de) or €1,234.50 (en).
export function euro(n, decimals = 2) {
  const neg = n < 0;
  const en = getLang() === 'en';
  const [i, d] = Math.abs(n).toFixed(decimals).split('.');
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, en ? ',' : '.');
  return `${neg ? '-' : ''}€${grouped}${d !== undefined ? (en ? '.' : ',') + d : ''}`;
}

/** Whole number with the language's thousands separator: 12.340 (nl, de) or 12,340 (en). */
export function num(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, getLang() === 'en' ? ',' : '.');
}

// Game clock: hours as a float, 25.5 = 01:30 the next night.
export function clockText(h) {
  const hh = Math.floor(h) % 24;
  const mm = Math.floor((h % 1) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** 24-07-2026 (nl), 24.07.2026 (de), 24/07/2026 (en). */
export function dateText(d) {
  const sep = { nl: '-', de: '.', en: '/' }[getLang()] || '-';
  return [String(d.getDate()).padStart(2, '0'), String(d.getMonth() + 1).padStart(2, '0'), d.getFullYear()].join(sep);
}

export function ageOn(birth, today) {
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

export const round2 = (n) => Math.round(n * 100) / 100;

// Random look for a person (used by every mode and by the ID card portrait).
const SKIN = ['#f3d2b8', '#f1c7a3', '#e0ac84', '#c68a5e', '#b07a55', '#8a5a3c', '#6b4429'];
const HAIR = ['#151010', '#3a2618', '#6b3a1e', '#a0522d', '#d9b46a', '#e8d5a0', '#7a7a7a', '#b03a2e'];
const SHIRT = ['#3f7a52', '#d9772b', '#efe6cf', '#b8322f', '#6b3f8f', '#2f5b8f', '#e9b434', '#1e1e20', '#5b7f8f',
  '#c75b7a', '#8f9a3f', '#ffffff', '#2d2d4a'];
const PANTS = ['#2d3a52', '#3b3b3b', '#4a5d7a', '#2a2a2a', '#5a4a3a', '#c9b38f', '#3f4a3a', '#6b6b6b'];
const HAT = ['#b8322f', '#2f5b8f', '#1d4a2f', '#e9b434', '#1e1e20', '#d9772b'];
const JACKET = ['#2a2f3a', '#5a3a2a', '#1e1e20', '#3f4a3a', '#7a2a2a', '#c9b38f', '#2f4a6b'];
export const HAIR_STYLES = ['hair_short', 'hair_long', 'hair_bun', 'hair_curly', 'hair_pony', 'hair_buzz', 'hat_beanie',
  'hat_cap', 'none'];

export function randomLook(r) {
  const style = r.weighted([['hair_short', 4], ['hair_long', 3], ['hair_bun', 1.5], ['hair_curly', 2], ['hair_pony', 1.5],
    ['hair_buzz', 1.5], ['hat_beanie', 1.5], ['hat_cap', 1.5], ['none', 0.4]]);
  return {
    top: r.weighted([['tee', 4], ['longsleeve', 2], ['hoodie', 2.5], ['jacket', 2]]),
    jacket: r.pick(JACKET),
    skin: r.pick(SKIN),
    hair: r.pick(HAIR),
    shirt: r.pick(SHIRT),
    pants: r.pick(PANTS),
    shoes: r.pick(['#e8e4dc', '#1e1e20', '#8a5a3c', '#c0392b', '#efefef']),
    hat: r.pick(HAT),
    style,
    glasses: r.chance(0.22),
    beard: r.chance(0.18),
    height: r.range(0.92, 1.06),
    width: r.range(0.92, 1.12),
  };
}

export function staffLook(r) {
  const look = randomLook(r);
  look.apron = true;
  look.top = r.chance(0.6) ? 'tee' : 'longsleeve';
  look.shirt = r.pick(['#efe6cf', '#1e1e20', '#ffffff', '#3f4a3a']);
  return look;
}
