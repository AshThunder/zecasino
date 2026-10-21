"use client";
import { WaitingScene } from "@/components/WaitingScene";
import { HowTo } from "@/components/HowTo";
import { ChainSees } from "@/components/ChainSees";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { PlayingCard } from "@/components/PlayingCard";
import { CardBack } from "@/components/CardBack";
import { Chip, ChipStack } from "@/components/Chip";
import { code } from "@/lib/cards";
import { best } from "@/lib/poker";
import { celebrate, flyChips, chipsFor } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { getClient, toZat, ZAT } from "@/lib/server";
import { loadMp, mp, type Masked, type Pk, type Share } from "@/lib/mp";

type Msg = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type StepState = "wait" | "on" | "done" | "bad";
const BUY_IN = 0.4;
const z = (zat: number) => (zat / ZAT).toFixed(3);
const short = (h: string) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : "…");

export default function Holdem() {
  const scope = useRef<HTMLDivElement>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const [seat, setSeat] = useState(0);
  const [opp, setOpp] = useState("");
  const [searching, setSearching] = useState(false);
  const [handNo, setHandNo] = useState(0);
  const [button, setButton] = useState(0);
  const [steps, setSteps] = useState<StepState[]>(["wait", "wait", "wait"]);
  const [myKey, setMyKey] = useState("");
  const [hole, setHole] = useState<number[]>([]);
  const [oppHole, setOppHole] = useState<number[] | null>(null);
  const [board, setBoard] = useState<number[]>([]);
  const [st, setSt] = useState<Msg | null>(null);
  const [raiseTo, setRaiseTo] = useState(0);
  const [result, setResult] = useState<Msg | null>(null);
  const [checks, setChecks] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => { if (!deadline) return; const i = setInterval(() => tick(t => t + 1), 250); return () => clearInterval(i); }, [deadline]);
  const k = useRef<{ sk: string; pks: Pk[]; joint: string; deck: Masked[] }>({ sk: "", pks: [], joint: "", deck: [] });
  const seatRef = useRef(0); const handRef = useRef(0);
  const { contextSafe } = useGSAP({ scope });
  const note = (s: string) => setChecks(c => [s, ...c].slice(0, 6));

  const shuffleFx = contextSafe(() => {
    play("shuffle", 0.5);
    gsap.timeline()
      .to(".mp-card", { x: () => gsap.utils.random(-120, 120), y: () => gsap.utils.random(-30, 30), rotation: () => gsap.utils.random(-25, 25), duration: 0.3, stagger: 0.02, ease: "power2.out" })
      .to(".mp-card", { x: 0, y: 0, rotation: 0, duration: 0.3, stagger: 0.015, ease: "power2.in" })
      .to(".mp-lock", { scale: 1.2, duration: 0.15, yoyo: true, repeat: 1 }, "-=0.2");
  });
  const dealFx = contextSafe((sel: string) => requestAnimationFrame(() => gsap.fromTo(sel, { y: -160, opacity: 0, rotation: 12 }, { y: 0, opacity: 1, rotation: 0, duration: 0.45, stagger: 0.12, ease: "power3.out" })));

  useEffect(() => {
    let offs: (() => void)[] = []; let alive = true;
    (async () => {
      const [c] = await Promise.all([getClient(), loadMp()]);
      if (!alive) return; setOnline(!!c); if (!c) return;
      const ix = (m: Msg) => (m.by === "house" ? 0 : m.by === c.session?.anonHoldem ? -1 : 1);
      const on = (t: string, f: (m: Msg) => void) => offs.push(c.on(t, f));
      on("hm_seated", m => { setSearching(false); setNotice(null); setRoom(m.room); setSeat(m.seat); seatRef.current = m.seat; setOpp(m.opponent); });
      on("hm_hand", m => {
        const saved = JSON.parse(sessionStorage.getItem("zc.hm.sk") ?? "null");
        k.current.sk = saved && saved.room === m.room && saved.hand === m.hand ? saved.sk : ""; handRef.current = m.hand; setHandNo(m.hand); setButton(m.button); setHole([]); setOppHole(null); setBoard([]); setResult(null); setSt(null); setSteps(["wait", "wait", "wait"]); setChecks([]); });
      on("hm_key_req", m => {
        // Kept for this tab only, so a refresh mid-hand can still open its cards and send shares.
        const kp = mp.keygen(); k.current.sk = kp.sk; setMyKey(kp.pk.key);
        sessionStorage.setItem("zc.hm.sk", JSON.stringify({ room: m.room, hand: handRef.current, sk: kp.sk }));
        c.send({ t: "hm_key", room: m.room, pk: kp.pk });
      });
      on("hm_keys", m => { k.current.pks = m.pks; k.current.joint = m.joint; note("3 deck keys published, each with a proof of knowledge"); });
      // Shuffle order is house → seat 0 → seat 1. Steps array is [house, seat0, seat1].
      on("hm_shuffled", m => {
        const idx = m.by === "house" ? 0 : seatRef.current === 0 ? 2 : 1;
        setSteps(s => s.map((x, i) => (i === idx ? "on" : x)));
        setTimeout(() => {
          const ok = mp.verifyShuffle(m.input, m.output, k.current.joint, m.proof);
          setSteps(s => s.map((x, i) => (i === idx ? (ok ? "done" : "bad") : x)));
          note(ok ? `${m.by === "house" ? "House" : `anon · ${m.by}`} shuffle proof verified in your browser` : "SHUFFLE PROOF FAILED");
          shuffleFx();
        }, 30);
        void ix;
      });
      on("hm_shuffle_req", m => {
        const mine = seatRef.current + 1;
        setSteps(s => s.map((x, i) => (i === mine ? "on" : x)));
        setTimeout(() => {
          const r = mp.shuffle(m.deck, k.current.joint);
          c.send({ t: "hm_shuffle", room: m.room, deck: r.deck, proof: r.proof });
          setSteps(s => s.map((x, i) => (i === mine ? "done" : x))); shuffleFx();
        }, 30);
      });
      on("hm_deck", m => { k.current.deck = m.deck; });
      on("hm_share_req", m => {
        const shares: Record<string, Share> = {};
        for (const p of m.positions as number[]) shares[p] = mp.share(k.current.sk, k.current.deck[p]);
        c.send({ t: "hm_shares", room: m.room, shares });
      });
      on("hm_hole", m => {
        const cards = (m.positions as number[]).map(p => {
          const others: Share[] = m.shares[p];
          const pks = k.current.pks; const s = seatRef.current;
          const ok = others.length === 2 && mp.verifyShare(pks[1 - s], k.current.deck[p], others[0]) && mp.verifyShare(pks[2], k.current.deck[p], others[1]);
          if (!ok) note("A decryption share for your hole card failed its proof");
          return mp.unmask(k.current.deck[p], [...others, mp.share(k.current.sk, k.current.deck[p])]);
        });
        setHole(cards); play("card", 0.5); dealFx(".pk-seat.bottom .pcard");
        note("Your hole cards opened here, with your own key. Nobody else has seen them.");
      });
      on("hm_state", m => { setSt(m); setDeadline(m.act_ms ? Date.now() + m.act_ms : 0); if (m.legal?.raise) setRaiseTo(m.legal.raise.min); if (m.legal) play("chip", 0.2); });
      on("hm_board", m => {
        const ok = (m.positions as number[]).every((p, i) => mp.unmask(k.current.deck[p], m.shares[p]) === m.cards[i]);
        note(ok ? `${["", "Flop", "Turn", "River"][m.street]} opened from 3 verified shares` : "BOARD SHARES DO NOT MATCH");
        const upto = ({ 1: 3, 2: 4, 3: 5 } as Record<number, number>)[m.street] ?? 5;
        setBoard(b => (b.length >= upto ? b : [...b.slice(0, upto - m.cards.length), ...m.cards])); play("card", 0.5); dealFx(".board-slot .pcard:not(.dealt)");
      });
      on("hm_result", m => {
        setResult(m); setSt(s => (s ? { ...s, legal: null } : s));
        if (m.by === "showdown") {
          const o = 1 - seatRef.current; const r = m.reveals[o];
          const mineOk = (r.positions as number[]).every((p, i) => mp.unmask(k.current.deck[p], r.shares[p]) === r.cards[i]);
          setOppHole(m.holes[o]); note(mineOk ? "Opponent's hole cards re-opened from their shares: match" : "OPPONENT REVEAL MISMATCH");
        }
        const won = m.winner === seatRef.current;
        if (won) celebrate((m.pot - m.rake) / ZAT, document.querySelector(".poker-felt"), { label: m.by === "showdown" ? "You take the pot" : "Pot is yours" }); else play(m.winner === "split" ? "chip" : "collide", 0.6);
      });
      on("hm_closed", m => { setNotice(m.reason ? `Table closed: ${m.reason}. ⓩ ${z(m.cashed_out)} returned to your balance.` : null); setRoom(null); setSt(null); setHole([]); setBoard([]); setResult(null); });
      on("error", m => setErr(m.error));
      on("reconnected", () => { getClient().then(n => n?.rpc({ t: "pvp_resume" }).catch(() => {})); });
      c.rpc({ t: "pvp_resume" }).catch(() => {});
    })();
    return () => { alive = false; offs.forEach(f => f()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sit = async () => {
    const c = await getClient(); if (!c) return;
    try { setErr(null); setSearching(true); await c.rpc({ t: "holdem_join", stake: toZat(BUY_IN) }); } catch (e) { setSearching(false); setErr((e as Error).message); }
  };
  const act = async (action: "fold" | "check" | "call" | "raise") => {
    const c = await getClient(); setErr(null);
    c?.send({ t: "hm_act", room, action, to: action === "raise" ? raiseTo : undefined });
    play(action === "raise" ? "stack" : action === "fold" ? "slide" : "chip", 0.5);
    if (action === "call" || action === "raise") flyChips([0.01, 0.005], document.querySelector(".pk-seat.bottom"), document.querySelector(".pk-pot"), { sound: false });
  };
  const leave = async () => { const c = await getClient(); c?.send({ t: "holdem_leave", room }); };

  const legal = st?.legal; const me = seat, op = 1 - seat;
  const stacks = (result?.stacks ?? st?.stacks ?? [toZat(BUY_IN), toZat(BUY_IN)]) as number[];
  const handName = hole.length === 2 && board.length >= 3 ? best([...hole, ...board]).name : hole.length === 2 && hole[0] % 13 === hole[1] % 13 ? "Pocket pair" : "";
  const shuffleNames = ["House", seat === 0 ? "You" : `anon · ${opp}`, seat === 1 ? "You" : `anon · ${opp}`];
  const resultText = result ? (result.winner === "split" ? "Split pot" : result.winner === me ? `You win ⓩ ${((result.pot - result.rake) / ZAT).toFixed(4)}${result.by === "showdown" ? ` with ${String(result.hands[me]).toLowerCase()}` : result.by === "forfeit" ? " · opponent withheld card shares" : ""}` : `anon · ${opp} wins${result.by === "showdown" ? ` with ${String(result.hands[op]).toLowerCase()}` : result.by === "forfeit" ? " · you forfeited by not sending card shares" : ""}`) : null;
  const left = deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0;

  return (
    <div ref={scope} className="table-page holdem-page">
      <div className="table-head"><div><p className="eyebrow">Player vs player · heads-up no-limit · mental-poker shuffle</p><div className="th-title"><h1>Heads-up Hold&apos;em</h1><HowTo game="holdem" /></div></div>
        <div className="blinds"><span>Blinds ⓩ 0.005 / 0.01</span><span>{handNo ? `Hand #${handNo}` : `Buy-in ⓩ ${BUY_IN.toFixed(2)}`}</span></div></div>
      <div className="poker-wrap">
        <div className="poker-rail">
          <div className="poker-felt">
        {searching && <WaitingScene table="holdem" label="Waiting for an opponent" />}
            <div className="pk-seat top">
              <Chip value={0.05} size={44} id="pk-op" /><div><b>{room ? `anon · ${opp}` : searching ? "Finding a player…" : "Empty seat"}</b><small>{room ? `ⓩ ${z(stacks[op])}${button === op ? " · dealer" : ""}${st?.street_bet?.[op] ? ` · bet ${z(st.street_bet[op])}` : ""}` : "Unlinkable session"}</small></div>
              <div className="pk-hole">{room && (oppHole ?? [-1, -1]).map((c, i) => <PlayingCard key={i} code={c >= 0 ? code(c) : "AS"} faceUp={c >= 0} width={70} />)}</div>
            </div>
            <div className="board">
              {Array.from({ length: 5 }, (_, i) => <div key={i} className="board-slot">{board[i] !== undefined ? <PlayingCard code={code(board[i])} width={84} /> : null}</div>)}
            </div>
            {resultText
              ? <div className="result-toast inline" role="status"><span>{resultText}{result?.rake ? <small> · rake ⓩ {(result.rake / ZAT).toFixed(4)}</small> : null}</span></div>
              : <div className="pk-pot"><ChipStack values={st?.pot ? chipsFor(st.pot / ZAT, 5) : []} size={40} /><span>Pot ⓩ {z(st?.pot ?? 0)}</span></div>}
            <div className="felt-mark">ZECASINO</div>
            <div className="pk-seat bottom">
              <div className="pk-hole">{room && (hole.length ? hole : [-1, -1]).map((c, i) => <PlayingCard key={i} code={c >= 0 ? code(c) : "AS"} faceUp={c >= 0} width={84} />)}</div>
              <Chip value={0.5} size={44} id="pk-me" /><div><b>You</b><small>ⓩ {z(stacks[me])}{button === me && room ? " · dealer" : ""}{handName ? ` · ${handName}` : ""}</small></div>
            </div>
            {notice && !room && <div className="result-toast" role="status"><span>{notice}</span></div>}
            {err && <div className="result-toast" role="alert"><span>{err}</span></div>}
          </div>
        </div>
        <div className="pk-actions">
          {online === false && <span className="wait">Hold&apos;em is played between real players and needs the live game server.</span>}
          {online && !room && <button className="btn gold lg" onClick={sit} disabled={searching}>{searching ? "Finding a player…" : `Sit down · buy in ⓩ ${BUY_IN.toFixed(2)}`}</button>}
          {room && legal && <>
            <span className={`act-clock ${left <= 5 ? "low" : ""}`} title="Auto check, or fold if there is a bet, when the clock runs out">{left}s</span>
            {legal.fold && <button className="btn ghost" onClick={() => act("fold")}>Fold</button>}
            {legal.check ? <button className="btn ghost" onClick={() => act("check")}>Check</button> : <button className="btn ghost" onClick={() => act("call")}>Call ⓩ {z(legal.call)}</button>}
            {legal.raise && <><label className="raise"><span>{legal.check ? "Bet" : "Raise to"}</span><input type="range" min={legal.raise.min} max={legal.raise.max} step={toZat(0.005)} value={raiseTo} onChange={e => setRaiseTo(+e.target.value)} /><b>ⓩ {z(raiseTo)}</b></label>
              <button className="btn gold" onClick={() => act("raise")}>{raiseTo === legal.raise.max ? "All in" : legal.check ? "Bet" : "Raise"}</button></>}
          </>}
          {room && !legal && !result && <span className="wait">{steps.some(s => s !== "done") ? "Shuffling the deck…" : hole.length ? `anon · ${opp} to act… ${st?.to_act === op && left ? `${left}s` : ""}` : "Dealing…"}</span>}
          {room && result && <><span className="wait">Next hand in a few seconds…</span><button className="btn ghost" onClick={leave}>Leave table</button></>}
        </div>
      </div>
      <div className="side-col">
        <aside className="fair mp">
        <h4>Mental-poker shuffle</h4>
        <p className="fair-explain">Every card is locked with three keys (yours, your opponent&apos;s and the house&apos;s), so nobody can see or stack the deck alone.</p>
        <ol className="mp-steps">
          {shuffleNames.map((who, i) => (
            <li key={i} className={steps[i] === "done" ? "done" : steps[i] === "on" ? "on" : steps[i] === "bad" ? "bad" : ""}>
              <span className="mp-n">{i + 1}</span><div><b>{who}</b><p>{i === 0 ? "masks all 52 cards under the joint key and shuffles" : "re-randomises every card and shuffles again"}</p>
                <code className="mono">{steps[i] === "done" ? (who === "You" ? "your shuffle · proof sent" : "proof ✓ verified here") : steps[i] === "on" ? "working…" : steps[i] === "bad" ? "proof FAILED" : "waiting"}</code></div>
            </li>
          ))}
        </ol>
        <div className="mp-deck" aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => <div key={i} className="mp-card" style={{ transform: `translate(${i * 0.6}px, ${-i * 0.6}px)` }}><CardBack width={60} /></div>)}
          <svg className="mp-lock" width="34" height="40" viewBox="0 0 34 40"><rect x="3" y="17" width="28" height="21" rx="4" fill="#F4B728" /><path d="M9 17v-6a8 8 0 0 1 16 0v6" fill="none" stroke="#F4B728" strokeWidth="4" /><circle cx="17" cy="27" r="3" fill="#1A1306" /></svg>
        </div>
        <dl><dt>Your deck key (public part)</dt><dd className="mono">{short(myKey)}</dd></dl>
        <p>Every card is ElGamal-encrypted to the sum of three keys: yours, your opponent&apos;s and the house&apos;s. A card opens only with all three decryption shares. Your hole cards open here, in this tab, with your own share; the house sees them only if you reach showdown.</p>
        <ul className="hand-log">{checks.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </aside>
        <ChainSees table="holdem" />
      </div>
    </div>
  );
}
