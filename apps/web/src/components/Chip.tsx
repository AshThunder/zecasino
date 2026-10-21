import { denomFor } from "@/lib/chips";
/** Casino chip: edge inserts, inlay ring, denomination and ⓩ. Pure SVG. */
export function Chip({ value, size = 56, tilt = false, id }: { value: number; size?: number; tilt?: boolean; id?: string }) {
  const d = denomFor(value);
  const uid = id ?? `c${String(value).replace(".", "")}`;
  const inserts = Array.from({ length: 8 }, (_, i) => i * 45);
  return (
    <svg className="chip" width={size} height={size} viewBox="0 0 100 100" aria-label={`${d.label} TAZ chip`}>
      <defs>
        <radialGradient id={`${uid}-sh`} cx="40%" cy="35%" r="75%">
          <stop offset="0" stopColor="#fff" stopOpacity=".28" /><stop offset=".6" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".28" />
        </radialGradient>
      </defs>
      <g transform={tilt ? "scale(1,.9) translate(0,-1)" : undefined}>
        {tilt && <circle cx="50" cy="56" r="47" fill={d.edge} stroke="#000" strokeOpacity=".45" />}
        <circle cx="50" cy="50" r="47" fill={d.base} />
        {inserts.map(a => (
          <rect key={a} x="44" y="3" width="12" height="15" rx="1.5" fill={d.edge} transform={`rotate(${a} 50 50)`} />
        ))}
        <circle cx="50" cy="50" r="33" fill={d.base} stroke={d.edge} strokeWidth="2" />
        <circle cx="50" cy="50" r="29" fill="none" stroke={d.ink} strokeOpacity=".5" strokeWidth=".8" strokeDasharray="2 2.6" />
        <text x="50" y="47" textAnchor="middle" fontFamily="var(--font-display), serif" fontWeight="700" fontSize="19" fill={d.ink}>{d.label}</text>
        <text x="50" y="66" textAnchor="middle" fontFamily="var(--font-body), sans-serif" fontWeight="700" fontSize="9" letterSpacing="1.6" fill={d.ink}>ⓩ TAZ</text>
        <circle cx="50" cy="50" r="47" fill={`url(#${uid}-sh)`} />
        <circle cx="50" cy="50" r="46.5" fill="none" stroke="#000" strokeOpacity=".35" />
      </g>
    </svg>
  );
}
/** A short stack of chips seen from the side, offset per chip. */
export function ChipStack({ values, size = 48 }: { values: number[]; size?: number }) {
  return (
    <div className="chip-stack" style={{ width: size, height: size + values.length * 5 }}>
      {values.map((v, i) => (
        <div key={i} style={{ position: "absolute", left: 0, bottom: i * 5 }}><Chip value={v} size={size} tilt id={`st${i}-${String(v).replace(".", "")}`} /></div>
      ))}
    </div>
  );
}
