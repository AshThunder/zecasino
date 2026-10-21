"use client";
import Link from "next/link";
import { TileArt } from "@/components/TileArt";
import { HeroWheel } from "@/components/HeroWheel";
import { useEffect, useState } from "react";
import { DEMO, setMode } from "@/lib/server";
import { GAMES } from "@/lib/games";
import { Walkthrough } from "@/components/Walkthrough";
import { useLobby, pct, type Lobby } from "@/lib/lobby";


/** Live activity for a tile, from the server. Shows nothing rather than a made-up number. */
function liveLabel(id: string, d: Lobby | null): string | null {
  if (!d) return null;
  const t = d.tables;
  const pvp = (r: { rooms: number; waiting: number }) => r.rooms ? `${r.rooms} table${r.rooms > 1 ? "s" : ""} live` : r.waiting ? `${r.waiting} waiting` : "Open · no one seated";
  if (id === "carrot") return pvp(t.carrot);
  if (id === "liars") return pvp(t.liars);
  if (id === "holdem") return pvp(t.holdem);
  if (id === "crash") return `Round ${t.crash.round.toLocaleString()}${t.crash.bettors ? ` · ${t.crash.bettors} in` : ""}`;
  return "Dealing now";
}

export default function LobbyPage() {
  const { data, offline } = useLobby();
  const [demo, setDemo] = useState(false); useEffect(() => setDemo(DEMO), []);
  const cov = data?.coverage ?? null;
  const [tour, setTour] = useState(false);
  return (
    <div className="lobby">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">A Zcash casino · NU7 testnet</p>
          <h1>Play in the<br /><em>shielded pool.</em></h1>
          <p className="lede">Deposit to a one-time Orchard address, play provably fair tables, and cash out to any shielded wallet. No account, no email, no transparent address. The chain never learns who sat at the table.</p>
          <div className="hero-cta">
            <Link className="btn gold lg" href="/table/carrot">Take a seat</Link>
            <button className="btn ghost lg" onClick={() => setMode(!demo)}>{demo ? "Leave demo" : "Try with play chips"}</button>
            <button className="btn link lg" onClick={() => setTour(true)}>▶ How it works · 20 s</button>
          </div>
          <dl className={`stats ${data ? "" : "loading"}`} aria-busy={!data}>
            <div title="Transparent outputs the house wallets ever received or sent, counted from the wallet databases.">
              <dt>Transparent outputs used</dt><dd>{data?.transparent ?? <span className="skel" />}</dd></div>
            <div title={data?.anchor ? `SHA-256 over block ${data.anchor.block_hash.slice(0, 16)}… and ${data.anchor.count} live seed commitments: ${data.anchor.digest}` : undefined}>
              <dt>Fairness anchor</dt><dd>{data?.anchor ? <a href="/solvency#anchor">#{data.anchor.height.toLocaleString()}</a> : <span className="skel" />}</dd></div>
            <div title={data ? `Cold reserve ${((data.reserve_zat ?? 0) / 1e8).toFixed(4)} TAZ (public viewing key) vs ${(data.liabilities_zat / 1e8).toFixed(4)} TAZ owed to players. Hot wallet ${((data.hot_zat ?? 0) / 1e8).toFixed(4)} TAZ not counted.` : undefined}>
              <dt>Reserve coverage</dt><dd className={cov !== null && cov < 1 ? "under" : ""}>{cov !== null ? <a href="/solvency">{pct(cov)}</a> : data ? "—" : <span className="skel" />}</dd></div>
          </dl>
          {offline && <p className="stats-note">Game server unreachable: live figures will appear when it is back.</p>}
        </div>
        <div className="hero-art"><HeroWheel /></div>
        {tour && <Walkthrough onClose={() => setTour(false)} />}
      </section>

      <section className="games" aria-labelledby="games-h">
        <div className="sec-head"><h2 id="games-h">The floor</h2><p>Every game here has a reason to be private.</p></div>
        <div className="grid">
          {GAMES.map(g => (
            <Link key={g.id} href={g.href} className={`tile ${g.feature ? "feature" : ""} ${"wide" in g && g.wide ? "wide" : ""}`}>
              <div className="tile-art"><TileArt game={g.id} /></div>
              <div className="tile-body">
                <span className="kind">{g.kind}</span>
                <h3>{g.name}</h3>
                <p>{g.why}</p>
                <div className="tile-foot"><span>{g.stakes}</span>{liveLabel(g.id, data) ? <span className="live"><i />{liveLabel(g.id, data)}</span> : <span className="skel sm" />}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section id="fair" className="explain">
        <div className="sec-head"><h2>Why nobody can watch you play</h2></div>
        <div className="cols">
          <article><span className="num">I</span><h4>Shielded in</h4><p>Each session gets a fresh diversified Orchard address and an encrypted memo tag. The house finds your deposit with its viewing key; observers see only that a shielded transaction happened.</p></article>
          <article><span className="num">II</span><h4>Provably fair</h4><p>The house commits to SHA-256(server seed) before your bet. Results come from HMAC(server seed, your seed, nonce). Rotate the seed and verify every result in your browser.</p></article>
          <article id="solvency"><span className="num">III</span><h4>Solvent, not snooping</h4><p>Balances sit in a Merkle-sum tree keyed by session hash. You get your inclusion proof, the public gets the total, and the reserves are shown by a reserve-only viewing key.</p></article>
          <article><span className="num">IV</span><h4>Shielded out</h4><p>Withdraw to any shielded address in randomized batches, so timing and amounts don't link deposits to withdrawals.</p></article>
        </div>
      </section>
    </div>
  );
}
