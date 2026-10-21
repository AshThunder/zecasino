"use client";
import { CloseX } from "./CloseX";
import { Toaster } from "./Toaster";
import { RecoveryCard, RestoreDialog } from "./Recovery";
import { toast } from "@/lib/toast";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ZMark } from "./ZMark";
import { CashierDialog } from "./CashierDialog";
import { useSyncExternalStore } from "react";
import { getClient, serverState, SESSION_KEY, KEEP_KEY } from "@/lib/server";
import { isMuted, setMuted } from "@/lib/sfx";

import { GAMES } from "@/lib/games";
import { installMotion } from "@/lib/motion";
import { DepositShield } from "./DepositShield";
import { DemoBar, ModeSwitch } from "./DemoBar";
const NAV = [["Lobby", "/"], ["Provably fair", "/#fair"], ["Solvency", "/solvency"], ["History", "/history"]] as const;
const PVP = GAMES.filter(g => g.kind.startsWith("Player")), HOUSE = GAMES.filter(g => !PVP.includes(g));

/** Games menu: all seven tables, grouped. Opens on click or keyboard, closes on Escape / outside click / navigation. */
function GamesMenu({ path }: { path: string }) {
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  const on = path.startsWith("/table/");
  return (
    <div className="games-menu" ref={ref}>
      <button className={on || open ? "on" : ""} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(o => !o)}>
        Games <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="m2 3.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>
      </button>
      {open && <div className="games-pop" role="menu">
        {[["Player vs player", PVP], ["House games", HOUSE]].map(([h, list]) => (
          <div key={h as string} className="gp-col"><small>{h as string}</small>
            {(list as typeof GAMES).map(g => <Link key={g.id} role="menuitem" href={g.href} className={path === g.href ? "on" : ""}><b>{g.name}</b><span>{g.kind}</span></Link>)}
          </div>))}
      </div>}
    </div>
  );
}

/** Small screens: one sheet with every table and page. */
function MobileMenu({ path, onKey }: { path: string; onKey: () => void }) {
  const [open, setOpen] = useState(false);
  const [restore, setRestore] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => { document.body.classList.toggle("menu-open", open); }, [open]);
  return (<>
    <button className="icon-btn burger" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(o => !o)}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">{open ? <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" /> : <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" />}</svg>
    </button>
    {restore && <RestoreDialog onClose={() => setRestore(false)} />}
    {open && createPortal(<nav className="mobile-sheet" aria-label="Menu">
      <Link href="/" className={path === "/" ? "on" : ""}>Lobby</Link>
      <small>Player vs player</small>{PVP.map(g => <Link key={g.id} href={g.href} className={path === g.href ? "on" : ""}>{g.name}<span>{g.kind}</span></Link>)}
      <small>House games</small>{HOUSE.map(g => <Link key={g.id} href={g.href} className={path === g.href ? "on" : ""}>{g.name}<span>{g.kind}</span></Link>)}
      <small>Your session</small><button className="ms-key" onClick={() => { setOpen(false); onKey(); }}>Session key &amp; recovery code<span>Save it, or restore another session</span></button>
      <button className="ms-key restore-entry" onClick={() => { setOpen(false); setRestore(true); }}>Restore session<span>Paste a recovery code or open a backup file</span></button>
      <small>Mode</small><div className="ms-wrap"><ModeSwitch /></div>
      <small>Trust</small><Link href="/#fair">Provably fair</Link><Link href="/solvency" className={path === "/solvency" ? "on" : ""}>Solvency</Link><Link href="/history" className={path === "/history" ? "on" : ""}>Session history</Link>
    </nav>, document.body)}
  </>);
}

export function Header() {
  const live = useSyncExternalStore(serverState.subscribe, serverState.get, serverState.server);
  useEffect(() => { getClient(); installMotion(); }, []);
  useEffect(() => { if (sessionStorage.getItem("zc.restored") && live.balance != null) { sessionStorage.removeItem("zc.restored"); toast({ kind: "success", title: "Session restored", body: `Balance ⓩ ${live.balance.toFixed(4)} is back in this browser.` }); } }, [live.balance]);
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [muted, setM] = useState(isMuted());
  const [keyOpen, setKeyOpen] = useState(false);
  return (<>
    <header className="hdr">
      <Link href="/" className="brand" aria-label="Zecasino lobby">
        <ZMark size={38} />
        <span className="brand-text"><span className="wordmark">ZECASINO</span><span className="tag">Play in the shielded pool</span></span>
      </Link>
      <nav className="nav" aria-label="Main">
        <Link href="/" className={path === "/" ? "on" : ""}>Lobby</Link>
        <GamesMenu path={path} />
        {NAV.slice(1).map(([l, h]) => <Link key={h} href={h} className={path === h ? "on" : ""}>{l}</Link>)}
      </nav>
      <div className="hdr-right">
        <ModeSwitch />
        <button className="shield-pill" title="Session key: save it to come back to this balance" aria-expanded={keyOpen} onClick={() => setKeyOpen(o => !o)}>
          <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true"><path d="M7 0 14 3v5c0 4-3 7-7 8-4-1-7-4-7-8V3z" fill="#F4B728" /><path d="m4 8 2 2 4-4" stroke="#14110A" strokeWidth="1.8" fill="none" /></svg>
          Shielded session
        </button>
        {keyOpen && <SessionKey onClose={() => setKeyOpen(false)} />}
        <span className="balance"><small>Balance</small><b>{live.balance == null ? <span className="skel" /> : `ⓩ ${live.balance.toFixed(4)}`}</b><small>TAZ</small></span>
        <button className="icon-btn" aria-label={muted ? "Unmute" : "Mute"} onClick={() => { setMuted(!muted); setM(!muted); }}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />{muted ? <path d="m16 9 5 6m0-6-5 6" stroke="currentColor" strokeWidth="2" /> : <path d="M16 8a5 5 0 0 1 0 8M18.5 5.5a8.5 8.5 0 0 1 0 13" stroke="currentColor" strokeWidth="2" fill="none" />}</svg>
        </button>
        <button className="btn gold" onClick={() => setOpen(true)}>Cashier</button>
        <MobileMenu path={path} onKey={() => setKeyOpen(true)} />
      </div>
      <CashierDialog open={open} onClose={() => setOpen(false)} />
      <DepositShield />
      <Toaster />
    </header>
    <DemoBar />
  </>);
}

/** Your session key is the only thing that ties you to a balance. No account exists to recover it. */
function SessionKey({ onClose }: { onClose: () => void }) {
  const [tok, setTok] = useState(""); const [show, setShow] = useState(false); const [keep, setKeep] = useState(false); const [paste, setPaste] = useState("");
  useEffect(() => { setTok(sessionStorage.getItem(SESSION_KEY) ?? ""); setKeep(!!localStorage.getItem(KEEP_KEY)); }, []);
  const remember = (on: boolean) => { setKeep(on); if (on) localStorage.setItem(KEEP_KEY, tok); else localStorage.removeItem(KEEP_KEY); };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);
  const restore = () => { const k = paste.trim(); if (!/^[0-9a-f]{64}$/.test(k)) return; sessionStorage.setItem(SESSION_KEY, k); if (keep) localStorage.setItem(KEEP_KEY, k); location.reload(); };
  return (
    <div className="session-key" role="dialog" aria-label="Session key">
      <h4>Session key</h4>
      <p>This key is your balance. Closing the tab forgets it unless you save it here. Anyone holding it can spend your balance.</p>
      <div className="sk-row"><code className="mono">{show ? tok : `${tok.slice(0, 6)}${"•".repeat(20)}`}</code>
        <button className="btn ghost sm" onClick={() => setShow(s => !s)}>{show ? "Hide" : "Show"}</button>
        <button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(tok); toast({ kind: "info", title: "Session key copied", body: "Keep it somewhere private: it spends your balance." }); }}>Copy</button></div>
      <label className="sk-keep"><input type="checkbox" checked={keep} onChange={e => remember(e.target.checked)} /> Remember on this device (stored in this browser only)</label>
      <div className="sk-row"><input id="sk-restore" className="mono" placeholder="Paste a saved key to restore" value={paste} onChange={e => setPaste(e.target.value)} spellCheck={false} />
        <button className="btn gold sm" onClick={restore} disabled={!/^[0-9a-f]{64}$/.test(paste.trim())}>Restore</button></div>
      <RecoveryCard compact />
      <CloseX onClick={onClose} />
    </div>
  );
}
