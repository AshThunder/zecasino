"use client";
import { useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { PlayingCard } from "@/components/PlayingCard";
import { ChipRack } from "@/components/ChipRack";
import { ChipStack } from "@/components/Chip";
import { CardShoe } from "@/components/CardShoe";
import { FeltArc } from "@/components/FeltArc";
import { FairPanel } from "@/components/FairPanel";
import { bjValue, code, localShoe } from "@/lib/cards";
import { play } from "@/lib/sfx";

type Phase = "bet" | "player" | "dealer" | "done";
export default function Blackjack() {
  const scope = useRef<HTMLDivElement>(null);
  const shoe = useRef<number[]>(localShoe());
  const [chip, setChip] = useState(0.01);
  const [bet, setBet] = useState<number[]>([0.05, 0.01]);
  const [dealer, setDealer] = useState<number[]>([]);
  const [player, setPlayer] = useState<number[]>([]);
  const [phase, setPhase] = useState<Phase>("bet");
  const [msg, setMsg] = useState<string | null>(null);
  const { contextSafe } = useGSAP({ scope });
  const stake = bet.reduce((a, b) => a + b, 0);
  const draw = () => shoe.current.shift()!;

  const animateLast = contextSafe((sel: string) => {
    requestAnimationFrame(() => {
      const els = scope.current?.querySelectorAll(sel); const el = els?.[els.length - 1]; if (!el) return;
      gsap.fromTo(el, { x: 380, y: -220, rotation: 25, opacity: 0 }, { x: 0, y: 0, rotation: 0, opacity: 1, duration: 0.45, ease: "power3.out" });
    });
  });
  const deal = () => {
    if (stake === 0) return;
    const p = [draw(), draw()], d = [draw(), draw()];
    setPlayer([]); setDealer([]); setMsg(null); setPhase("player");
    [[p[0], "p"], [d[0], "d"], [p[1], "p"], [d[1], "d"]].forEach(([c, who], i) => setTimeout(() => {
      play("card", 0.5);
      if (who === "p") { setPlayer(x => [...x, c as number]); animateLast(".hand.player .pcard"); }
      else { setDealer(x => [...x, c as number]); animateLast(".hand.dealer .pcard"); }
      if (i === 3 && bjValue(p).total === 21) setTimeout(() => finish(p, d), 500);
    }, i * 380));
  };
  const hit = () => {
    const c = draw(); const p = [...player, c]; setPlayer(p); play("slide", 0.5); animateLast(".hand.player .pcard");
    if (bjValue(p).total > 21) setTimeout(() => finish(p, dealer), 500);
  };
  const stand = (p = player) => {
    setPhase("dealer"); play("card", 0.4);
    let d = [...dealer]; const steps: number[][] = [];
    while (bjValue(d).total < 17) { d = [...d, draw()]; steps.push(d); }
    steps.forEach((s, i) => setTimeout(() => { setDealer(s); play("card", 0.5); animateLast(".hand.dealer .pcard"); }, 600 + i * 600));
    setTimeout(() => finish(p, d), 800 + steps.length * 600);
  };
  const double = () => { setBet(b => [...b, ...b]); const p = [...player, draw()]; setPlayer(p); play("stack", 0.5); animateLast(".hand.player .pcard"); setTimeout(() => bjValue(p).total > 21 ? finish(p, dealer) : stand(p), 600); };
  const finish = (p: number[], d: number[]) => {
    const pv = bjValue(p).total, dv = bjValue(d).total, bj = pv === 21 && p.length === 2;
    setPhase("done");
    const m = pv > 21 ? "Bust." : bj && !(dv === 21 && d.length === 2) ? "Blackjack! Pays 3 to 2." : dv > 21 ? "Dealer busts. You win." : pv > dv ? "You win." : pv === dv ? "Push." : "Dealer wins.";
    setMsg(m); play(m.includes("win") || m.includes("Blackjack") ? "stack" : "collide", 0.6);
    if (shoe.current.length < 60) shoe.current = localShoe();
  };
  const pv = bjValue(player), dv = bjValue(phase === "player" ? dealer.slice(0, 1) : dealer);

  return (
    <div ref={scope} className="table-page bj-page">
      <div className="table-head"><div><p className="eyebrow">House game · 6 decks · dealer stands on all 17s</p><h1>Blackjack</h1></div></div>
      <div className="felt bj-felt">
        <div className="bj-shoe"><CardShoe width={170} /></div>
        <div className="hand dealer">
          {dealer.map((c, i) => <PlayingCard key={i} code={code(c)} faceUp={!(i === 1 && phase === "player")} width={92} />)}
          {dealer.length > 0 && <span className="hand-total">{dv.total}</span>}
        </div>
        <FeltArc width={820} lines={[
          { text: "BLACKJACK PAYS 3 TO 2", size: 30, r: 330 },
          { text: "Dealer must draw to 16 and stand on all 17's", size: 15, r: 330, color: "#F3ECDDaa" },
          { text: "INSURANCE PAYS 2 TO 1", size: 17, r: 330, color: "#E9C46Acc" },
        ]} />
        <div className="hand player">
          {player.map((c, i) => <PlayingCard key={i} code={code(c)} width={92} />)}
          {player.length > 0 && <span className={`hand-total ${pv.total > 21 ? "bust" : ""}`}>{pv.soft && pv.total <= 21 ? `soft ${pv.total}` : pv.total}</span>}
        </div>
        <div className="bet-circle" onClick={() => phase === "bet" || phase === "done" ? (setBet(b => [...b, chip]), play("chip")) : null} role="button" aria-label="Betting circle">
          {bet.length ? <ChipStack values={bet} size={58} /> : <span>BET</span>}
        </div>
        {msg && <div className="result-toast" role="status"><span>{msg}</span></div>}
        <div className="table-controls bj-controls">
          <ChipRack value={chip} onChange={setChip} />
          <div className="ctl">
            <div className="bet-total"><small>Bet</small><b>ⓩ {stake.toFixed(3)}</b></div>
            {(phase === "bet" || phase === "done") && <><button className="btn ghost" onClick={() => setBet([])}>Clear</button><button className="btn gold lg" onClick={deal} disabled={!stake}>Deal</button></>}
            {phase === "player" && player.length >= 2 && <><button className="btn ghost" onClick={hit}>Hit</button><button className="btn ghost" onClick={() => stand()}>Stand</button>{player.length === 2 && <button className="btn gold" onClick={double}>Double</button>}</>}
            {phase === "dealer" && <span className="wait">Dealer plays…</span>}
          </div>
        </div>
      </div>
      <FairPanel commitment="shoe: 2c71e0b4…9fa1d6c3" clientSeed="lagos-night-77" nonce={58}
        extra={<p className="note">The full 312-card shoe order is derived from the committed seed before the first card is dealt, so the dealer can&apos;t stack the deck mid-hand.</p>} />
    </div>
  );
}
