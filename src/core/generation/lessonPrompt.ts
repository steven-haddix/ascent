// Composable prompt builder for lesson bodies. Moved verbatim from lesson.ts so
// later waves can extend it through two empty-by-default seams without rewriting
// the lesson generator. With no `parts`, the output is byte-identical to today.
import type { ExistingConcept } from "../types";
import { assembleVisualGuidance } from "../visuals/authoring";
import { inferDomain, kindsForDomains, type Domain } from "../visuals/catalog";
import { renderVisualBriefForPrompt, visualToolkitPrompt, type VisualBrief } from "./visualPlan";

export interface LessonContext {
  topicTitle: string;
  path: string[];
  summary?: string | null;
  siblings: string[];
  children: string[];
  /** every other concept in this topic — lets the model link rather than re-fork */
  existingConcepts: ExistingConcept[];
  /** the topic's intake brief summary — tailors depth/emphasis (absent = skipped intake) */
  briefSummary?: string | null;
  /** the concept the learner navigated FROM. Continuity treats this as navigation
   *  history and only bridges when it is also organizationally upstream. */
  referrer?: string | null;
}

export interface LessonPromptParts {
  /** Wave 1 (Continuity B4): a continuity section inserted right after the existing-concepts
   *  block. Empty by default → output unchanged. */
  continuity?: string;
  /** Wave 2 (Visual §3a / per-kind guidance): extra guidance appended at the end of the FORMAT
   *  section (before FINISH). Empty by default → output unchanged. */
  formatAddendum?: string;
  /** Web search (web-search spec §5): a bounded, guarded "live web findings" block inserted after
   *  continuity so the lesson can draw on current information. Empty by default → output unchanged. */
  grounding?: string;
  /** LLM-authored visual teaching brief: learning moments to preserve, with tool suggestions
   *  that are intentionally not a whitelist. */
  visualBrief?: VisualBrief | null;
}

export function buildLessonPrompt(
  concept: { title: string; domains?: Domain[] },
  ctx: LessonContext,
  parts: LessonPromptParts = {},
): string {
  const focus = ctx.summary ? `\nFocus (what this concept should cover): ${ctx.summary}` : "";
  const siblings = ctx.siblings.length
    ? `\nSibling concepts taught separately — do NOT re-explain these: ${ctx.siblings.join(", ")}.`
    : "";
  const children = ctx.children.length
    ? `\nThis concept has sub-concepts taught in their own lessons: ${ctx.children.join(", ")}. Keep THIS lesson an orienting overview that motivates and connects them — don't fully dive into each.`
    : "";
  const brief = ctx.briefSummary
    ? `\nLearner brief (tailor depth, emphasis, and examples to this): ${ctx.briefSummary}`
    : "";
  const existing = ctx.existingConcepts.length
    ? `\n\nConcepts ALREADY in the learner's tree for this topic (do NOT recreate these — link to them by handle instead):\n${ctx.existingConcepts
        .map((c) => `[${c.handle}] ${c.title}${c.summary ? ` — ${c.summary}` : ""}`)
        .join("\n")}`
    : "";

  // Domain-aware visual hints (§3a): useful suggestions from the catalog, not routing.
  // The visual director and lesson author can use any supported visual tool.
  const domains = concept.domains?.length
    ? concept.domains
    : [inferDomain(`${ctx.topicTitle} ${concept.title}`)];
  const hintKinds = kindsForDomains(domains)
    .map((d) => d.label)
    .join(", ");
  const hintLine = hintKinds
    ? `VISUAL HINTS — this currently reads as a ${domains.join(" / ")} lesson. The catalog suggests these tools may fit: ${hintKinds}. Treat this as inspiration, not a whitelist; use any supported visual tool when it teaches the current lesson better.`
    : "";
  const visualBrief = renderVisualBriefForPrompt(parts.visualBrief ?? null);

  return `You are an exceptional tutor — the kind whose explanations make a hard idea
suddenly click — writing ONE focused lesson within a larger learning tree. Your goal is
understanding, not coverage. Do NOT write like an encyclopedia.

Topic: "${ctx.topicTitle}"
Path: ${ctx.path.join(" > ")}
Concept to teach: "${concept.title}"${focus}${siblings}${children}${brief}${existing}${parts.continuity ? `\n${parts.continuity}\n` : ""}${parts.grounding ? `\n${parts.grounding}\n` : ""}

HOW TO EXPLAIN (this matters more than how much you cover):
- Start from intuition. Before any formalism, give the learner a way to picture or feel
  what's going on and why it matters — a plain-language framing, an analogy, or a motivating
  question. Earn the formal definition; don't open with it.
- Ascent is hyper-visual. For every major mechanism, structure, comparison, process, state
  change, or transformation, first ask what the learner should see, trace, compare, or manipulate.
  Let equations, code, and prose support that visual model instead of replacing it.
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
- Do not use Markdown emphasis markers such as **bold** or *italic* in any text field. Write
  normal prose; the app handles visual styling.

${visualToolkitPrompt(domains)}

${visualBrief}

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
  notation over writing things like "d_k" or "Q times K transpose" in prose. Never put raw LaTeX
  commands like \`\\approx\` or \`\\sqrt{}\` in paragraph text unless they are inside single dollar signs.
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
- A "widget" block embeds a small INTERACTIVE component that a separate builder constructs
  from your spec while you keep writing. Use it when interaction teaches better than passive
  reading — the learner manipulates something and watches a response (drag a slider to reshape
  a curve, step through an algorithm's states, toggle a parameter and see the output move).
  Set \`widgetId\` (short kebab-case slug, unique in this lesson), \`title\` (3-7 words), and
  \`spec\`: 2-5 sentences naming the variables the learner controls (with ranges), what responds
  and how, and the one insight the interaction should surface. The builder sees ONLY your spec,
  never this lesson — make it self-contained. Refer to the widget from the surrounding prose.
  Prefer the fewest widgets that earn their place; multiple widgets are fine when each teaches
  a distinct manipulation or state change.
${hintLine ? `${hintLine}\n` : ""}${assembleVisualGuidance()}
- Every block must have content: paragraph and callout need non-empty text, section needs a label, code needs non-empty text, widget needs widgetId + title + spec.${parts.formatAddendum ? `\n${parts.formatAddendum}` : ""}

FINISH by recommending what to explore next, split into two lists — this is how the learner grows
the tree without duplicating it, so choose carefully:
- suggestedLessons: for each next idea that is ALREADY covered by a concept in the existing list
  above, reference that concept by its handle (e.g. "c2"). These render as LINKS to lessons the
  learner already has — never recreate them as new.
- suggestedForks: ONLY for a sub-concept genuinely ABSENT from the existing list — a true new
  branch worth its own lesson, nested under this one. Give a short title (2-5 words) and a one-line
  reason.
- When unsure whether an idea already exists above, prefer a LINK (suggestedLessons) over a new
  fork. A smaller, well-connected tree beats a sprawl of near-duplicate lessons.
No markdown.`;
}
