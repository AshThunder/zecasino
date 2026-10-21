"use client";
import { CardBack } from "./CardBack";
/** Real card face (public-domain Vector Playing Cards) with a 3D flip to the Zecasino back. */
export function PlayingCard({ code, faceUp = true, width = 110, className = "" }: { code: string; faceUp?: boolean; width?: number; className?: string }) {
  return (
    <div className={`pcard ${faceUp ? "up" : "down"} ${className}`} style={{ width, height: width * 1.4 }}>
      <div className="pcard-inner">
        <img className="pcard-face" src={`/assets/cards/${code}.png`} alt={code} width={width} height={width * 1.4} draggable={false} />
        <div className="pcard-back"><CardBack width={width} /></div>
      </div>
    </div>
  );
}
