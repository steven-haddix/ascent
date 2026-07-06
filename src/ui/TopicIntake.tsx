import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { sourceRepo, type LibraryEntry } from "../core/store/repositories";
import { removeSource, retryDocument, setSourceRole } from "../core/knowledge/ingest";
import type { SourceRole } from "../core/knowledge/types";
import {
  answerBack,
  answerNext,
  attachIntakeFiles,
  beginInterview,
  cancelIntake,
  generateTree,
  getIntakeSnapshot,
  resetIntake,
  restartInterview,
  retryGeneration,
  rewindToQuestion,
  selectOption,
  setIntakeTitle,
  setOther,
  skipToGenerate,
  useIntakeSession,
} from "../core/generation/intakeSession";

// New-topic flow (topic-creation design): compose (name + attach materials) →
// doc-aware interview (one question at a time) → brief review → streamed tree
// creation → done. A module store (intakeSession) drives it and is shared with the
// right-pane Brief; this file is the center-pane view. The draft topic and its
// library are the single source of truth for attached documents.

const ROLE_LABEL: Record<SourceRole, string> = {
  syllabus: "syllabus",
  "ground-truth": "ground truth",
  reference: "reference",
};
const ROLE_CYCLE: SourceRole[] = ["reference", "ground-truth", "syllabus"];
const PROCESSING = new Set(["queued", "fetching", "extracting", "chunking", "indexing"]);

export function TopicIntake({
  onOpenTopic,
  onCancel,
}: {
  onOpenTopic: (topicId: string, rootConceptId: string) => void;
  onCancel: () => void;
}) {
  const s = useIntakeSession();

  // Re-entering "New topic" after a finished creation starts clean.
  useEffect(() => {
    if (getIntakeSnapshot().phase === "done") resetIntake();
  }, []);

  const docs = useQuery({
    queryKey: ["library", s.draftTopicId],
    queryFn: () => sourceRepo.listByTopic(s.draftTopicId as string),
    enabled: !!s.draftTopicId,
  });
  const docRows = docs.data ?? [];
  const hasDocs = docRows.length > 0;

  const cancel = () => {
    void cancelIntake();
    onCancel();
  };

  if (s.phase === "compose") {
    return <Compose docs={docRows} onCancel={cancel} />;
  }
  if (s.phase === "planning") {
    return (
      <Centered>
        <Spinner label={s.waveIndex === 0 ? (hasDocs ? "Reading your sources & planning questions…" : "Thinking about what to ask…") : "Reading your answers…"} />
        <CancelLink onCancel={cancel} />
      </Centered>
    );
  }
  if (s.phase === "asking") {
    return <Interview onCancel={cancel} />;
  }
  if (s.phase === "brief") {
    return <Review docs={docRows} hasDocs={hasDocs} onCancel={cancel} />;
  }
  if (s.phase === "creating" || (s.phase === "done" && !s.result)) {
    return <Creating onCancel={cancel} />;
  }
  if (s.phase === "done" && s.result) {
    return <Done onOpenTopic={onOpenTopic} onCancel={cancel} />;
  }
  // phase === "error": creation error carries a log; a planning error does not.
  const inCreation = s.log.length > 0;
  return (
    <Centered>
      <div className="w-full max-w-lg text-center">
        <p className="text-sm text-red-600">
          {inCreation ? "Couldn't finish the tree" : "Couldn't prepare questions"} — {s.error}
        </p>
        <div className="mt-4 flex justify-center gap-4">
          <button onClick={cancel} className="text-sm text-ink-3 hover:text-ink">Cancel</button>
          {!inCreation && (
            <button onClick={() => skipToGenerate()} className="text-sm text-ink-2 hover:text-ink">
              Skip &amp; generate
            </button>
          )}
          <button
            onClick={() => (inCreation ? retryGeneration() : beginInterview())}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-surface hover:bg-accent"
          >
            {inCreation ? "Retry" : "Try again"}
          </button>
        </div>
      </div>
    </Centered>
  );
}

// ---------- compose ----------

function Compose({ docs, onCancel }: { docs: LibraryEntry[]; onCancel: () => void }) {
  const s = useIntakeSession();
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFiles = (files: FileList | null) => {
    if (files?.length) void attachIntakeFiles(Array.from(files));
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <Centered>
      <div className="w-full max-w-xl">
        <div className="text-center">
          <h1 className="font-serif text-3xl tracking-tight text-ink">What do you want to learn?</h1>
          <p className="mt-2 text-sm text-ink-2">
            Name a topic — or drop in course material. Ascent asks a few quick questions, then grows a tree of
            concepts grounded in what you give it.
          </p>
        </div>

        <div className="mt-6 flex gap-2">
          <input
            autoFocus
            value={s.title}
            onChange={(e) => setIntakeTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && s.title.trim() && beginInterview()}
            placeholder="Transformers · the French Revolution · music theory…"
            className="flex-1 rounded-md border border-rule-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <button
            onClick={() => s.title.trim() && beginInterview()}
            disabled={!s.title.trim()}
            className="rounded-md bg-ink px-4 text-sm font-medium text-surface hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continue
          </button>
        </div>

        {docs.length === 0 ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              onFiles(e.dataTransfer.files);
            }}
            className={`mt-3 rounded-lg border border-dashed px-4 py-6 text-center transition-colors ${
              dragOver ? "border-accent bg-accent/5" : "border-rule-strong"
            }`}
          >
            <p className="text-sm text-ink-2">Drop PDFs, notes, or a syllabus here</p>
            <p className="mt-1 text-[12px] text-ink-3">
              Lessons cite your material instead of starting from scratch —{" "}
              <button onClick={() => fileRef.current?.click()} className="text-accent hover:underline">
                browse files
              </button>
            </p>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-1.5">
            {docs.map((e) => (
              <DocCard key={e.source.id} entry={e} />
            ))}
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-dashed border-rule-strong px-4 py-2.5 text-center text-[12.5px] text-ink-3 hover:border-accent hover:text-ink"
            >
              + Add more material — or drop it here
            </button>
          </div>
        )}

        <div className="mt-4 text-center">
          <button
            onClick={() => s.title.trim() && skipToGenerate()}
            disabled={!s.title.trim()}
            className="text-[12px] text-ink-3 hover:text-ink disabled:opacity-30"
          >
            Skip questions &amp; generate now →
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain"
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />

        <div className="mt-6 text-center">
          <button onClick={onCancel} className="text-xs text-ink-3 hover:text-ink">
            Cancel
          </button>
        </div>
      </div>
    </Centered>
  );
}

function DocCard({ entry }: { entry: LibraryEntry }) {
  const { source, document } = entry;
  const processing = PROCESSING.has(document.status);
  const nextRole = ROLE_CYCLE[(ROLE_CYCLE.indexOf(source.role) + 1) % ROLE_CYCLE.length];
  return (
    <div className="flex items-center gap-3 rounded-md border border-rule bg-surface px-3 py-2">
      <span className="font-mono text-[9px] uppercase text-accent">{document.kind === "pdf" ? "PDF" : "DOC"}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-ink">{document.title}</div>
        <div className="mt-0.5 text-[11px] text-ink-4">
          {processing ? (
            <span className="text-ink-3">Indexing…</span>
          ) : document.status === "failed" ? (
            <span className="text-danger">
              Couldn't read this file{" "}
              <button onClick={() => void retryDocument(document.id)} className="text-accent hover:underline">
                retry
              </button>
            </span>
          ) : (
            <span>✓ Indexed · ready to cite</span>
          )}
        </div>
      </div>
      <button
        title="Click to change how this document is used"
        onClick={() => void setSourceRole(source.id, nextRole)}
        className="shrink-0 rounded-full border border-rule px-2 py-0.5 font-mono text-[10px] text-ink-3 hover:border-accent hover:text-ink"
      >
        {ROLE_LABEL[source.role]}
      </button>
      <button onClick={() => void removeSource(source.id)} className="shrink-0 text-ink-4 hover:text-danger">
        ✕
      </button>
    </div>
  );
}

// ---------- interview ----------

function Interview({ onCancel }: { onCancel: () => void }) {
  const s = useIntakeSession();
  const q = s.wave[s.qIndex];
  if (!q) return null;
  const canNext = !!s.draftSelected || s.draftOther.trim().length > 0;
  // Answered questions from THIS wave, editable via rewind.
  const waveStart = Math.max(0, s.history.length - s.qIndex);
  const answered = s.history.slice(waveStart);

  return (
    <Centered>
      <div className="w-full max-w-xl text-left">
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-wide text-ink-3">Refining “{s.title}”</p>
          <p className="text-[11px] text-ink-4">
            {s.qIndex + 1} of {s.wave.length}
          </p>
        </div>

        {answered.length > 0 && (
          <div className="mt-3 flex flex-col gap-1">
            {answered.map((a, i) => (
              <button
                key={i}
                onClick={() => rewindToQuestion(i)}
                className="flex items-center justify-between gap-3 text-left text-[12px] text-ink-3 hover:text-ink"
              >
                <span className="flex items-center gap-1.5">
                  <span className="text-accent">✓</span> {a.prompt}
                </span>
                <span className="truncate text-ink-4">{a.selected ?? a.other}</span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 rounded-xl border border-rule bg-surface p-6">
          <h2 className="font-serif text-2xl tracking-tight text-ink">{q.prompt}</h2>
          {q.source && (
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/5 px-2 py-0.5 font-mono text-[10px] text-accent">
              from {q.source}
            </span>
          )}
          <div className="mt-4 flex flex-col gap-2">
            {q.options.map((opt, i) => {
              const active = s.draftSelected === opt;
              return (
                <button
                  key={opt}
                  onClick={() => selectOption(opt)}
                  className={`flex items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition-colors ${
                    active
                      ? "border-accent bg-accent/10 text-ink"
                      : "border-rule bg-bg text-ink-2 hover:border-accent/60 hover:text-ink"
                  }`}
                >
                  <span className="rounded border border-rule px-1.5 font-mono text-[10px] text-ink-4">{i + 1}</span>
                  {opt}
                </button>
              );
            })}
          </div>
          <input
            value={s.draftOther}
            onChange={(e) => setOther(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canNext && answerNext()}
            placeholder="Other (optional) — add your own…"
            className="mt-3 w-full rounded-md border border-rule bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <div className="mt-5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={answerBack}
                disabled={s.qIndex === 0}
                className="text-sm text-ink-3 hover:text-ink disabled:opacity-30"
              >
                ← Back
              </button>
              <button onClick={() => skipToGenerate()} className="text-sm text-ink-3 hover:text-ink">
                Skip
              </button>
            </div>
            <div className="flex items-center gap-4">
              <button onClick={onCancel} className="text-sm text-ink-3 hover:text-ink">
                Cancel
              </button>
              <button
                onClick={answerNext}
                disabled={!canNext}
                className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-surface hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
        <p className="mt-3 text-center text-[11px] text-ink-4">Press 1–{Math.min(9, q.options.length)} to choose · ↵ to continue</p>
      </div>
    </Centered>
  );
}

// ---------- review (brief) ----------

function Review({ docs, hasDocs, onCancel }: { docs: LibraryEntry[]; hasDocs: boolean; onCancel: () => void }) {
  const s = useIntakeSession();
  return (
    <Centered>
      <div className="w-full max-w-xl text-left">
        <p className="text-[11px] uppercase tracking-wide text-ink-3">Here's what I'll build</p>
        <h1 className="mt-1 font-serif text-3xl tracking-tight text-ink">{s.title}</h1>

        {s.facets.length > 0 && (
          <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-rule bg-rule">
            {s.facets.map((f, i) => (
              <div key={i} className="bg-surface px-4 py-3">
                <div className="text-[10px] font-medium uppercase tracking-wider text-ink-4">{f.label}</div>
                <div className="mt-1 text-[13px] text-ink">{f.value}</div>
              </div>
            ))}
          </div>
        )}

        {hasDocs && (
          <div className="mt-3 rounded-lg border border-rule bg-surface px-4 py-3">
            <div className="text-[10px] font-medium uppercase tracking-wider text-ink-4">Grounded in</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {docs.map((e) => (
                <span
                  key={e.source.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-rule px-2.5 py-0.5 text-[11px] text-ink-2"
                >
                  <span className="font-mono text-[9px] text-accent">{e.document.kind === "pdf" ? "PDF" : "DOC"}</span>
                  {e.document.title}
                  <span className="text-ink-4">· {ROLE_LABEL[e.source.role]}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {s.summary && (
          <p className="mt-4 whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">{s.summary}</p>
        )}

        <div className="mt-6 flex items-center justify-between">
          <button onClick={restartInterview} className="text-sm text-ink-3 hover:text-ink">
            ↻ Restart interview
          </button>
          <div className="flex items-center gap-4">
            <button onClick={onCancel} className="text-sm text-ink-3 hover:text-ink">
              Cancel
            </button>
            <button
              onClick={() => generateTree()}
              className="rounded-md bg-ink px-5 py-2 text-sm font-medium text-surface hover:bg-accent"
            >
              Generate tree
            </button>
          </div>
        </div>
      </div>
    </Centered>
  );
}

// ---------- creating ----------

function Creating({ onCancel }: { onCancel: () => void }) {
  const s = useIntakeSession();
  return (
    <Centered>
      <div className="w-full max-w-xl text-left">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-rule-strong border-t-accent" />
          <h1 className="font-serif text-2xl tracking-tight text-ink">Building your tree…</h1>
        </div>

        <div className="mt-4 flex flex-col gap-1.5">
          {s.log.map((row) => (
            <div key={row.id} className="flex items-center gap-2 text-[12.5px]">
              <span className={row.state === "done" ? "text-accent" : row.state === "failed" ? "text-danger" : "text-ink-4"}>
                {row.state === "done" ? "✓" : row.state === "failed" ? "✕" : "…"}
              </span>
              <span className={row.state === "failed" ? "text-danger" : "text-ink-2"}>{row.text}</span>
            </div>
          ))}
        </div>

        {s.revealed.length > 0 && (
          <div className="mt-5 rounded-lg border border-rule bg-surface p-4">
            {s.revealed.map((c, i) => (
              <div
                key={i}
                className={`py-0.5 text-[13px] ${c.depth === 0 ? "font-medium text-ink" : "text-ink-2"}`}
                style={{ paddingLeft: c.depth * 18 }}
              >
                {c.depth > 0 && <span className="mr-1.5 text-ink-4">└</span>}
                {c.title}
              </div>
            ))}
          </div>
        )}

        <div className="mt-6">
          <button onClick={onCancel} className="text-xs text-ink-3 hover:text-ink">
            Cancel
          </button>
        </div>
      </div>
    </Centered>
  );
}

// ---------- done ----------

function Done({
  onOpenTopic,
  onCancel,
}: {
  onOpenTopic: (topicId: string, rootConceptId: string) => void;
  onCancel: () => void;
}) {
  const s = useIntakeSession();
  const result = s.result!;
  const cited = new Set(result.citedTitles);
  const levels = s.revealed.reduce((m, r) => Math.max(m, r.depth + 1), 1);

  return (
    <Centered>
      <div className="w-full max-w-xl text-left">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-accent/15 text-accent">✓</span>
          <h1 className="font-serif text-2xl tracking-tight text-ink">Tree ready</h1>
        </div>
        <p className="mt-1 text-[12.5px] text-ink-3">
          {s.revealed.filter((r) => r.depth > 0).length} concepts · {levels} levels
          {cited.size > 0 ? ` · ${cited.size} lessons cite your sources` : ""}
        </p>

        <div className="mt-4 rounded-lg border border-rule bg-surface p-4">
          {s.revealed.map((c, i) => (
            <div key={i} className="flex items-center justify-between py-0.5" style={{ paddingLeft: c.depth * 18 }}>
              <span className={`text-[13px] ${c.depth === 0 ? "font-medium text-ink" : "text-ink-2"}`}>
                {c.depth > 0 && <span className="mr-1.5 text-ink-4">└</span>}
                {c.title}
              </span>
              {c.depth > 0 && cited.has(c.title) && (
                <span className="font-mono text-[10px] text-accent">cited</span>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button onClick={onCancel} className="text-sm text-ink-3 hover:text-ink">
            + Create another topic
          </button>
          <button
            onClick={() => onOpenTopic(result.topicId, result.rootConceptId)}
            className="rounded-md bg-ink px-5 py-2 text-sm font-medium text-surface hover:bg-accent"
          >
            Start learning →
          </button>
        </div>
      </div>
    </Centered>
  );
}

// ---------- shared ----------

function Centered({ children }: { children: ReactNode }) {
  return <div className="grid h-full place-items-center overflow-y-auto bg-bg p-8">{children}</div>;
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
