// GenerationService — lesson bodies. Streamed on first visit and persisted.
// generateLesson streams partial lessons (onPartial) for progressive rendering,
// then persists the complete, validated result.
import { streamText, Output } from "ai";
import { z } from "zod";
import { getModel } from "../ai/service";
import { getModelId } from "../settings";
import { lessonRepo, conceptRepo, type ConceptRow } from "../store/repositories";
import type { Block, SuggestedBranch, LensId } from "../types";

const LessonSchema = z.object({
  subtitle: z.string().describe("one-line subtitle framing the lesson"),
  blocks: z
    .array(
      z.object({
        kind: z.enum(["paragraph", "callout", "section", "code", "table", "math", "chart", "diagram"]),
        text: z
          .string()
          .optional()
          .describe("paragraph/callout body, `code` source, LaTeX (no delimiters) for `math`, or Mermaid source for `diagram`"),
        label: z.string().optional().describe("callout label (e.g. 'Notice') or section label"),
        hint: z.string().optional().describe("optional one-line section hint"),
        terms: z
          .array(z.object({ term: z.string(), gloss: z.string() }))
          .optional()
          .describe("for paragraphs only: key terms appearing verbatim in `text`, each with a one-line gloss, that a curious learner could branch into"),
        language: z
          .string()
          .optional()
          .describe("for `code` blocks ONLY: the source language — 'python', 'javascript', 'typescript', 'bash', or 'json'"),
        title: z
          .string()
          .optional()
          .describe("a short, specific label (3-7 words): the title of a `code` snippet, or a caption for a `table` (and later `diagram`/`chart`)"),
        headers: z
          .array(z.string())
          .optional()
          .describe("for `table` blocks ONLY: short column headers"),
        rows: z
          .array(z.array(z.string()))
          .optional()
          .describe("for `table` blocks ONLY: rows, each an array of short cell strings aligned to `headers`"),
        chartType: z
          .enum(["line", "bar", "scatter", "area"])
          .optional()
          .describe("for `chart` blocks ONLY: how to plot the series"),
        series: z
          .array(
            z.object({
              name: z.string().optional().describe("series label (shown in the legend)"),
              points: z
                .array(z.object({ x: z.string(), y: z.number() }))
                .describe('data points; x is a number written as a string (e.g. "0.5") for line/scatter/area, or a short category label for bar; y is a number'),
            }),
          )
          .optional()
          .describe("for `chart` blocks ONLY: one or more data series"),
        xLabel: z.string().optional().describe("for `chart` blocks ONLY: x-axis label"),
        yLabel: z.string().optional().describe("for `chart` blocks ONLY: y-axis label"),
      }),
    )
    .describe(
      "8-14 blocks: short paragraphs (2-4 sentences, one idea each), section headers that chunk the lesson into clear beats, at most one callout",
    ),
  suggestedBranches: z
    .array(z.object({ title: z.string(), reason: z.string() }))
    .describe("2-4 concepts worth exploring next"),
});

export interface LessonContext {
  topicTitle: string;
  path: string[];
  summary?: string | null;
  siblings: string[];
  children: string[];
}

/** A lesson while it's still streaming (fields fill in progressively). */
export interface PartialLesson {
  subtitle?: string;
  blocks?: Block[];
  suggestedBranches?: SuggestedBranch[];
}

export async function generateLesson(
  concept: ConceptRow,
  ctx: LessonContext,
  onPartial?: (partial: PartialLesson) => void,
  signal?: AbortSignal,
) {
  const focus = ctx.summary ? `\nFocus (what this concept should cover): ${ctx.summary}` : "";
  const siblings = ctx.siblings.length
    ? `\nSibling concepts taught separately — do NOT re-explain these: ${ctx.siblings.join(", ")}.`
    : "";
  const children = ctx.children.length
    ? `\nThis concept has sub-concepts taught in their own lessons: ${ctx.children.join(", ")}. Keep THIS lesson an orienting overview that motivates and connects them — don't fully dive into each.`
    : "";

  const result = streamText({
    model: getModel(),
    output: Output.object({ schema: LessonSchema }),
    abortSignal: signal,
    prompt: `You are an exceptional tutor — the kind whose explanations make a hard idea
suddenly click — writing ONE focused lesson within a larger learning tree. Your goal is
understanding, not coverage. Do NOT write like an encyclopedia.

Topic: "${ctx.topicTitle}"
Path: ${ctx.path.join(" > ")}
Concept to teach: "${concept.title}"${focus}${siblings}${children}

HOW TO EXPLAIN (this matters more than how much you cover):
- Start from intuition. Before any formalism, give the learner a way to picture or feel
  what's going on and why it matters — a plain-language framing, an analogy, or a motivating
  question. Earn the formal definition; don't open with it.
- Build up in small steps, one idea per paragraph. Introduce a piece, make it land, then add
  the next. Never stack three new ideas into one dense paragraph.
- Show, don't just state. Include at least one concrete worked example — small real numbers,
  a tiny scenario, a case walked through step by step, or (for programming / ML / scripting
  topics) a tight runnable code snippet — and use everyday analogies where they genuinely
  help. The moment you introduce notation or a formula, say in words what each part means
  and why it's there.
- Keep the rigor. This is NOT "explain like I'm five": stay precise and correct, name things
  properly — just make the path to understanding gentle, and unpack jargon the instant you use it.
- Be warm and direct, like you're talking to one curious person. No filler, no throat-clearing,
  no "in this lesson we will".

FORMAT:
- 8-14 blocks, mostly short "paragraph" blocks of 2-4 sentences (break up anything longer).
- Use "section" headers to chunk the lesson into a few clear beats — e.g. the intuition, the
  mechanism, a worked example, why it matters. Give each a short label and optional one-line hint.
- Across the paragraphs, mark 2-5 key TERMS (each appearing verbatim in that paragraph's text)
  with a one-line gloss — these become forkable branches.
- A "callout" is RARE (at most one): reserve it for a single standout intuition or "watch out",
  with a short label ("Intuition", "Notice", "Watch out") and a real sentence of body. Omit it if
  nothing earns it; never label one "load-bearing". Put examples in normal paragraphs, not callouts.
- A "code" block contains a runnable code snippet. Use it ONLY when seeing real code helps
  understanding (programming, ML, scripting, data work). Keep snippets short and focused
  (5-30 lines), self-contained where possible. Set \`language\` to the source language
  ("python", "javascript", "typescript", "bash", or "json") AND set \`title\` to a short,
  specific label (3-7 words) of what the snippet does (e.g. "Computing attention scores"),
  so a reader understands it while it's collapsed. Python runs locally in a sandboxed
  in-browser runtime (Pyodide), so a Python snippet may import ONLY the standard library or
  these available packages: numpy, pandas, scipy, scikit-learn, sympy, matplotlib. Do NOT
  import torch, tensorflow, keras, or jax — illustrate ML / deep-learning ideas from scratch
  with numpy (or plain Python) so the snippet actually runs. One tight illustrative example
  beats five. For non-technical subjects (history, music, biology essays, etc.), use NO code blocks.
- A "table" block (set \`headers\` + \`rows\`) lays out a comparison or structured facts side by
  side — comparing approaches, options, eras, properties, trade-offs. Keep cells short (a few
  words). Prefer it over prose whenever the content is inherently tabular. Optional \`title\`
  caption; refer to it from the surrounding text.
- Use REAL math, never ASCII. For a standalone equation, use a "math" block with \`text\` set to
  LaTeX (no surrounding dollar signs). For math inside a sentence, wrap it in single dollar signs
  right in the paragraph text — e.g. "the score is $QK^T/\\sqrt{d_k}$". Always prefer rendered
  notation over writing things like "d_k" or "Q times K transpose" in prose.
- A "chart" block visualizes a trend or quantitative comparison: set \`chartType\` (line, bar,
  scatter, or area), \`series\` (each an optional \`name\` and an array of {x, y} points), and
  \`xLabel\` / \`yLabel\`. Data may be ILLUSTRATIVE — the shape of a sigmoid, a learning curve, a
  rough comparison — kept small (a handful of points) and representative, not precise. Use a
  chart only when a shape or comparison genuinely aids understanding; refer to it in the prose.
- A "diagram" block renders a Mermaid diagram (\`text\` = Mermaid source) — use it to SHOW
  structure a picture clarifies: a process or pipeline (flowchart \`graph TD\`), an interaction
  over time (\`sequenceDiagram\`), a state machine (\`stateDiagram-v2\`), relationships
  (\`mindmap\`), or events (\`timeline\`). Keep it focused — a handful of nodes. Use VALID Mermaid
  syntax only. Optional \`title\` caption; refer to it in the prose.
- Every block must have content: paragraph and callout need non-empty text, section needs a label, code needs non-empty text.
- Finish by suggesting 2-4 next concepts. No markdown.`,
  });

  // Capture output now and pre-attach a catch: on abort we throw out of the
  // for-await below without awaiting output, and an un-awaited rejection would
  // surface as an unhandled promise rejection. `await` still sees a rejection on
  // the success path (e.g. a parse error), so real failures still propagate.
  const outputPromise = result.output;
  void outputPromise.then(undefined, () => {});

  for await (const partial of result.partialOutputStream) {
    onPartial?.(partial as unknown as PartialLesson);
  }
  const output = await outputPromise;

  const now = Date.now();
  const blocks = output.blocks as Block[];
  // The Code lens is declared only when there's actually code to surface — keeps
  // the right pane uncluttered for non-technical lessons.
  const hasCode = blocks.some((b) => b.kind === "code");
  const lenses: LensId[] = hasCode
    ? ["notes", "quiz", "chat", "teach", "code"]
    : ["notes", "quiz", "chat", "teach"];
  const row = {
    conceptId: concept.id,
    title: concept.title,
    subtitle: output.subtitle,
    blocks,
    suggestedBranches: output.suggestedBranches as SuggestedBranch[],
    lenses,
    model: getModelId(),
    generatedAt: now,
  };
  await lessonRepo.upsert(row);
  await conceptRepo.update(concept.id, {
    state: "ready",
    status: concept.status === "queued" ? "visited" : concept.status,
  });
  return row;
}
