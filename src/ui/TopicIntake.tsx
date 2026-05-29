import { useEffect, useReducer, useState, type ReactNode } from "react";
import { planWave, type IntakeWave } from "../core/generation/intake";
import type { IntakeAnswer, IntakeQuestion, TopicBrief } from "../core/types";

// New-topic flow: name a subject, answer a short AI interview (in "waves" — a
// batch of independent questions shown one at a time), confirm the AI's
// understanding, then generate. A reducer state machine drives it; the questions
// come from planWave. Skippable at any point — Skip generates with no brief, which
// reproduces the original one-field behavior.

type Status = "naming" | "planning" | "asking" | "confirming" | "generating" | "error";

interface State {
  status: Status;
  title: string;
  history: IntakeAnswer[];
  /** count of waves planned so far (0-based index for the next planWave) */
  waveIndex: number;
  wave: IntakeQuestion[];
  qIndex: number;
  draftSelected?: string;
  draftOther: string;
  summary: string;
  error: string | null;
  /** bumped to trigger a planWave fetch in the effect */
  planNonce: number;
}

type Action =
  | { type: "BEGIN"; title: string }
  | { type: "PLANNED"; result: IntakeWave }
  | { type: "SELECT"; option: string }
  | { type: "OTHER"; text: string }
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "RESTART" }
  | { type: "GENERATE" }
  | { type: "RETRY" }
  | { type: "FAIL"; message: string };

const initialState: State = {
  status: "naming",
  title: "",
  history: [],
  waveIndex: 0,
  wave: [],
  qIndex: 0,
  draftSelected: undefined,
  draftOther: "",
  summary: "",
  error: null,
  planNonce: 0,
};

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "BEGIN":
      return {
        ...initialState,
        status: "planning",
        title: a.title,
        planNonce: s.planNonce + 1,
      };
    case "PLANNED":
      if (a.result.done) {
        return { ...s, status: "confirming", summary: a.result.summary };
      }
      return {
        ...s,
        status: "asking",
        wave: a.result.questions,
        qIndex: 0,
        waveIndex: s.waveIndex + 1,
        draftSelected: undefined,
        draftOther: "",
      };
    case "SELECT":
      return { ...s, draftSelected: s.draftSelected === a.option ? undefined : a.option };
    case "OTHER":
      return { ...s, draftOther: a.text };
    case "NEXT": {
      const q = s.wave[s.qIndex];
      const answer: IntakeAnswer = {
        prompt: q.prompt,
        selected: s.draftSelected,
        other: s.draftOther.trim() || undefined,
      };
      const history = [...s.history, answer];
      if (s.qIndex < s.wave.length - 1) {
        return { ...s, history, qIndex: s.qIndex + 1, draftSelected: undefined, draftOther: "" };
      }
      // wave exhausted — plan the next one
      return { ...s, history, status: "planning", planNonce: s.planNonce + 1 };
    }
    case "BACK": {
      if (s.qIndex === 0) return s;
      const prev = s.history[s.history.length - 1];
      return {
        ...s,
        history: s.history.slice(0, -1),
        qIndex: s.qIndex - 1,
        draftSelected: prev?.selected,
        draftOther: prev?.other ?? "",
      };
    }
    case "RESTART":
      return {
        ...initialState,
        status: "planning",
        title: s.title,
        planNonce: s.planNonce + 1,
      };
    case "GENERATE":
      return { ...s, status: "generating", error: null };
    case "RETRY":
      return { ...s, status: "planning", error: null, planNonce: s.planNonce + 1 };
    case "FAIL":
      return { ...s, status: "error", error: a.message };
    default:
      return s;
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function TopicIntake({
  onGenerate,
  onCancel,
  busy,
  error,
}: {
  onGenerate: (title: string, brief?: TopicBrief) => void;
  onCancel: () => void;
  /** outer startTopic mutation is pending (during "generating") */
  busy: boolean;
  /** outer startTopic error */
  error?: string | null;
}) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Plan a wave whenever we enter "planning" (each request bumps planNonce).
  useEffect(() => {
    if (state.status !== "planning") return;
    let cancelled = false;
    planWave(state.title, state.history, state.waveIndex)
      .then((result) => !cancelled && dispatch({ type: "PLANNED", result }))
      .catch((e) => !cancelled && dispatch({ type: "FAIL", message: errMsg(e) }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.planNonce]);

  const generate = (brief?: TopicBrief) => {
    dispatch({ type: "GENERATE" });
    onGenerate(state.title, brief);
  };

  if (state.status === "naming") {
    return <Naming onContinue={(t) => dispatch({ type: "BEGIN", title: t })} onSkip={(t) => onGenerate(t, undefined)} />;
  }

  if (state.status === "planning") {
    return <Centered><Spinner label="Thinking about what to ask…" /><CancelLink onCancel={onCancel} /></Centered>;
  }

  if (state.status === "asking") {
    const q = state.wave[state.qIndex];
    const canNext = !!state.draftSelected || state.draftOther.trim().length > 0;
    return (
      <Centered>
        <div className="w-full max-w-lg text-left">
          <p className="text-xs uppercase tracking-wide text-ink-3">
            Refining “{state.title}” · question {state.qIndex + 1} of {state.wave.length}
          </p>
          <h2 className="mt-2 font-serif text-2xl tracking-tight text-ink">{q.prompt}</h2>
          <div className="mt-5 flex flex-col gap-2">
            {q.options.map((opt) => {
              const active = state.draftSelected === opt;
              return (
                <button
                  key={opt}
                  onClick={() => dispatch({ type: "SELECT", option: opt })}
                  className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    active
                      ? "border-accent bg-accent/10 text-ink"
                      : "border-rule-strong bg-surface text-ink-2 hover:border-accent/60 hover:text-ink"
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          <input
            value={state.draftOther}
            onChange={(e) => dispatch({ type: "OTHER", text: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && canNext && dispatch({ type: "NEXT" })}
            placeholder="Other (optional) — add your own…"
            className="mt-3 w-full rounded-md border border-rule bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <div className="mt-6 flex items-center justify-between">
            <button
              onClick={() => dispatch({ type: "BACK" })}
              disabled={state.qIndex === 0}
              className="text-sm text-ink-3 hover:text-ink disabled:opacity-30"
            >
              ← Back
            </button>
            <div className="flex items-center gap-4">
              <button onClick={onCancel} className="text-sm text-ink-3 hover:text-ink">
                Cancel
              </button>
              <button
                onClick={() => dispatch({ type: "NEXT" })}
                disabled={!canNext}
                className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-surface hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </Centered>
    );
  }

  if (state.status === "confirming") {
    return (
      <Centered>
        <div className="w-full max-w-lg text-left">
          <p className="text-xs uppercase tracking-wide text-ink-3">Here's what I'll build</p>
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink">{state.summary}</p>
          <div className="mt-6 flex items-center justify-between">
            <button
              onClick={() => dispatch({ type: "RESTART" })}
              className="text-sm text-ink-3 hover:text-ink"
            >
              ↻ Restart
            </button>
            <div className="flex items-center gap-4">
              <button onClick={onCancel} className="text-sm text-ink-3 hover:text-ink">
                Cancel
              </button>
              <button
                onClick={() => generate({ summary: state.summary, answers: state.history })}
                className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-surface hover:bg-accent"
              >
                Generate tree
              </button>
            </div>
          </div>
        </div>
      </Centered>
    );
  }

  if (state.status === "generating") {
    return (
      <Centered>
        {busy || !error ? (
          <Spinner label="Outlining the concept tree…" />
        ) : (
          <div className="w-full max-w-lg text-center">
            <p className="text-sm text-red-600">Couldn't generate — {error}</p>
            <div className="mt-4 flex justify-center gap-4">
              <button onClick={onCancel} className="text-sm text-ink-3 hover:text-ink">
                Cancel
              </button>
              <button
                onClick={() => generate({ summary: state.summary, answers: state.history })}
                className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-surface hover:bg-accent"
              >
                Try again
              </button>
            </div>
          </div>
        )}
      </Centered>
    );
  }

  // status === "error" (a planWave failure)
  return (
    <Centered>
      <div className="w-full max-w-lg text-center">
        <p className="text-sm text-red-600">Couldn't prepare questions — {state.error}</p>
        <div className="mt-4 flex justify-center gap-4">
          <button onClick={onCancel} className="text-sm text-ink-3 hover:text-ink">
            Cancel
          </button>
          <button
            onClick={() => onGenerate(state.title, undefined)}
            className="text-sm text-ink-2 hover:text-ink"
          >
            Skip &amp; generate
          </button>
          <button
            onClick={() => dispatch({ type: "RETRY" })}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-surface hover:bg-accent"
          >
            Retry
          </button>
        </div>
      </div>
    </Centered>
  );
}

/** Step 0 — name the topic. Mirrors the original Trailhead, plus a Skip path. */
function Naming({
  onContinue,
  onSkip,
}: {
  onContinue: (title: string) => void;
  onSkip: (title: string) => void;
}) {
  const [title, setTitle] = useState("");
  const go = () => title.trim() && onContinue(title.trim());
  return (
    <Centered>
      <div className="w-full max-w-lg text-center">
        <h1 className="font-serif text-3xl tracking-tight text-ink">What do you want to learn?</h1>
        <p className="mt-2 text-sm text-ink-2">
          Name a topic. Ascent asks a few quick questions, then sketches a tree of concepts to explore.
        </p>
        <div className="mt-6 flex gap-2">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
            placeholder="Transformers · the French Revolution · music theory…"
            className="flex-1 rounded-md border border-rule-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <button
            onClick={go}
            disabled={!title.trim()}
            className="rounded-md bg-ink px-4 text-sm font-medium text-surface hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continue
          </button>
        </div>
        <button
          onClick={() => title.trim() && onSkip(title.trim())}
          disabled={!title.trim()}
          className="mt-3 text-xs text-ink-3 hover:text-ink disabled:opacity-30"
        >
          Skip questions &amp; generate now →
        </button>
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="grid h-full place-items-center bg-bg p-8">{children}</div>;
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="text-center">
      <div className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-rule-strong border-t-accent" />
      <p className="mt-3 text-xs text-ink-3">{label}</p>
    </div>
  );
}

function CancelLink({ onCancel }: { onCancel: () => void }) {
  return (
    <button onClick={onCancel} className="mt-4 text-xs text-ink-3 hover:text-ink">
      Cancel
    </button>
  );
}
