import type { Term } from "../core/types";
import { QuickActionPopover, ForkIcon } from "./QuickActionPopover";

/** Quick-action popover anchored under a clicked forkable term. A thin preset over
 *  the shared QuickActionPopover, so it stays identical to the selection menu. */
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
  return (
    <QuickActionPopover
      rect={rect}
      title={term.term}
      chip="concept"
      gloss={term.gloss}
      onClose={onClose}
      actions={[
        { label: "Fork branch", variant: "accent", icon: <ForkIcon />, onClick: onFork },
        { label: "Close", onClick: onClose },
      ]}
      footer="Forks a new concept under this one."
    />
  );
}
