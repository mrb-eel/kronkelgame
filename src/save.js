// Local save (high scores, settings, tycoon progress). Storage can be unavailable (private mode,
// blocked site data), so every access is wrapped and the game keeps working from memory.
const KEY = 'kronkel-save-v1';

const DEFAULTS = {
  ageOk: false,
  settings: { music: 0.5, sfx: 0.8, quality: 'auto', haptics: true },
  best: { cashier: 0, server: 0 },
  stars: { cashier: 0, server: 0 },
  tycoon: null,
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
  mem = structuredClone(DEFAULTS);
  mem.ageOk = !!keepAge;
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
