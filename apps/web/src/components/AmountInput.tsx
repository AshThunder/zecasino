"use client";
import { useEffect, useState } from "react";

/** Typed stake with ½ / 2× / max quick buttons. Clamped to [min, max]; max is the lower of the table limit and your balance. */
export function AmountInput({ value, onChange, min, max, disabled, label = "Bet" }: { value: number; onChange: (v: number) => void; min: number; max: number; disabled?: boolean; label?: string }) {
  const [text, setText] = useState(value.toFixed(3));
  useEffect(() => { setText(t => (Number(t) === value ? t : value.toFixed(3))); }, [value]);
  const clamp = (v: number) => Math.min(Math.max(Math.round(v * 1000) / 1000, min), Math.max(min, max));
  const set = (v: number) => { const c = clamp(v); onChange(c); setText(c.toFixed(3)); };
  const bad = text !== "" && (isNaN(Number(text)) || Number(text) < min || Number(text) > max);
  return (
    <div className={`amount ${bad ? "bad" : ""}`}>
      <label><small>{label}</small>
        <span className="amt-field"><i aria-hidden="true">ⓩ</i>
          <input inputMode="decimal" value={text} disabled={disabled} aria-label={`${label} in TAZ`} aria-invalid={bad}
            onChange={e => { const t = e.target.value.replace(",", ".").replace(/[^\d.]/g, ""); setText(t); const n = Number(t); if (t && !isNaN(n) && n >= min && n <= max) onChange(n); }}
            onBlur={() => set(Number(text) || min)} /></span></label>
      <div className="amt-quick">
        <button type="button" className="btn ghost sm" disabled={disabled} onClick={() => set(value / 2)}>½</button>
        <button type="button" className="btn ghost sm" disabled={disabled} onClick={() => set(value * 2)}>2×</button>
        <button type="button" className="btn ghost sm" disabled={disabled} onClick={() => set(max)}>Max</button>
      </div>
      {bad && <small className="amt-hint">Between ⓩ {min.toFixed(3)} and ⓩ {max.toFixed(3)}</small>}
    </div>
  );
}
