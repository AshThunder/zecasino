"use client";
import { useEffect, useRef, useState } from "react";
import { LocalSeat, games, unhex, verifySeed } from "./fair";

export type Revealed = { serverSeed: string; commitment: string; clientSeed: string; bets: number };
export type Game = "dice" | "crash" | "roulette" | "blackjack";

/** One seeded seat at a house game. Uses the game server when NEXT_PUBLIC_GAME_WS is set, else an in-browser seat. */
export interface Seat {
  commitment: string; clientSeed: string; nonce: number;
  bet<T>(game: Game, params: Record<string, unknown>): Promise<{ nonce: number; outcome: T; settle?: unknown }>;
  rotate(newClientSeed: string): Promise<Revealed>;
}

export function useSeat(defaultClientSeed?: string) {
  const ref = useRef<Seat | null>(null);
  const [view, setView] = useState({ commitment: "…", clientSeed: defaultClientSeed ?? "", nonce: 0, remote: false });
  useEffect(() => {
    let alive = true;
    (async () => {
      const { mySeed } = await import("./seed"); const cs = defaultClientSeed ?? mySeed();
      const { connectSeat } = await import("./server");
      const remote = await connectSeat(cs).catch(() => null);
      const seat: Seat = remote ?? (await localSeat(cs));
      if (!alive) return;
      ref.current = seat; setView({ commitment: seat.commitment, clientSeed: seat.clientSeed, nonce: seat.nonce, remote: !!remote });
    })();
    return () => { alive = false; };
  }, [defaultClientSeed]);
  const sync = () => { const s = ref.current; if (s) setView(v => ({ ...v, commitment: s.commitment, clientSeed: s.clientSeed, nonce: s.nonce })); };
  return {
    ...view, ready: view.commitment !== "…",
    async bet<T>(game: Game, params: Record<string, unknown> = {}) {
      const s = ref.current!; const commitment = s.commitment, clientSeed = s.clientSeed;
      const r = await s.bet<T>(game, params); sync();
      import("./history").then(h => h.record(game, summarize(game, r.outcome), [{ kind: "house", game, commitment, clientSeed, nonce: r.nonce, outcome: r.outcome }]));
      return r;
    },
    async rotate(cs: string) { import("./seed").then(m => m.keepSeed(cs)); const r = await ref.current!.rotate(cs); sync(); import("./history").then(h => h.attachSeed(r.commitment, r.serverSeed)); return r; },
  };
}

async function localSeat(cs: string): Promise<Seat> {
  const s = await new LocalSeat(cs).init();
  return {
    get commitment() { return s.commitment; }, get clientSeed() { return s.clientSeed; }, get nonce() { return s.nonce; },
    async bet<T>(game: Game) {
      const n = s.next();
      const outcome = game === "blackjack" ? await games.shoe(s.seed, s.clientSeed, n) : await games[game](s.seed, s.clientSeed, n);
      return { nonce: n, outcome: outcome as T };
    },
    rotate: (c: string) => s.rotate(c),
  };
}

/** Recompute an outcome from a revealed seed. Returns null if the seed does not open the commitment. */
export async function verifyBet(r: Revealed, game: Game, nonce: number) {
  if (!(await verifySeed(r.serverSeed, r.commitment))) return null;
  const seed = unhex(r.serverSeed);
  return game === "blackjack" ? games.shoe(seed, r.clientSeed, nonce) : games[game](seed, r.clientSeed, nonce);
}

function summarize(game: Game, o: unknown) {
  if (game === "dice") return `roll ${(Number(o) / 100).toFixed(2)}`;
  if (game === "roulette") return `pocket ${String(o)}`;
  if (game === "crash") return `point ${(Number(o) / 100).toFixed(2)}×`;
  return "shoe dealt";
}
