"use client";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { PlayingCard } from "@/components/PlayingCard";
import { ChipRack } from "@/components/ChipRack";
import { ChipStack } from "@/components/Chip";
import { CardShoe } from "@/components/CardShoe";
import { FeltArc } from "@/components/FeltArc";
import { HouseFair } from "@/components/HouseFair";
import { useSeat } from "@/lib/house";
import { localDealer, remoteDealer, drawOrder, type Dealer, type HandView } from "@/lib/blackjack";
import { bjValue, code } from "@/lib/cards";
import { play } from "@/lib/sfx";

type Phase = "bet" | "player" | "dealer" | "done";
export default function Blackjack() {
  const scope = useRef<HTMLDivElement>(null);
  const seat = useSeat();
  const dealerRef = useRef<Dealer | null>(null);
  const [chip, setChip] = useState(0.01);
  const [bet, setBet] = useState<number[]>([0.05, 0.01]);
  const [dealer, setDealer] = useState<number[]>([]);
  const [player, setPlayer] = useState<number[]>([]);
  const [phase, setPhase] = useState<Phase>("bet");
  const [msg, setMsg] = useState<string | null>(null);
  const [hands, setHands] = useState<{ nonce: number; outcome: number[]; seed: string }[]>([]);
  const seedAtDeal = useRef("");
  const { contextSafe } = useGSAP({ scope });
  const stake = bet.reduce((a, b) => a + b, 0);

  useEffect(() => { if (!seat.ready) return; (async () => { dealerRef.current = (seat.remote ? await remoteDealer() : null) ?? localDealer(seat); })(); }, [seat.ready, seat.remote]); // eslint-disable-line react-hooks/exhaustive-deps

  const animateLast = contextSafe((sel: string) => {
    requestAnimationFrame(() => {
      const els = scope.current?.querySelectorAll(sel); const el = els?.[els.length - 1]; if (!el) return;
      gsap.fromTo(el, { x: 380, y: -220, rotation: 25, opacity: 0 }, { x: 0, y: 0, rotation: 0, opacity: 1, duration: 0.45, ease: "power3.out" });
    });
  });
  /** Animate the table from what it shows now to the server's view, card by card. */
  const show = (v: HandView, from: { p: number; d: number }, startDelay = 0) => {
    let t = startDelay;
    const steps: (() => void)[] = [];
    const p = v.player, d = v.dealer;
    if (from.p === 0 && from.d === 0 && p.length >= 2) {
      steps.push(() => { setPlayer([p[0]]); animateLast(".hand.player .pcard"); }, () => { setDealer([d[0]]); animateLast(".hand.dealer .pcard"); },
        () => { setPlayer([p[0], p[1]]); animateLast(".hand.player .pcard"); }, () => { setDealer(v.done ? [d[0], d[1]] : [d[0], -1]); animateLast(".hand.dealer .pcard"); });
      from = { p: 2, d: 2 };
    }
    for (let i = from.p; i < p.length; i++) steps.push(() => { setPlayer(p.slice(0, i + 1)); animateLast(".hand.player .pcard"); });
    if (v.done) { if (from.d >= 2) steps.push(() => { setDealer(d.slice(0, 2)); setPhase("dealer"); });
      for (let i = Math.max(2, from.d); i < d.length; i++) steps.push(() => { setDealer(d.slice(0, i + 1)); animateLast(".hand.dealer .pcard"); }); }
    steps.forEach(f => setTimeout(() => { play("card", 0.5); f(); }, (t += 420)));
    setTimeout(() => {
      if (!v.done) { setPhase("player"); return; }
      setPhase("done"); setMsg(v.message); play(v.payout > v.stake ? "stack" : "collide", 0.6);
      if (v.stake > stake) setBet(b => [...b, ...b]);
      setHands(h => [{ nonce: v.nonce, outcome: drawOrder(v), seed: seedAtDeal.current }, ...h].slice(0, 20));
    }, t + 420);
  };
  const deal = async () => {
    if (stake === 0 || !dealerRef.current) return;
    seedAtDeal.current = seat.commitment;
    setPlayer([]); setDealer([]); setMsg(null); setPhase("dealer");
    try { show(await dealerRef.current.deal(stake), { p: 0, d: 0 }); } catch (e) { setMsg((e as Error).message); setPhase("bet"); }
  };
  const act = async (a: "hit" | "stand" | "double") => {
    setPhase("dealer"); play(a === "double" ? "stack" : "slide", 0.5);
    try { show(await dealerRef.current!.act(a), { p: player.length, d: dealer.length }, -300); } catch (e) { setMsg((e as Error).message); setPhase("player"); }
  };
  const pv = bjValue(player), dv = bjValue(dealer.filter(c => c >= 0));

  return (
    <div ref={scope} className="table-page bj-page">
      <div className="table-head"><div><p className="eyebrow">House game · 6 decks · dealer stands on all 17s</p><h1>Blackjack</h1></div></div>
      <div className="felt bj-felt">
        <div className="bj-shoe"><CardShoe width={170} /></div>
        <div className="hand dealer">
          {dealer.map((c, i) => <PlayingCard key={i} code={c >= 0 ? code(c) : "AS"} faceUp={c >= 0} width={92} />)}
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
            {(phase === "bet" || phase === "done") && <><button className="btn ghost" onClick={() => setBet([])}>Clear</button><button className="btn gold lg" onClick={deal} disabled={!stake || !seat.ready}>Deal</button></>}
            {phase === "player" && player.length >= 2 && <><button className="btn ghost" onClick={() => act("hit")}>Hit</button><button className="btn ghost" onClick={() => act("stand")}>Stand</button>{player.length === 2 && <button className="btn gold" onClick={() => act("double")}>Double</button>}</>}
            {phase === "dealer" && <span className="wait">Dealer plays…</span>}
          </div>
        </div>
      </div>
      <HouseFair seat={seat} game="blackjack" bets={hands} fmt={o => (o as number[]).map(code).join(" ")}
        check={(shoe, dealt) => (dealt as number[]).every((c, i) => (shoe as number[])[i] === c)}
        formula="Each hand gets a fresh 6-deck shoe: Fisher-Yates over 312 cards driven by HMAC-SHA256(server seed, “client seed:nonce:cursor”). Cards come off the top in order."
        extra={<p className="note">The whole shoe is fixed by the committed seed before the first card, and the hole card stays on the server until you finish, so nobody can stack the deck mid-hand.</p>} />
    </div>
  );
}
