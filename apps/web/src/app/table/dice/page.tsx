"use client";
import { useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ChipRack } from "@/components/ChipRack";
import { ChipStack } from "@/components/Chip";
import { HouseFair } from "@/components/HouseFair";
import { useSeat } from "@/lib/house";
import { celebrate, flyChips, chipsFor } from "@/lib/motion";
import { play } from "@/lib/sfx";

const EDGE = 0.99;
type Roll = { nonce: number; roll: number; win: boolean; seed: string; outcome: number };
export default function Dice() {
  const scope = useRef<HTMLDivElement>(null);
  const seat = useSeat();
  const [chip, setChip] = useState(0.01);
  const [stack, setStack] = useState<number[]>([0.01, 0.005]);
  const [target, setTarget] = useState(50.5);
  const [over, setOver] = useState(true);
  const [rolling, setRolling] = useState(false);
  const [last, setLast] = useState<Roll | null>(null);
  const [hist, setHist] = useState<Roll[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const { contextSafe } = useGSAP({ scope });

  const stake = stack.reduce((a, b) => a + b, 0);
  const chance = over ? 100 - target : target;
  const mult = (100 * EDGE) / chance;
  const tPct = target;

  const roll = contextSafe(async () => {
    if (rolling || stake === 0 || !seat.ready) return;
    setRolling(true); play("shake", 0.5);
    const commitment = seat.commitment;
    let res: { nonce: number; outcome: number };
    try { setErr(null); res = await seat.bet<number>("dice", { target: Math.round(target * 100), over, stake }); }
    catch (e) { setErr((e as Error).message); setRolling(false); return; }
    const { nonce, outcome } = res;
    const v = outcome / 100;
    const win = over ? v > target : v < target;
    const o = { x: last?.roll ?? 50 };
    gsap.to(o, { x: v, duration: 0.9, ease: "expo.out", onUpdate: () => { if (readout.current) readout.current.textContent = o.x.toFixed(2); },
      onComplete: () => { const r = { nonce, roll: v, win, seed: commitment, outcome }; setLast(r); setHist(h => [r, ...h].slice(0, 12)); setRolling(false); if (win) celebrate(stake * mult, document.querySelector(".dice-felt")); else play("die", 0.6); } });
    gsap.fromTo(".dtrack .marker", { left: `${last?.roll ?? 50}%` }, { left: `${v}%`, duration: 0.9, ease: "expo.out" });
  });

  const rail = over
    ? `linear-gradient(90deg, #8E1B24 0 ${tPct}%, #1E9A5B ${tPct}% 100%)`
    : `linear-gradient(90deg, #1E9A5B 0 ${tPct}%, #8E1B24 ${tPct}% 100%)`;

  return (
    <div ref={scope} className="table-page dice-page">
      <div className="table-head">
        <div><p className="eyebrow">House game · over / under · 1% edge</p><h1>Dice</h1></div>
        <div className="history" aria-label="Recent rolls">{hist.map(h => <span key={h.nonce} className={`hpill dpill ${h.win ? "win" : "lose"}`}>{h.roll.toFixed(2)}</span>)}</div>
      </div>
      <div className="felt dice-felt">
        <div className="dice-readout">
          <span ref={readout} className={`roll ${rolling || !last ? "" : last.win ? "win" : "lose"}`}>{last ? last.roll.toFixed(2) : "–.––"}</span>
          <small>{last && !rolling ? (last.win ? `Win · ⓩ ${(stake * mult).toFixed(4)}` : "No win") : `Roll ${over ? "over" : "under"} ${target.toFixed(2)}`}</small>
        </div>
        {err && <div className="result-toast" role="alert"><span>{err}</span></div>}
        <div className="dtrack">
          <div className="rail" style={{ background: rail }} />
          <input type="range" min={2} max={98} step={0.5} value={target} disabled={rolling} aria-label="Target"
            onChange={e => { setTarget(Number(e.target.value)); }} onPointerUp={() => play("handle", 0.3)} />
          <div className="ticks">{[0, 25, 50, 75, 100].map(t => <span key={t}>{t}</span>)}</div>
          {last && <div className="marker" style={{ left: `${last.roll}%` }}><span>{last.roll.toFixed(2)}</span></div>}
        </div>
        <div className="dstats">
          <div className="dstat"><small>Multiplier</small><b>{mult.toFixed(4)}×</b></div>
          <div className="dstat"><small>Roll {over ? "over" : "under"}</small><b>{target.toFixed(2)}</b></div>
          <div className="dstat"><small>Win chance</small><b>{chance.toFixed(2)}%</b></div>
        </div>
        <div className="table-controls">
          <ChipRack value={chip} onChange={setChip} />
          <div className="ctl">
            <button className="bet-spot" onClick={e => { setStack(s => [...s, chip]); flyChips([chip], document.querySelector(".rack .on"), e.currentTarget, { sound: false }); play("chip"); }} disabled={rolling} aria-label="Add chip to bet"><ChipStack values={stack} size={52} /></button>
            <div className="bet-total"><small>Bet · pays</small><b>ⓩ {stake.toFixed(3)} · {(stake * mult).toFixed(4)}</b></div>
            <div className="dmode" role="group" aria-label="Direction">
              <button aria-pressed={!over} onClick={() => { setOver(false); setTarget(t => 100 - t); }}>Under</button>
              <button aria-pressed={over} onClick={() => { setOver(true); setTarget(t => 100 - t); }}>Over</button>
            </div>
            <button className="btn ghost" onClick={() => setStack([])} disabled={rolling}>Clear</button>
            <button className="btn gold lg" onClick={roll} disabled={rolling || stake === 0 || !seat.ready}>{rolling ? "Rolling" : "Roll"}</button>
          </div>
        </div>
      </div>
      <HouseFair seat={seat} game="dice" bets={hist} fmt={o => (Number(o) / 100).toFixed(2)} formula="Roll = ⌊float(HMAC-SHA256(server seed, “client seed:nonce:0”)) × 10001⌋ / 100. Win if it lands on your side of the line." />
    </div>
  );
}
