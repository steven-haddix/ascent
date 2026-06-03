import type { ReactNode } from "react";
import type { SuggestedFork } from "../core/types";

/** A link to a concept that already exists in the tree. `viaFork` rows are forks
 *  that turned out to match an existing concept at render time — they route through
 *  `onFork` so the dedup guard (one site) navigates AND records the edge; plain
 *  links navigate directly (their edge was created eagerly upstream). */
export interface RelatedItem {
  conceptId: string;
  title: string;
  reason: string;
  viaFork: boolean;
}

/** A next-step row: a Link to an existing concept, or a Fork to a new one. Same
 *  shape, different action label + handler. */
function SuggestionRow({
  title,
  reason,
  action,
  onClick,
}: {
  title: string;
  reason: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border border-rule bg-surface px-3 py-2.5 text-left hover:border-accent hover:bg-surface-2"
    >
      <span>
        <span className="block text-[13px] font-medium text-ink">{title}</span>
        {reason && <span className="mt-0.5 block text-[12px] text-ink-3">{reason}</span>}
      </span>
      <span className="shrink-0 font-mono text-[11.5px] text-ink-3">{action}</span>
    </button>
  );
}

function SuggestionSection({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="mt-9 font-sans">
      <div className="mb-3 flex items-baseline justify-between border-b border-rule pb-2">
        <span className="text-[11.5px] font-semibold uppercase tracking-wide text-ink">{label}</span>
        <span className="text-[11.5px] text-ink-3">{hint}</span>
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

/** The closing "where to go next" block: existing concepts to revisit (Links) and
 *  net-new branches to create (Forks). Shared by the lesson foot and the teach-back
 *  result. `forkLabel`/`forkHint` let a caller retitle the Forks section (the
 *  teach-back calls them "Gaps to explore"). */
export function NextSteps({
  related,
  forks,
  onFork,
  onNavigate,
  forkLabel = "Branches to explore",
  forkHint = "New — fork into your tree",
}: {
  related: RelatedItem[];
  forks: SuggestedFork[];
  onFork: (title: string, summary?: string) => void;
  onNavigate: (conceptId: string) => void;
  forkLabel?: string;
  forkHint?: string;
}) {
  if (!related.length && !forks.length) return null;
  return (
    <>
      {related.length > 0 && (
        <SuggestionSection label="Related in your tree" hint="Already here — go revisit">
          {related.map((r) => (
            <SuggestionRow
              key={r.conceptId}
              title={r.title}
              reason={r.reason}
              action="Go to →"
              onClick={() => (r.viaFork ? onFork(r.title, r.reason) : onNavigate(r.conceptId))}
            />
          ))}
        </SuggestionSection>
      )}
      {forks.length > 0 && (
        <SuggestionSection label={forkLabel} hint={forkHint}>
          {forks.map((f, i) => (
            <SuggestionRow
              key={i}
              title={f.title}
              reason={f.reason}
              action="Fork →"
              onClick={() => onFork(f.title, f.reason)}
            />
          ))}
        </SuggestionSection>
      )}
    </>
  );
}
