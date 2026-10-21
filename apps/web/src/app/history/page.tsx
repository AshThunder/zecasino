"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { VerifiedRound } from "@/components/Verified";
import { clearAll, load, onChange, remove, verifyProof, type Entry, type Proof } from "@/lib/history";
import { GAMES } from "@/lib/games";

const name = (g: string) => GAMES.find(x => x.id === g)?.name ?? g;
const short = (s: string) => s.length > 22 ? `${s.slice(0, 10)}…${s.slice(-8)}` : s;
function ProofRows({ p }: { p: Proof }) {
  if (p.kind === "house") return <><dt>Seed commitment</dt><dd className="mono">{short(p.commitment)}</dd><dt>Client seed · nonce</dt><dd className="mono">{p.clientSeed} · {p.nonce}</dd>
    <dt>Server seed</dt><dd className="mono">{p.serverSeed ? short(p.serverSeed) : "not revealed yet: press “Reveal seed & verify” at the table"}</dd></>;
  if (p.kind === "crash") return <><dt>Round · bust</dt><dd className="mono">#{p.round} · {(p.bust / 100).toFixed(2)}×</dd><dt>Seed / commitment</dt><dd className="mono">{short(p.serverSeed)} / {short(p.commitment)}</dd></>;
  return <><dt>Commitment</dt><dd className="mono">{short(p.commitment)}</dd><dt>Salt · value</dt><dd className="mono">{short(p.salt)} · {p.valueHex}</dd></>;
}

export default function History() {
  const [list, setList] = useState<Entry[] | null>(null);
  const [ok, setOk] = useState<Record<string, (boolean | null)[]>>({});
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { const f = () => setList(load()); f(); return onChange(f); }, []);
  useEffect(() => {
    if (!list) return; let alive = true;
    (async () => { const out: Record<string, (boolean | null)[]> = {}; for (const e of list) out[e.id] = await Promise.all(e.proofs.map(verifyProof)); if (alive) setOk(out); })();
    return () => { alive = false; };
  }, [list]);
  const state = (e: Entry) => { const r = ok[e.id]; if (!r) return null; return r.some(x => x === false) ? false : r.some(x => x === null) ? null : true; };
  return (
    <>
      <main className="history-page wrap">
        <div className="h-head">
          <div><p className="eyebrow">Only in this browser</p><h1>Session history</h1>
            <p className="lede">Your past rounds are kept in this browser&apos;s local storage and nowhere else; the server keeps no per-player history. Every round is re-verified here, from its stored seeds and salts, each time you open this page.</p></div>
          {list && list.length > 0 && (confirm
            ? <div className="h-confirm"><span>Delete all {list.length} rounds from this browser?</span><button className="btn sm danger" onClick={() => { clearAll(); setConfirm(false); }}>Delete</button><button className="btn ghost sm" onClick={() => setConfirm(false)}>Keep</button></div>
            : <button className="btn ghost sm" onClick={() => setConfirm(true)}>Clear history</button>)}
        </div>
        {list === null ? <div className="h-list">{[0, 1, 2].map(i => <div key={i} className="skel h-skel" />)}</div>
          : list.length === 0 ? <div className="empty-state"><svg width="54" height="54" viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="25" fill="none" stroke="#E9C46A55" strokeDasharray="4 5" /><path d="M27 15v13l8 5" stroke="#E9C46A" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>
              <h3>No rounds yet</h3><p>Play any table and each round lands here with its proof.</p><Link className="btn gold" href="/">Choose a table</Link></div>
          : <div className="h-list verify">{list.map(e => (
              <div className="h-item" key={e.id}>
                <VerifiedRound id={name(e.game)} summary={<>{e.summary}<span className="h-at">{new Date(e.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}{e.demo ? " · play chips" : ""}</span></>} ok={state(e)} pendingLabel={ok[e.id] ? "Seed not revealed" : "Checking…"}>
                  {e.proofs.map((p, i) => <ProofRows key={i} p={p} />)}
                </VerifiedRound>
                <button className="h-del" aria-label="Delete this round" onClick={() => remove(e.id)}>×</button>
              </div>))}
            </div>}
      </main>
    </>
  );
}
