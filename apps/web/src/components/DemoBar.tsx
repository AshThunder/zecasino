"use client";
import { useEffect, useState } from "react";
import { DEMO, getClient, setMode } from "@/lib/server";

/** Persistent label while in demo mode: what it is, what it can't touch, refill and the way out. */
export function DemoBar() {
  const [on, setOn] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setOn(DEMO); document.body.classList.toggle("demo-mode", DEMO); }, []);
  if (!on) return null;
  const refill = async () => { const c = await getClient(); if (!c) { setMsg("Demo server offline"); return; } await c.rpc({ t: "demo_refill" }); setMsg("Topped up to 5 play chips"); setTimeout(() => setMsg(null), 2000); };
  return (
    <div className="demo-bar" role="note">
      <span className="db-tag">Demo</span>
      <span className="db-text"><b>Play chips only.</b> A separate demo server and database: nothing here touches the real ledger or the chain.</span>
      <span className="db-act">{msg && <em>{msg}</em>}<button className="btn ghost sm" onClick={refill}>Refill chips</button><button className="btn ghost sm" onClick={() => setMode(false)}>Leave demo</button></span>
    </div>
  );
}

/** Real / Demo switch for the header. */
export function ModeSwitch() {
  const [demo, setDemo] = useState(false);
  useEffect(() => setDemo(DEMO), []);
  return (
    <div className="mode-switch" role="group" aria-label="Table mode">
      <button aria-pressed={!demo} className={!demo ? "on" : ""} onClick={() => demo && setMode(false)}>Real</button>
      <button aria-pressed={demo} className={demo ? "on" : ""} onClick={() => !demo && setMode(true)}>Demo</button>
    </div>
  );
}
