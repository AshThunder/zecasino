import Link from "next/link";
import { TileArt } from "@/components/TileArt";
import { HeroWheel } from "@/components/HeroWheel";
import { SESSION } from "@/lib/mock";

const GAMES = [
  { id: "carrot", name: "Carrot in a Box", kind: "Player vs player", why: "Only the holder peeks. The box is sealed with a SHA-256 commitment before anyone bluffs.", stakes: "ⓩ 0.005 – 0.5", live: "6 tables", href: "/table/carrot", feature: true },
  { id: "holdem", name: "Heads-up Hold'em", kind: "Player vs player", why: "Mental-poker shuffle: even the house can't see your hole cards.", stakes: "ⓩ 0.01 – 1", live: "4 tables", href: "#" },
  { id: "liars", name: "Liar's Dice", kind: "2–4 players", why: "Dice committed under the cup; opened only when someone calls liar.", stakes: "ⓩ 0.005 – 0.25", live: "3 tables", href: "#" },
  { id: "roulette", name: "European Roulette", kind: "House · single zero", why: "Seed committed before you bet; every spin verifiable.", stakes: "ⓩ 0.001 – 0.5", live: "Live", href: "/table/roulette" },
  { id: "blackjack", name: "Blackjack", kind: "House · 6 decks", why: "The whole shoe order is committed before the first card.", stakes: "ⓩ 0.005 – 0.5", live: "Live", href: "#" },
  { id: "dice", name: "Dice", kind: "House · over / under", why: "HMAC(server seed, your seed, nonce). Check it yourself.", stakes: "ⓩ 0.001 – 0.25", live: "Live", href: "#" },
  { id: "crash", name: "Crash", kind: "House · multiplayer", why: "Cash out before it busts. Bettors are just session hashes.", stakes: "ⓩ 0.001 – 0.25", live: "Round 18,204", href: "#", wide: true },
];

export default function Lobby() {
  return (
    <div className="lobby">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">A Zcash casino · NU7 testnet</p>
          <h1>Play in the<br /><em>shielded pool.</em></h1>
          <p className="lede">Deposit to a one-time Orchard address, play provably fair tables, and cash out to any shielded wallet. No account, no email, no transparent address. The chain never learns who sat at the table.</p>
          <div className="hero-cta">
            <Link className="btn gold lg" href="/table/carrot">Take a seat</Link>
            <a className="btn ghost lg" href="#fair">How privacy works</a>
          </div>
          <dl className="stats">
            <div><dt>Transparent addresses used</dt><dd>0</dd></div>
            <div><dt>Last fairness anchor</dt><dd>#{SESSION.anchor.toLocaleString()}</dd></div>
            <div><dt>Reserves ≥ liabilities</dt><dd>112.4%</dd></div>
          </dl>
        </div>
        <div className="hero-art"><HeroWheel /></div>
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
                <div className="tile-foot"><span>{g.stakes}</span><span className="live"><i />{g.live}</span></div>
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
