import { useState } from "react";
import { useTeachAttempts, useTeachBack } from "../../core/store/hooks";
import type { LensProps } from "./types";
import type { TeachAudience, TeachAnnotation } from "../../core/types";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const AUDIENCES: { id: TeachAudience; label: string }[] = [
  { id: "child", label: "12-year-old" },
  { id: "peer", label: "Peer" },
  { id: "expert", label: "Expert" },
];

const ANN_STYLE: Record<TeachAnnotation["kind"], string> = {
  strong: "rounded-[2px] bg-accent/15 text-ink",
  vague: "rounded-[2px] bg-amber-400/20 text-ink-2 underline decoration-dotted decoration-amber-600",
  gap: "rounded-[2px] bg-red-400/20 text-ink-2 underline decoration-dotted decoration-red-500",
};

/** Re-highlight the learner's own words in place: split on the graded spans
 *  (matched verbatim) and tint each strong / vague / gap. Unmatched text is plain. */
function Annotated({ text, annotations }: { text: string; annotations: TeachAnnotation[] }) {
  const found = annotations.filter((a) => a.text && text.includes(a.text));
  if (!found.length) return <>{text}</>;
  const sorted = [...found].sort((a, b) => b.text.length - a.text.length);
  const re = new RegExp(`(${sorted.map((a) => escapeRegex(a.text)).join("|")})`, "g");
  return (
    <>
      {text.split(re).map((part, i) => {
        const ann = found.find((a) => a.text === part);
        return ann ? (
          <span key={i} title={`${ann.kind}: ${ann.note}`} className={ANN_STYLE[ann.kind]}>
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-[11px]">
        <span className="text-ink-3">{label}</span>
        <span className="font-mono text-ink-2">{pct}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** The Feynman teach-back lens: compose → grade → annotated result with rubric,
 *  verdict, re-highlighted words, and auto-forked remedial branches. */
export function TeachLens({ concept, ctx }: LensProps) {
  const attempts = useTeachAttempts(concept.id).data ?? [];
  const latest = attempts.length ? attempts[attempts.length - 1] : null;
  const teach = useTeachBack(concept, { ...ctx, summary: concept.summary });

  const [composing, setComposing] = useState(false);
  const [audience, setAudience] = useState<TeachAudience>("child");
  const [text, setText] = useState("");

  const fresh = teach.data;
  const shown = fresh ?? latest;
  const shownText = fresh ? text : (latest?.text ?? "");
  const showResult = !!shown && !composing && !teach.isPending;

  const submit = () => {
    const t = text.trim();
    if (!t || teach.isPending) return;
    setComposing(false);
    teach.mutate({ text: t, audience });
  };
  const again = () => {
    teach.reset();
    setText("");
    setComposing(true);
  };

  if (teach.isPending) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-3">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        Grading your explanation…
      </div>
    );
  }

  if (showResult && shown) {
    const masteryPct = Math.round(concept.mastery * 100);
    const delta = Math.round(shown.masteryDelta * 100);
    return (
      <div className="flex h-full flex-col overflow-y-auto p-4">
        <div className="mb-4 flex items-baseline justify-between border-b border-rule pb-3">
          <div>
            <div className="text-[10.5px] font-medium uppercase tracking-wider text-ink-3">Mastery</div>
            <div className="font-serif text-3xl leading-none text-ink">
              {masteryPct}
              <span className="text-lg text-ink-3">%</span>
            </div>
          </div>
          <span
            className={`font-mono text-[12px] ${delta > 0 ? "text-accent" : delta < 0 ? "text-red-600" : "text-ink-3"}`}
          >
            {delta > 0 ? "+" : ""}
            {delta} this attempt
          </span>
        </div>

        <div className="mb-4 flex flex-col gap-2.5">
          <Bar label="Clarity" value={shown.rubric.clarity} />
          <Bar label="Accuracy" value={shown.rubric.accuracy} />
          <Bar label="Completeness" value={shown.rubric.completeness} />
          <Bar label="Mental model" value={shown.rubric.model} />
        </div>

        <p className="mb-4 text-[13.5px] leading-relaxed text-ink-2">{shown.verdict}</p>

        <div className="mb-2 flex items-center gap-3 text-[10px] uppercase tracking-wider text-ink-3">
          <span className="font-medium">Your words</span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-[2px] bg-accent/40" />
            strong
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-[2px] bg-amber-400/50" />
            vague
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-[2px] bg-red-400/50" />
            gap
          </span>
        </div>
        <div className="mb-4 rounded-md border border-rule bg-surface p-3 font-serif text-[14px] leading-[1.7] text-ink">
          <Annotated text={shownText} annotations={shown.annotations} />
        </div>

        {shown.gaps.length > 0 ? (
          <div className="mb-3">
            <div className="mb-2 text-[10.5px] font-medium uppercase tracking-wider text-ink-3">
              Forked {shown.gaps.length} remedial {shown.gaps.length === 1 ? "branch" : "branches"}
            </div>
            <div className="flex flex-col gap-1.5">
              {shown.gaps.map((g, i) => (
                <div key={i} className="rounded-md border border-rule border-l-2 border-l-accent bg-surface px-3 py-2">
                  <div className="text-[12.5px] font-medium text-ink">{g.title}</div>
                  <div className="mt-0.5 text-[11.5px] text-ink-3">{g.reason}</div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-ink-3">
              These now live under this concept in your tree — visit them to fill the gaps.
            </p>
          </div>
        ) : (
          <div className="mb-3 text-[12.5px] text-ink-2">No gaps flagged — solid explanation.</div>
        )}

        <button
          onClick={again}
          className="mt-auto rounded-md border border-rule bg-surface px-3 py-2 text-[12.5px] font-medium text-ink-2 hover:border-accent hover:text-ink"
        >
          ↻ Teach it again
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-4">
      <p className="mb-2 text-[13px] leading-relaxed text-ink-2">
        Explain <span className="font-medium text-ink">{concept.title}</span> in your own words. The clearer and more
        complete, the higher your mastery.
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-ink-3">Explain to:</span>
        {AUDIENCES.map((a) => (
          <button
            key={a.id}
            onClick={() => setAudience(a.id)}
            className={`rounded-full border px-2.5 py-0.5 text-[11.5px] ${
              audience === a.id ? "border-accent bg-accent/10 text-ink" : "border-rule text-ink-3 hover:text-ink"
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
        }}
        placeholder="In your own words…  (⌘↵ to grade)"
        className="min-h-0 flex-1 resize-none rounded-md border border-rule bg-surface p-3 font-serif text-[14px] leading-relaxed text-ink outline-none placeholder:text-ink-4 focus:border-accent"
      />
      {teach.isError && <p className="mt-2 text-[12px] text-red-600">Couldn't grade that — try again.</p>}
      <div className="mt-2 flex items-center justify-between">
        {latest ? (
          <button onClick={() => setComposing(false)} className="text-[11.5px] text-ink-3 hover:text-accent">
            ← last result
          </button>
        ) : (
          <span />
        )}
        <button
          onClick={submit}
          disabled={!text.trim()}
          className="rounded-md bg-ink px-4 py-1.5 text-[12.5px] font-medium text-surface hover:bg-accent disabled:opacity-40"
        >
          Grade my explanation
        </button>
      </div>
    </div>
  );
}
