"use client";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Die } from "@/components/Die";
import { DiceCup } from "@/components/DiceCup";
import { Chip, ChipStack } from "@/components/Chip";
import { play } from "@/lib/sfx";

type P = { name: string; dice: number[]; commit: string; chip: number };
const roll5 = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), b => (b % 6) + 1);
const hex = (n = 4) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, "0")).join("");
const WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen"];
const plural = (f: number) => (f === 6 ? "sixes" : `${f}s`);

export default function Liars() {
  const scope = useRef<HTMLDivElement>(null);
  const [players, setPlayers] = useState<P[]>([]);
  const [phase, setPhase] = useState<"roll" | "bid" | "reveal">("roll");
  const [bid, setBid] = useState<{ q: number; f: number; by: string } | null>(null);
  const [q, setQ] = useState(3); const [f, setF] = useState(5);
  const [verdict, setVerdict] = useState<string | null>(null);
  const { contextSafe } = useGSAP({ scope });
  useEffect(() => { setPlayers([{ name: "You", dice: roll5(), commit: hex(), chip: 0.5 }, { name: "anon · 3c9e", dice: roll5(), commit: hex(), chip: 0.05 }, { name: "anon · b71f", dice: roll5(), commit: hex(), chip: 0.1 }]); }, []);

  const roll = contextSafe(() => {
    play("shake", 0.7);
    gsap.timeline()
      .to(".lp .cup", { x: () => gsap.utils.random(-8, 8), rotation: () => gsap.utils.random(-10, 10), duration: 0.08, repeat: 9, yoyo: true })
      .to(".lp .cup", { x: 0, rotation: 0, duration: 0.15 })
      .add(() => {
        play("throw", 0.6);
        setPlayers(ps => ps.map(p => ({ ...p, dice: roll5(), commit: hex() })));
        setPhase("bid"); setBid({ q: 2, f: 4, by: "anon · b71f" }); setQ(3); setF(4);
      });
  });
  const placeBid = () => {
    if (bid && (q < bid.q || (q === bid.q && f <= bid.f))) return;
    play("chip", 0.5); setBid({ q, f, by: "You" });
    setTimeout(() => { const nb = { q: q + (f === 6 ? 1 : 0), f: f === 6 ? 2 : f + 1, by: "anon · 3c9e" }; setBid(nb); setQ(nb.q); setF(nb.f); play("chip", 0.4); }, 1200);
  };
  const callLiar = contextSafe(() => {
    if (!bid) return;
    setPhase("reveal"); play("die", 0.7);
    gsap.to(".lp:not(.me) .cup", { y: -90, rotation: -8, opacity: 0.25, duration: 0.7, ease: "power3.out", stagger: 0.12 });
    setVerdict("x");
  });
  const reset = contextSafe(() => { gsap.to(".lp .cup", { y: 0, rotation: 0, opacity: 1, duration: 0.4 }); setPhase("roll"); setBid(null); setVerdict(null); });

  const me = players[0], others = players.slice(1);
  const count = bid ? players.flatMap(p => p.dice).filter(d => d === bid.f).length : 0;
  const verdictText = verdict && bid ? (count >= bid.q ? `There are ${WORDS[count]} ${plural(bid.f)} on the table. The bid stands; you lose the round.` : `Only ${WORDS[count] || "zero"} ${plural(bid.f)}. ${bid.by} was bluffing. You win the pot.`) : null;
  return (
    <div ref={scope} className="table-page liars-page">
      <div className="table-head"><div><p className="eyebrow">2–4 players · 5 dice each · ones are not wild</p><h1>Liar&apos;s Dice</h1></div></div>
      <div className="felt liars-felt">
        <div className="lp-row">
          {others.map(p => (
            <div key={p.name} className="lp">
              <div className="lp-cupwrap">
                {phase === "reveal" && <div className="lp-dice">{p.dice.map((d, i) => <Die key={i} value={d} size={34} />)}</div>}
                <div className="cup"><DiceCup width={110} /></div>
              </div>
              <div className="lp-tag"><Chip value={p.chip} size={30} id={`lp-${p.chip}`} /><div><b>{p.name}</b><small className="mono">commit {p.commit}…{phase === "reveal" && <em> ✓ opened</em>}</small></div></div>
            </div>
          ))}
        </div>
        <div className="lp-center">
          <ChipStack values={[0.05, 0.05, 0.05]} size={46} />
          <div className="bid-card" style={verdictText ? { visibility: "hidden" } : undefined}>
            {bid ? <><small>{bid.by} bids</small><b>{WORDS[bid.q]} × </b><Die value={bid.f} size={40} /></> : <small>Shake your cup to start the round</small>}
          </div>
        </div>
        {verdictText && <div className="result-toast" role="status"><span>{verdictText}</span></div>}
        {me && (
          <div className="lp me">
            <div className="tray">
              <span className="tray-label">Your dice · only you can see these</span>
              <div className="lp-dice mine">{me.dice.map((d, i) => <Die key={i} value={d} size={56} color="ruby" />)}</div>
            </div>
            <div className="lp-controls">
              {phase === "roll" && <button className="btn gold lg" onClick={roll}>Shake &amp; roll</button>}
              {phase === "bid" && <>
                <div className="stepper"><button onClick={() => setQ(x => Math.max(1, x - 1))} aria-label="Fewer">−</button><b>{q}</b><button onClick={() => setQ(x => Math.min(15, x + 1))} aria-label="More">+</button></div>
                <div className="faces" role="radiogroup" aria-label="Face">{[1, 2, 3, 4, 5, 6].map(v => <button key={v} role="radio" aria-checked={f === v} className={f === v ? "on" : ""} onClick={() => setF(v)}><Die value={v} size={36} /></button>)}</div>
                <button className="btn ghost" onClick={placeBid}>Bid</button>
                <button className="btn gold" onClick={callLiar}>Liar!</button>
              </>}
              {phase === "reveal" && <button className="btn gold" onClick={reset}>Next round</button>}
            </div>
          </div>
        )}
      </div>
      <aside className="fair">
        <h4>Committed dice</h4>
        <p>When the cups go down, every player posts SHA-256(“zecasino:commit:v1”‖salt‖dice). When someone calls liar, each player opens their commitment and every browser checks it, so nobody can change their dice after hearing a bid.</p>
        <dl>{players.map(p => <div key={p.name}><dt>{p.name}</dt><dd className="mono">{p.commit}…{phase === "reveal" ? " · verified" : ""}</dd></div>)}</dl>
      </aside>
    </div>
  );
}
