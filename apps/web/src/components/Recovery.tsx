"use client";
import { CloseX, backdropClose } from "./CloseX";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { adopt, backupBlob, currentToken, download, fromCode, isSaved, markSaved, readBackup, toCode } from "@/lib/recovery";
import { toast } from "@/lib/toast";
import { DEMO } from "@/lib/server";

/** One-time recovery code + downloadable backup, shown before the first deposit address. */
export function RecoveryCard({ onDone, compact }: { onDone?: () => void; compact?: boolean }) {
  const [tok, setTok] = useState(""); const [code, setCode] = useState(""); const [pass, setPass] = useState(""); const [ack, setAck] = useState(false);
  useEffect(() => { const t = currentToken(); setTok(t); if (t) toCode(t).then(setCode); }, []);
  if (!tok) return <div className="rc rc-skel" role="status"><span className="skel" /> Preparing your recovery code…</div>;
  const copy = () => { navigator.clipboard?.writeText(code); toast({ kind: "info", title: "Recovery code copied", body: "Paste it into a password manager, not a chat." }); };
  const save = async () => { download(await backupBlob(tok, pass || undefined)); toast({ kind: "success", title: "Backup downloaded", body: pass ? "Sealed with your passphrase." : "Keep the file private: it restores your balance." }); };
  return (
    <section className={`rc ${compact ? "compact" : ""}`} aria-labelledby="rc-h">
      <div className="rc-head"><svg width="20" height="22" viewBox="0 0 14 16" aria-hidden="true"><path d="M7 0 14 3v5c0 4-3 7-7 8-4-1-7-4-7-8V3z" fill="#F4B728" /><path d="M5 7.5V6a2 2 0 0 1 4 0v1.5M4.5 7.5h5v4h-5z" stroke="#14110A" strokeWidth="1.2" fill="none" /></svg>
        <h4 id="rc-h">Save your recovery code</h4></div>
      <p>There is no account. Your balance belongs to this browser session; if you clear site data or switch devices, this code is the only way back. Anyone with it can spend the balance.</p>
      <code className="rc-code mono" aria-label="Recovery code">{code || "…"}</code>
      <div className="rc-actions">
        <button className="btn ghost sm" onClick={copy} disabled={!code}>Copy code</button>
        <span className="rc-file"><input type="password" placeholder="Optional passphrase" value={pass} onChange={e => setPass(e.target.value)} aria-label="Passphrase to seal the backup file (optional)" autoComplete="new-password" />
          <button className="btn ghost sm" onClick={save} disabled={!code}>Download backup</button></span>
      </div>
      {onDone && <label className="rc-ack"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /> I saved my recovery code somewhere safe</label>}
      {onDone && <div className="rc-go"><button className="btn gold sm" disabled={!ack} onClick={() => { markSaved(tok); onDone(); }}>Show my deposit address</button></div>}
    </section>
  );
}
export const recoverySaved = () => isSaved(currentToken());

/** Lobby: restore a session from a recovery code or backup file. */
export function RestoreDialog({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState(""); const [file, setFile] = useState<string | null>(null); const [needPass, setNeedPass] = useState(false);
  const [pass, setPass] = useState(""); const [err, setErr] = useState<string | null>(null); const [keep, setKeep] = useState(true); const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const go = async () => {
    setBusy(true); setErr(null);
    let token: string | null = null;
    if (file) { const r = await readBackup(file, pass || undefined); if (r.needsPass && !r.error) { setNeedPass(true); setBusy(false); return; } if (r.error) { setErr(r.error); setNeedPass(!!r.needsPass); setBusy(false); return; }
      if ((r.mode === "demo") !== DEMO) { setErr(r.mode === "demo" ? "This backup is for play chips: switch to Demo first." : "This backup is for the real cashier: leave Demo first."); setBusy(false); return; } token = r.token!; }
    else token = await fromCode(code);
    if (!token) { setErr("That code doesn't check out. Look for a typo: the last group is a checksum."); setBusy(false); return; }
    if (token === currentToken()) { setErr("That's the session you're already in."); setBusy(false); return; }
    adopt(token, keep);
  };
  return createPortal(
    <dialog ref={ref} className="restore" onClose={onClose} onClick={backdropClose(() => ref.current?.close())} {...{ closedby: "any" }} aria-labelledby="rs-h">
      <CloseX onClick={() => ref.current?.close()} />
      <h3 id="rs-h">Restore a session</h3>
      <p>Paste your recovery code or open your backup file. This browser switches to that balance; the current session stays on the server, so save its code first if it holds funds.</p>
      <label className="rs-field"><small>Recovery code</small><textarea className="mono" rows={2} value={code} onChange={e => { setCode(e.target.value); setFile(null); setErr(null); }} placeholder={DEMO ? "PLAY-XXXX-XXXX-…" : "ZEC-XXXX-XXXX-…"} spellCheck={false} autoCapitalize="characters" /></label>
      <div className="rs-or"><span>or</span></div>
      <label className="btn ghost sm rs-upload">{file ? "Backup file loaded ✓" : "Open backup file"}<input type="file" accept="application/json,.json" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) { setFile(await f.text()); setCode(""); setErr(null); setNeedPass(false); } }} /></label>
      {needPass && <label className="rs-field"><small>Backup passphrase</small><input type="password" value={pass} onChange={e => setPass(e.target.value)} autoFocus /></label>}
      <label className="rc-ack"><input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)} /> Remember on this device</label>
      {err && <p className="rs-err" role="alert">{err}</p>}
      <div className="rs-actions"><button className="btn ghost" onClick={() => ref.current?.close()}>Cancel</button><button className="btn gold" disabled={busy || (!code.trim() && !file)} onClick={go}>{busy ? "Checking…" : "Restore session"}</button></div>
    </dialog>, document.body);
}
