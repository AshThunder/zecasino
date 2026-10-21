"use client";
import { CloseX, backdropClose } from "./CloseX";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { gsap } from "gsap";
import { reducedMotion } from "@/lib/motion";
import { ZMark } from "./ZMark";

const STEPS = [
  { k: "Deposit", t: "Send from any shielded wallet to a one-time Orchard address. On chain it is an encrypted note: no address, no amount." },
  { k: "Play", t: "Bets settle in the house ledger, off chain. Every outcome comes from a seed committed before you bet, and your browser checks it." },
  { k: "Withdraw", t: "Cash out to any shielded address. Again the chain sees one encrypted note, unlinkable to your deposit." },
];
const Note = ({ cls }: { cls: string }) => (
  <svg className={`wt-note ${cls}`} width="58" height="40" viewBox="0 0 58 40" aria-hidden="true"><rect x="1" y="1" width="56" height="38" rx="6" fill="#1a1408" stroke="#F4B728" strokeWidth="1.5" /><path d="M1 7l28 17L57 7" fill="none" stroke="#F4B728" strokeWidth="1.5" /><circle cx="46" cy="30" r="5" fill="#F4B728" /></svg>
);

/** ~20 s guided tour: shielded deposit in → play → shielded withdrawal out. Skippable; static storyboard under reduced motion. */
export function Walkthrough({ onClose }: { onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const tl = useRef<gsap.core.Timeline | null>(null);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [still] = useState(() => reducedMotion());
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k); document.body.style.overflow = "hidden";
    root.current?.querySelector<HTMLButtonElement>(".wt-skip")?.focus();
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [onClose]);
  useEffect(() => {
    if (still || !root.current) return;
    const ctx = gsap.context(() => {
      const t = gsap.timeline({ onComplete: () => setDone(true) });
      const W = () => root.current!.querySelector<HTMLElement>(".wt-stage")!.clientWidth;
      const mid = () => W() * .5 - W() * (innerWidth < 641 ? .15 : .1) - 29, end = () => W() * .8 - W() * (innerWidth < 641 ? .15 : .1) - 29;
      const bal = { v: 0 }; const balEl = root.current!.querySelector(".wt-bal b")!;
      const show = (n: number) => () => setStep(n);
      t.set(".wt-progress i", { scaleX: 0 }).to(".wt-progress i", { scaleX: 1, duration: 20, ease: "none" }, 0);
      // 1 · deposit (0–7 s)
      t.call(show(0), [], 0)
        .from(".wt-wallet.in, .wt-pool, .wt-house", { autoAlpha: 0, y: 14, stagger: .2, duration: .6, ease: "power3.out" }, .2)
        .fromTo(".wt-note.n1", { x: 0, y: 0, autoAlpha: 0 }, { autoAlpha: 1, duration: .3 }, 1.4)
        .to(".wt-note.n1", { x: mid, duration: 1.6, ease: "power2.inOut" }, 1.7)
        .to(".wt-pool", { boxShadow: "0 0 0 10px #F4B72822, 0 0 50px #F4B72866", duration: .4, yoyo: true, repeat: 1 }, 3.1)
        .fromTo(".wt-chainline", { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: .4 }, 3.3)
        .to(".wt-note.n1", { x: end, duration: 1.4, ease: "power2.inOut" }, 3.9)
        .to(".wt-note.n1", { autoAlpha: 0, scale: .6, duration: .3 }, 5.3)
        .to(bal, { v: 0.5, duration: 1, ease: "power1.out", onUpdate: () => { balEl.textContent = bal.v.toFixed(3); } }, 5.3)
        .to(".wt-chainline", { autoAlpha: 0, duration: .3 }, 6.6);
      // 2 · play (7–13.5 s)
      t.call(show(1), [], 7)
        .fromTo(".wt-table", { autoAlpha: 0, scale: .92 }, { autoAlpha: 1, scale: 1, duration: .5, ease: "power3.out" }, 7)
        .fromTo(".wt-card", { x: 120, y: -60, rotation: 12, autoAlpha: 0 }, { x: 0, y: 0, rotation: 0, autoAlpha: 1, stagger: .25, duration: .55, ease: "power3.out" }, 7.6)
        .to(".wt-card .back", { rotationY: -180, stagger: .25, duration: .45 }, 8.6).to(".wt-card .face", { rotationY: 0, stagger: .25, duration: .45 }, 8.6)
        .fromTo(".wt-seal", { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: .4 }, 9.6)
        .to(bal, { v: 0.62, duration: .9, onUpdate: () => { balEl.textContent = bal.v.toFixed(3); } }, 10.6)
        .fromTo(".wt-win", { autoAlpha: 0, scale: .7 }, { autoAlpha: 1, scale: 1, duration: .4, ease: "back.out(2)" }, 10.6)
        .to(".wt-table", { autoAlpha: 0, duration: .4 }, 13);
      // 3 · withdraw (13.5–20 s)
      t.call(show(2), [], 13.5)
        .fromTo(".wt-wallet.out", { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: .5 }, 13.5)
        .to(".wt-wallet.in", { autoAlpha: 0, duration: .4 }, 13.4)
        .fromTo(".wt-note.n2", { x: end, autoAlpha: 0 }, { autoAlpha: 1, duration: .3 }, 14.1)
        .to(bal, { v: 0, duration: .8, onUpdate: () => { balEl.textContent = bal.v.toFixed(3); } }, 14.1)
        .to(".wt-note.n2", { x: mid, duration: 1.4, ease: "power2.inOut" }, 14.4)
        .to(".wt-pool", { boxShadow: "0 0 0 10px #F4B72822, 0 0 50px #F4B72866", duration: .4, yoyo: true, repeat: 1 }, 15.6)
        .fromTo(".wt-chainline", { autoAlpha: 0 }, { autoAlpha: 1, duration: .4 }, 15.8)
        .to(".wt-note.n2", { x: 0, duration: 1.4, ease: "power2.inOut" }, 16.4)
        .to(".wt-note.n2", { autoAlpha: 0, duration: .3 }, 17.9)
        .fromTo(".wt-unlink", { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: .5 }, 18.2)
        .to({}, { duration: 1.6 });
      tl.current = t;
    }, root);
    return () => ctx.revert();
  }, [still]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);
  const replay = () => { setDone(false); tl.current?.restart(); };
  return createPortal(
    <div className="wt-backdrop" role="dialog" aria-modal="true" aria-label="How Zecasino works" onClick={backdropClose(onClose)}>
      <div ref={root} className="wt">
        <CloseX onClick={onClose} />
        <div className="wt-top"><p className="eyebrow">How it works · 20 seconds</p><button className="btn ghost sm wt-skip" onClick={onClose}>{done || still ? "Close" : "Skip"}</button></div>
        {still ? (
          <ol className="wt-board">{STEPS.map((s, i) => <li key={s.k}><span className="mono">{i + 1}</span><h3>{s.k}</h3><p>{s.t}</p></li>)}</ol>
        ) : <>
          <div className="wt-stage">
            <div className="wt-wallet in"><svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><rect x="4" y="10" width="32" height="22" rx="5" fill="none" stroke="#F5F1E6" strokeWidth="1.6" /><path d="M26 18h10v8H26a4 4 0 0 1 0-8Z" fill="none" stroke="#F5F1E6" strokeWidth="1.6" /></svg><small>Your wallet</small></div>
            <div className="wt-pool"><ZMark size={34} /><small>Orchard shielded pool</small></div>
            <div className="wt-house"><div className="wt-bal"><small>Session balance</small><b className="mono">0.000</b><span> TAZ</span></div></div>
            <div className="wt-wallet out"><svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><rect x="4" y="10" width="32" height="22" rx="5" fill="none" stroke="#F4B728" strokeWidth="1.6" /><path d="M26 18h10v8H26a4 4 0 0 1 0-8Z" fill="none" stroke="#F4B728" strokeWidth="1.6" /></svg><small>Any shielded wallet</small></div>
            <Note cls="n1" /><Note cls="n2" />
            <p className="wt-chainline mono">chain sees: nullifier · cmx · 580-byte ciphertext</p>
            <div className="wt-table">
              <div className="wt-cards">{["A♠", "K♥"].map((c, i) => <div key={c} className="wt-card"><span className="back" /><span className={`face ${i ? "red" : ""}`}>{c}</span></div>)}</div>
              <p className="wt-seal mono">seed committed · SHA-256 3f9a…c21e ✓ verified</p>
              <b className="wt-win mono">+0.120</b>
            </div>
            <p className="wt-unlink">Deposit and withdrawal share nothing a block explorer can link.</p>
          </div>
          <div className="wt-caption" aria-live="polite"><span className="mono">{step + 1}/3</span><h3>{STEPS[step].k}</h3><p>{STEPS[step].t}</p></div>
          <div className="wt-progress" aria-hidden="true"><i /></div>
          {done && <button className="btn link sm wt-replay" onClick={replay}>Replay</button>}
        </>}
        <p className="wt-fine">Illustration. Amounts shown are examples, not live data.</p>
      </div>
    </div>, document.body);
}
