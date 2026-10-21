"use client";
import { useEffect, useState } from "react";
import { getClient } from "@/lib/server";

type Action = { nullifier: string; cmx: string; epk: string; ciphertext: string; ciphertext_len: number };
type View = { txid: string; height: number | null; size: number; orchard: Action[]; ironwood: Action[]; sapling_outputs: number; sapling_spends: number; transparent_in: number; transparent_out: number };
type Tx = { kind: "deposit" | "withdrawal"; txid: string; view: View | null };

const cut = (h: string, n = 10) => `${h.slice(0, n)}…${h.slice(-6)}`;

/**
 * "What the chain sees", built from this session's real transactions: the house wallet parses each raw deposit /
 * withdrawal and returns only what any node stores. Bets never touch the chain, so the table itself adds nothing.
 */
export function ChainSees({ table }: { table: string }) {
  const [txs, setTxs] = useState<Tx[] | null>(null); const [off, setOff] = useState(false); const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let un = () => {};
    const load = () => getClient().then(async c => {
      if (!c) { setOff(true); return; }
      try { const r = await c.rpc({ t: "chain_view" }); setTxs(r.txs as Tx[]); } catch { setOff(true); }
      un(); un = c.on("deposit", () => setTimeout(load, 1500));
    });
    load(); return () => un();
  }, []);
  return (
    <section className="fair chain-sees" aria-labelledby={`cs-${table}`}>
      <h4 id={`cs-${table}`}>What the chain sees</h4>
      <div className="cs-row nothing"><span className="cs-k">This table</span><span><b>Nothing.</b> Rounds settle in the house ledger off-chain; placing a bet creates no transaction.</span></div>
      <div className="cs-row"><span className="cs-k">Your session</span>
        {off ? <span className="muted">Wallet service offline.</span>
          : !txs ? <span className="muted">Reading the chain<span className="dots" /></span>
          : !txs.length ? <span className="muted">No deposit yet. When one confirms, this shows the exact bytes a block explorer gets for it.</span>
          : <span>{txs.length} shielded transaction{txs.length > 1 ? "s" : ""}, shown as any node stores them.</span>}
      </div>
      {txs?.map(t => { const v = t.view; const acts = v ? [...v.ironwood, ...v.orchard] : []; const pool = v?.ironwood.length ? "Ironwood" : "Orchard"; const k = t.txid;
        return (
          <div key={k} className="cs-tx">
            <button className="cs-head" aria-expanded={open === k} onClick={() => setOpen(o => o === k ? null : k)}>
              <span className="cs-lock" aria-hidden="true"><svg width="12" height="14" viewBox="0 0 12 14"><rect x="1" y="6" width="10" height="7.5" rx="1.6" fill="currentColor" /><path d="M3.3 6V4.2a2.7 2.7 0 0 1 5.4 0V6" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg></span>
              <span className="mono">{cut(t.txid)}</span>
              <span className="cs-meta">{v ? `block ${v.height?.toLocaleString() ?? "mempool"} · ${acts.length} ${pool} action${acts.length === 1 ? "" : "s"}${v.transparent_in + v.transparent_out ? ` · ${v.transparent_in + v.transparent_out} transparent` : " · 0 transparent"}` : "view unavailable"}</span>
            </button>
            {open === k && v && <div className="cs-acts">
              {acts.map((a, i) => (
                <div key={i} className="cs-act">
                  <small>Action {i + 1}</small>
                  <dl>
                    <dt>Encrypted note</dt><dd className="mono ct">{a.ciphertext.slice(0, 96)}<i>… {a.ciphertext_len} bytes</i></dd>
                    <dt>Nullifier</dt><dd className="mono">{cut(a.nullifier, 16)}</dd>
                    <dt>Note commitment</dt><dd className="mono">{cut(a.cmx, 16)}</dd>
                  </dl>
                </div>))}
              <p className="cs-hidden">Not in the transaction: sender, recipient, amount, memo, your session, this table. A nullifier only says <em>some</em> note was spent; actions are padded so the count does not reveal how many people were paid.</p>
            </div>}
          </div>); })}
    </section>
  );
}
