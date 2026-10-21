"use client";
/** The one close button every modal uses: top-right, 40px target, aria-label "Close". */
export function CloseX({ onClick }: { onClick: () => void }) {
  return <button type="button" className="dlg-x" onClick={onClick} aria-label="Close" title="Close (Esc)">
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
  </button>;
}
/** Click on a <dialog>'s own box (i.e. its ::backdrop) closes it; clicks on content do not. */
export const backdropClose = (close: () => void) => (e: React.MouseEvent<HTMLElement>) => {
  if (e.target !== e.currentTarget) return;
  const r = e.currentTarget.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom || e.currentTarget.classList.contains("wt-backdrop")) close();
};
