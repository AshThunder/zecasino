"use client";
import { useEffect, useState } from "react";
import { getClient, ZAT } from "@/lib/server";
import { verifyInclusion, type Node, type Step } from "@/lib/solvency";

type Sol = { liabilities_zat: number; house_pnl_zat: number; snapshot: { epoch: number; built_at: number; root: Node; leaves: number; depth: number; next_at: number }; reserves: null | { tip: number; total_zat: number; network: string; ufvk: string; address: string; birthday: number }; hot: null | { tip: number; spendable_zat: number; total_zat: number } };
type Proof = { epoch: number; root: Node; salt?: string; balance: number; path: Step[] | null };
const HTTP = (process.env.NEXT_PUBLIC_GAME_WS ?? "ws://127.0.0.1:3200/ws").replace(/^ws/, "http").replace(/\/ws$/, "");
const z = (n: number) => (n / ZAT).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-8)}`;

type Anchor = { height: number; block_hash: string; digest: string; commitments: string[]; built_at: number };
const hexb = (h: string) => Uint8Array.from(h.match(/../g) ?? [], b => parseInt(b, 16));
async function anchorDigest(a: Anchor) {
  const parts = [new TextEncoder().encode("zecasino:anchor:v1"), hexb(a.block_hash), ...a.commitments.map(hexb)];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { all.set(p, i); i += p.length; }
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", all)), x => x.toString(16).padStart(2, "0")).join("");
}

/** Fairness anchor: recompute the digest in this browser and look for this session's own seed commitment in it. */
function AnchorCard() {
  const [a, setA] = useState<Anchor | null>(null); const [ok, setOk] = useState<boolean | null>(null); const [mine, setMine] = useState<boolean | null>(null);
  useEffect(() => { fetch(`${HTTP}/anchor`).then(r => r.json()).then(async (v: Anchor | null) => {
    if (!v) return; setA(v); setOk(await anchorDigest(v) === v.digest);
    const c = await getClient(); const com = c ? (await c.rpc({ t: "seat_get" }).catch(() => null))?.seat?.commitment : null;
    setMine(com ? v.commitments.includes(com) : null);
  }).catch(() => {}); }, []);
  return (
    <section id="anchor" className="fair sol-anchor">
      <h4>Fairness anchor</h4>
      <p>Every minute the server hashes the latest block hash together with every live seed commitment (yours included). The block hash proves the set existed no earlier than that block; your browser recomputes the digest from the published list below.</p>
      {a ? <dl>
        <dt>Block</dt><dd className="mono">#{a.height.toLocaleString()} · {short(a.block_hash)}</dd>
        <dt>Digest</dt><dd className="mono">{short(a.digest)} {ok === null ? "" : ok ? <b className="ok">✓ recomputed</b> : <b className="bad">✗ mismatch</b>}</dd>
        <dt>Commitments</dt><dd className="mono">{a.commitments.length} live{mine === null ? "" : mine ? " · yours is in it" : " · yours joins at the next anchor"}</dd>
      </dl> : <p className="wait">Waiting for the first anchor<span className="dots" /></p>}
    </section>
  );
}

export default function Solvency() {
  const [s, setS] = useState<Sol | null>(null);
  const [down, setDown] = useState(false);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [proof, setProof] = useState<Proof | null>(null);
  const [check, setCheck] = useState<{ ok: boolean; trail: Node[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setInterval>;
    const load = () => fetch(`${HTTP}/solvency`).then(r => r.json()).then(v => { setS(v); setDown(false); }).catch(() => setDown(true));
    load(); t = setInterval(() => { load(); }, 15000);
    const c = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => { clearInterval(t); clearInterval(c); };
  }, []);
  const verifyMine = async () => {
    setBusy(true); setCheck(null);
    const c = await getClient(); if (!c) { setBusy(false); return; }
    const p = (await c.rpc({ t: "solvency_proof" })) as unknown as Proof; setProof(p);
    if (p.path && p.salt) setCheck(await verifyInclusion(p.salt, p.balance, p.path, p.root));
    setBusy(false);
  };

  const res = s?.reserves; const liab = s?.snapshot.root.sum ?? 0;
  const cover = res && liab ? res.total_zat / liab : null;
  return (
    <div className="table-page solvency-page">
      <div className="table-head"><div><p className="eyebrow">House transparency · proof of liabilities · reserves</p><h1>Solvency</h1></div>
        <div className="blinds"><span>{s ? `Snapshot #${s.snapshot.epoch}` : "…"}</span><span>{s ? `Next in ${Math.max(0, Math.round(s.snapshot.next_at - now))} s` : ""}</span></div></div>
      {down && <p className="wait">The game server is offline, so there is no live snapshot to show.</p>}
      <div className="sol-grid">
        <div className="sol-card"><small>Owed to players</small><b>ⓩ {s ? z(liab) : "…"}</b><span>{s ? `${s.snapshot.leaves} funded sessions · root sum` : ""}</span></div>
        <div className="sol-card"><small>Cold reserve · on-chain verifiable</small><b>ⓩ {res ? z(res.total_zat) : s ? "n/a" : "…"}</b><span>{res ? `watched with the public viewing key · ${res.network} block ${res.tip?.toLocaleString()}` : "reserve wallet offline"}{s?.hot ? ` · hot wallet ⓩ ${z(s.hot.total_zat)} (server-reported)` : ""}</span></div>
        <div className={`sol-card ${cover !== null && cover < 1 ? "short" : ""}`}><small>Coverage</small><b>{cover !== null ? `${(cover * 100).toFixed(cover < 0.01 ? 3 : 1)}%` : "n/a"}</b>
          <div className="sol-bar"><i style={{ width: `${Math.min(100, (cover ?? 0) * 100)}%` }} /></div></div>
      </div>
      <AnchorCard />
      <div className="sol-cols">
        <section className="fair sol-tree">
          <h4>Liability tree</h4>
          <dl>
            <dt>Root hash</dt><dd className="mono">{s ? short(s.snapshot.root.hash) : "…"}</dd>
            <dt>Root sum</dt><dd className="mono">{s ? `${s.snapshot.root.sum.toLocaleString()} zat` : "…"}</dd>
            <dt>Depth</dt><dd className="mono">{s?.snapshot.depth ?? "…"}</dd>
            <dt>Built</dt><dd className="mono">{s ? new Date(s.snapshot.built_at * 1000).toLocaleTimeString() : "…"}</dd>
          </dl>
          <p>Every funded session is one leaf: SHA-256 of a fresh random salt and the balance. Each parent commits to both children and to the sum of their balances, so the root sum is the total the house owes. Balances cannot be negative, so no leaf can cancel another one out.</p>
          <p>No session IDs, addresses or deposit history go into the tree. Salts change with every snapshot, so a leaf cannot be followed from one snapshot to the next.</p>
        </section>
        <section className="fair sol-mine">
          <h4>Check that your balance is counted</h4>
          <p>The server sends only your salt and the sibling hashes on your path. Your browser rebuilds the path up to the root and compares it with the root published above.</p>
          <button className="btn gold" onClick={verifyMine} disabled={busy || down}>{busy ? "Verifying…" : "Verify my inclusion"}</button>
          {proof && !proof.path && <p className="wait">Your balance in snapshot #{proof.epoch} was zero, so there is no leaf for you. Balances join the tree when it is rebuilt (every 60 s).</p>}
          {proof?.path && check && (
            <div className={`sol-result ${check.ok ? "ok" : "bad"}`}>
              <b>{check.ok ? `✓ Included: ⓩ ${z(proof.balance)} in snapshot #${proof.epoch}` : "✗ Proof does not match the published root"}</b>
              <ol className="sol-path">
                <li><span>leaf</span><code className="mono">{short(check.trail[0].hash)}</code><em>{check.trail[0].sum.toLocaleString()}</em></li>
                {proof.path.map((st, i) => (
                  <li key={i}><span>+ {st.side}</span><code className="mono">{short(check.trail[i + 1].hash)}</code><em>{check.trail[i + 1].sum.toLocaleString()}</em></li>
                ))}
              </ol>
              <small>The last line must equal the root hash and root sum. Snapshots are rebuilt every 60 s, so a bet made within the last minute shows up in the next one.</small>
            </div>
          )}
        </section>
      </div>
      {res && (
        <section className="fair sol-vk">
          <h4>Check the reserve yourself</h4>
          <p>The cold reserve is a separate wallet from the one that receives deposits, so its viewing key shows reserve movements only, never player deposits. A viewing key can see incoming and outgoing notes but cannot spend anything. The seed is kept offline.</p>
          <dl>
            <dt>Reserve address</dt><dd className="mono">{res.address}</dd>
            <dt>Viewing key (UFVK)</dt><dd className="mono vk">{res.ufvk}</dd>
            <dt>Birthday height</dt><dd className="mono">{res.birthday.toLocaleString()}</dd>
          </dl>
          <div className="vk-actions">
            <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(res.ufvk)}>Copy viewing key</button>
          </div>
          <pre className="mono vk-cmd">{`zcash-devtool wallet -w reserve-check init-fvk --name reserve \\
  --fvk ${res.ufvk.slice(0, 18)}… --birthday ${res.birthday}
zcash-devtool wallet -w reserve-check sync
zcash-devtool wallet -w reserve-check balance`}</pre>
          <p>Any wallet that can import a viewing key (Zingo, zcash-devtool) shows the same balance. Coverage above compares that on-chain figure with the liability root, which leaves the hot wallet out.</p>
        </section>
      )}
    </div>
  );
}
