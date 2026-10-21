"use client";
const FILES = {
  chip: ["chip-lay-1", "chip-lay-2"], stack: ["chips-stack-1"], collide: ["chips-collide-1"], handle: ["chips-handle-1"],
  card: ["card-place-1"], slide: ["card-slide-1", "card-slide-3"], shuffle: ["card-shuffle"], fan: ["card-fan-1"],
  shake: ["dice-shake-1"], throw: ["dice-throw-1"], die: ["die-throw-1"],
} as const;
export type Sfx = keyof typeof FILES;
let muted = false;
const cache = new Map<string, HTMLAudioElement>();
export function setMuted(m: boolean) { muted = m; }
export function isMuted() { return muted; }
export function play(name: Sfx, volume = 0.6) {
  if (muted || typeof window === "undefined") return;
  const list = FILES[name];
  const f = list[Math.floor(Math.random() * list.length)];
  let base = cache.get(f);
  if (!base) { base = new Audio(`/assets/sfx/${f}.mp3`); cache.set(f, base); }
  const a = base.cloneNode(true) as HTMLAudioElement;
  a.volume = volume; a.play().catch(() => {});
}
/** Roulette ball: synthesised rolling ticks that slow down (no sample needed). */
export function ballRoll(durationS: number) {
  if (muted || typeof window === "undefined") return;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx(); let t = ctx.currentTime; let gap = 0.035;
  while (t < ctx.currentTime + durationS) {
    const buf = ctx.createBuffer(1, 400, ctx.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / 60);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = 0.18; const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 3200;
    src.connect(f).connect(g).connect(ctx.destination); src.start(t);
    t += gap; gap *= 1.045;
  }
  setTimeout(() => ctx.close(), (durationS + 1) * 1000);
}
