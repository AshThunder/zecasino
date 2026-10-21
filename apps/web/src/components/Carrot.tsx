/** Hand-drawn style carrot: tapered root with growth rings and a three-frond top. */
export function Carrot({ width = 120 }: { width?: number }) {
  return (
    <svg width={width} height={width * 1.25} viewBox="0 0 160 200" aria-label="Carrot">
      <defs>
        <linearGradient id="cr-body" x1="0" x2="1"><stop offset="0" stopColor="#C4470F" /><stop offset=".35" stopColor="#F27A1F" /><stop offset=".6" stopColor="#F79A3E" /><stop offset="1" stopColor="#B53F0C" /></linearGradient>
        <linearGradient id="cr-leaf" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#2F6B1E" /><stop offset="1" stopColor="#7DBA3C" /></linearGradient>
      </defs>
      <g transform="rotate(-28 80 100)">
        <path d="M80 58c-6-22-24-38-40-44 10 14 18 30 30 44z" fill="url(#cr-leaf)" />
        <path d="M80 58c2-26 12-44 22-54 0 18-6 38-14 54z" fill="url(#cr-leaf)" />
        <path d="M80 58c-14-14-20-32-18-50 12 12 20 30 24 50z" fill="#4E8E2A" />
        <path d="M58 62c0-6 10-10 22-10s22 4 22 10c0 30-10 86-20 126-1 4-4 4-5 0C66 148 58 92 58 62z" fill="url(#cr-body)" />
        {[78, 96, 114, 132, 150].map((y, i) => (
          <path key={y} d={`M${62 + i * 2} ${y}q${8 - i} 3 ${14 - i * 2} 0`} fill="none" stroke="#8E300A" strokeOpacity=".55" strokeWidth="1.6" strokeLinecap="round" />
        ))}
        {[86, 106, 124, 142].map((y, i) => (
          <path key={y} d={`M${98 - i * 2.5} ${y}q-${7 - i} 3 -${12 - i * 2} 0`} fill="none" stroke="#8E300A" strokeOpacity=".45" strokeWidth="1.4" strokeLinecap="round" />
        ))}
        <path d="M66 66c4 30 8 60 14 96" fill="none" stroke="#FFD2A1" strokeOpacity=".45" strokeWidth="3" strokeLinecap="round" />
      </g>
    </svg>
  );
}
