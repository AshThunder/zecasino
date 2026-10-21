"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ZMark } from "./ZMark";
import { CashierDialog } from "./CashierDialog";
import { SESSION } from "@/lib/mock";
import { useSyncExternalStore } from "react";
import { getClient, serverState, SESSION_KEY, KEEP_KEY } from "@/lib/server";
import { isMuted, setMuted } from "@/lib/sfx";

const NAV = [["Lobby", "/"], ["Carrot in a Box", "/table/carrot"], ["Roulette", "/table/roulette"], ["Provably fair", "/#fair"], ["Solvency", "/solvency"]] as const;

export function Header() {
  const live = useSyncExternalStore(serverState.subscribe, serverState.get, serverState.server);
  useEffect(() => { getClient(); }, []);
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [muted, setM] = useState(isMuted());
  const [keyOpen, setKeyOpen] = useState(false);
  return (
    <header className="hdr">
      <Link href="/" className="brand" aria-label="Zecasino lobby">
        <ZMark size={38} />
        <span className="brand-text"><span className="wordmark">ZECASINO</span><span className="tag">Play in the shielded pool</span></span>
      </Link>
      <nav className="nav" aria-label="Main">
        {NAV.map(([l, h]) => <Link key={h} href={h} className={path === h ? "on" : ""}>{l}</Link>)}
      </nav>
      <div className="hdr-right">
        <button className="shield-pill" title="Session key: save it to come back to this balance" aria-expanded={keyOpen} onClick={() => setKeyOpen(o => !o)}>
          <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true"><path d="M7 0 14 3v5c0 4-3 7-7 8-4-1-7-4-7-8V3z" fill="#F4B728" /><path d="m4 8 2 2 4-4" stroke="#14110A" strokeWidth="1.8" fill="none" /></svg>
          Shielded session
        </button>
        {keyOpen && <SessionKey onClose={() => setKeyOpen(false)} />}
        <span className="balance"><small>Balance</small><b>ⓩ {(live.balance ?? SESSION.balance).toFixed(4)}</b><small>TAZ</small></span>
        <button className="icon-btn" aria-label={muted ? "Unmute" : "Mute"} onClick={() => { setMuted(!muted); setM(!muted); }}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />{muted ? <path d="m16 9 5 6m0-6-5 6" stroke="currentColor" strokeWidth="2" /> : <path d="M16 8a5 5 0 0 1 0 8M18.5 5.5a8.5 8.5 0 0 1 0 13" stroke="currentColor" strokeWidth="2" fill="none" />}</svg>
        </button>
        <button className="btn gold" onClick={() => setOpen(true)}>Cashier</button>
      </div>
      <CashierDialog open={open} onClose={() => setOpen(false)} />
    </header>
  );
}

/** Your session key is the only thing that ties you to a balance. No account exists to recover it. */
function SessionKey({ onClose }: { onClose: () => void }) {
  const [tok, setTok] = useState(""); const [show, setShow] = useState(false); const [keep, setKeep] = useState(false); const [paste, setPaste] = useState("");
  useEffect(() => { setTok(sessionStorage.getItem(SESSION_KEY) ?? ""); setKeep(!!localStorage.getItem(KEEP_KEY)); }, []);
  const remember = (on: boolean) => { setKeep(on); if (on) localStorage.setItem(KEEP_KEY, tok); else localStorage.removeItem(KEEP_KEY); };
  const restore = () => { const k = paste.trim(); if (!/^[0-9a-f]{64}$/.test(k)) return; sessionStorage.setItem(SESSION_KEY, k); if (keep) localStorage.setItem(KEEP_KEY, k); location.reload(); };
  return (
    <div className="session-key" role="dialog" aria-label="Session key">
      <h4>Session key</h4>
      <p>This key is your balance. Closing the tab forgets it unless you save it here. Anyone holding it can spend your balance.</p>
      <div className="sk-row"><code className="mono">{show ? tok : `${tok.slice(0, 6)}${"•".repeat(20)}`}</code>
        <button className="btn ghost sm" onClick={() => setShow(s => !s)}>{show ? "Hide" : "Show"}</button>
        <button className="btn ghost sm" onClick={() => navigator.clipboard?.writeText(tok)}>Copy</button></div>
      <label className="sk-keep"><input type="checkbox" checked={keep} onChange={e => remember(e.target.checked)} /> Remember on this device (stored in this browser only)</label>
      <div className="sk-row"><input id="sk-restore" className="mono" placeholder="Paste a saved key to restore" value={paste} onChange={e => setPaste(e.target.value)} spellCheck={false} />
        <button className="btn gold sm" onClick={restore} disabled={!/^[0-9a-f]{64}$/.test(paste.trim())}>Restore</button></div>
      <button className="sk-close" onClick={onClose} aria-label="Close">×</button>
    </div>
  );
}
