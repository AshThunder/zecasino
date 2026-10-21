"use client";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { PlayingCard } from "@/components/PlayingCard";
import { CardBack } from "@/components/CardBack";
import { Chip, ChipStack } from "@/components/Chip";
import { code, localShoe } from "@/lib/cards";
import { best, compareHands } from "@/lib/poker";
import { play } from "@/lib/sfx";

const STAGES = [
  { who: "You", what: "encrypt every card with your key k₁ and shuffle", key: "k₁ · 9f2c…41ad" },
  { who: "anon · 3c9e", what: "re-encrypt with k₂ and shuffle again", key: "k₂ · hidden" },
  { who: "House", what: "re-encrypt with k₃, shuffle, and deal positions", key: "k₃ · hidden" },
];
type Street = "shuffle" | "preflop" | "flop" | "turn" | "river" | "showdown";
const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, "0")).join("");

export default function Holdem() {
  const scope = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState(-1);
  const [street, setStreet] = useState<Street>("shuffle");
  const [deck, setDeck] = useState<number[]>([]);
  const [pot, setPot] = useState(0.02);
  const [raise, setRaise] = useState(0.02);
  const [log, setLog] = useState<string[]>([]);
  const [deckHash, setDeckHash] = useState("…");
  useEffect(() => setDeckHash(`${hex()}…${hex()}`), []);
  const { contextSafe } = useGSAP({ scope });

  const shuffleCeremony = contextSafe(() => {
    setStage(0); play("shuffle", 0.6);
    const tl = gsap.timeline();
    STAGES.forEach((_, i) => {
      tl.add(() => { setStage(i); play("shuffle", 0.5); })
        .to(".mp-card", { x: () => gsap.utils.random(-120, 120), y: () => gsap.utils.random(-30, 30), rotation: () => gsap.utils.random(-25, 25), duration: 0.35, stagger: 0.02, ease: "power2.out" })
        .to(".mp-card", { x: 0, y: 0, rotation: 0, duration: 0.35, stagger: 0.015, ease: "power2.in" })
        .to(".mp-lock", { scale: 1.2, duration: 0.15, yoyo: true, repeat: 1 }, "-=0.2");
    });
    tl.add(() => { setStage(3); setDeck(localShoe(1)); setStreet("preflop"); play("fan", 0.6); setLog(l => ["Deck shuffled by 3 parties. You can decrypt only your own cards.", ...l]); });
  });

  const next: Record<Street, Street> = { shuffle: "preflop", preflop: "flop", flop: "turn", turn: "river", river: "showdown", showdown: "shuffle" };
  const act = (a: "fold" | "call" | "raise") => {
    if (a === "fold") { setLog(l => ["You fold. anon · 3c9e takes the pot.", ...l]); setStreet("showdown"); return; }
    const add = a === "raise" ? raise * 2 : 0.02;
    setPot(p => +(p + add).toFixed(3)); play(a === "raise" ? "stack" : "chip", 0.6);
    setLog(l => [`You ${a === "raise" ? `raise ⓩ ${raise.toFixed(3)}` : "call"} · anon · 3c9e calls`, ...l]);
    const s = next[street]; setStreet(s); if (s !== "showdown") play("card", 0.5);
  };
  const reset = () => { setStreet("shuffle"); setStage(-1); setDeck([]); setPot(0.02); setLog([]); };

  const mine = deck.slice(0, 2), theirs = deck.slice(2, 4), board = deck.slice(4, 9);
  const shown = { shuffle: 0, preflop: 0, flop: 3, turn: 4, river: 5, showdown: 5 }[street];
  const result = street === "showdown" && deck.length ? compareHands([...mine, ...board], [...theirs, ...board]) : 0;

  return (
    <div ref={scope} className="table-page holdem-page">
      <div className="table-head"><div><p className="eyebrow">Player vs player · heads-up no-limit · mental-poker shuffle</p><h1>Heads-up Hold&apos;em</h1></div>
        <div className="blinds"><span>Blinds ⓩ 0.005 / 0.01</span><span>Hand #2,184</span></div></div>
      <div className="poker-wrap">
        <div className="poker-rail">
          <div className="poker-felt">
            <div className="pk-seat top">
              <Chip value={0.05} size={44} id="pk-op" /><div><b>anon · 3c9e</b><small>ⓩ 0.842</small></div>
              <div className="pk-hole">{theirs.length ? theirs.map((c, i) => <PlayingCard key={i} code={code(c)} faceUp={street === "showdown"} width={70} />) : null}</div>
            </div>
            <div className="board">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="board-slot">{i < shown && board[i] !== undefined ? <PlayingCard code={code(board[i])} width={84} /> : null}</div>
              ))}
            </div>
            <div className="pk-pot"><ChipStack values={[0.01, 0.01, 0.005]} size={40} /><span>Pot ⓩ {pot.toFixed(3)}</span></div>
            <div className="felt-mark">ZECASINO</div>
            <div className="pk-seat bottom">
              <div className="pk-hole">{mine.map((c, i) => <PlayingCard key={i} code={code(c)} width={84} />)}</div>
              <Chip value={0.5} size={44} id="pk-me" /><div><b>You</b><small>ⓩ 0.412{mine.length && shown >= 3 ? ` · ${best([...mine, ...board.slice(0, shown)]).name}` : mine.length && mine[0] % 13 === mine[1] % 13 ? " · Pocket pair" : ""}</small></div>
            </div>
            {street === "showdown" && deck.length > 0 && (
              <div className="result-toast" role="status"><span>{result > 0 ? `You win with ${best([...mine, ...board]).name.toLowerCase()}` : result < 0 ? `anon · 3c9e wins with ${best([...theirs, ...board]).name.toLowerCase()}` : "Split pot"}</span></div>
            )}
          </div>
        </div>
        <div className="pk-actions">
          {street === "shuffle" && <button className="btn gold lg" onClick={shuffleCeremony} disabled={stage >= 0}>{stage >= 0 ? "Shuffling…" : "Start hand · shuffle deck"}</button>}
          {street !== "shuffle" && street !== "showdown" && <>
            <button className="btn ghost" onClick={() => act("fold")}>Fold</button>
            <button className="btn ghost" onClick={() => act("call")}>{street === "preflop" ? "Call ⓩ 0.005" : "Check"}</button>
            <label className="raise"><span>Raise</span><input type="range" min="0.01" max="0.4" step="0.005" value={raise} onChange={e => setRaise(+e.target.value)} /><b>ⓩ {raise.toFixed(3)}</b></label>
            <button className="btn gold" onClick={() => act("raise")}>Raise</button>
          </>}
          {street === "showdown" && <button className="btn gold" onClick={reset}>Next hand</button>}
        </div>
      </div>
      <aside className="fair mp">
        <h4>Mental-poker shuffle</h4>
        <ol className="mp-steps">
          {STAGES.map((s, i) => (
            <li key={i} className={stage > i ? "done" : stage === i ? "on" : ""}>
              <span className="mp-n">{i + 1}</span><div><b>{s.who}</b><p>{s.what}</p><code className="mono">{s.key}</code></div>
            </li>
          ))}
        </ol>
        <div className="mp-deck" aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => <div key={i} className="mp-card" style={{ transform: `translate(${i * 0.6}px, ${-i * 0.6}px)` }}><CardBack width={60} /></div>)}
          <svg className="mp-lock" width="34" height="40" viewBox="0 0 34 40"><rect x="3" y="17" width="28" height="21" rx="4" fill="#F4B728" /><path d="M9 17v-6a8 8 0 0 1 16 0v6" fill="none" stroke="#F4B728" strokeWidth="4" /><circle cx="17" cy="27" r="3" fill="#1A1306" /></svg>
        </div>
        <dl><dt>Deck commitment</dt><dd className="mono">{deckHash}</dd></dl>
        <p>Cards are commutatively encrypted by all three parties. To see a card you need everyone&apos;s key share, so your hole cards decrypt only in your browser, and the house never sees them.</p>
        <ul className="hand-log">{log.slice(0, 4).map((l, i) => <li key={i}>{l}</li>)}</ul>
      </aside>
    </div>
  );
}
