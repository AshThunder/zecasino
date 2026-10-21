/** Browser-side check of a Merkle-sum inclusion proof. Mirrors crates/game-server/src/solvency.rs. */
export type Node = { hash: string; sum: number };
export type Step = { side: "left" | "right"; node: Node };
const te = new TextEncoder();
const unhex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], b => parseInt(b, 16));
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, "0")).join("");
const be = (n: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n)); return b; };
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const sha = async (b: Uint8Array) => hex(await crypto.subtle.digest("SHA-256", b as BufferSource));
export const leaf = async (salt: string, bal: number): Promise<Node> => ({ hash: await sha(cat(te.encode("zecasino:liab:leaf:v1"), unhex(salt), be(bal))), sum: bal });
export const parent = async (l: Node, r: Node): Promise<Node> => ({ hash: await sha(cat(te.encode("zecasino:liab:node:v1"), unhex(l.hash), be(l.sum), unhex(r.hash), be(r.sum))), sum: l.sum + r.sum });
/** Returns every intermediate node so the page can show the climb to the root. */
export async function verifyInclusion(salt: string, bal: number, path: Step[], root: Node) {
  let n = await leaf(salt, bal); const trail = [n];
  for (const s of path) { n = s.side === "left" ? await parent(s.node, n) : await parent(n, s.node); trail.push(n); }
  return { ok: n.hash === root.hash && n.sum === root.sum, trail };
}
