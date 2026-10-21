/** Zcash-style ⓩ mark drawn as a gold coin. */
export function ZMark({ size = 32, ring = true }: { size?: number; ring?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id="zm-g" cx="35%" cy="30%" r="80%">
          <stop offset="0" stopColor="#FFE08A" /><stop offset=".55" stopColor="#F4B728" /><stop offset="1" stopColor="#B57F0E" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill="url(#zm-g)" />
      {ring && <circle cx="32" cy="32" r="25.5" fill="none" stroke="#1A1306" strokeOpacity=".35" strokeWidth="1.2" />}
      <path d="M22 18h20v5.2L28.8 40H42v6H22v-5.2L35.2 24H22z" fill="#1A1306" />
      <rect x="30" y="12" width="4" height="7" fill="#1A1306" /><rect x="30" y="45" width="4" height="7" fill="#1A1306" />
    </svg>
  );
}
