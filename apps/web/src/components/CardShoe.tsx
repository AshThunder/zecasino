import { CardBack } from "./CardBack";
/** Dealer's card shoe: smoked acrylic body with brass rail and a card peeking out. */
export function CardShoe({ width = 150 }: { width?: number }) {
  return (
    <div className="shoe" style={{ width, height: width * 0.72 }}>
      <div className="shoe-card"><CardBack width={width * 0.42} /></div>
      <svg width={width} height={width * 0.72} viewBox="0 0 150 108" aria-label="Card shoe">
        <defs><linearGradient id="sh-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2B2B30" stopOpacity=".92" /><stop offset="1" stopColor="#0C0C0E" /></linearGradient>
          <linearGradient id="sh-g" x1="0" x2="1"><stop offset="0" stopColor="#8A5E12" /><stop offset=".5" stopColor="#FFE7A3" /><stop offset="1" stopColor="#8A5E12" /></linearGradient></defs>
        <path d="M8 30 120 10l24 14v70l-136 8z" fill="url(#sh-b)" stroke="#000" />
        <path d="M8 30 120 10l24 14L32 44z" fill="#ffffff10" />
        <path d="M8 96 144 90v6L8 104z" fill="url(#sh-g)" />
        <path d="M120 10v76" stroke="#ffffff22" />
        <text x="70" y="78" textAnchor="middle" fontFamily="var(--font-display)" fontSize="11" letterSpacing="3" fill="#F4B728cc">ZECASINO</text>
      </svg>
    </div>
  );
}
