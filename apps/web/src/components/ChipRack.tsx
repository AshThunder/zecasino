"use client";
import { DENOMS } from "@/lib/chips";
import { Chip } from "./Chip";
import { play } from "@/lib/sfx";
export function ChipRack({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="rack" role="radiogroup" aria-label="Chip value">
      {DENOMS.map(d => (
        <button key={d.value} role="radio" aria-checked={value === d.value} className={value === d.value ? "on" : ""}
          onClick={() => { onChange(d.value); play("handle", 0.4); }}>
          <Chip value={d.value} size={54} id={`rk${d.label}`} />
        </button>
      ))}
    </div>
  );
}
