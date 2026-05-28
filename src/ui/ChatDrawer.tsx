import { useEffect, useRef, useState } from "react";
import type { ConceptRow } from "../core/store/repositories";
import { useChat } from "../core/store/hooks";
import { TUTOR_MODES, type ChatContext, type TutorMode } from "../core/generation/tutor";
import { getTutorMode, setTutorMode } from "../core/settings";

const QUICK_PROMPTS = ["Make it simpler", "Go deeper", "Give an example", "Quiz me"];

function Bubble({ role, text }: { role: "user" | "ai"; text: string }) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg rounded-br-sm bg-ink px-3 py-2 text-sm text-surface">{text}</div>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink font-mono text-sm text-accent">∿</div>
      <div className="max-w-[85%] rounded-lg rounded-bl-sm border border-rule bg-surface px-3 py-2 text-sm text-ink">
        {text}
      </div>
    </div>
  );
}

/** Chat docked at the bottom of the lesson pane. The input bar is always visible
 *  (ask while reading); the conversation panel slides up on focus/send/chevron
 *  and minimizes back down. */
export function ChatDrawer({
  concept,
  ctx,
  onHeightChange,
}: {
  concept: ConceptRow;
  ctx: ChatContext;
  /** reports the drawer's rendered height so the lesson can reserve scroll room
   *  beneath it (it overlays the lesson, so the lesson pads by this much). */
  onHeightChange?: (height: number) => void;
}) {
  const { turns, streaming, sending, send } = useChat(concept, ctx);
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const [mode, setMode] = useState<TutorMode>(() => getTutorMode());

  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !onHeightChange) return;
    // Fires through the open/close max-height transition too, so the lesson's
    // bottom padding tracks the drawer as it grows and shrinks.
    const ro = new ResizeObserver(() => onHeightChange(el.offsetHeight));
    ro.observe(el);
    onHeightChange(el.offsetHeight);
    return () => ro.disconnect();
  }, [onHeightChange]);

  const submit = (text: string) => {
    if (!text.trim() || sending) return;
    setVal("");
    setOpen(true);
    send(text);
  };
  const changeMode = (m: TutorMode) => {
    setMode(m);
    setTutorMode(m);
  };

  const hasConversation = turns.length > 0 || streaming !== null;

  return (
    <div
      ref={rootRef}
      className="absolute inset-x-0 bottom-0 z-20 border-t border-rule bg-surface shadow-[0_-4px_16px_rgba(26,24,21,0.06)]"
    >
      {/* Expandable conversation panel — slides up/down. */}
      <div
        className={`overflow-hidden transition-[max-height] duration-200 ease-out ${open ? "max-h-[55vh]" : "max-h-0"}`}
      >
        <div className="flex max-h-[55vh] flex-col">
          <div className="flex items-center justify-between border-b border-rule px-4 py-2">
            <span className="text-[10.5px] font-medium uppercase tracking-wider text-ink-3">Conversation</span>
            <select
              value={mode}
              onChange={(e) => changeMode(e.target.value as TutorMode)}
              className="rounded border border-rule bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-2 outline-none"
            >
              {(Object.keys(TUTOR_MODES) as TutorMode[]).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
            {!hasConversation && (
              <p className="text-sm text-ink-3">
                Ask anything about <span className="text-ink-2">{concept.title}</span> — answers stay
                grounded in this concept.
              </p>
            )}
            {turns.map((t) => (
              <Bubble key={t.id} role={t.role} text={t.text} />
            ))}
            {streaming !== null && <Bubble role="ai" text={streaming || "…"} />}
          </div>
          <div className="flex flex-wrap gap-1.5 px-4 pb-2">
            {QUICK_PROMPTS.map((q) => (
              <button
                key={q}
                disabled={sending}
                onClick={() => submit(q)}
                className="rounded border border-rule bg-surface px-2 py-1 text-[11.5px] text-ink-2 hover:border-accent hover:text-accent disabled:opacity-40"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Always-visible input bar. */}
      <div className="flex items-end gap-2 px-3 py-2">
        <button
          onClick={() => setOpen((o) => !o)}
          title={open ? "Minimize" : "Expand conversation"}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" style={{ transform: open ? "rotate(180deg)" : "none" }}>
            <path d="M2 8 L6 4 L10 8" stroke="currentColor" strokeWidth="1.4" fill="none" />
          </svg>
        </button>
        <textarea
          rows={1}
          value={val}
          placeholder={`Ask about ${concept.title}…`}
          onFocus={() => setOpen(true)}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(val);
            }
          }}
          className="max-h-28 flex-1 resize-none rounded-md border border-rule-strong bg-surface-2 px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent"
        />
        <button
          disabled={sending || !val.trim()}
          onClick={() => submit(val)}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-ink text-surface hover:bg-accent disabled:opacity-40"
        >
          {sending ? (
            "…"
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14">
              <path d="M2 7 L12 7 M8 3 L12 7 L8 11" stroke="currentColor" strokeWidth="1.4" fill="none" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
