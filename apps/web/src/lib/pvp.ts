"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getClient, toZat, ZAT } from "./server";
import { play } from "./sfx";

export type Game = "carrot" | "liars" | "holdem";
const START: Record<Game, string> = { carrot: "carrot_start", liars: "liars_start", holdem: "hm_seated" };
type Mode = { kind: "quick" } | { kind: "invite" } | { kind: "code"; code: string };

/** Matchmaking for one PvP table: quick match at a stake, private invite tables, joining by code,
 *  and the clearly-labelled House player fallback. Reads ?stake=&quick=1 and ?invite=CODE links. */
export function useMatch(game: Game, stake: number, setStake: (taz: number) => void, onErr: (e: string | null) => void) {
  const [searching, setSearching] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [since, setSince] = useState(0);
  const mode = useRef<Mode | null>(null);
  const stakeRef = useRef(stake); stakeRef.current = stake;

  const join = useCallback(async (m: Mode, extra: Record<string, unknown> = {}) => {
    const c = await getClient(); if (!c) return;
    mode.current = m; onErr(null); setSearching(true); setSince(Date.now());
    const msg: Record<string, unknown> = { t: `${game}_join`, stake: toZat(stakeRef.current), ...extra };
    if (m.kind === "invite") msg.invite = true; if (m.kind === "code") msg.code = m.code;
    try { const r = await c.rpc(msg); if (r.t === "queued") { setCode(r.code ?? null); if (r.stake) setStake(r.stake / ZAT); } }
    catch (e) { const s = (e as Error).message; if (!/connection lost|offline/.test(s)) { setSearching(false); mode.current = null; setCode(null); } onErr(s); }
  }, [game, onErr, setStake]);

  const quick = useCallback(() => join({ kind: "quick" }), [join]);
  const invite = useCallback(() => join({ kind: "invite" }), [join]);
  const joinCode = useCallback((c: string) => join({ kind: "code", code: c.trim().toUpperCase() }), [join]);
  const house = useCallback(() => join({ kind: "quick" }, { house: true }), [join]);
  const cancel = useCallback(async () => { mode.current = null; setSearching(false); setCode(null); const c = await getClient(); c?.rpc({ t: "queue_leave" }).catch(() => {}); }, []);

  useEffect(() => {
    let offs: (() => void)[] = [];
    getClient().then(c => {
      if (!c) return;
      offs = [
        c.on(START[game], () => { mode.current = null; setSearching(false); setCode(null); play("chip", 0.5); }),
        // The server drops queued seats when a tab disconnects; take the seat again on reconnect.
        c.on("reconnected", () => { const m = mode.current; if (m && m.kind !== "code") join(m); c.rpc({ t: "pvp_resume" }).catch(() => {}); }),
      ];
      const q = new URLSearchParams(location.search);
      const inv = q.get("invite"); const st = Number(q.get("stake"));
      if (st > 0) { setStake(st); stakeRef.current = st; }
      if (inv || q.get("quick")) history.replaceState(null, "", location.pathname);
      if (inv) join({ kind: "code", code: inv.toUpperCase() }); else if (q.get("quick")) join({ kind: "quick" });
    });
    return () => offs.forEach(f => f());
  }, [game]); // eslint-disable-line react-hooks/exhaustive-deps

  const link = code && typeof window !== "undefined" ? `${location.origin}/table/${game}?invite=${code}` : null;
  return { searching, code, link, since, quick, invite, joinCode, house, cancel };
}
export type Match = ReturnType<typeof useMatch>;

/** Seconds left on a turn clock started by a server message carrying `at` (epoch ms) and `turn_ms`. */
export function useTurnClock(at: number | null, ms: number | null) {
  const [, tick] = useState(0);
  useEffect(() => { if (!at || !ms) return; const i = setInterval(() => tick(x => x + 1), 250); return () => clearInterval(i); }, [at, ms]);
  if (!at || !ms) return null;
  const start = Math.min(at, Date.now()); // never trust a clock ahead of ours
  return { left: Math.max(0, Math.ceil((start + ms - Date.now()) / 1000)), frac: Math.max(0, Math.min(1, (start + ms - Date.now()) / ms)) };
}

/** Opponent connection state for a room: null when connected, else when their held seat runs out. */
export function usePresence(room: string | null) {
  const [away, setAway] = useState<number | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { setAway(null); if (!room) return; let off = () => {};
    getClient().then(c => { if (c) off = c.on("pvp_presence", m => { if (m.room === room) setAway(m.online ? null : Date.now() + m.grace_ms); }); });
    return () => off(); }, [room]);
  useEffect(() => { if (!away) return; const i = setInterval(() => tick(x => x + 1), 500); return () => clearInterval(i); }, [away]);
  return away ? { left: Math.max(0, Math.ceil((away - Date.now()) / 1000)) } : null;
}

/** Rematch handshake for a finished room. Against the house it starts at once. */
export function useRematch(room: string | null) {
  const [state, setState] = useState<"idle" | "asked" | "offered">("idle");
  useEffect(() => { setState("idle"); if (!room) return; let off = () => {};
    getClient().then(c => { if (c) off = c.on("pvp_rematch_offer", m => { if (m.room === room) setState(s => s === "asked" ? s : "offered"); }); });
    return () => off(); }, [room]);
  const ask = useCallback(async () => { const c = await getClient(); if (!c || !room) return; setState("asked"); try { await c.rpc({ t: "pvp_rematch", room }); } catch (e) { setState("idle"); throw e; } }, [room]);
  return { state, ask };
}
