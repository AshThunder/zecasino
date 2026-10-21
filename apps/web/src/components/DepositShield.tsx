"use client";
import { toast } from "@/lib/toast";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { getClient } from "@/lib/server";
import { reducedMotion } from "@/lib/motion";
import { play } from "@/lib/sfx";

/** When the house viewing key finds this session's deposit: a shield draws itself, closes, and the amount lands. */
export function DepositShield() {
  const [dep, setDep] = useState<number | null>(null); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { let un = () => {}; getClient().then(c => { if (c) un = c.on("deposit", m => setDep(m.zat / 1e8)); }); return () => un(); }, []);
  useEffect(() => {
    const el = ref.current; if (dep === null || !el) return;
    play("stack", 0.6);
    toast({ kind: "success", title: `Shielded deposit ⓩ ${dep.toFixed(4)} arrived`, body: "Credited after the house viewing key found your note." });
    if (reducedMotion()) { const t = setTimeout(() => setDep(null), 3200); return () => clearTimeout(t); }
    const path = el.querySelector<SVGPathElement>(".ds-outline")!; const len = path.getTotalLength();
    const tl = gsap.timeline({ onComplete: () => setDep(null) });
    tl.fromTo(el, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.3, ease: "power2.out" })
      .fromTo(path, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 0.9, ease: "power2.inOut" }, 0.1)
      .fromTo(el.querySelector(".ds-fill"), { opacity: 0, scale: 0.6, transformOrigin: "50% 55%" }, { opacity: 1, scale: 1, duration: 0.45, ease: "back.out(2)" }, 0.8)
      .fromTo(el.querySelector(".ds-check"), { strokeDashoffset: 20 }, { strokeDashoffset: 0, duration: 0.35, ease: "power2.out" }, 1.1)
      .fromTo(el.querySelectorAll(".ds-text > *"), { opacity: 0, y: 8 }, { opacity: 1, y: 0, stagger: 0.1, duration: 0.35 }, 1.1)
      .to(el, { opacity: 0, y: -10, duration: 0.4, ease: "power2.in" }, 3.6);
    return () => { tl.kill(); };
  }, [dep]);
  if (dep === null) return null;
  return (
    <div ref={ref} className="deposit-shield" role="status" aria-live="polite">
      <svg width="64" height="74" viewBox="0 0 64 74" aria-hidden="true">
        <path className="ds-fill" d="M32 6 56 15v18c0 17-11 29-24 35C19 62 8 50 8 33V15z" fill="#F4B72822" />
        <path className="ds-outline" d="M32 4 58 14v19c0 18-12 31-26 37C18 64 6 51 6 33V14z" fill="none" stroke="#F4B728" strokeWidth="2.5" strokeLinejoin="round" />
        <path className="ds-check" d="m21 37 8 8 15-16" fill="none" stroke="#F4B728" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="20 40" />
      </svg>
      <div className="ds-text"><small>Shielded deposit found</small><b>ⓩ {dep.toFixed(4)}</b><span>Seen only with the house viewing key</span></div>
    </div>
  );
}
