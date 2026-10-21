const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]], 5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
};
/** Ivory casino die with drilled, painted pips. */
export function Die({ value, size = 56, color = "ivory" }: { value: number; size?: number; color?: "ivory" | "ruby" }) {
  const body = color === "ruby" ? ["#C9283A", "#7E0F1C"] : ["#FFFDF6", "#D9D0BC"];
  const pip = color === "ruby" ? "#FFF7EA" : "#1A1A1D";
  const id = `die-${color}`;
  return (
    <svg className="die" width={size} height={size} viewBox="0 0 100 100" aria-label={`Die showing ${value}`}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={body[0]} /><stop offset="1" stopColor={body[1]} /></linearGradient></defs>
      <rect x="4" y="4" width="92" height="92" rx="20" fill={`url(#${id})`} stroke="#0004" />
      <rect x="10" y="9" width="80" height="80" rx="15" fill="none" stroke="#fff" strokeOpacity=".5" />
      {PIPS[value].map(([x, y], i) => <g key={i}><circle cx={x} cy={y + 1.2} r="9" fill="#fff" opacity=".35" /><circle cx={x} cy={y} r="8.5" fill={pip} /></g>)}
    </svg>
  );
}
