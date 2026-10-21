"use client";
import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { useLobby } from "@/lib/lobby";
import { DEMO, ZAT } from "@/lib/server";
import type { Match } from "@/lib/pvp";
import { HouseBadge } from "./Pvp";
import { toast } from "@/lib/toast";

const HOUSE_AFTER_S = 20;
import { reducedMotion } from "@/lib/motion";

/** The "waiting for opponent" scene shown over a PvP felt while the matchmaker looks for a second player. */
export function WaitingScene({ table, label, m, stake, fmt = (v: number) => v.toFixed(3) }: { table: "carrot" | "liars" | "holdem"; label: string; m?: Match; stake?: number; fmt?: (v: number) => string }) {
  const root = useRef<HTMLDivElement>(null);
  const [t0] = useState(() => Date.now());
  const [now, setNow] = useState(t0);
  const { data: lobby, offline } = useLobby(5000);
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  useEffect(() => {
    const el = root.current; if (!el) return;
    const ctx = gsap.context(() => {
      gsap.from(el, { autoAlpha: 0, duration: .35, ease: "power2.out" });
      gsap.from(".ws-card", { y: 18, autoAlpha: 0, duration: .5, ease: "power3.out", delay: .05 });
      if (reducedMotion()) return;
      gsap.utils.toArray<SVGCircleElement>(".ws-ring").forEach((r, i) =>
        gsap.fromTo(r, { attr: { r: 30 }, opacity: .7 }, { attr: { r: 64 }, opacity: 0, duration: 2.4, ease: "sine.out", repeat: -1, delay: i * .8 }));
      gsap.to(".ws-orbit", { rotation: 360, svgOrigin: "70 70", duration: 6, ease: "none", repeat: -1 });
    }, el);
    return () => ctx.revert();
  }, []);
  const s = Math.floor((now - t0) / 1000);
  const room = lobby?.tables[table];
  const atStake = stake !== undefined && room?.by_stake ? Math.max(0, (room.by_stake[String(Math.round(stake * ZAT))] ?? 0) - (m?.code ? 0 : 1)) : null;
  const others = atStake ?? (room ? Math.max(0, room.waiting - 1) : null);
  const copy = () => { if (m?.link) navigator.clipboard?.writeText(m.link).then(() => toast({ kind: "success", title: "Invite link copied", body: "Send it to a friend. They join at your stake." })).catch(() => {}); };
  return (
    <div ref={root} className="waiting-scene" role="status" aria-live="polite">
      <div className="ws-card">
        <svg width="140" height="140" viewBox="0 0 140 140" aria-hidden="true">
          <circle className="ws-ring" cx="70" cy="70" r="30" fill="none" stroke="#E9C46A" strokeWidth="1.2" />
          <circle className="ws-ring" cx="70" cy="70" r="30" fill="none" stroke="#E9C46A" strokeWidth="1.2" />
          <circle className="ws-ring" cx="70" cy="70" r="30" fill="none" stroke="#E9C46A" strokeWidth="1.2" />
          <circle cx="70" cy="70" r="28" fill="#0B0B0Ccc" stroke="#E9C46A88" strokeDasharray="3 4" />
          <g className="ws-orbit"><circle cx="70" cy="14" r="4" fill="#F4B728" /></g>
          <path d="M70 58a8 8 0 1 1 0 .01M56 86c2-9 8-13 14-13s12 4 14 13" fill="none" stroke="#F5F1E6aa" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        <h3>{m?.code ? "Private table · waiting for your friend" : label}</h3>
        <p className="mono ws-clock">{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</p>
        {m?.code ? <div className="ws-invite">
          <small>Table code</small><b className="mono" data-code={m.code}>{m.code}</b>
          <div className="ws-link"><input readOnly value={m.link ?? ""} aria-label="Invite link" onFocus={e => e.target.select()} className="mono" /><button className="btn gold sm" onClick={copy}>Copy link</button></div>
          <small>Stake ⓩ {stake !== undefined ? fmt(stake) : "–"} · your friend joins at this stake</small>
        </div> : <p className="ws-live">{offline ? "Live queue stats unavailable" : others === null ? <span className="skel sm" /> : others > 0 ? `${others} other player${others === 1 ? "" : "s"} in the queue` : `${room!.rooms} table${room!.rooms === 1 ? "" : "s"} in play · you're first in the queue at this stake`}</p>}
        {m && !m.code && s >= HOUSE_AFTER_S && <div className="ws-house">
          <p><HouseBadge /> No one else is at this stake yet. You can play the casino instead: it is clearly marked as the house, never a person, and every result is checkable the same way.</p>
          <button className="btn gold" onClick={m.house}>Play the house instead</button>
        </div>}
        {m && <button className="btn ghost sm ws-cancel" onClick={m.cancel}>Leave queue</button>}
        <p className="ws-note">Your opponent sees an unlinkable seat name, never your address or balance.</p>
        {DEMO && <p className="ws-tip">Play chips: open this table in a second window to play yourself.</p>}
      </div>
    </div>
  );
}
