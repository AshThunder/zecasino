/** Zecasino card back: guilloché rosette with the ⓩ mark, oxblood and gold. */
export function CardBack({ width = 120 }: { width?: number }) {
  const petals = Array.from({ length: 24 }, (_, i) => i * 15);
  return (
    <svg width={width} height={width * 1.4} viewBox="0 0 250 350" className="card-back" aria-label="Card back">
      <defs>
        <pattern id="cb-lat" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="12" height="12" fill="#5E1420" /><path d="M0 6h12M6 0v12" stroke="#C99A2E" strokeOpacity=".35" strokeWidth=".8" />
        </pattern>
      </defs>
      <rect x="1" y="1" width="248" height="348" rx="16" fill="#FBF7EE" stroke="#0003" />
      <rect x="12" y="12" width="226" height="326" rx="10" fill="url(#cb-lat)" />
      <rect x="20" y="20" width="210" height="310" rx="7" fill="none" stroke="#E9C46A" strokeWidth="1.5" />
      <g transform="translate(125 175)">
        {petals.map(a => <ellipse key={a} rx="16" ry="62" fill="none" stroke="#E9C46A" strokeOpacity=".55" strokeWidth=".9" transform={`rotate(${a})`} />)}
        <circle r="34" fill="#5E1420" stroke="#E9C46A" strokeWidth="1.5" />
        <path d="M-13 -17h26v6.5L-4.5 10H13v7h-26v-6.5L4.5 -10H-13z" fill="#F4B728" />
        <rect x="-2.5" y="-25" width="5" height="9" fill="#F4B728" /><rect x="-2.5" y="16" width="5" height="9" fill="#F4B728" />
      </g>
    </svg>
  );
}
