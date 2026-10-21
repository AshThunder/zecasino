"use client";
import { Chip } from "./Chip";
import { play } from "@/lib/sfx";

/** One matched stake, picked before the match: you are only paired with someone at the same stake. */
export function StakePicker({ options, value, onChange, disabled }: { options: number[]; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="stake-pick" role="radiogroup" aria-label="Stake for this match">
      <small>Stake · matched</small>
      <div className="sp-row">
        {options.map(v => (
          <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? "on" : ""} disabled={disabled}
            onClick={() => { onChange(v); play("handle", 0.35); }}>
            <Chip value={v} size={30} id={`sp${v}`} /><span className="mono">ⓩ {v.toFixed(v < 0.1 ? 3 : 2)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
