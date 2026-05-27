import { useState } from "react";
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

export function ChatThread({ concept, ctx }: { concept: ConceptRow; ctx: ChatContext }) {
  const { turns, streaming, sending, send } = useChat(concept, ctx);
  const [val, setVal] = useState("");
  const [mode, setMode] = useState<TutorMode>(() => getTutorMode());

  const submit = (text: string) => {
    if (!text.trim() || sending) return;
    setVal("");
    send(text);
  };
  const changeMode = (m: TutorMode) => {
    setMode(m);
    setTutorMode(m);
  };

  return (
    <div className="mt-9 font-sans">
      <div className="mb-3 flex items-baseline justify-between border-b border-rule pb-2">
        <span className="text-[11.5px] font-semibold uppercase tracking-wide text-ink">Conversation</span>
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

      {(turns.length > 0 || streaming !== null) && (
        <div className="flex flex-col gap-3">
          {turns.map((t) => (
            <Bubble key={t.id} role={t.role} text={t.text} />
          ))}
          {streaming !== null && <Bubble role="ai" text={streaming || "…"} />}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
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

      <div className="mt-2 flex items-end gap-2 rounded-lg border border-rule-strong bg-surface p-2">
        <textarea
          rows={1}
          value={val}
          placeholder="Ask anything about this concept…"
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(val);
            }
          }}
          className="max-h-32 flex-1 resize-none bg-transparent px-1 py-1 text-sm text-ink outline-none"
        />
        <button
          disabled={sending || !val.trim()}
          onClick={() => submit(val)}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-ink text-surface hover:bg-accent disabled:opacity-40"
        >
          {sending ? "…" : "↑"}
        </button>
      </div>
    </div>
  );
}
