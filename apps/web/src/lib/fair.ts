/** Browser mirror of crates/fairness. Same bytes, same results: used to verify the house. */
const enc = new TextEncoder();
export const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
export const unhex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map(h => parseInt(h, 16)));

export async function sha256Hex(data: Uint8Array) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource))); }

async function hmac(key: Uint8Array, msg: string) {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}

/** Async-prefetching byte stream identical to OutcomeStream (cursor blocks of 32 bytes). */
export async function stream(seed: Uint8Array, clientSeed: string, nonce: number, blocks = 4) {
  const bufs: Uint8Array[] = [];
  for (let c = 0; c < blocks; c++) bufs.push(await hmac(seed, `${clientSeed}:${nonce}:${c}`));
  const all = new Uint8Array(blocks * 32); bufs.forEach((b, i) => all.set(b, i * 32));
  let pos = 0;
  const u8 = () => { if (pos >= all.length) throw new Error("stream exhausted"); return all[pos++]; };
  const u32 = () => ((u8() << 24) | (u8() << 16) | (u8() << 8) | u8()) >>> 0;
  const f64 = () => { let f = 0, d = 1; for (let i = 0; i < 4; i++) { d *= 256; f += u8() / d; } return f; };
  const below = (n: number) => { const MAX = 0xffffffff; const zone = MAX - (MAX % n); for (;;) { const v = u32(); if (v < zone) return v % n; } };
  return { u8, u32, f64, below };
}

export const games = {
  /** 0..=10000, hundredths of a percent */
  dice: async (seed: Uint8Array, cs: string, n: number) => Math.floor((await stream(seed, cs, n, 1)).f64() * 10001),
  /** multiplier in hundredths, 1% instant bust */
  crash: async (seed: Uint8Array, cs: string, n: number) => {
    const h = BigInt((await stream(seed, cs, n, 1)).u32());
    if (h % 100n === 0n) return 100;
    const e = 1n << 32n; const v = (100n * e - h) / (e - h);
    return Number(v < 100n ? 100n : v);
  },
  roulette: async (seed: Uint8Array, cs: string, n: number) => (await stream(seed, cs, n, 1)).below(37),
  shoe: async (seed: Uint8Array, cs: string, n: number, decks = 6) => {
    const s = await stream(seed, cs, n, 160);
    const v = Array.from({ length: decks * 52 }, (_, i) => i % 52);
    for (let i = v.length - 1; i > 0; i--) { const j = s.below(i + 1); [v[i], v[j]] = [v[j], v[i]]; }
    return v;
  },
};

export async function verifySeed(seedHex: string, commitment: string) { return (await sha256Hex(unhex(seedHex))) === commitment.toLowerCase(); }

/** PvP commitment: SHA256("zecasino:commit:v1" || u32be salt_len || salt || value) */
export async function pvpCommit(salt: Uint8Array, value: Uint8Array) {
  const d = enc.encode("zecasino:commit:v1");
  const buf = new Uint8Array(d.length + 4 + salt.length + value.length);
  buf.set(d); new DataView(buf.buffer).setUint32(d.length, salt.length); buf.set(salt, d.length + 4); buf.set(value, d.length + 4 + salt.length);
  return sha256Hex(buf);
}

/** Local seat used until the game server connects. Real crypto, same API shape. */
export class LocalSeat {
  seed = crypto.getRandomValues(new Uint8Array(32)); commitment = ""; nonce = 0;
  clientSeed: string;
  constructor(clientSeed: string) { this.clientSeed = clientSeed; }
  async init() { this.commitment = await sha256Hex(this.seed); return this; }
  next() { return this.nonce++; }
  async rotate(cs: string) { const r = { serverSeed: hex(this.seed), commitment: this.commitment, clientSeed: this.clientSeed, bets: this.nonce };
    this.seed = crypto.getRandomValues(new Uint8Array(32)); this.clientSeed = cs; this.nonce = 0; await this.init(); return r; }
}
