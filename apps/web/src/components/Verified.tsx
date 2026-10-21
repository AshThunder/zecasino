"use client";
/**
 * One round, one badge: a single green "Verified" (or red "Mismatch") per round, with the evidence folded away
 * underneath. Keeps the `.vrow` / `b.ok` / `b.bad` hooks the QA scripts count.
 */
export function VerifiedRound({ id, summary, ok, children }: { id: string; summary: React.ReactNode; ok: boolean | null; children?: React.ReactNode }) {
  return (
    <details className={`vround ${ok === null ? "pending" : ok ? "is-ok" : "is-bad"}`}>
      <summary className="vrow">
        <span className="vr-id mono">{id}</span>
        <span className="vr-sum mono">{summary}</span>
        {ok === null ? <span className="vbadge wait">Checking…</span>
          : <b className={`vbadge ${ok ? "ok" : "bad"}`}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">{ok ? <path d="m2.5 6.2 2.3 2.3 4.7-5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /> : <path d="m3 3 6 6M9 3 3 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}</svg>
              {ok ? "Verified" : "Mismatch"}
            </b>}
        <svg className="vr-caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="m3 2 3 3-3 3" stroke="currentColor" strokeWidth="1.4" fill="none" /></svg>
      </summary>
      {children && <dl className="vr-details">{children}</dl>}
    </details>
  );
}
