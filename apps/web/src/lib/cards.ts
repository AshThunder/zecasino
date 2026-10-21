/** Card index 0..51 ⇄ asset code. Matches the fairness crate: rank = c % 13, suit = c / 13. */
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const SUITS = ["C", "D", "H", "S"];
export const code = (c: number) => RANKS[c % 13] + SUITS[Math.floor(c / 13) % 4];
export const bjValue = (cards: number[]) => {
  let t = 0, aces = 0;
  for (const c of cards) { const r = c % 13; if (r === 0) { aces++; t += 11; } else t += Math.min(10, r + 1); }
  while (t > 21 && aces) { t -= 10; aces--; }
  return { total: t, soft: aces > 0 };
};
export function localShoe(decks = 6) {
  const v = Array.from({ length: decks * 52 }, (_, i) => i % 52);
  const r = new Uint32Array(v.length); crypto.getRandomValues(r);
  for (let i = v.length - 1; i > 0; i--) { const j = r[i] % (i + 1); [v[i], v[j]] = [v[j], v[i]]; }
  return v;
}
