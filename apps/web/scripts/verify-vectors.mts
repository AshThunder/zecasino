import { readFileSync } from "node:fs";
import { games, sha256Hex } from "../src/lib/fair.ts";
const v = JSON.parse(readFileSync(new URL("../src/lib/fair.vectors.json", import.meta.url), "utf8"));
const seed = new Uint8Array(32).fill(5); let bad = 0;
const eq = (name: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} ${name}`); };
eq("commit", await sha256Hex(seed), v.commit);
for (const g of ["dice", "crash", "roulette"] as const) eq(g, await Promise.all(v[g].map((_: number, n: number) => games[g](seed, "t", n))), v[g]);
eq("shoe20", (await games.shoe(seed, "t", 0)).slice(0, 20), v.shoe20);
process.exit(bad ? 1 : 0);
