"use client";
import { RED } from "@/lib/roulette";
import { Chip } from "./Chip";

export type BetKey = string; // "n:17", "red", "black", "even", "odd", "low", "high", "doz:1", "col:1"
const W = 62, H = 74, X0 = 70, Y0 = 10;
type Cell = { key: BetKey; x: number; y: number; w: number; h: number; label: string; fill: string; rot?: boolean };
const cells: Cell[] = [];
cells.push({ key: "n:0", x: 10, y: Y0, w: X0 - 10, h: H * 3, label: "0", fill: "#0F6B3E" });
for (let c = 0; c < 12; c++) for (let r = 0; r < 3; r++) {
  const n = c * 3 + (3 - r);
  cells.push({ key: `n:${n}`, x: X0 + c * W, y: Y0 + r * H, w: W, h: H, label: String(n), fill: RED.has(n) ? "#A8161F" : "#141416" });
}
for (let r = 0; r < 3; r++) cells.push({ key: `col:${3 - r}`, x: X0 + 12 * W, y: Y0 + r * H, w: W, h: H, label: "2 to 1", fill: "transparent", rot: true });
["1st 12", "2nd 12", "3rd 12"].forEach((l, i) => cells.push({ key: `doz:${i + 1}`, x: X0 + i * 4 * W, y: Y0 + 3 * H, w: 4 * W, h: 58, label: l, fill: "transparent" }));
[["low", "1–18"], ["even", "EVEN"], ["red", "◆"], ["black", "◆"], ["odd", "ODD"], ["high", "19–36"]].forEach(([k, l], i) =>
  cells.push({ key: k, x: X0 + i * 2 * W, y: Y0 + 3 * H + 58, w: 2 * W, h: 58, label: l, fill: "transparent" }));

export function RouletteLayout({ bets, onBet, highlight }: { bets: Record<BetKey, number[]>; onBet: (k: BetKey) => void; highlight?: number | null }) {
  return (
    <svg className="layout" viewBox={`0 0 ${X0 + 13 * W + 10} ${Y0 + 3 * H + 126}`} role="group" aria-label="Roulette betting layout">
      {cells.map(c => {
        const lit = highlight != null && c.key === `n:${highlight}`;
        return (
          <g key={c.key} className="lcell" onClick={() => onBet(c.key)} role="button" aria-label={`Bet ${c.key === "red" ? "Red" : c.key === "black" ? "Black" : c.label}`} tabIndex={0}
             onKeyDown={e => (e.key === "Enter" || e.key === " ") && onBet(c.key)}>
            {c.key === "n:0"
              ? <path d={`M${c.x + c.w} ${c.y}H${c.x + 18}L${c.x} ${c.y + c.h / 2}L${c.x + 18} ${c.y + c.h}H${c.x + c.w}Z`} fill={c.fill} stroke="#E9DFC6" strokeWidth="2" />
              : <rect x={c.x} y={c.y} width={c.w} height={c.h} fill={c.fill} stroke="#E9DFC6" strokeWidth="2" />}
            {lit && <rect x={c.x + 4} y={c.y + 4} width={c.w - 8} height={c.h - 8} fill="none" stroke="#F4B728" strokeWidth="3" className="lit" />}
            {c.key === "red" || c.key === "black"
              ? <path d={`M${c.x + c.w / 2} ${c.y + 13}l26 16-26 16-26-16z`} fill={c.key === "red" ? "#A8161F" : "#141416"} stroke="#E9DFC6" strokeWidth="1.5" />
              : <text x={c.x + c.w / 2} y={c.y + c.h / 2} textAnchor="middle" dominantBaseline="central"
                  transform={c.rot ? `rotate(-90 ${c.x + c.w / 2} ${c.y + c.h / 2})` : undefined}
                  fontFamily="var(--font-display), serif" fontWeight="600" fontSize={c.key.startsWith("n:") ? 26 : 19} fill="#F3ECDD"
                  style={c.key.startsWith("n:") && c.key !== "n:0" ? undefined : { letterSpacing: 1 }}>
                  <tspan transform={c.key.startsWith("n:") ? "" : ""}>{c.label}</tspan>
                </text>}
            {(bets[c.key] ?? []).map((v, i) => (
              <foreignObject key={i} x={c.x + c.w / 2 - 19} y={c.y + c.h / 2 - 19 - i * 4} width="38" height="38" pointerEvents="none">
                <Chip value={v} size={38} id={`lb-${c.key.replace(":", "")}-${i}`} />
              </foreignObject>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
