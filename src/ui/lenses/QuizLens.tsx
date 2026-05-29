import { useState } from "react";
import { useQuiz, useGenerateQuiz } from "../../core/store/hooks";
import type { LensProps } from "./types";

export function QuizLens({ concept, ctx }: LensProps) {
  const { data: quiz } = useQuiz(concept.id);
  const gen = useGenerateQuiz(concept, ctx.topicTitle, ctx.briefSummary);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);

  const start = () => {
    setIdx(0);
    setPicked(null);
    gen.mutate();
  };

  if (gen.isPending) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-3">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        Writing a quick check…
      </div>
    );
  }

  if (!quiz || quiz.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <p className="text-sm text-ink-2">
          Test yourself on <span className="text-ink">{concept.title}</span>.
        </p>
        <button onClick={start} className="rounded-md bg-ink px-4 py-1.5 text-sm font-medium text-surface hover:bg-accent">
          Quiz me
        </button>
        {gen.isError && <p className="text-xs text-red-600">Couldn't generate — try again.</p>}
      </div>
    );
  }

  const q = quiz[Math.min(idx, quiz.length - 1)];
  const correct = picked === q.answerIndex;

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] text-ink-3">
          {idx + 1} of {quiz.length}
        </span>
        <button onClick={start} className="text-[11.5px] text-ink-3 hover:text-accent">
          ↻ New set
        </button>
      </div>
      <div className="mb-3 text-[15px] font-medium text-ink">{q.question}</div>
      <div className="flex flex-col gap-1.5">
        {q.choices.map((c, i) => {
          const state =
            picked === null
              ? "border-rule"
              : i === q.answerIndex
                ? "border-accent bg-accent/10 text-ink"
                : i === picked
                  ? "border-red-400 text-ink-2"
                  : "border-rule opacity-50";
          return (
            <button
              key={i}
              disabled={picked !== null}
              onClick={() => setPicked(i)}
              className={`flex items-center gap-2 rounded-md border bg-surface px-3 py-2 text-left text-sm text-ink-2 hover:border-rule-strong disabled:cursor-default ${state}`}
            >
              <span className="font-mono text-[11px] text-ink-3">{String.fromCharCode(65 + i)}</span>
              <span>{c}</span>
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <div className="mt-3 rounded-md border border-rule bg-surface-2 p-3 text-sm text-ink-2">
          <span className={correct ? "font-medium text-accent" : "font-medium text-ink"}>
            {correct ? "Right. " : "Not quite. "}
          </span>
          {q.explanation}
          {idx < quiz.length - 1 && (
            <button
              onClick={() => {
                setIdx(idx + 1);
                setPicked(null);
              }}
              className="mt-2 block rounded-md bg-ink px-3 py-1 text-xs font-medium text-surface hover:bg-accent"
            >
              Next →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
