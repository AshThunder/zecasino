/** 7-card Texas Hold'em evaluator (best 5 of 7). Cards are 0..51, rank = c % 13 (A=0). */
const NAMES = ["High card", "Pair", "Two pair", "Three of a kind", "Straight", "Flush", "Full house", "Four of a kind", "Straight flush"];
const rv = (c: number) => (c % 13 === 0 ? 14 : (c % 13) + 1);
function score5(cs: number[]): number[] {
  const r = cs.map(rv).sort((a, b) => b - a);
  const flush = cs.every(c => Math.floor(c / 13) === Math.floor(cs[0] / 13));
  const uniq = [...new Set(r)];
  let straightHigh = 0;
  if (uniq.length === 5 && r[0] - r[4] === 4) straightHigh = r[0];
  if (uniq.length === 5 && r[0] === 14 && r[1] === 5) straightHigh = 5;
  const counts = new Map<number, number>(); r.forEach(x => counts.set(x, (counts.get(x) ?? 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map(g => g[1]).join("");
  const kick = groups.map(g => g[0]);
  if (straightHigh && flush) return [8, straightHigh];
  if (shape === "41") return [7, ...kick];
  if (shape === "32") return [6, ...kick];
  if (flush) return [5, ...r];
  if (straightHigh) return [4, straightHigh];
  if (shape === "311") return [3, ...kick];
  if (shape === "221") return [2, ...kick];
  if (shape === "2111") return [1, ...kick];
  return [0, ...r];
}
const cmp = (a: number[], b: number[]) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d) return d; } return 0; };
export function best(cards: number[]) {
  let top: number[] = [-1];
  const n = cards.length, k = 5;
  const pick = (start: number, acc: number[]) => {
    if (acc.length === k) { const s = score5(acc); if (cmp(s, top) > 0) top = s; return; }
    for (let i = start; i < n; i++) pick(i + 1, [...acc, cards[i]]);
  };
  pick(0, []);
  return { score: top, name: NAMES[top[0]] };
}
export const compareHands = (a: number[], b: number[]) => cmp(best(a).score, best(b).score);
