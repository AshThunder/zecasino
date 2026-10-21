"use client";
import { useEffect, useRef, useState } from "react";
import { ChipRack } from "@/components/ChipRack";
import { ChipStack } from "@/components/Chip";
import { HouseFair } from "@/components/HouseFair";
import { ZMark } from "@/components/ZMark";
import { useSeat } from "@/lib/house";
import { multAt, msFor, curve } from "@/lib/crash";
import { play } from "@/lib/sfx";
import { getClient, toZat, ZAT } from "@/lib/server";
import { games, unhex, verifySeed } from "@/lib/fair";

type Phase = "betting" | "running" | "busted";
type Seat = { id: string; bet: number; target: number; out?: number };
const W = 560, H = 400;
const anon = () => Array.from(crypto.getRandomValues(new Uint8Array(2)), b => b.toString(16).padStart(2, "0")).join("");

export default function Crash() {
  const seat = useSeat();
  const [chip, setChip] = useState(0.01);
  const [stack, setStack] = useState<number[]>([0.01]);
  const [auto, setAuto] = useState(2);
  const [phase, setPhase] = useState<Phase>("betting");
  const [count, setCount] = useState(6);
  const [mult, setMult] = useState(1);
  const [elapsed, setElapsed] = useState(0);
  const [bust, setBust] = useState(0);
  const [joined, setJoined] = useState(false);
  const [mine, setMine] = useState<{ bet: number; out?: number } | null>(null);
  const [table, setTable] = useState<Seat[]>([]);
  const [hist, setHist] = useState<{ nonce: number; outcome: number; seed: string }[]>([]);
  const [round, setRound] = useState(18204);
  const point = useRef<{ crash: number | null; nonce: number; seed: string } | null>(null);
  const [checked, setChecked] = useState<{ round: number; bust: number; ok: boolean }[]>([]);
  const myAnon = useRef<string | null>(null);
  const offset = useRef(0);
  const remote = seat.remote;

  // Server-driven rounds: every round has its own committed seed, revealed (and checked here) at the bust.
  useEffect(() => {
    if (!remote) return;
    let offs: (() => void)[] = []; let alive = true;
    (async () => {
      const c = await getClient(); if (!c || !alive) return;
      type B = { anon: string; stake: number; out: number | null };
      const fromSnap = (m: { round: number; phase: string; commitment: string; elapsed_ms: number; bet_ms: number; bettors: B[]; me?: B }) => {
        if (m.me) { myAnon.current = m.me.anon; setJoined(true); setMine({ bet: m.me.stake / ZAT, out: m.me.out ? m.me.out / 100 : undefined }); m.bettors = m.bettors.filter(b => b.anon !== m.me!.anon); }
        setRound(m.round); point.current = { crash: null, nonce: m.round, seed: m.commitment };
        setTable(m.bettors.map(b => ({ id: b.anon, bet: b.stake / ZAT, target: 0, out: b.out ? b.out / 100 : undefined })));
        if (m.phase === "betting") { offset.current = 0; setPhase("betting"); setCount(Math.ceil((m.bet_ms - m.elapsed_ms) / 1000)); }
        else if (m.phase === "running") { offset.current = m.elapsed_ms; setPhase("running"); }
        else setPhase("busted");
      };
      offs = [
        c.on("crash", m => fromSnap(m as never)),
        c.on("crash_join", m => setTable(t => t.some(x => x.id === m.anon) || m.anon === myAnon.current ? t : [...t, { id: m.anon, bet: m.stake / ZAT, target: 0 }])),
        c.on("crash_start", m => { offset.current = 0; point.current = { crash: null, nonce: m.round, seed: m.commitment }; setPhase("running"); play("handle", 0.4); }),
        c.on("crash_out", m => { if (m.anon === myAnon.current) { setMine(me => me && { ...me, out: m.mult / 100 }); play("stack", 0.5); } else setTable(t => t.map(x => x.id === m.anon ? { ...x, out: m.mult / 100 } : x)); }),
        c.on("crash_bust", async m => {
          if (point.current) point.current.crash = m.bust / 100;
          const ok = (await verifySeed(m.server_seed, m.commitment)) && (await games.crash(unhex(m.server_seed), m.client_seed, m.round)) === m.bust;
          setChecked(x => [{ round: m.round, bust: m.bust / 100, ok }, ...x].slice(0, 6));
        }),
      ];
      offs.push(c.on("reconnected", () => { getClient().then(n => n?.send({ t: "crash_sub" })); }));
      c.send({ t: "crash_sub" });
    })();
    return () => { alive = false; offs.forEach(f => f()); };
  }, [remote]);
  const stake = stack.reduce((a, b) => a + b, 0);

  // betting countdown
  useEffect(() => {
    if (phase !== "betting" || !seat.ready) return;
    if (remote) { setMult(1); setElapsed(0); const iv = setInterval(() => setCount(c => c - 1), 1000); return () => clearInterval(iv); }
    setTable(Array.from({ length: 5 + Math.floor(Math.random() * 4) }, () => ({ id: anon(), bet: [0.005, 0.01, 0.02, 0.05, 0.1][Math.floor(Math.random() * 5)], target: +(1.1 + Math.random() ** 2 * 6).toFixed(2) })));
    setCount(6); setMult(1); setElapsed(0);
    const iv = setInterval(() => setCount(c => c - 1), 1000);
    return () => clearInterval(iv);
  }, [phase, seat.ready, remote]);

  useEffect(() => {
    if (phase !== "betting" || count > 0 || remote) return;
    (async () => {
      const commitment = seat.commitment;
      const { nonce, outcome } = await seat.bet<number>("crash", {});
      point.current = { crash: outcome / 100, nonce, seed: commitment };
      setPhase("running"); play("handle", 0.4);
    })();
  }, [count, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // flight
  useEffect(() => {
    if (phase !== "running" || !point.current) return;
    const p = point.current; const t0 = performance.now() - offset.current; let raf = 0;
    const tick = () => {
      const crash = p.crash ?? Infinity; const { nonce, seed } = p;
      const end = p.crash ? msFor(p.crash) : Infinity;
      const t = Math.min(performance.now() - t0, end); const m = multAt(t);
      setElapsed(t); setMult(m);
      if (!remote) {
        setTable(ts => ts.map(s => !s.out && s.target <= m && s.target <= crash ? { ...s, out: s.target } : s));
        setMine(me => { if (me && !me.out && auto > 1 && m >= auto && auto < crash) { play("stack", 0.5); return { ...me, out: auto }; } return me; });
      }
      if (t >= end) {
        setMult(p.crash!); setBust(p.crash!); setPhase("busted"); play("collide", 0.7);
        setHist(h => [{ nonce, outcome: Math.round(p.crash! * 100), seed }, ...h].slice(0, 14));
        setTimeout(() => { setJoined(false); setMine(null); myAnon.current = null; if (!remote) { setRound(r => r + 1); setPhase("betting"); } }, 2900);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const [err, setErr] = useState<string | null>(null);
  const join = async () => {
    if (phase !== "betting" || stake === 0) return;
    if (remote) {
      const c = await getClient(); if (!c) return;
      try { setErr(null); const r = await c.rpc({ t: "crash_bet", stake: toZat(stake), auto: auto > 1 ? Math.round(auto * 100) : undefined }); myAnon.current = r.anon; }
      catch (e) { setErr((e as Error).message); return; }
    }
    setJoined(true); setMine({ bet: stake }); play("chip");
  };
  const cashOut = async () => {
    if (!(phase === "running" && mine && !mine.out)) return;
    if (remote) { const c = await getClient(); try { const r = await c!.rpc({ t: "crash_cash" }); setMine(me => me && { ...me, out: r.mult / 100 }); } catch (e) { setErr((e as Error).message); return; } }
    else setMine({ ...mine, out: mult });
    play("stack", 0.6);
  };

  // graph scaling
  const maxT = Math.max(9000, elapsed * 1.1), maxM = Math.max(2, mult * 1.15);
  const X = (t: number) => 44 + (t / maxT) * (W - 64), Y = (m: number) => H - 30 - ((m - 1) / (maxM - 1)) * (H - 60);
  const pts = Array.from({ length: 64 }, (_, i) => { const t = (elapsed * i) / 63; return `${X(t).toFixed(1)},${Y(curve(t)).toFixed(1)}`; });
  const tip = pts[pts.length - 1]?.split(",").map(Number) ?? [X(0), Y(1)];
  const grid = [1, ...[1.5, 2, 3, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].filter(v => v < maxM / 1.08).slice(-4)];
  const tStep = [2000, 5000, 10000, 20000, 30000, 60000, 120000].find(st => maxT / st <= 6) ?? 300000;
  const busted = phase === "busted";

  return (
    <div className="table-page crash-page">
      <div className="table-head">
        <div><p className="eyebrow">House game · multiplayer · max 1000× · round {round.toLocaleString()}</p><h1>Crash</h1></div>
        <div className="history" aria-label="Recent busts">{hist.map(h => <span key={h.nonce} className={`hpill dpill ${h.outcome >= 200 ? "win" : "lose"}`}>{(h.outcome / 100).toFixed(2)}×</span>)}</div>
      </div>
      <div className="felt crash-felt">
        <div className="crash-grid">
          <div className={`crash-graph ${busted ? "bust" : ""}`}>
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Multiplier ${mult.toFixed(2)}`}>
              <defs>
                <linearGradient id="cr-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={busted ? "#C0262F" : "#F4B728"} stopOpacity=".38" /><stop offset="1" stopColor={busted ? "#C0262F" : "#F4B728"} stopOpacity="0" /></linearGradient>
                <filter id="cr-glow"><feGaussianBlur stdDeviation="4" /></filter>
              </defs>
              {grid.map(g => <g key={g}><line x1={44} x2={W - 16} y1={Y(g)} y2={Y(g)} stroke="#ffffff14" strokeDasharray="3 6" /><text x={36} y={Y(g) + 4} textAnchor="end" className="ax">{g}×</text></g>)}
              {Array.from({ length: Math.floor(maxT / tStep) + 1 }, (_, i) => <text key={i} x={X(i * tStep)} y={H - 10} textAnchor="middle" className="ax">{(i * tStep) / 1000}s</text>)}
              {phase !== "betting" && elapsed > 0 && <>
                <polygon points={`${X(0)},${Y(1)} ${pts.join(" ")} ${tip[0]},${Y(1)}`} fill="url(#cr-fill)" />
                <polyline points={pts.join(" ")} fill="none" stroke={busted ? "#E0414B" : "#FFD46B"} strokeWidth="6" opacity=".45" filter="url(#cr-glow)" />
                <polyline points={pts.join(" ")} fill="none" stroke={busted ? "#E0414B" : "#FFE7A3"} strokeWidth="3" strokeLinecap="round" />
                {table.filter(s => s.out).map(s => <circle key={s.id} cx={X(msFor(s.out!))} cy={Y(s.out!)} r="4" fill="#7CF0AE" stroke="#0B0B0C" />)}
                {mine?.out && <circle cx={X(msFor(mine.out))} cy={Y(mine.out)} r="6" fill="#F4B728" stroke="#0B0B0C" strokeWidth="2" />}
                <g transform={`translate(${tip[0] - 16} ${tip[1] - 16})`} className={busted ? "coin bust" : "coin"}><ZMark size={32} /></g>
              </>}
            </svg>
            {err && <div className="result-toast" role="alert"><span>{err}</span></div>}
            <div className="crash-readout" aria-live="polite">
              {phase === "betting"
                ? <><small>Next round in</small><b>{Math.max(count, 0)}s</b><span>Place your bet</span></>
                : <><b className={busted ? "bust" : ""}>{mult.toFixed(2)}×</b><span>{busted ? `Busted at ${bust.toFixed(2)}×` : mine?.out ? `You cashed out at ${mine.out.toFixed(2)}×` : "\u00a0"}</span></>}
            </div>
          </div>
          <div className="crash-players">
            <h5>Table · {table.length + (joined ? 1 : 0)} bettors</h5>
            <p className="sub">Bettors are session hashes. No accounts, no addresses.</p>
            <ul>
              {joined && mine && <li className="me"><span className="mono">you</span><span className="mono">ⓩ {mine.bet.toFixed(3)}</span><b className={mine.out ? "won" : busted ? "lost" : ""}>{mine.out ? `${mine.out.toFixed(2)}×` : busted ? "bust" : "–"}</b></li>}
              {table.map(s => <li key={s.id}><span className="mono">anon·{s.id}</span><span className="mono">ⓩ {s.bet.toFixed(3)}</span><b className={s.out ? "won" : busted ? "lost" : ""}>{s.out ? `${s.out.toFixed(2)}×` : busted ? "bust" : "–"}</b></li>)}
            </ul>
          </div>
        </div>
        <div className="table-controls">
          <ChipRack value={chip} onChange={setChip} />
          <div className="ctl">
            <button className="bet-spot" onClick={() => { if (!joined) { setStack(s => [...s, chip]); play("chip"); } }} disabled={joined} aria-label="Add chip to bet"><ChipStack values={stack} size={52} /></button>
            <div className="bet-total"><small>Bet</small><b>ⓩ {stake.toFixed(3)}</b></div>
            <label className="auto"><small>Auto cash-out</small><span><input type="number" min={1.01} max={999.99} step={0.1} value={auto} onChange={e => setAuto(Number(e.target.value))} disabled={joined} />×</span></label>
            <button className="btn ghost" onClick={() => setStack([])} disabled={joined}>Clear</button>
            {phase === "running" && mine && !mine.out
              ? <button className="btn gold lg cash" onClick={cashOut}>Cash out ⓩ {(mine.bet * mult).toFixed(4)}</button>
              : <button className="btn gold lg" onClick={join} disabled={phase !== "betting" || joined || stake === 0}>{joined ? "Bet placed" : phase === "betting" ? "Bet next round" : "Wait for next round"}</button>}
          </div>
        </div>
      </div>
      <HouseFair seat={seat} game="crash" bets={remote ? [] : hist}
        extra={remote ? <div className="verify"><dt>Round seeds (checked in your browser)</dt>{checked.length === 0 && <p>Waiting for the first bust…</p>}
          {checked.map(c => <div key={c.round} className="vrow mono"><span>#{c.round}</span><span>{c.bust.toFixed(2)}×</span><b className={c.ok ? "ok" : "bad"}>{c.ok ? "✓ match" : "✗ mismatch"}</b></div>)}</div> : undefined} fmt={o => `${(Number(o) / 100).toFixed(2)}×`} formula="h = first 4 bytes of HMAC-SHA256(server seed, “client seed:nonce:0”). 1 in 100 rounds bust instantly; otherwise bust = ⌊(100·2³² − h) / (2³² − h)⌋ / 100, capped at 1000×." />
    </div>
  );
}
