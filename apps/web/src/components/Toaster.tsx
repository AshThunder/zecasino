"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { gsap } from "gsap";
import { dismiss, toasts, type Toast } from "@/lib/toast";
import { reducedMotion } from "@/lib/motion";

const ICON: Record<Toast["kind"], React.ReactNode> = {
  success: <path d="m6 12.5 4 4 8-9" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  error: <><path d="M12 7v6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /><circle cx="12" cy="17" r="1.4" fill="currentColor" /></>,
  info: <><circle cx="12" cy="7.5" r="1.4" fill="currentColor" /><path d="M12 11v6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></>,
  win: <><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="2.6 2.4" /><text x="12" y="15.6" textAnchor="middle" fontSize="9" fontWeight="700" fill="currentColor">Z</text></>,
};

function Item({ t }: { t: Toast }) {
  const el = useRef<HTMLDivElement>(null); const bar = useRef<HTMLElement>(null);
  const [hover, setHover] = useState(false);
  const left = useRef(t.ms); const drag = useRef<{ x: number; dx: number } | null>(null);
  const close = () => { const e = el.current; if (!e || reducedMotion()) return dismiss(t.id); gsap.to(e, { autoAlpha: 0, x: 40, height: 0, marginTop: 0, paddingTop: 0, paddingBottom: 0, duration: .28, ease: "power2.in", onComplete: () => dismiss(t.id) }); };
  useEffect(() => { if (el.current && !reducedMotion()) gsap.from(el.current, { autoAlpha: 0, y: -14, scale: .97, duration: .35, ease: "power3.out" }); }, []);
  useEffect(() => {
    if (hover) return; let last = performance.now(); let raf = 0;
    const tick = (now: number) => { left.current -= now - last; last = now;
      if (bar.current) bar.current.style.transform = `scaleX(${Math.max(0, left.current / t.ms)})`;
      if (left.current <= 0) close(); else raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [hover]); // eslint-disable-line react-hooks/exhaustive-deps
  const down = (e: React.PointerEvent) => { drag.current = { x: e.clientX, dx: 0 }; (e.target as Element).setPointerCapture?.(e.pointerId); setHover(true); };
  const move = (e: React.PointerEvent) => { const d = drag.current; if (!d || !el.current) return; d.dx = Math.max(0, e.clientX - d.x); el.current.style.transform = `translateX(${d.dx}px)`; el.current.style.opacity = String(1 - d.dx / 220); };
  const up = () => { const d = drag.current; drag.current = null; setHover(false); if (!el.current || !d) return; if (d.dx > 80) close(); else { el.current.style.transform = ""; el.current.style.opacity = ""; } };
  return (
    <div ref={el} className={`toast t-${t.kind}`} role={t.kind === "error" ? "alert" : "status"}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <span className="t-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24">{ICON[t.kind]}</svg></span>
      <div className="t-text"><b>{t.title}</b>{t.body && <p>{t.body}</p>}</div>
      <button className="t-close" aria-label="Dismiss notification" onPointerDown={e => e.stopPropagation()} onClick={close}>×</button>
      <i ref={bar} className="t-bar" aria-hidden="true" />
    </div>
  );
}

/** Casino-styled toast stack, top-right (bottom on phones). Polite live region; errors are assertive. */
export function Toaster() {
  const list = useSyncExternalStore(toasts.subscribe, toasts.get, toasts.server);
  const [mounted, setMounted] = useState(false); useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(<div className="toaster" aria-live="polite" aria-relevant="additions">{list.map(t => <Item key={t.id} t={t} />)}</div>, document.body);
}
