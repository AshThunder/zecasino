/** Printed felt text along an arc, as on a real table layout. */
export function FeltArc({ lines, width = 760 }: { lines: { text: string; size: number; color?: string; r: number }[]; width?: number }) {
  return (
    <svg className="felt-arc" width={width} height={width * 0.32} viewBox="-400 -20 800 260" aria-hidden="true">
      {lines.map((l, i) => (
        <g key={i}>
          <path id={`arc${i}-${l.r}`} d={`M${-l.r} ${i * 30}A${l.r} ${l.r * 0.42} 0 0 0 ${l.r} ${i * 30}`} fill="none" />
          <text fontFamily="var(--font-display), serif" fontWeight="700" fontSize={l.size} letterSpacing={l.size * 0.22} fill={l.color ?? "#E9C46A"} textAnchor="middle">
            <textPath href={`#arc${i}-${l.r}`} startOffset="50%">{l.text}</textPath>
          </text>
        </g>
      ))}
    </svg>
  );
}
