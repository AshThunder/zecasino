/** Mirror of crates/game-server/src/house_bot.rs `liars_move`: the House player's Liar's Dice policy.
 *  Inputs are only the house's own five dice and the standing bid, so after the cups open any browser can
 *  replay every house move and confirm it never depended on the player's dice. `null` = "call liar". */
export function liarsMove(own: number[], bid: { q: number; f: number } | null, total: number): { q: number; f: number } | null {
  const unknown = total - 5;
  const have = (f: number) => own.filter(d => d === f).length;
  const expect = (f: number) => have(f) + unknown / 3;
  let best = 1; for (let f = 1; f <= 6; f++) if (have(f) > have(best) || (have(f) === have(best) && f > best)) best = f;
  if (!bid) return { q: Math.max(1, have(best)), f: best };
  if (bid.q > expect(bid.f) + 1) return null;
  const n = best > bid.f ? { q: bid.q, f: best } : { q: bid.q + 1, f: best };
  return n.q > total || n.q > expect(n.f) + 1 ? null : n;
}

/** Replays the house's moves of one round. `moves` are in table order, `house` marks the house's own. */
export function checkHouseLiars(houseDice: number[], moves: { house: boolean; q?: number; f?: number; call?: boolean }[], total = 10): { ok: boolean; checked: number } {
  let standing: { q: number; f: number } | null = null; let checked = 0;
  for (const m of moves) {
    if (m.house) {
      const want = liarsMove(houseDice, standing, total); checked++;
      if (m.call ? want !== null : !want || want.q !== m.q || want.f !== m.f) return { ok: false, checked };
    }
    if (!m.call) standing = { q: m.q!, f: m.f! };
  }
  return { ok: true, checked };
}
