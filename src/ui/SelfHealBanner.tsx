// The visible surface of self-healing (Continuity B6): an unobtrusive "your understanding
// changed — refresh?" nudge when a lesson is stale, and a "revised" badge with one-click
// revert after a refresh. Silent rewrites would erode trust; every change is offered,
// versioned, and reversible.
export function SelfHealBanner({
  stale,
  revised,
  canRevert,
  onRefresh,
  onDismiss,
  onRevert,
}: {
  stale: boolean;
  revised: boolean;
  canRevert: boolean;
  onRefresh: () => void;
  onDismiss: () => void;
  onRevert: () => void;
}) {
  if (!stale && !revised) return null;
  return (
    <div className="mt-5 font-sans">
      {stale ? (
        <div className="flex items-center gap-3 rounded-md border border-accent/40 bg-accent/5 px-3 py-2">
          <span className="flex-1 text-[12.5px] text-ink-2">
            Your understanding has changed since this lesson was written.
          </span>
          <button
            onClick={onRefresh}
            className="rounded-md bg-ink px-2.5 py-1 text-[12px] font-medium text-surface hover:bg-accent"
          >
            Refresh
          </button>
          <button onClick={onDismiss} className="text-[12px] text-ink-3 hover:text-ink">
            Dismiss
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[11.5px] text-ink-3">
          <span className="rounded bg-surface-2 px-1.5 py-0.5">Revised</span>
          <span className="flex-1">This lesson was refreshed to match your progress.</span>
          {canRevert && (
            <button onClick={onRevert} className="text-accent hover:underline">
              Revert
            </button>
          )}
        </div>
      )}
    </div>
  );
}
