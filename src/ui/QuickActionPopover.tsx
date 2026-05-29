import type { ReactNode } from "react";

export interface PopoverAction {
  label: string;
  onClick: () => void;
  /** "accent" = filled primary; "default" = outlined */
  variant?: "accent" | "default";
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
}

/** The quick-action popover anchored under a clicked term or a text selection.
 *  One shell, two callers (TermPopover preset + LessonPane's selection menu), so
 *  the term and selection menus can never visually drift. */
export function QuickActionPopover({
  rect,
  title,
  chip,
  gloss,
  glossMuted = false,
  actions,
  footer,
  onClose,
}: {
  rect: DOMRect;
  title: string;
  chip?: string;
  gloss?: ReactNode;
  /** render the gloss as a muted hint (e.g. "Define inline for a gloss…") */
  glossMuted?: boolean;
  actions: PopoverAction[];
  footer?: ReactNode;
  onClose: () => void;
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
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink" title={title}>
            {title}
          </span>
          {chip && (
            <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-ink-3">
              {chip}
            </span>
          )}
        </div>
        {gloss != null && gloss !== "" && (
          <p
            className={`mb-2.5 border-b border-rule pb-2.5 font-serif text-[12.5px] italic leading-snug ${
              glossMuted ? "text-ink-3" : "text-ink-2"
            }`}
          >
            {gloss}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {actions.map((a, i) => (
            <button
              key={i}
              onClick={a.onClick}
              disabled={a.disabled || a.loading}
              className={
                a.variant === "accent"
                  ? "flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                  : "flex items-center gap-1.5 rounded-md border border-rule bg-surface-2 px-2.5 py-1 text-[11.5px] text-ink-2 hover:text-ink disabled:opacity-50"
              }
            >
              {a.loading ? <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-current" /> : a.icon}
              {a.label}
            </button>
          ))}
        </div>
        {footer && <div className="mt-2.5 font-mono text-[10.5px] text-ink-3">{footer}</div>}
      </div>
    </>
  );
}

/** The fork-branch glyph, shared by the term and selection menus. */
export function ForkIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10">
      <path d="M5 1 L5 5 M3 5 L7 5 M3 5 L3 9 M7 5 L7 9" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </svg>
  );
}
