import type { Term } from "../core/types";

/** Quick-action popover anchored under a clicked forkable term. */
export function TermPopover({
  term,
  rect,
  onClose,
  onFork,
}: {
  term: Term;
  rect: DOMRect;
  onClose: () => void;
  onFork: () => void;
}) {
  const style: React.CSSProperties = {
    position: "fixed",
    top: rect.bottom + 8,
    left: Math.max(12, Math.min(rect.left, window.innerWidth - 326)),
    zIndex: 50,
  };
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div style={style} className="w-[310px] rounded-lg border border-rule-strong bg-surface p-3 shadow-lg">
        <div className="mb-1.5 flex items-baseline gap-2">
          <span className="text-[13px] font-semibold text-ink">{term.term}</span>
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-ink-3">
            concept
          </span>
        </div>
        <p className="mb-2.5 border-b border-rule pb-2.5 font-serif text-[12.5px] italic leading-snug text-ink-2">
          {term.gloss}
        </p>
        <div className="flex gap-1.5">
          <button
            onClick={onFork}
            className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-medium text-white hover:opacity-90"
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M5 1 L5 5 M3 5 L7 5 M3 5 L3 9 M7 5 L7 9" stroke="currentColor" strokeWidth="1.4" fill="none" />
            </svg>
            Fork branch
          </button>
          <button
            onClick={onClose}
            className="rounded-md border border-rule bg-surface-2 px-2.5 py-1 text-[11.5px] text-ink-2 hover:text-ink"
          >
            Close
          </button>
        </div>
        <div className="mt-2.5 font-mono text-[10.5px] text-ink-3">Forks a new concept under this one.</div>
      </div>
    </>
  );
}
