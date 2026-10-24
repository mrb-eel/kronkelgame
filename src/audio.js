// All sound is synthesised with WebAudio, so the game ships without audio files.
// iOS Safari only allows audio after a user gesture: unlock() is called from input handlers.

let ctx = null;
let master = null;
let sfxBus = null;
let musicBus = null;
let musicOn = false;
let nextBeat = 0;
let beat = 0;
let noiseBuf = null;
let volumes = { music: 0.5, sfx: 0.8 };

export function setVolumes(v) {
  volumes = { ...volumes, ...v };
  if (sfxBus) sfxBus.gain.value = volumes.sfx;
  if (musicBus) musicBus.gain.value = volumes.music * 0.55;
}

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    sfxBus = ctx.createGain();
    musicBus = ctx.createGain();
    sfxBus.connect(master);
    musicBus.connect(master);
    setVolumes(volumes);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function tone(freq, t0, dur, { type = 'sine', vol = 0.3, attack = 0.005, bus = sfxBus, glide = 0, filter = 0 } = {}) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filter;
    g.connect(f);
    f.connect(bus);
  } else {
    g.connect(bus);
  }
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noise(t0, dur, { vol = 0.2, hp = 0, lp = 0, bus = sfxBus } = {}) {
  if (!ctx) return;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let last = s;
  if (hp) {
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    last.connect(f);
    last = f;
  }
  if (lp) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lp;
    last.connect(f);
    last = f;
  }
  last.connect(g).connect(bus);
  s.start(t0, Math.random() * 0.5);
  s.stop(t0 + dur + 0.05);
}

export const sfx = {
  click() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(900, t, 0.05, { type: 'triangle', vol: 0.12 });
  },
  hover() {
    if (!ctx) return;
    tone(1400, ctx.currentTime, 0.03, { type: 'sine', vol: 0.04 });
  },
  ok() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(660, t, 0.12, { type: 'triangle', vol: 0.18 });
    tone(990, t + 0.08, 0.18, { type: 'triangle', vol: 0.16 });
  },
  error() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(180, t, 0.22, { type: 'square', vol: 0.08, filter: 900 });
    tone(140, t + 0.1, 0.25, { type: 'square', vol: 0.08, filter: 900 });
  },
  cash() {
    if (!ctx) return;
    const t = ctx.currentTime;
    noise(t, 0.08, { vol: 0.25, hp: 2000 });
    tone(2093, t + 0.05, 0.5, { vol: 0.18 });
    tone(2637, t + 0.12, 0.6, { vol: 0.15 });
  },
  coin() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(1800 + Math.random() * 300, t, 0.12, { vol: 0.1 });
    tone(2600, t + 0.03, 0.15, { vol: 0.06 });
  },
  pin() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(1568, t, 0.09, { type: 'square', vol: 0.06, filter: 3000 });
    tone(1568, t + 0.15, 0.09, { type: 'square', vol: 0.06, filter: 3000 });
  },
  door() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(1318, t, 0.9, { vol: 0.08 });
    tone(1046, t + 0.12, 1.0, { vol: 0.07 });
  },
  pop() {
    if (!ctx) return;
    tone(520, ctx.currentTime, 0.1, { type: 'sine', vol: 0.12, glide: 1.8 });
  },
  ding() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(1975, t, 0.6, { vol: 0.12 });
    tone(2960, t, 0.4, { vol: 0.05 });
  },
  whoosh() {
    if (!ctx) return;
    noise(ctx.currentTime, 0.25, { vol: 0.08, lp: 1800 });
  },
  fanfare() {
    if (!ctx) return;
    const t = ctx.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.11, 0.35, { type: 'triangle', vol: 0.14 }));
  },
  sad() {
    if (!ctx) return;
    const t = ctx.currentTime;
    [392, 370, 349, 311].forEach((f, i) => tone(f, t + i * 0.18, 0.3, { type: 'triangle', vol: 0.12 }));
  },
};

// ---------------------------------------------------------------------------
// Lo-fi background loop: Rhodes-ish chords, soft kick/snare, hats and vinyl crackle.
// ---------------------------------------------------------------------------
const CHORDS = [
  [57, 60, 64, 67], // Am7
  [50, 57, 60, 65], // Dm7
  [55, 59, 62, 65], // G7
  [48, 55, 59, 64], // Cmaj7
];
const BPM = 78;
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function startMusic() {
  if (!ctx || musicOn) return;
  musicOn = true;
  nextBeat = ctx.currentTime + 0.1;
  beat = 0;
}

export function stopMusic() {
  musicOn = false;
}

export function musicTick() {
  if (!ctx || !musicOn || volumes.music <= 0) return;
  const spb = 60 / BPM / 2; // eighth notes
  while (nextBeat < ctx.currentTime + 0.25) {
    const t = nextBeat;
    const bar = Math.floor(beat / 8) % 4;
    const step = beat % 8;
    const chord = CHORDS[bar];
    if (step === 0) {
      chord.forEach((m, i) => {
        tone(midi(m), t + i * 0.012, spb * 7.5, { type: 'triangle', vol: 0.05, attack: 0.03, bus: musicBus, filter: 1400 });
        tone(midi(m) * 2.005, t + i * 0.012, spb * 4, { type: 'sine', vol: 0.012, attack: 0.02, bus: musicBus });
      });
      tone(midi(chord[0] - 12), t, spb * 3.5, { type: 'sine', vol: 0.12, attack: 0.01, bus: musicBus });
    }
    if (step === 5) tone(midi(chord[0] - 12), t, spb * 2, { type: 'sine', vol: 0.08, bus: musicBus });
    if (step === 0 || step === 5) tone(110, t, 0.22, { type: 'sine', vol: 0.32, glide: 0.4, bus: musicBus });
    if (step === 4) noise(t, 0.14, { vol: 0.1, hp: 1200, lp: 5000, bus: musicBus });
    if (step % 2 === 1 || Math.random() < 0.2) noise(t + (step % 2 ? 0.02 : 0), 0.04, { vol: 0.035, hp: 7000, bus: musicBus });
    if (step === 3 && Math.random() < 0.5) {
      const m = chord[1 + Math.floor(Math.random() * 3)] + 12;
      tone(midi(m), t, spb * 2, { type: 'sine', vol: 0.03, bus: musicBus });
    }
    if (Math.random() < 0.35) noise(t + Math.random() * spb, 0.01, { vol: 0.03, hp: 3000, bus: musicBus });
    nextBeat += spb * (step % 2 === 0 ? 1.08 : 0.92); // swing
    beat++;
  }
}
