// Tiny translation layer. Every visible string goes through t(); gamedata names go through td().
// Pure module (no DOM) so the sims and the Node tests can use it too.
import nl from './lang/nl.js';
import en from './lang/en.js';
import de from './lang/de.js';

export const LANGS = [
  { id: 'nl', name: 'Nederlands', short: 'NL' },
  { id: 'en', name: 'English', short: 'EN' },
  { id: 'de', name: 'Deutsch', short: 'DE' },
];

const DICT = { nl, en, de };
let cur = 'en';

export function setLang(id) {
  if (DICT[id]) cur = id;
  if (typeof document !== 'undefined') document.documentElement.lang = cur;
  return cur;
}

export function getLang() {
  return cur;
}

/** First supported language from a list like navigator.languages; English otherwise. */
export function detectLang(list = []) {
  for (const l of list) {
    const k = String(l).slice(0, 2).toLowerCase();
    if (DICT[k]) return k;
  }
  return 'en';
}

/** Translate a key. {name} placeholders are filled from vars. Falls back to English, then the key itself. */
export function t(key, vars = null) {
  let s = DICT[cur][key] ?? DICT.en[key];
  if (s === undefined) return key;
  if (Array.isArray(s) || !vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** A list from the dictionary (customer lines, month names...). */
export function tl(key) {
  const v = t(key);
  return Array.isArray(v) ? v : [v];
}

/** Localised field of a gamedata entry (item, upgrade, staff member, event); the data file is the fallback. */
export function td(kind, item, field = 'name') {
  if (!item) return '';
  const k = `${kind}.${item.id}.${field}`;
  return DICT[cur][k] ?? DICT.en[k] ?? item[field];
}

export const dictionaries = DICT;
