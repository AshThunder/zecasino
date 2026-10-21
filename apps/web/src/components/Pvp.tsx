"use client";
import { useState } from "react";
import { StakePicker } from "./StakePicker";
import { useLobby } from "@/lib/lobby";
import { ZAT } from "@/lib/server";
import type { Game, Match } from "@/lib/pvp";
import { useRematch } from "@/lib/pvp";
import { toast } from "@/lib/toast";

/** Per-stake count of public players waiting at a table, keyed like StakePicker (TAZ as a string). */
export function useWaitingByStake(game: Game, everyMs = 4000) {
  const { data } = useLobby(everyMs);
  const by = data?.tables[game]?.by_stake ?? {};
  const out: Record<string, number> = {};
  for (const [zat, n] of Object.entries(by)) out[String(Number(zat) / ZAT)] = n;
  return out;
}

/** Stake chips with live queue counts, Quick match, Private table and Join-with-code. */
export function MatchBar({ game, stakes, stake, setStake, m, fmt = (v: number) => v.toFixed(3), quickLabel = "Quick match" }: { game: Game; stakes: number[]; stake: number; setStake: (v: number) => void; m: Match; fmt?: (v: number) => string; quickLabel?: string }) {
  const waiting = useWaitingByStake(game);
  const [code, setCode] = useState(""); const [open, setOpen] = useState(false);
  const here = waiting[String(stake)] ?? 0;
  return (
    <div className="match-bar">
      <StakePicker options={stakes} value={stake} onChange={setStake} disabled={m.searching} waiting={waiting} />
      <div className="mb-row">
        <button className="btn gold lg mb-quick" onClick={m.quick} disabled={m.searching}>
          {quickLabel} · ⓩ {fmt(stake)}<small>{here ? `${here} waiting · instant match` : "join the queue"}</small>
        </button>
        <button className="btn ghost mb-private" onClick={m.invite} disabled={m.searching} title="Get a link to send a friend">Private table</button>
        <button className="btn ghost mb-code" onClick={() => setOpen(o => !o)} disabled={m.searching} aria-expanded={open}>Have a code?</button>
      </div>
      {open && <form className="mb-join" onSubmit={e => { e.preventDefault(); if (code.trim()) m.joinCode(code); }}>
        <input aria-label="Invite code" placeholder="e.g. K7M2QX" maxLength={6} value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ""))} className="mono" />
        <button className="btn gold" type="submit" disabled={code.length < 6}>Join table</button>
        <small>The stake is set by the friend who made the table.</small>
      </form>}
    </div>
  );
}

export function HouseBadge() {
  return <span className="house-badge" title="This seat is played by the casino, not a person"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 5.5 6 1l5 4.5V11H1z" fill="currentColor" /></svg>House player</span>;
}

const HOUSE_TEXT: Record<Game, string> = {
  carrot: "This seat is the casino, not a person. As guesser it flips a coin for keep or swap and seals that choice before you peek; the seal opens at the reveal. As holder it sees only its own box (like any holder) and picks a line at random.",
  liars: "This seat is the casino, not a person. Its bids follow a fixed public rule using only its own five dice and the bid on the table. When the cups open, your browser replays every house move to prove it never used your dice.",
  holdem: "This seat is the casino, not a person. Here the house holds two of the three deck keys, which is still not enough: every card also needs your share, and you shuffle the deck yourself, so it can neither see your hole cards nor stack the deck. It checks when it can, calls with a pair or an ace or when the price is at most half the pot, and folds otherwise.",
};
/** Shown whenever the house holds a seat: who it is, and how its moves are decided. */
export function HouseNote({ game }: { game: Game }) {
  return <div className="house-note" role="note"><HouseBadge /><p>{HOUSE_TEXT[game]} <a href="/house">How the house player works</a></p></div>;
}

/** A visible turn clock with what happens when it runs out. */
export function TurnClock({ clock, mine, auto }: { clock: { left: number; frac: number } | null; mine: boolean; auto: string }) {
  if (!clock) return null;
  const r = 15, c = 2 * Math.PI * r;
  return (
    <div className={`turn-clock ${mine ? "mine" : "theirs"} ${clock.left <= 10 ? "low" : ""}`} role="timer" aria-live="off">
      <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true"><circle cx="19" cy="19" r={r} fill="none" stroke="#ffffff22" strokeWidth="3" /><circle cx="19" cy="19" r={r} fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={c} strokeDashoffset={c * (1 - clock.frac)} transform="rotate(-90 19 19)" strokeLinecap="round" /></svg>
      <div><b className="mono">{clock.left}s</b><small>{mine ? "Your turn" : "Their turn"} · then {auto}</small></div>
    </div>
  );
}

export function PresenceBanner({ away }: { away: { left: number } | null }) {
  if (!away) return null;
  return <div className="presence" role="status"><span className="pz-dot" />Opponent reconnecting… seat held for {away.left}s, then the turn clock decides.</div>;
}

export function RematchButton({ room, house }: { room: string | null; house?: boolean }) {
  const r = useRematch(room);
  if (!room) return null;
  return <>
    {r.state === "offered" && <span className="rematch-offer">Opponent wants a rematch</span>}
    <button className={`btn ${r.state === "offered" ? "gold" : "ghost"} rematch`} disabled={r.state === "asked"} onClick={() => r.ask().catch(e => toast({ kind: "error", title: "Rematch", body: (e as Error).message }))}>
      {r.state === "asked" ? (house ? "Dealing…" : "Waiting for opponent…") : r.state === "offered" ? "Accept rematch" : "Rematch"}
    </button>
  </>;
}

const QM: { game: Game; name: string; stakes: number[]; fmt: (v: number) => string }[] = [
  { game: "carrot", name: "Carrot in a Box", stakes: [0.01, 0.02, 0.05, 0.08, 0.1, 0.25], fmt: v => v.toFixed(v < 0.1 ? 3 : 2) },
  { game: "liars", name: "Liar's Dice", stakes: [0.01, 0.02, 0.05, 0.08, 0.1, 0.25], fmt: v => v.toFixed(v < 0.1 ? 3 : 2) },
  { game: "holdem", name: "Heads-up Hold'em", stakes: [0.2, 0.3, 0.4, 0.5], fmt: v => v.toFixed(2) },
];
/** Lobby strip: one tap joins the queue at that stake; live counts of players already waiting. */
export function QuickMatch({ data }: { data: import("@/lib/lobby").Lobby | null }) {
  return (
    <section className="quick-match" aria-labelledby="qm-h">
      <div className="sec-head"><h2 id="qm-h">Quick match</h2><p>One tap to join a heads-up table. No one there after 20 s? You can play the house instead, always clearly marked.</p></div>
      <div className="qm-grid">
        {QM.map(q => {
          const by = data?.tables[q.game]?.by_stake ?? {};
          return (
            <div key={q.game} className="qm-row">
              <h4>{q.name}</h4>
              <div className="qm-stakes">
                {q.stakes.map(v => { const n = by[String(Math.round(v * ZAT))] ?? 0; return (
                  <a key={v} href={`/table/${q.game}?stake=${v}&quick=1`} className={`qm-stake ${n ? "hot" : ""}`} data-game={q.game} data-stake={v}>
                    <b className="mono">ⓩ {q.fmt(v)}</b><small>{data ? (n ? `${n} waiting` : "open") : "…"}</small>
                  </a>); })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
