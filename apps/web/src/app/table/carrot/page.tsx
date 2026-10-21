"use client";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { CarrotBox } from "@/components/CarrotBox";
import { Carrot } from "@/components/Carrot";
import { ChipStack, Chip } from "@/components/Chip";
import { FairPanel } from "@/components/FairPanel";
import { getClient, toZat } from "@/lib/server";
import { hex, pvpCommit, unhex } from "@/lib/fair";
import { play } from "@/lib/sfx";

type Phase = "peek" | "bluff" | "decide" | "reveal";
const LINES = ["I've got the carrot.", "Mine's empty. Want to swap?", "You should keep yours.", "I'd swap if I were you."];
const STEPS: [Phase, string][] = [["peek", "Peek"], ["bluff", "Bluff"], ["decide", "Keep or swap"], ["reveal", "Reveal"]];

type Role = "holder" | "guesser";
const STAKE = 0.08;
const short = (h: string) => (h ? `${h.slice(0, 8)}…${h.slice(-8)}` : "…");

export default function CarrotTable() {
  const scope = useRef<HTMLDivElement>(null);
  const myLid = useRef<SVGGElement>(null), theirLid = useRef<SVGGElement>(null);
  const [phase, setPhase] = useState<Phase>("peek");
  const [peeked, setPeeked] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [swap, setSwap] = useState<boolean | null>(null);
  const [role, setRole] = useState<Role>("holder");
  const [opp, setOpp] = useState("3c9e");
  const [room, setRoom] = useState<string | null>(null);
  const [remote, setRemote] = useState(false);
  const [searching, setSearching] = useState(false);
  /** Where the carrot is, as far as this browser knows: holder learns it by peeking, guesser only at reveal. */
  const [inHolder, setInHolder] = useState<boolean | null>(null);
  const [seal, setSeal] = useState<{ commitment: string; value?: string; salt?: string; ok?: boolean }>({ commitment: "" });
  const local = useRef<{ value: string; salt: Uint8Array } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { contextSafe } = useGSAP(() => {
    gsap.from(".cbox", { y: 30, opacity: 0, stagger: 0.15, duration: 0.7, ease: "power3.out" });
    gsap.from(".pot .chip-stack", { y: -60, opacity: 0, duration: 0.6, ease: "back.out(1.8)", delay: 0.4 });
  }, { scope });

  /** Local table: the box is sealed with the same commitment scheme the server uses, then opened at reveal. */
  const dealLocal = async () => {
    const value = crypto.getRandomValues(new Uint8Array(1))[0] & 1 ? "carrot:holder" : "carrot:guesser";
    const salt = crypto.getRandomValues(new Uint8Array(32));
    local.current = { value, salt };
    setSeal({ commitment: await pvpCommit(salt, new TextEncoder().encode(value)) });
    setRole("holder"); setInHolder(null);
  };
  useEffect(() => { (async () => { const c = await getClient(); setRemote(!!c); if (!c) dealLocal(); })(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openSeal = async (o: { commitment: string; value: string; salt: string }) => {
    const ok = (await pvpCommit(unhex(o.salt), new TextEncoder().encode(o.value))) === o.commitment;
    setSeal({ ...o, ok }); setInHolder(o.value === "carrot:holder");
  };

  // Remote room events
  useEffect(() => {
    if (!remote) return;
    let offs: (() => void)[] = [];
    getClient().then(c => {
      if (!c) return;
      offs = [
        c.on("carrot_start", m => { setSearching(false); setRoom(m.room); setRole(m.role); setOpp(m.opponent); setSeal({ commitment: m.commitment }); setInHolder(m.peek ? m.peek === "carrot" : null); setPhase(m.role === "holder" ? "peek" : "bluff"); play("chip", 0.5); }),
        c.on("carrot_say", m => { setSaid(m.line); setPhase("decide"); play("chip", 0.3); }),
        c.on("carrot_reveal", async m => { setSwap(m.swap); await openSeal(m.opening); setTimeout(() => setPhase("reveal"), m.swap ? 900 : 300); play("stack", 0.6); }),
      ];
    });
    return () => offs.forEach(f => f());
  }, [remote]); // eslint-disable-line react-hooks/exhaustive-deps

  const findOpponent = async () => {
    const c = await getClient(); if (!c) return;
    try { setErr(null); setSearching(true); await c.rpc({ t: "carrot_join", stake: toZat(STAKE) }); }
    catch (e) { setSearching(false); setErr((e as Error).message); }
  };

  const peek = contextSafe(() => {
    if (!remote && local.current) setInHolder(local.current.value === "carrot:holder");
    setPeeked(true); play("slide", 0.5);
    gsap.timeline()
      .to(myLid.current, { rotation: 38, svgOrigin: "232 92", duration: 0.7, ease: "power2.out" })
      .fromTo(".mine .cbox-inside .carrot-in", { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power2.out" }, "-=0.3")
      .to(myLid.current, { rotation: 0, svgOrigin: "232 92", duration: 0.6, ease: "power2.in", delay: 1.2 })
      .to(".mine .cbox-inside .carrot-in", { y: 60, opacity: 0, duration: 0.4 }, "<")
      .add(() => setPhase("bluff"));
  });
  const bluff = async (i: number) => {
    setSaid(LINES[i]); play("chip", 0.3); setTimeout(() => setPhase("decide"), 600);
    if (remote) { const c = await getClient(); c?.send({ t: "carrot_say", room, line: i }); return; }
    setTimeout(() => decide(Math.random() < 0.5), 2200);
  };
  const decide = contextSafe(async (s: boolean) => {
    if (remote && role === "guesser") { const c = await getClient(); try { await c?.rpc({ t: "carrot_choose", room, swap: s }); } catch { /* reveal arrives as an event */ } }
    setSwap(s); play(s ? "slide" : "chip", 0.5);
    if (s) gsap.timeline().to(".mine .cbox", { x: 0, y: -40, duration: 0.25 }).to(".mine .cbox", { y: 0, duration: 0.25 });
    if (!remote && local.current) { const l = local.current; setTimeout(async () => { await openSeal({ commitment: seal.commitment, value: l.value, salt: hex(l.salt) }); setPhase("reveal"); play("stack", 0.6); }, 1200); }
  });
  useEffect(() => {
    if (phase !== "reveal") return;
    const tl = gsap.timeline()
      .to([myLid.current, theirLid.current], { rotation: 72, svgOrigin: "232 92", duration: 0.8, ease: "power3.out", stagger: 0.15 })
      .fromTo(".has-carrot .carrot-in", { y: 70, opacity: 0 }, { y: -10, opacity: 1, duration: 0.7, ease: "back.out(1.6)" }, "-=0.3");
    return () => { tl.kill(); };
  }, [phase]);
  const reset = contextSafe(async () => {
    gsap.to([myLid.current, theirLid.current], { rotation: 0, svgOrigin: "232 92", duration: 0.5 });
    gsap.to(".carrot-in", { opacity: 0, y: 60, duration: 0.3 });
    setPhase("peek"); setPeeked(false); setSaid(null); setSwap(null); setRoom(null); setInHolder(null);
    if (!remote) await dealLocal(); else setSeal({ commitment: "" });
  });

  const carrotInMine = inHolder === null ? false : role === "holder" ? inHolder : !inHolder;
  // After an optional swap, whoever holds the carrot box wins.
  const carrotHere = (side: "mine" | "theirs") => (side === "mine") === (swap ? !carrotInMine : carrotInMine);
  const iWin = phase === "reveal" && carrotHere("mine");
  const waitingRoom = remote && !room && phase !== "reveal";

  return (
    <div ref={scope} className="table-page carrot-page">
      <div className="table-head">
        <div><p className="eyebrow">Player vs player · heads-up · rake 2%</p><h1>Carrot in a Box</h1></div>
        <ol className="phases">{STEPS.map(([p, l], i) => <li key={p} className={phase === p ? "on" : STEPS.findIndex(s => s[0] === phase) > i ? "done" : ""}><span>{i + 1}</span>{l}</li>)}</ol>
      </div>
      <div className="felt carrot-felt">
        <div className="felt-print" aria-hidden="true"><span>ZECASINO</span><small>CARROT IN A BOX · WINNER TAKES THE POT</small></div>
        <div className="seat top">
          <span className="avatar"><Chip value={0.05} size={46} id="av-op" /></span>
          <div><b>anon · {opp}</b><small>Unlinkable session · {role === "holder" ? "decides keep or swap" : "holds the boxes, may bluff"}</small></div>
          {phase === "decide" && swap === null && role === "holder" && <span className="thinking">Deciding…</span>}
          {swap !== null && role === "holder" && <span className={`verdict ${swap ? "swap" : "keep"}`}>{swap ? "Swaps boxes" : "Keeps it"}</span>}
        </div>
        <div className="boxes">
          <div className={`box-slot theirs ${phase === "reveal" && carrotHere("theirs") ? "has-carrot" : ""}`}>
            <CarrotBox width={230} lidRef={theirLid} label="Opponent's box">{<div className="carrot-in"><Carrot width={110} /></div>}</CarrotBox>
            <span className="box-label">Their box</span>
          </div>
          <div className="pot"><ChipStack values={[0.05, 0.05, 0.05, 0.01]} size={52} /><span>Pot ⓩ {(STAKE * 2).toFixed(3)}</span></div>
          <div className={`box-slot mine ${(phase === "reveal" && carrotHere("mine")) ? "has-carrot" : ""}`}>
            <CarrotBox width={230} lidRef={myLid} label="Your box">{(carrotInMine && (peeked || phase === "reveal")) || phase === "reveal" ? <div className="carrot-in"><Carrot width={110} /></div> : null}</CarrotBox>
            <span className="box-label">Your box {peeked && phase !== "reveal" && <em>only you saw inside</em>}</span>
          </div>
        </div>
        {said && <div className="speech" role="status">“{said}”</div>}
        <div className="seat bottom">
          <span className="avatar"><Chip value={0.5} size={46} id="av-me" /></span>
          <div><b>You</b><small>{role === "holder" ? "Holder · you may peek, then bluff" : "Guesser · listen, then keep or swap"}</small></div>
          <div className="actions">
            {waitingRoom && <button className="btn gold lg" onClick={findOpponent} disabled={searching}>{searching ? "Finding an opponent…" : `Sit down · ⓩ ${STAKE.toFixed(3)}`}</button>}
            {!waitingRoom && role === "holder" && <>
              {phase === "peek" && <button className="btn gold lg" onClick={peek} disabled={!seal.commitment}>Peek inside</button>}
              {phase === "bluff" && LINES.map((l, i) => <button key={l} className="btn ghost" onClick={() => bluff(i)}>{l}</button>)}
              {phase === "decide" && <span className="wait">Waiting for their decision</span>}
            </>}
            {!waitingRoom && role === "guesser" && phase !== "reveal" && (phase === "decide" && swap === null
              ? <><button className="btn ghost lg" onClick={() => decide(false)}>Keep my box</button><button className="btn gold lg" onClick={() => decide(true)}>Swap boxes</button></>
              : <span className="wait">{swap === null ? "They're peeking…" : "Opening the boxes…"}</span>)}
            {phase === "reveal" && <><span className={`outcome ${iWin ? "win" : "lose"}`}>{iWin ? `The carrot is yours. You win ⓩ ${(STAKE * 2 * 0.98).toFixed(4)}` : "They found the carrot."}</span><button className="btn gold" onClick={reset}>Next round</button></>}
          </div>
        </div>
      </div>
      {err && <div className="result-toast" role="alert"><span>{err}</span></div>}
      <aside className="fair">
        <h4>Sealed box</h4>
        <dl>
          <dt>Commitment (published before the peek)</dt><dd className="mono">{short(seal.commitment)}</dd>
          <dt>Dealer</dt><dd className="mono">{remote ? "game server · live room" : "in-browser table (server offline)"}</dd>
          {seal.salt && <><dt>Opened value</dt><dd className="mono">{seal.value}</dd><dt>Salt</dt><dd className="mono">{short(seal.salt)}</dd>
            <dt>Check</dt><dd className={`mono ${seal.ok ? "ok" : "bad"}`}>{seal.ok ? "✓ SHA-256 matches the commitment" : "✗ does not match"}</dd></>}
        </dl>
        <p className="note">The carrot&apos;s box is sealed as SHA-256(“zecasino:commit:v1”‖len‖salt‖box) before anyone peeks. At reveal the salt opens it and your browser recomputes the hash, so nobody can move the carrot after hearing the bluff.</p>
      </aside>
    </div>
  );
}
