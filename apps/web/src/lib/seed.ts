"use client";
/** A random client seed per player, generated in the browser (crypto.getRandomValues) and kept in localStorage. */
const KEY = "zc.clientSeed";
const WORDS = ["jade", "ember", "onyx", "coral", "amber", "slate", "ivory", "cobalt", "garnet", "topaz", "opal", "sable"];
export function newSeed() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return `${WORDS[b[0] % WORDS.length]}-${Array.from(b.slice(1), x => x.toString(16).padStart(2, "0")).join("")}`;
}
export function mySeed() {
  try { let s = localStorage.getItem(KEY); if (!s) { s = newSeed(); localStorage.setItem(KEY, s); } return s; } catch { return newSeed(); }
}
export function keepSeed(s: string) { try { localStorage.setItem(KEY, s); } catch { /* */ } }
/** "a18507ef…" → "a185 07ef · 3c21 … f8a8 5b0c" : grouped, head and tail, easy to compare by eye. */
export function readable(h: string) {
  if (!h || h.length < 16 || h === "…") return h;
  const g = (s: string) => s.match(/.{1,4}/g)!.join(" ");
  return `${g(h.slice(0, 12))} … ${g(h.slice(-8))}`;
}
