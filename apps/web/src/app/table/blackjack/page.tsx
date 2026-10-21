"use client";
import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import { PlayingCard } from "@/components/PlayingCard";
import { ChipRack } from "@/components/ChipRack";
import { ChipStack } from "@/components/Chip";
import { CardShoe } from "@/components/CardShoe";
import { FeltArc } from "@/components/FeltArc";
import { HouseFair } from "@/components/HouseFair";
import { useSeat } from "@/lib/house";
import { localDealer, remoteDealer, record, verifyRecord, type Action, type BjRecord, type Dealer, type HandView } from "@/lib/blackjack";
import { bjValue, code } from "@/lib/cards";
import { play } from "@/lib/sfx";
import { celebrate, dealFromShoe, flyChips } from "@/lib/motion";

type Phase = "bet" | "player" | "dealer" | "done";
export default function Blackjack() {
  const scope = useRef<HTMLDivElement>(null);
  const seat = useSeat();
  const dealerRef = useRef<Dealer | null>(null);
  const [chip, setChip] = useState(0.01);
  const [bet, setBet] = useState<number[]>([0.05, 0.01]);
  const [dealer, setDealer] = useState<number[]>([]);
  const [phands, setPhands] = useState<number[][]>([[]]);
  const [active, setActive] = useState(0);
  const [caps, setCaps] = useState({ split: false, double: false });
  const player = phands[active] ?? [];
  const setPlayer = (p: number[]) => { setPhands([p]); setActive(0); };
  const [phase, setPhase] = useState<Phase>("bet");
  const [msg, setMsg] = useState<string | null>(null);
  const [hands, setHands] = useState<{ nonce: number; outcome: BjRecord; seed: string }[]>([]);
  const seedAtDeal = useRef("");
  const { contextSafe } = useGSAP({ scope });
  const stake = bet.reduce((a, b) => a + b, 0);

  useEffect(() => { if (!seat.ready) return; (async () => {
    dealerRef.current = (seat.remote ? await remoteDealer() : null) ?? localDealer(seat);
    const open = await dealerRef.current.resume?.();
    if (open) { seedAtDeal.current = seat.commitment; setBet([open.stake]); setPlayer([]); setDealer([]); setPhase("dealer"); show(open, { hands: [[]], d: 0 }); }
  })(); }, [seat.ready, seat.remote]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Each card leaves the shoe face down and turns over on its spot; the dealer's hole card stays down. */
  const animateLast = contextSafe((sel: string, flip = true) => {
    requestAnimationFrame(() => {
      const els = scope.current?.querySelectorAll(sel); const el = els?.[els.length - 1]; if (!el) return;
      dealFromShoe(el, scope.current?.querySelector(".bj-shoe"), { flip });
    });
  });
  /** Animate the table from what it shows now to the server's view, card by card (split hands included). */
  const show = (v: HandView, from: { hands: number[][]; d: number }, startDelay = 0) => {
    let t = startDelay;
    const steps: (() => void)[] = [];
    const target = v.hands.length ? v.hands.map(h => h.cards) : [v.player], d = v.dealer;
    let cur = from.hands.map(h => [...h]);
    const push = (next: number[][], act: number, anim = true) => { const snap = next.map(h => [...h]); steps.push(() => { setPhands(snap); setActive(act); if (anim) animateLast(`.hand.player .phand:nth-child(${act + 1}) .pcard`); }); };
    if (from.d === 0 && target[0].length >= 2) {
      const p0 = target.length > 1 ? [target[0][0], target[1][0]] : target[0];
      steps.push(() => { setPhands([[p0[0]]]); setActive(0); animateLast(".hand.player .pcard"); }, () => { setDealer([d[0]]); animateLast(".hand.dealer .pcard"); },
        () => { setPhands([[p0[0], p0[1]]]); animateLast(".hand.player .pcard"); }, () => { setDealer(v.done ? [d[0], d[1]] : [d[0], -1]); animateLast(".hand.dealer .pcard", v.done); });
      cur = [[p0[0], p0[1]]]; from = { ...from, d: 2 };
    }
    if (target.length > cur.length && cur.length === 1 && cur[0].length === 2) { cur = [[cur[0][0]], [cur[0][1]]]; push(cur, 0, false); }
    target.forEach((h, i) => { if (!cur[i]) cur[i] = []; for (let k = cur[i].length; k < h.length; k++) { cur[i] = h.slice(0, k + 1); push(cur, i); } });
    if (v.done) { if (from.d >= 2) steps.push(() => { setDealer(d.slice(0, 2)); setPhase("dealer"); });
      for (let i = Math.max(2, from.d); i < d.length; i++) steps.push(() => { setDealer(d.slice(0, i + 1)); animateLast(".hand.dealer .pcard"); }); }
    steps.forEach(f => setTimeout(() => { play("card", 0.5); f(); }, (t += 420)));
    setTimeout(() => {
      setCaps({ split: v.can_split && !!dealerRef.current?.canSplit, double: v.can_double });
      if (!v.done) { setActive(v.active); setPhase("player"); return; }
      setPhase("done"); setMsg(v.message);
      if (v.payout > v.stake) celebrate(v.payout, scope.current?.querySelector(".bj-felt"), { label: v.message?.startsWith("Blackjack") ? "Blackjack" : "You win" }); else play(v.payout === v.stake ? "chip" : "collide", 0.6);
      setHands(h => [{ nonce: v.nonce, outcome: record(v), seed: seedAtDeal.current }, ...h].slice(0, 20));
    }, t + 420);
  };
  const deal = async () => {
    if (stake === 0 || !dealerRef.current) return;
    seedAtDeal.current = seat.commitment;
    setPlayer([]); setDealer([]); setMsg(null); setPhase("dealer");
    try { show(await dealerRef.current.deal(stake), { hands: [[]], d: 0 }); } catch (e) { setMsg((e as Error).message); setPhase("bet"); }
  };
  const act = async (a: Action) => {
    setPhase("dealer"); play(a === "double" || a === "split" ? "stack" : "slide", 0.5);
    if (a === "double" || a === "split") setBet(b => [...b, ...b]);
    try { show(await dealerRef.current!.act(a), { hands: phands, d: dealer.length }, -300); } catch (e) { setMsg((e as Error).message); setPhase("player"); }
  };
  const dv = bjValue(dealer.filter(c => c >= 0));

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
        <div className={`hand player ${phands.length > 1 ? "split" : ""}`}>
          {phands.map((h, hi) => { const v = bjValue(h); return (
            <div key={hi} className={`phand ${phands.length > 1 && hi === active && phase === "player" ? "active" : ""}`} data-hand={hi}>
              {h.map((c, i) => <PlayingCard key={i} code={code(c)} width={phands.length > 1 ? 78 : 92} />)}
              {h.length > 0 && <span className={`hand-total ${v.total > 21 ? "bust" : ""}`}>{v.soft && v.total <= 21 ? `soft ${v.total}` : v.total}</span>}
            </div>); })}
        </div>
        <div className="bet-circle" onClick={e => { if (phase === "bet" || phase === "done") { setBet(b => [...b, chip]); flyChips([chip], scope.current?.querySelector(".rack .on"), e.currentTarget); play("chip"); } }} role="button" aria-label="Betting circle">
          {bet.length ? <ChipStack values={bet} size={58} /> : <span>BET</span>}
        </div>
        {msg && <div className="result-toast" role="status"><span>{msg}</span></div>}
        <div className="table-controls bj-controls">
          <ChipRack value={chip} onChange={setChip} />
          <div className="ctl">
            <div className="bet-total"><small>Bet</small><b>ⓩ {stake.toFixed(3)}</b></div>
            {(phase === "bet" || phase === "done") && <><button className="btn ghost" onClick={() => setBet([])}>Clear</button><button className="btn gold lg" onClick={deal} disabled={!stake || !seat.ready}>Deal</button></>}
            {phase === "player" && player.length >= 2 && <><button className="btn ghost" onClick={() => act("hit")}>Hit</button><button className="btn ghost" onClick={() => act("stand")}>Stand</button>{caps.double && <button className="btn gold" onClick={() => act("double")}>Double</button>}{caps.split && <button className="btn gold" onClick={() => act("split")}>Split</button>}</>}
            {phase === "dealer" && <span className="wait">Dealer plays…</span>}
          </div>
        </div>
      </div>
      <HouseFair seat={seat} game="blackjack" bets={hands} fmt={o => { const r = o as BjRecord; return `${r.hands.map(h => h.map(code).join(" ")).join(" | ")} vs ${r.dealer.map(code).join(" ")}`; }}
        check={(shoe, dealt) => verifyRecord(shoe as number[], dealt as BjRecord)}
        formula="Each hand gets a fresh 6-deck shoe: Fisher-Yates over 312 cards driven by HMAC-SHA256(server seed, “client seed:nonce:cursor”). Cards come off the top in order. After the reveal your browser replays the server's draw log (including any split) against the shoe and checks it rebuilds your exact hands and the dealer's 17 rule."
        extra={<p className="note">The whole shoe is fixed by the committed seed before the first card, and the hole card stays on the server until you finish, so nobody can stack the deck mid-hand.</p>} />
    </div>
  );
}
