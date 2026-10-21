import type { Ref, ReactNode } from "react";
/** Wooden keepsake box with hinged lid (lid animated via lidRef) and brass Zcash plate. */
export function CarrotBox({ width = 220, lidRef, label, children }: { width?: number; lidRef?: Ref<SVGGElement>; label: string; children?: ReactNode }) {
  return (
    <div className="cbox" style={{ width, height: width * 0.95 }}>
      <div className="cbox-inside">{children}</div>
      <svg width={width} height={width * 0.95} viewBox="0 0 240 228" aria-label={label}>
        <defs>
          <linearGradient id="bx-wood" x1="0" x2="1"><stop offset="0" stopColor="#5A2F17" /><stop offset=".5" stopColor="#8A4D25" /><stop offset="1" stopColor="#4C2612" /></linearGradient>
          <linearGradient id="bx-lid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9C5B2E" /><stop offset="1" stopColor="#6A381A" /></linearGradient>
          <linearGradient id="bx-brass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFE7A3" /><stop offset=".5" stopColor="#D9A23A" /><stop offset="1" stopColor="#8A5E12" /></linearGradient>
          <pattern id="bx-grain" width="240" height="14" patternUnits="userSpaceOnUse"><path d="M0 7c40-4 80 4 120 0s80-4 120 0" fill="none" stroke="#2B1407" strokeOpacity=".22" /></pattern>
        </defs>
        <ellipse cx="120" cy="216" rx="112" ry="10" fill="#000" opacity=".4" />
        {/* body front: open top so the inside layer shows through */}
        <path d="M14 96h212v110a8 8 0 0 1-8 8H22a8 8 0 0 1-8-8z" fill="url(#bx-wood)" />
        <path d="M14 96h212v110a8 8 0 0 1-8 8H22a8 8 0 0 1-8-8z" fill="url(#bx-grain)" />
        <rect x="14" y="96" width="212" height="10" fill="#2B1407" opacity=".5" />
        {[22, 210].map(x => <rect key={x} x={x} y="104" width="8" height="106" rx="2" fill="url(#bx-brass)" opacity=".9" />)}
        <rect x="92" y="138" width="56" height="38" rx="4" fill="url(#bx-brass)" stroke="#5C3C08" />
        <path d="M110 147h20v4l-13 15h13v4h-20v-4l13-15h-13z" fill="#3A2606" />
        <g ref={lidRef} style={{ transformOrigin: "120px 96px" }}>
          <path d="M8 60q112-30 224 0v36H8z" fill="url(#bx-lid)" stroke="#2B1407" strokeOpacity=".6" />
          <path d="M8 60q112-30 224 0v36H8z" fill="url(#bx-grain)" />
          <rect x="8" y="88" width="224" height="8" fill="url(#bx-brass)" />
          <rect x="108" y="84" width="24" height="20" rx="3" fill="url(#bx-brass)" stroke="#5C3C08" />
        </g>
      </svg>
    </div>
  );
}
