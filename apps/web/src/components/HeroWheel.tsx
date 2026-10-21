"use client";
import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { RouletteWheel } from "./RouletteWheel";
import { Chip } from "./Chip";

export function HeroWheel() {
  const scope = useRef<HTMLDivElement>(null);
  const wheel = useRef<SVGGElement>(null);
  const orbit = useRef<SVGGElement>(null);
  useGSAP(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    gsap.to(wheel.current, { rotation: 360, duration: 40, ease: "none", repeat: -1, svgOrigin: "0 0" });
    gsap.to(orbit.current, { rotation: -360, duration: 9, ease: "none", repeat: -1, svgOrigin: "0 0" });
    gsap.from(".hero-chip", { y: -40, opacity: 0, stagger: 0.12, duration: 0.8, ease: "back.out(1.6)", delay: 0.3 });
  }, { scope });
  return (
    <div ref={scope} className="hero-wheel">
      <div className="felt-disc" />
      <RouletteWheel size={500} wheelRef={wheel} ballOrbitRef={orbit} />
      <div className="hero-chip c1"><Chip value={0.5} size={84} id="h1" /></div>
      <div className="hero-chip c2"><Chip value={0.05} size={70} id="h2" /></div>
      <div className="hero-chip c3"><Chip value={0.01} size={62} id="h3" /></div>
    </div>
  );
}
