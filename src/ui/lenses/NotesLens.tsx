import { useEffect, useRef, useState } from "react";
import { useNotes, useAddNote } from "../../core/store/hooks";
import type { LensProps } from "./types";

function ago(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function NotesLens({ concept }: LensProps) {
  const notes = useNotes(concept.id);
  const add = useAddNote(concept.id);
  const [val, setVal] = useState("");

  // Grow the input with its content, up to a cap (then it scrolls).
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [val]);

  const submit = () => {
    const t = val.trim();
    if (!t) return;
    add.mutate(t);
    setVal("");
  };
  const items = [...(notes.data ?? [])].reverse(); // newest first

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-rule p-3">
        <textarea
          ref={taRef}
          rows={2}
          value={val}
          placeholder="Jot a note on this concept…"
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          className="max-h-80 w-full resize-none overflow-y-auto rounded-md border border-rule-strong bg-surface-2 px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10.5px] text-ink-3">⌘↵ to save</span>
          <button
            onClick={submit}
            disabled={!val.trim()}
            className="rounded-md bg-ink px-3 py-1 text-xs font-medium text-surface hover:bg-accent disabled:opacity-40"
          >
            Add note
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {items.length === 0 ? (
          <p className="mt-6 text-center text-xs text-ink-3">No notes yet. What stuck with you?</p>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((n) => (
              <div key={n.id} className="rounded-md border border-rule bg-surface-2 p-2.5">
                <div className="mb-1 font-mono text-[10px] text-ink-3">{ago(n.createdAt)}</div>
                <div className="whitespace-pre-wrap text-sm text-ink">{n.text}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
