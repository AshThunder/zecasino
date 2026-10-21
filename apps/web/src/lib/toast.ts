"use client";
/** Tiny toast store: toast({ kind, title, body }) from anywhere; <Toaster/> renders the stack. */
export type ToastKind = "success" | "error" | "info" | "win";
export type Toast = { id: number; kind: ToastKind; title: string; body?: string; ms: number };
let list: Toast[] = []; let n = 0; const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());
export const toasts = { subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; }, get: () => list, server: () => list };
export function toast(t: { kind: ToastKind; title: string; body?: string; ms?: number }) {
  const ms = t.ms ?? (t.kind === "error" ? 7000 : t.kind === "win" ? 5000 : 4000);
  const item = { ...t, id: ++n, ms };
  // Same message twice in a row: refresh instead of stacking duplicates.
  list = [item, ...list.filter(x => !(x.title === t.title && x.body === t.body))].slice(0, 4); emit(); return item.id;
}
export function dismiss(id: number) { list = list.filter(x => x.id !== id); emit(); }
