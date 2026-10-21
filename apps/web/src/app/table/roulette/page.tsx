"use client";
import { useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { RouletteWheel, POCKET_STEP } from "@/components/RouletteWheel";
import { RouletteLayout, type BetKey } from "@/components/RouletteLayout";
import { ChipRack } from "@/components/ChipRack";
import { HouseFair } from "@/components/HouseFair";
import { useSeat } from "@/lib/house";
import { WHEEL_ORDER, RED, colorOf } from "@/lib/roulette";
import { play, ballRoll } from "@/lib/sfx";

const payout = (k: BetKey, n: number): number => {
  if (k.startsWith("n:")) return Number(k.slice(2)) === n ? 36 : 0;
  if (n === 0) return 0;
  if (k === "red") return RED.has(n) ? 2 : 0;
  if (k === "black") return !RED.has(n) ? 2 : 0;
  if (k === "even") return n % 2 === 0 ? 2 : 0;
  if (k === "odd") return n % 2 === 1 ? 2 : 0;
  if (k === "low") return n <= 18 ? 2 : 0;
  if (k === "high") return n >= 19 ? 2 : 0;
  if (k.startsWith("doz:")) return Math.ceil(n / 12) === Number(k.slice(4)) ? 3 : 0;
  if (k.startsWith("col:")) return ((n - 1) % 3) + 1 === Number(k.slice(4)) ? 3 : 0;
  return 0;
};

export default function Roulette() {
  const scope = useRef<HTMLDivElement>(null);
  const wheel = useRef<SVGGElement>(null), orbit = useRef<SVGGElement>(null), ball = useRef<SVGCircleElement>(null);
  const wheelRot = useRef(0);
  const [chip, setChip] = useState(0.01);
  const [bets, setBets] = useState<Record<BetKey, number[]>>({ "n:17": [0.01, 0.01], red: [0.05], "doz:2": [0.005] });
  const [history, setHistory] = useState<number[]>([32, 0, 17, 5, 26, 11, 30, 8, 19, 3]);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<{ n: number; win: number } | null>(null);
  const seat = useSeat();
  const [err, setErr] = useState<string | null>(null);
  const [verifiable, setVerifiable] = useState<{ nonce: number; outcome: number; seed: string }[]>([]);
  const { contextSafe } = useGSAP({ scope });

  const total = Object.values(bets).flat().reduce((a, b) => a + b, 0);
  const place = (k: BetKey) => { if (spinning) return; play("chip"); setResult(null); setBets(b => ({ ...b, [k]: [...(b[k] ?? []), chip] })); };

  const spin = contextSafe(async () => {
    if (spinning || total === 0 || !seat.ready) return;
    setSpinning(true); setResult(null); setErr(null);
    const commitment = seat.commitment;
    let r: { nonce: number; outcome: number };
    try { r = await seat.bet<number>("roulette", { bets: Object.entries(bets).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0)]) }); }
    catch (e) { setSpinning(false); setErr((e as Error).message); return; }
    const n = r.outcome;
    const idx = WHEEL_ORDER.indexOf(n);
    const dur = 6.2;
    const w0 = wheelRot.current, w1 = w0 + 360 * 3 + Math.random() * 360;
    wheelRot.current = w1;
    const target = w1 + idx * POCKET_STEP;
    const ballEnd = target - 360 * 6 - (((target % 360) + 360) % 360 === 0 ? 0 : 0);
    gsap.set(orbit.current, { rotation: 0, svgOrigin: "0 0" });
    gsap.set(ball.current, { attr: { cy: -165 } });
    ballRoll(dur - 0.8);
    const tl = gsap.timeline({ onComplete: () => {
      const win = Object.entries(bets).reduce((a, [k, v]) => a + payout(k, n) * v.reduce((x, y) => x + y, 0), 0);
      setResult({ n, win }); setHistory(h => [n, ...h].slice(0, 14)); setSpinning(false); setVerifiable(h => [{ nonce: r.nonce, outcome: n, seed: commitment }, ...h].slice(0, 20));
      play(win > 0 ? "stack" : "collide", 0.6);
    } });
    tl.to(wheel.current, { rotation: w1, svgOrigin: "0 0", duration: dur, ease: "power3.out" }, 0)
      .to(orbit.current, { rotation: ballEnd - 360 * Math.floor(w0 / 360) * 0, svgOrigin: "0 0", duration: dur, ease: "power3.out" }, 0)
      .to(ball.current, { attr: { cy: -126 }, duration: 1.1, ease: "bounce.out" }, dur - 2.3)
      .to(orbit.current, { rotation: w1 + idx * POCKET_STEP, svgOrigin: "0 0", duration: 0.01 }, dur);
  });

  return (
    <div ref={scope} className="table-page roulette-page">
      <div className="table-head">
        <div><p className="eyebrow">House game · single zero · 2.70% edge</p><h1>European Roulette</h1></div>
        <div className="history" aria-label="Recent results">
          {history.map((h, i) => <span key={i} className={`hpill ${colorOf(h)}`}>{h}</span>)}
        </div>
      </div>
      <div className="felt roulette-felt">
        <div className="wheel-well"><RouletteWheel size={440} wheelRef={wheel} ballOrbitRef={orbit} ballRef={ball} /></div>
        <div className="layout-wrap">
          <RouletteLayout bets={bets} onBet={place} highlight={result?.n ?? null} />
          <div className="table-controls">
            <ChipRack value={chip} onChange={setChip} />
            <div className="ctl">
              <div className="bet-total"><small>Total bet</small><b>ⓩ {total.toFixed(3)}</b></div>
              <button className="btn ghost" onClick={() => { setBets({}); setResult(null); play("collide", 0.4); }} disabled={spinning}>Clear</button>
              <button className="btn gold lg" onClick={spin} disabled={spinning || total === 0 || !seat.ready}>{spinning ? "No more bets" : "Spin"}</button>
            </div>
          </div>
        </div>
        {err && <div className="result-toast" role="alert"><span>{err}</span></div>}
        {result && (
          <div className={`result-toast ${colorOf(result.n)}`} role="status">
            <span className="rn">{result.n}</span>
            <span>{result.win > 0 ? <>You win <b>ⓩ {result.win.toFixed(3)}</b></> : "No win this spin"}</span>
          </div>
        )}
      </div>
      <HouseFair seat={seat} game="roulette" bets={verifiable} fmt={o => String(o)} formula="Pocket = unbiased(HMAC-SHA256(server seed, “client seed:nonce:cursor”)) mod 37, by rejection sampling. Rotate to reveal the seed and recheck every spin." />
    </div>
  );
}
