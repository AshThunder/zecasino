"use client";
import { DENOMS } from "@/lib/chips";
import { Chip } from "./Chip";
import { play } from "@/lib/sfx";
export function ChipRack({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="rack-wrap"><div className="rack" role="radiogroup" aria-label="Chip value (TAZ)">
      {DENOMS.map(d => (
        <button key={d.value} role="radio" aria-checked={value === d.value} className={value === d.value ? "on" : ""}
          onClick={() => { onChange(d.value); play("handle", 0.4); }}>
          <Chip value={d.value} size={64} id={`rk${d.label}`} />
        </button>
      ))}
    </div><span className="rack-unit" aria-hidden="true">ⓩ TAZ per chip</span></div>
  );
}
