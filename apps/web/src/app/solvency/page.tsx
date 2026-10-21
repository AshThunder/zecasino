"use client";
import { useEffect, useState } from "react";
import { getClient, ZAT } from "@/lib/server";
import { verifyInclusion, type Node, type Step } from "@/lib/solvency";

type Sol = { liabilities_zat: number; house_pnl_zat: number; snapshot: { epoch: number; built_at: number; root: Node; leaves: number; depth: number; next_at: number }; reserves: null | { tip: number; spendable_zat: number; total_zat: number; network: string } };
type Proof = { epoch: number; root: Node; salt?: string; balance: number; path: Step[] | null };
const HTTP = (process.env.NEXT_PUBLIC_GAME_WS ?? "ws://127.0.0.1:3200/ws").replace(/^ws/, "http").replace(/\/ws$/, "");
const z = (n: number) => (n / ZAT).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-8)}`;

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
        <div className="sol-card"><small>House reserves</small><b>ⓩ {res ? z(res.total_zat) : s ? "n/a" : "…"}</b><span>{res ? `${z(res.spendable_zat)} spendable · ${res.network} block ${res.tip.toLocaleString()}` : "wallet service offline"}</span></div>
        <div className={`sol-card ${cover !== null && cover < 1 ? "short" : ""}`}><small>Coverage</small><b>{cover !== null ? `${(cover * 100).toFixed(1)}%` : "n/a"}</b>
          <div className="sol-bar"><i style={{ width: `${Math.min(100, (cover ?? 0) * 100)}%` }} /></div></div>
      </div>
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
      <p className="sol-foot">What this does not prove yet: reserves are read from the house wallet by the server. Publishing a viewing key for a separate cold-reserve account would let anyone check that figure on-chain too, without linking deposits.</p>
    </div>
  );
}
