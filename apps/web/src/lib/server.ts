"use client";
import type { Game, Revealed, Seat } from "./house";

/** Websocket client for crates/game-server. Amounts on the wire are zatoshi. */
export const ZAT = 100_000_000;
export const toZat = (taz: number) => Math.round(taz * ZAT);
type Msg = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Demo mode: a separate game server with its own database and no wallet service, where every session starts with
 * play chips. Chosen per browser (localStorage), and it changes the socket and the session-key slots, so a demo
 * session can never touch the real ledger.
 */
export const MODE_KEY = "zc.mode";
export const DEMO = typeof window !== "undefined" && localStorage.getItem(MODE_KEY) === "demo";
export function setMode(demo: boolean) { if (demo) localStorage.setItem(MODE_KEY, "demo"); else localStorage.removeItem(MODE_KEY); location.reload(); }
const URL_ = DEMO ? (process.env.NEXT_PUBLIC_DEMO_WS ?? "ws://127.0.0.1:3201/ws") : (process.env.NEXT_PUBLIC_GAME_WS ?? "ws://127.0.0.1:3200/ws");
const DEV_CREDIT = process.env.NEXT_PUBLIC_DEV_CREDIT === "1";

class Client {
  ws: WebSocket; seq = 0; pending = new Map<number, { ok: (m: Msg) => void; no: (e: Error) => void }>();
  subs = SUBS; session: Msg | null = null;
  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = e => {
      const m: Msg = JSON.parse(e.data);
      if (typeof m.balance === "number") setBalance(m.balance / ZAT);
      const p = m.id != null && this.pending.get(m.id);
      if (p) { this.pending.delete(m.id); m.t === "error" ? p.no(new Error(m.error)) : p.ok(m); }
      this.subs.get(m.t)?.forEach(f => f(m));
    };
    ws.onclose = () => {
      // Fail in-flight calls instead of leaving them hanging, then reconnect with the same token.
      this.pending.forEach(p => p.no(new Error("connection lost, reconnecting…"))); this.pending.clear();
      const was = client === this; if (was) { client = null; status = "offline"; emit(); }
      if (was) reconnect(1);
    };
  }
  /** Pages may hold a client from before a reconnect; calls are routed to the live connection. */
  private live(): Client | null { return this.ws.readyState === WebSocket.OPEN ? this : client && client !== this ? client.live() : null; }
  rpc(m: Msg): Promise<Msg> {
    const c = this.live(); if (!c) return Promise.reject(new Error("offline, reconnecting…"));
    const id = ++c.seq; c.ws.send(JSON.stringify({ ...m, id })); return new Promise((ok, no) => c.pending.set(id, { ok, no }));
  }
  send(m: Msg) { this.live()?.ws.send(JSON.stringify(m)); }
  on(t: string, f: (m: Msg) => void) { if (!this.subs.has(t)) this.subs.set(t, new Set()); this.subs.get(t)!.add(f); return () => { this.subs.get(t)!.delete(f); }; }
}

const SUBS = new Map<string, Set<(m: Msg) => void>>();
function reconnect(attempt: number) {
  setTimeout(async () => {
    const c = await getClient();
    if (c) SUBS.get("reconnected")?.forEach(f => f({ t: "reconnected" }));
    else if (attempt < 30) reconnect(attempt + 1);
  }, Math.min(500 * attempt, 5000));
}
if (typeof window !== "undefined") (window as unknown as { __zc: unknown }).__zc = { drop: () => client?.ws.close() }; // QA hook: simulate a dropped connection
export const SESSION_KEY = DEMO ? "zc.demo.session" : "zc.session", KEEP_KEY = DEMO ? "zc.demo.session.keep" : "zc.session.keep";
export const storedToken = () => sessionStorage.getItem(SESSION_KEY) ?? localStorage.getItem(KEEP_KEY) ?? undefined;

let client: Client | null = null; let connecting: Promise<Client | null> | null = null;
let status: "offline" | "online" = "offline"; let balance: number | null = null;
const listeners = new Set<() => void>();
let snap: { status: "offline" | "online"; balance: number | null } = { status: "offline", balance: null };
const emit = () => { snap = { status, balance }; listeners.forEach(f => f()); };
function setBalance(b: number) { balance = b; emit(); }
export const serverState = { subscribe: (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; }, get: () => snap, server: () => snap };

/** Connects once per tab. The session token lives in sessionStorage only: closing the tab forgets it unless you save it. */
export function getClient(clientSeed = "zecasino"): Promise<Client | null> {
  if (client) return Promise.resolve(client);
  if (typeof window === "undefined") return Promise.resolve(null);
  return (connecting ??= new Promise<Client | null>(resolve => {
    let ws: WebSocket;
    try { ws = new WebSocket(URL_); } catch { connecting = null; return resolve(null); }
    const timer = setTimeout(() => { ws.close(); }, 1500);
    ws.onerror = () => { clearTimeout(timer); connecting = null; resolve(null); };
    ws.onopen = async () => {
      clearTimeout(timer);
      const c = new Client(ws);
      const s = await c.rpc({ t: "hello", token: storedToken(), client_seed: clientSeed });
      sessionStorage.setItem(SESSION_KEY, s.token); if (localStorage.getItem(KEEP_KEY)) localStorage.setItem(KEEP_KEY, s.token); c.session = s;
      if (DEMO !== !!s.demo) { ws.close(); connecting = null; return resolve(null); } // demo chips only on the demo server, real balance only on the real one
      if (!DEMO && DEV_CREDIT && s.balance === 0) await c.rpc({ t: "dev_credit", amount: toZat(0.412) });
      client = c; status = "online"; connecting = null; emit(); resolve(c);
    };
  }));
}

export async function connectSeat(cs: string): Promise<Seat | null> {
  const c = await getClient(cs); if (!c) return null;
  let seat = (await c.rpc({ t: "seat_get" })).seat;
  if (seat.client_seed !== cs && seat.nonce === 0) seat = (await c.rpc({ t: "seed", client_seed: cs })).seat;
  const s: Seat = {
    get commitment() { return seat.commitment; }, get clientSeed() { return seat.client_seed; }, get nonce() { return seat.nonce; },
    async bet<T>(game: Game, params: Record<string, unknown>) {
      let r: Msg;
      if (game === "dice") r = await c.rpc({ t: "dice", stake: toZat(params.stake as number), target: params.target, over: params.over });
      else if (game === "roulette") r = await c.rpc({ t: "roulette", bets: (params.bets as [string, number][]).map(([key, a]) => ({ key, amount: toZat(a) })) });
      else throw new Error(`${game} is played through its own messages`);
      seat = r.seat;
      return { nonce: r.nonce, outcome: r.outcome as T, settle: { payout: r.payout / ZAT } };
    },
    async rotate(ncs: string): Promise<Revealed> {
      const r = await c.rpc({ t: "rotate", client_seed: ncs }); seat = r.seat;
      return { serverSeed: r.revealed.server_seed, commitment: r.revealed.commitment, clientSeed: r.revealed.client_seed, bets: r.revealed.bets };
    },
  };
  return s;
}
