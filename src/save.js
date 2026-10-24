// Local save (high scores, settings, tycoon progress). Storage can be unavailable (private mode,
// blocked site data), so every access is wrapped and the game keeps working from memory.
const KEY = 'kronkel-save-v2';

const DEFAULTS = {
  ageOk: false,
  settings: { music: 0.5, sfx: 0.8, quality: 'auto', haptics: true, lang: null },
  best: { cashier: 0, bar: 0 },
  stars: { cashier: 0, bar: 0 },
  seenHowto: {},
};

let mem = null;

export function loadSave() {
  if (mem) return mem;
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    data = null;
  }
  mem = merge(structuredClone(DEFAULTS), data || {});
  return mem;
}

export function writeSave() {
  try {
    localStorage.setItem(KEY, JSON.stringify(mem));
  } catch {
    /* storage blocked: keep playing from memory */
  }
}

export function resetSave() {
  const keepAge = mem?.ageOk;
  const keepSettings = mem?.settings;
  mem = structuredClone(DEFAULTS);
  mem.ageOk = !!keepAge;
  if (keepSettings) mem.settings = keepSettings; // "Settings stay"
  writeSave();
  return mem;
}

function merge(base, extra) {
  for (const [k, v] of Object.entries(extra)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      merge(base[k], v);
    } else {
      base[k] = v;
    }
  }
  return base;
}
