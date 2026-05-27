import { useState } from "react";

/** Home / new-topic screen. Name a subject -> AI sketches the concept tree. */
export function Trailhead({
  onStart,
  busy,
  error,
}: {
  onStart: (title: string) => void;
  busy: boolean;
  error?: string | null;
}) {
  const [title, setTitle] = useState("");
  const start = () => {
    if (title.trim() && !busy) onStart(title.trim());
  };
  return (
    <div className="grid h-full place-items-center bg-bg p-8">
      <div className="w-full max-w-lg text-center">
        <h1 className="font-serif text-3xl tracking-tight text-ink">What do you want to learn?</h1>
        <p className="mt-2 text-sm text-ink-2">
          Name a topic and Ascent will sketch a tree of concepts to explore.
        </p>
        <div className="mt-6 flex gap-2">
          <input
            autoFocus
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && start()}
            placeholder="Transformers · the French Revolution · music theory…"
            className="flex-1 rounded-md border border-rule-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-60"
          />
          <button
            onClick={start}
            disabled={busy || !title.trim()}
            className="rounded-md bg-ink px-4 text-sm font-medium text-surface hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Sketching…" : "Start"}
          </button>
        </div>
        {busy && <p className="mt-3 text-xs text-ink-3">Outlining the concept tree…</p>}
        {error && !busy && (
          <p className="mt-3 text-xs text-red-600">Couldn't outline that topic — {error}</p>
        )}
      </div>
    </div>
  );
}
