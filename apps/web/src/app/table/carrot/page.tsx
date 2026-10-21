"use client";
import { useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { CarrotBox } from "@/components/CarrotBox";
import { Carrot } from "@/components/Carrot";
import { ChipStack, Chip } from "@/components/Chip";
import { FairPanel } from "@/components/FairPanel";
import { play } from "@/lib/sfx";

type Phase = "peek" | "bluff" | "decide" | "reveal";
const LINES = ["I've got the carrot.", "Mine's empty. Want to swap?", "You should keep yours.", "I'd swap if I were you."];
const STEPS: [Phase, string][] = [["peek", "Peek"], ["bluff", "Bluff"], ["decide", "Keep or swap"], ["reveal", "Reveal"]];

export default function CarrotTable() {
  const scope = useRef<HTMLDivElement>(null);
  const myLid = useRef<SVGGElement>(null), theirLid = useRef<SVGGElement>(null);
  const [phase, setPhase] = useState<Phase>("peek");
  const [peeked, setPeeked] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [swap, setSwap] = useState<boolean | null>(null);
  const [carrotInMine] = useState(true); // mock: dealt by the committed seed
  const { contextSafe } = useGSAP(() => {
    gsap.from(".cbox", { y: 30, opacity: 0, stagger: 0.15, duration: 0.7, ease: "power3.out" });
    gsap.from(".pot .chip-stack", { y: -60, opacity: 0, duration: 0.6, ease: "back.out(1.8)", delay: 0.4 });
  }, { scope });

  const peek = contextSafe(() => {
    setPeeked(true); play("slide", 0.5);
    gsap.timeline()
      .to(myLid.current, { rotation: 38, svgOrigin: "232 92", duration: 0.7, ease: "power2.out" })
      .fromTo(".mine .cbox-inside .carrot-in", { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power2.out" }, "-=0.3")
      .to(myLid.current, { rotation: 0, svgOrigin: "232 92", duration: 0.6, ease: "power2.in", delay: 1.2 })
      .to(".mine .cbox-inside .carrot-in", { y: 60, opacity: 0, duration: 0.4 }, "<")
      .add(() => setPhase("bluff"));
  });
  const bluff = (l: string) => { setSaid(l); play("chip", 0.3); setTimeout(() => setPhase("decide"), 600); setTimeout(() => decide(Math.random() < 0.5), 2200); };
  const decide = contextSafe((s: boolean) => {
    setSwap(s); play(s ? "slide" : "chip", 0.5);
    if (s) gsap.timeline().to(".mine .cbox", { x: 0, y: -40, duration: 0.25 }).to(".mine .cbox", { y: 0, duration: 0.25 });
    setTimeout(() => reveal(), 1200);
  });
  const reveal = contextSafe(() => {
    setPhase("reveal"); play("stack", 0.6);
    gsap.timeline()
      .to([myLid.current, theirLid.current], { rotation: 72, svgOrigin: "232 92", duration: 0.8, ease: "power3.out", stagger: 0.15 })
      .fromTo(".has-carrot .carrot-in", { y: 70, opacity: 0 }, { y: -10, opacity: 1, duration: 0.7, ease: "back.out(1.6)" }, "-=0.3");
  });
  const reset = contextSafe(() => {
    gsap.to([myLid.current, theirLid.current], { rotation: 0, svgOrigin: "232 92", duration: 0.5 });
    gsap.to(".carrot-in", { opacity: 0, y: 60, duration: 0.3 });
    setPhase("peek"); setPeeked(false); setSaid(null); setSwap(null);
  });

  // After an optional swap, whoever holds the carrot box wins.
  const iWin = phase === "reveal" && (swap ? !carrotInMine : carrotInMine);
  const carrotHere = (side: "mine" | "theirs") => (side === "mine") === (swap ? !carrotInMine : carrotInMine);

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
          <div><b>anon · 3c9e</b><small>Unlinkable session · decides keep or swap</small></div>
          {phase === "decide" && swap === null && <span className="thinking">Deciding…</span>}
          {swap !== null && <span className={`verdict ${swap ? "swap" : "keep"}`}>{swap ? "Swaps boxes" : "Keeps it"}</span>}
        </div>
        <div className="boxes">
          <div className={`box-slot theirs ${phase === "reveal" && carrotHere("theirs") ? "has-carrot" : ""}`}>
            <CarrotBox width={230} lidRef={theirLid} label="Opponent's box">{<div className="carrot-in"><Carrot width={110} /></div>}</CarrotBox>
            <span className="box-label">Their box</span>
          </div>
          <div className="pot"><ChipStack values={[0.05, 0.05, 0.05, 0.01]} size={52} /><span>Pot ⓩ 0.160</span></div>
          <div className={`box-slot mine ${(phase === "reveal" && carrotHere("mine")) ? "has-carrot" : ""}`}>
            <CarrotBox width={230} lidRef={myLid} label="Your box">{carrotInMine || phase === "reveal" ? <div className="carrot-in"><Carrot width={110} /></div> : null}</CarrotBox>
            <span className="box-label">Your box {peeked && phase !== "reveal" && <em>only you saw inside</em>}</span>
          </div>
        </div>
        {said && <div className="speech" role="status">“{said}”</div>}
        <div className="seat bottom">
          <span className="avatar"><Chip value={0.5} size={46} id="av-me" /></span>
          <div><b>You</b><small>Holder · you may peek, then bluff</small></div>
          <div className="actions">
            {phase === "peek" && <button className="btn gold lg" onClick={peek}>Peek inside</button>}
            {phase === "bluff" && LINES.map(l => <button key={l} className="btn ghost" onClick={() => bluff(l)}>{l}</button>)}
            {phase === "decide" && <span className="wait">Waiting for their decision</span>}
            {phase === "reveal" && <><span className={`outcome ${iWin ? "win" : "lose"}`}>{iWin ? "The carrot is yours. You win ⓩ 0.157" : "They found the carrot."}</span><button className="btn gold" onClick={reset}>Next round</button></>}
          </div>
        </div>
      </div>
      <FairPanel commitment="box: 4e0d9a71…b3c2f018" clientSeed="both players' seeds mixed" nonce={7}
        extra={<p className="note">The carrot's box is sealed as SHA-256(“zecasino:commit:v1”‖salt‖box) before you peek. At reveal, the salt opens it, so neither the house nor your opponent can move the carrot.</p>} />
    </div>
  );
}
