// Micro-generations — small, fast calls on Haiku for the selection menu:
//   - defineInline: a one-line gloss for an arbitrary text selection
//   - normalizeConcept: turn a (possibly messy) selection into a clean concept
//     title + summary, ready to fork
// Both go through the shared getModel() chokepoint (usage auto-recorded) pinned to
// the fast model, and keep the lesson context so answers are situated, not generic.
import { generateText } from "ai";
import { getModel } from "../ai/service";
import { MODELS } from "../ai/models";

export interface MicroContext {
  topicTitle: string;
  /** breadcrumb from root → current concept */
  path: string[];
  conceptTitle: string;
  /** the topic's intake brief summary, if any — keeps glosses aligned to the goal */
  briefSummary?: string | null;
}

function place(ctx: MicroContext): string {
  const where = `"${ctx.conceptTitle}" within "${ctx.topicTitle}" (${ctx.path.join(" > ")})`;
  return ctx.briefSummary ? `${where}. Learner brief: ${ctx.briefSummary}` : where;
}

/** One-line definition of `selection`, grounded in the current lesson. */
export async function defineInline(selection: string, ctx: MicroContext): Promise<string> {
  const { text } = await generateText({
    model: getModel(MODELS.fast),
    system:
      "You are a concise tutor. Define the learner's selected text in ONE clear, plain-language " +
      "sentence, grounded in the lesson they're reading. No markdown, no preamble, and do not " +
      'restate the term (don\'t begin with "X is"). Just the definition.',
    prompt: `Lesson context: ${place(ctx)}.\n\nSelected text: "${selection}"`,
  });
  return text.trim();
}

export interface NormalizedConcept {
  title: string;
  summary: string;
}

/** Turn a free-text selection into a clean concept title + one-line summary to
 *  fork into. Parses a strict `Title :: summary` reply; falls back to the raw
 *  selection if the model strays from the format. */
export async function normalizeConcept(selection: string, ctx: MicroContext): Promise<NormalizedConcept> {
  const fallbackTitle = selection.trim().replace(/\s+/g, " ").slice(0, 80);
  const { text } = await generateText({
    model: getModel(MODELS.fast),
    system:
      "You turn a learner's text selection into a concept worth its own lesson. Reply with ONLY " +
      "a concise concept title (2-5 words, properly capitalized), then ' :: ', then a one-line " +
      "summary of what that concept covers. No markdown, no quotes, nothing else. " +
      'Example: "Positional Encoding :: How transformers inject token order into embeddings."',
    prompt: `Lesson context: ${place(ctx)}.\n\nSelected text: "${selection}"`,
  });
  const [rawTitle, ...rest] = text.trim().split("::");
  const title = (rawTitle ?? "").trim().replace(/^["']|["']$/g, "") || fallbackTitle;
  const summary = rest.join("::").trim().replace(/^["']|["']$/g, "");
  return { title, summary };
}
