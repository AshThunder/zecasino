"use client";
import { useEffect, useState } from "react";

/** Public facts from the game server's /lobby endpoint. Every figure is measured, never sample data. */
export type Lobby = {
  liabilities_zat: number; reserve_zat: number | null; hot_zat: number | null; coverage: number | null;
  anchor: { height: number; digest: string; block_hash: string; count: number } | null;
  transparent: number | null; online: number;
  tables: { carrot: Room; liars: Room; holdem: Room; crash: { round: number; bettors: number } };
};
type Room = { rooms: number; waiting: number };

import { DEMO } from "./server";
// Play-chip sessions live on the demo server, so its queue counts come from there too.
export const HTTP_BASE = (process.env.NEXT_PUBLIC_GAME_WS ?? "ws://127.0.0.1:3200/ws").replace(/^ws/, "http").replace(/\/ws$/, "");
const DEMO_HTTP = (process.env.NEXT_PUBLIC_DEMO_WS ?? "ws://127.0.0.1:3201/ws").replace(/^ws/, "http").replace(/\/ws$/, "");

export function useLobby(everyMs = 15_000) {
  const [d, setD] = useState<Lobby | null>(null); const [err, setErr] = useState(false);
  useEffect(() => {
    let dead = false;
    const go = () => Promise.all([fetch(HTTP_BASE + "/lobby").then(r => r.json()), DEMO ? fetch(DEMO_HTTP + "/lobby").then(r => r.json()).catch(() => null) : null]).then(([j, d]) => (d ? { ...j, tables: d.tables } : j)).then(j => { if (!dead) { setD(j); setErr(false); } }).catch(() => !dead && setErr(true));
    go(); const t = setInterval(go, everyMs); return () => { dead = true; clearInterval(t); };
  }, [everyMs]);
  return { data: d, offline: err && !d };
}

export const pct = (x: number) => x >= 10 ? `${Math.round(x * 100).toLocaleString()}%` : x >= 0.1 ? `${(x * 100).toFixed(1)}%` : `${(x * 100).toFixed(2)}%`;
