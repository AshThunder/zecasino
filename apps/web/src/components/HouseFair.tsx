"use client";
import { ChainSees } from "@/components/ChainSees";
import { useState } from "react";
import { VerifiedRound } from "./Verified";
import { verifyBet, type Game, type Revealed } from "@/lib/house";

type SeatView = { commitment: string; clientSeed: string; nonce: number; remote: boolean; rotate: (cs: string) => Promise<Revealed> };
/** Provably-fair panel with real rotate + in-browser verification of every bet under the old seed. */
export function HouseFair({ seat, game, bets, fmt, formula, check, extra }: { seat: SeatView; game: Game; bets: { nonce: number; outcome: unknown; seed: string }[]; fmt: (o: unknown) => string; formula: string; check?: (verified: unknown, recorded: unknown) => boolean; extra?: React.ReactNode }) {
  const [cs, setCs] = useState(seat.clientSeed);
  const [checks, setChecks] = useState<{ rev: Revealed; rows: { nonce: number; ok: boolean; v: string }[] } | null>(null);
  const rotate = async () => {
    const rev = await seat.rotate(cs.trim() || "zecasino");
    const mine = bets.filter(b => b.seed === rev.commitment);
    const rows = await Promise.all(mine.slice(0, 6).map(async b => { const v = await verifyBet(rev, game, b.nonce); return { nonce: b.nonce, ok: v !== null && (check ? check(v, b.outcome) : JSON.stringify(v) === JSON.stringify(b.outcome)), v: v === null ? "seed mismatch" : fmt(check ? b.outcome : v) }; }));
    setChecks({ rev, rows });
  };
  return (
    <div className="side-col">
      <aside className="fair">
      <h4>Provably fair</h4>
      <dl>
        <dt>Server seed commitment</dt><dd className="mono">{seat.commitment.slice(0, 10)}…{seat.commitment.slice(-8)}</dd>
        <dt>Your client seed</dt>
        <dd><input className="seed-input mono" value={cs} maxLength={64} onChange={e => setCs(e.target.value.replace(/\s/g, ""))} aria-label="Client seed for the next seed pair" /></dd>
        <dt>Nonce</dt><dd className="mono">{seat.nonce}</dd>
        <dt>Dealer</dt><dd className="mono">{seat.remote ? "game server · live" : "in-browser seat (server offline)"}</dd>
      </dl>
      <button className="btn ghost sm full" onClick={rotate}>Reveal seed &amp; verify</button>
      {checks && (
        <div className="verify">
          <div className="v-head"><span>Revealed seed</span><code className="mono">{checks.rev.serverSeed.slice(0, 16)}…</code></div>
          {checks.rows.length === 0 && <p>No bets under that seed.</p>}
          {checks.rows.map(r => <VerifiedRound key={r.nonce} id={`#${r.nonce}`} summary={r.v} ok={r.ok}>
            <dt>Commitment</dt><dd className="mono">SHA-256(seed) = {checks.rev.commitment.slice(0, 12)}… ✓</dd>
            <dt>Inputs</dt><dd className="mono">HMAC(seed, “{checks.rev.clientSeed}:{r.nonce}:…”)</dd>
            <dt>Recomputed</dt><dd className="mono">{r.v}</dd>
            <dt>Recorded</dt><dd className="mono">{r.ok ? "same as recomputed" : "differs from recomputed"}</dd>
          </VerifiedRound>)}
        </div>
      )}
      {extra}
      <p>{formula}</p>
    </aside>
      <ChainSees table={game} />
    </div>
  );
}
