import type { Ref } from "react";
import { WHEEL_ORDER, colorOf } from "@/lib/roulette";

const STEP = 360 / 37;
const pt = (r: number, deg: number) => { const a = (deg * Math.PI) / 180; return [r * Math.sin(a), -r * Math.cos(a)] as const; };
const wedge = (r0: number, r1: number, a0: number, a1: number) => {
  const [x0, y0] = pt(r1, a0), [x1, y1] = pt(r1, a1), [x2, y2] = pt(r0, a1), [x3, y3] = pt(r0, a0);
  return `M${x0} ${y0}A${r1} ${r1} 0 0 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 0 0 ${x3} ${y3}Z`;
};
const FILL = { red: "#A8161F", black: "#141416", green: "#0F6B3E" } as const;

/** Accurate European single-zero wheel. Pocket i is centred at i*STEP degrees clockwise from top. */
export function RouletteWheel({ size = 420, wheelRef, ballOrbitRef, ballRef, showBall = true }: {
  size?: number; wheelRef?: Ref<SVGGElement>; ballOrbitRef?: Ref<SVGGElement>; ballRef?: Ref<SVGCircleElement>; showBall?: boolean;
}) {
  return (
    <svg className="wheel" width={size} height={size} viewBox="-205 -205 410 410" role="img" aria-label="European roulette wheel">
      <defs>
        <radialGradient id="rw-wood" r="1"><stop offset=".78" stopColor="#4A2412" /><stop offset=".9" stopColor="#7A3E1C" /><stop offset="1" stopColor="#2C1408" /></radialGradient>
        <radialGradient id="rw-track" r="1"><stop offset=".72" stopColor="#1B110B" /><stop offset=".85" stopColor="#3A2618" /><stop offset="1" stopColor="#120B06" /></radialGradient>
        <radialGradient id="rw-cone" r="1"><stop offset="0" stopColor="#9C5A2A" /><stop offset=".7" stopColor="#5B2E14" /><stop offset="1" stopColor="#2E1609" /></radialGradient>
        <linearGradient id="rw-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFE7A3" /><stop offset=".5" stopColor="#D9A23A" /><stop offset="1" stopColor="#8A5E12" /></linearGradient>
        <radialGradient id="rw-ball" cx="35%" cy="30%" r="70%"><stop offset="0" stopColor="#fff" /><stop offset=".6" stopColor="#E7E3DA" /><stop offset="1" stopColor="#9A958A" /></radialGradient>
      </defs>
      <circle r="203" fill="url(#rw-wood)" />
      <circle r="176" fill="url(#rw-track)" stroke="url(#rw-gold)" strokeWidth="2" />
      {Array.from({ length: 8 }, (_, i) => { const [x, y] = pt(162, i * 45 + 22.5); return <path key={i} d={`M${x} ${y - 7}l5 7-5 7-5-7z`} fill="url(#rw-gold)" />; })}
      <g ref={wheelRef}>
        {WHEEL_ORDER.map((n, i) => {
          const a0 = i * STEP - STEP / 2, a1 = a0 + STEP; const [tx, ty] = pt(131, i * STEP);
          return (
            <g key={n}>
              <path d={wedge(112, 150, a0, a1)} fill={FILL[colorOf(n)]} />
              <path d={wedge(98, 112, a0, a1)} fill={FILL[colorOf(n)]} opacity=".75" />
              <text x={tx} y={ty} transform={`rotate(${i * STEP} ${tx} ${ty})`} textAnchor="middle" dominantBaseline="central"
                fontFamily="var(--font-display), serif" fontWeight="700" fontSize="15" fill="#F6EEDC">{n}</text>
            </g>
          );
        })}
        {WHEEL_ORDER.map((_, i) => { const a = i * STEP - STEP / 2; const [x0, y0] = pt(98, a), [x1, y1] = pt(150, a); return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke="url(#rw-gold)" strokeWidth="1.6" />; })}
        <circle r="150" fill="none" stroke="url(#rw-gold)" strokeWidth="2.5" />
        <circle r="112" fill="none" stroke="url(#rw-gold)" strokeWidth="1.2" />
        <circle r="98" fill="url(#rw-cone)" stroke="url(#rw-gold)" strokeWidth="2" />
        {Array.from({ length: 4 }, (_, i) => <rect key={i} x="-3" y="-72" width="6" height="144" rx="3" fill="url(#rw-gold)" transform={`rotate(${i * 45 + 22.5})`} />)}
        <circle r="26" fill="url(#rw-gold)" /><circle r="17" fill="#2E1609" /><circle r="9" fill="url(#rw-gold)" />
        <g transform="scale(.42)"><path d="M-13 -17h26v6.5L-4.5 10H13v7h-26v-6.5L4.5 -10H-13z" fill="#F4B728" /></g>
      </g>
      {showBall && (
        <g ref={ballOrbitRef}><circle ref={ballRef} cx="0" cy="-165" r="6.5" fill="url(#rw-ball)" stroke="#0006" strokeWidth=".6" /></g>
      )}
    </svg>
  );
}
export const POCKET_STEP = STEP;
