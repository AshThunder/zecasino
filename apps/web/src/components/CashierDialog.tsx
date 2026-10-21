"use client";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { DEPOSIT, zip321 } from "@/lib/mock";
import { ZMark } from "./ZMark";

export function CashierDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState("");
  const [delay, setDelay] = useState("random");
  const uri = zip321(DEPOSIT.address, DEPOSIT.amount, DEPOSIT.memoTag);

  useEffect(() => {
    QRCode.toDataURL(uri, { margin: 1, width: 440, errorCorrectionLevel: "M", color: { dark: "#14110A", light: "#FBF7EE" } }).then(setQr);
  }, [uri]);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);

  const copy = (k: string, v: string) => { navigator.clipboard?.writeText(v); setCopied(k); setTimeout(() => setCopied(""), 1400); };
  return (
    <dialog ref={ref} className="cashier" onClose={onClose} {...{ closedby: "any" }} aria-labelledby="cashier-title">
      <div className="cashier-head">
        <ZMark size={30} />
        <div><h2 id="cashier-title">Cashier</h2><p>Shielded in, shielded out. No account.</p></div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" /></svg>
        </button>
      </div>
      <div className="tabs" role="tablist">
        {(["deposit", "withdraw"] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "deposit" ? "Deposit" : "Withdraw"}</button>)}
      </div>
      {tab === "deposit" ? (
        <div className="dep">
          <div className="qr-wrap">
            {qr && <img src={qr} alt="ZIP-321 payment QR" width={220} height={220} />}
            <span className="qr-badge"><ZMark size={34} /></span>
          </div>
          <div className="dep-info">
            <label>One-time shielded deposit address <em>Orchard · Ironwood</em></label>
            <div className="mono addr">{DEPOSIT.address}</div>
            <button className="btn ghost sm" onClick={() => copy("a", DEPOSIT.address)}>{copied === "a" ? "Copied" : "Copy address"}</button>
            <label>Memo tag <em>matches the deposit to this session</em></label>
            <div className="mono memo">{DEPOSIT.memoTag}</div>
            <button className="btn ghost sm" onClick={() => copy("u", uri)}>{copied === "u" ? "Copied" : "Copy payment link"}</button>
            <ol className="steps">
              <li className="done">Address derived for this session (diversifier #{DEPOSIT.diversifierIndex})</li>
              <li className="live"><span className="pulse" />Watching with the house viewing key…</li>
              <li>3 confirmations · about 75 s on NU7 testnet</li>
            </ol>
          </div>
          <ul className="assure">
            <li>No transparent receiver. Never reused.</li>
            <li>The memo is encrypted; only the house viewing key can read it.</li>
            <li>Send from a shielded wallet: Zashi, Zingo, YWallet.</li>
          </ul>
        </div>
      ) : (
        <form className="wd" onSubmit={e => e.preventDefault()}>
          <label htmlFor="wd-addr">Withdraw to a shielded address</label>
          <input id="wd-addr" className="mono" placeholder="utest1… or ztestsapling1…" autoComplete="off" spellCheck={false} />
          <small>Transparent t-addresses are refused to protect your privacy.</small>
          <label htmlFor="wd-amt">Amount</label>
          <div className="amt"><span>ⓩ</span><input id="wd-amt" inputMode="decimal" defaultValue="0.2500" /><span>TAZ</span></div>
          <fieldset className="delay"><legend>Privacy delay</legend>
            {[["now", "Next batch", "Fast; shares a batch"], ["random", "Random 5–60 min", "Recommended"], ["6h", "Up to 6 hours", "Strongest unlinkability"]].map(([v, l, s]) => (
              <label key={v} className={delay === v ? "on" : ""}><input type="radio" name="delay" value={v} checked={delay === v} onChange={() => setDelay(v)} /><b>{l}</b><small>{s}</small></label>
            ))}
          </fieldset>
          <button className="btn gold wide">Queue shielded withdrawal</button>
        </form>
      )}
    </dialog>
  );
}
