/** Leather Liar's Dice cup with stitched rim and brass band. */
export function DiceCup({ width = 120 }: { width?: number }) {
  return (
    <svg width={width} height={width * 1.1} viewBox="0 0 120 132" aria-label="Dice cup">
      <defs>
        <linearGradient id="cup-l" x1="0" x2="1"><stop offset="0" stopColor="#2A140C" /><stop offset=".45" stopColor="#6B3420" /><stop offset="1" stopColor="#24110A" /></linearGradient>
        <linearGradient id="cup-b" x1="0" x2="1"><stop offset="0" stopColor="#8A5E12" /><stop offset=".5" stopColor="#FFE7A3" /><stop offset="1" stopColor="#8A5E12" /></linearGradient>
      </defs>
      <ellipse cx="60" cy="124" rx="52" ry="7" fill="#000" opacity=".4" />
      <path d="M14 118 24 14h72l10 104z" fill="url(#cup-l)" />
      <ellipse cx="60" cy="14" rx="36" ry="7" fill="#1A0B05" />
      <path d="M13 108h94l1 10H12z" fill="url(#cup-b)" />
      <path d="M22 30h76" stroke="url(#cup-b)" strokeWidth="5" />
      <path d="M23 40h74" stroke="#E9C46A" strokeOpacity=".6" strokeDasharray="4 4" />
      <path d="M17 98h86" stroke="#E9C46A" strokeOpacity=".6" strokeDasharray="4 4" />
      <path d="M34 22 30 104" stroke="#fff" strokeOpacity=".08" strokeWidth="8" />
    </svg>
  );
}
