// TutorService — branch-grounded chat. Streams a reply about the current concept
// in the learner's chosen tutor mode, and now exposes a single tool (setLessonCode)
// that the model can call when the learner asks for code: it adds or replaces a
// snippet directly in the lesson body, which makes the Code tab and inline
// highlighted block appear/update without a full regenerate.
import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { getModel, MODELS } from "../ai/service";
import { lessonRepo, type ConceptRow } from "../store/repositories";
import { queryClient } from "../store/queryClient";
import { isLessonStreaming } from "./lessonStreams";
import type { Block, LensId } from "../types";

export const TUTOR_MODES = {
  Mentor: "You are a warm, encouraging mentor who blends intuition with rigor.",
  Socratic:
    "You are a Socratic tutor — answer with one short guiding question back rather than a direct answer, unless the learner asks plainly.",
  Encyclopedic: "You answer clearly and densely, like a polished textbook excerpt.",
} as const;

export type TutorMode = keyof typeof TUTOR_MODES;

export interface ChatContext {
  topicTitle: string;
  path: string[];
  summary?: string | null;
}

export interface ChatTurnInput {
  role: "user" | "ai";
  text: string;
}

/** Stream a tutor reply. `history` is the prior turns; `message` is the new one.
 *  Calls `onDelta` for each token chunk; resolves to the full reply text. The
 *  model may call `setLessonCode` mid-turn to add or replace a code snippet in the
 *  lesson; the lesson updates in place via setQueryData (no regenerate needed). */
export async function chat(
  concept: ConceptRow,
  ctx: ChatContext,
  history: ChatTurnInput[],
  mode: TutorMode,
  message: string,
  onDelta: (delta: string) => void,
): Promise<string> {
  const system =
    `${TUTOR_MODES[mode]} The learner is studying "${concept.title}" within "${ctx.topicTitle}" ` +
    `(${ctx.path.join(" > ")}).${ctx.summary ? ` This concept covers: ${ctx.summary}.` : ""} ` +
    `Ground answers in this concept. Keep text replies to 2-4 short sentences unless asked ` +
    `for more. Be concrete. No markdown.\n\n` +
    `If the learner asks for code, an example, or a runnable demonstration, you may call ` +
    `setLessonCode to add a snippet directly into the lesson — it appears highlighted in the ` +
    `body and runnable in the Code tab on the right. Always give the snippet a short, specific ` +
    `title (3-7 words) of what it does, so the learner understands it while it's collapsed. ` +
    `Call this ONLY when seeing real code ` +
    `would help understanding (programming / ML / scripting / data topics). Don't call it on ` +
    `every message. The snippet must be distilled and focused on teaching THIS concept as ` +
    `clearly as possible — length should serve clarity, never be artificially capped. A tight ` +
    `8-line example is great; a careful 40-line walkthrough with comments that earn their ` +
    `place is also fine when the topic warrants. Self-contained where possible. Don't dump ` +
    `production code; don't truncate a clear explanation.\n\n` +
    `Use mode="replace" when the learner is iterating on the same example ("show it in pandas ` +
    `instead", "rewrite with vectorization", "what if we use a generator") — this overwrites ` +
    `the previous chat-added snippet in place. Use mode="add" when they want an additional ` +
    `distinct example alongside the previous one ("also show me with NumPy", "now in PyTorch"). ` +
    `When you call the tool, write a brief one-line acknowledgement in your reply ("Added a ` +
    `walkthrough in the lesson ↓" / "Updated the example to use pandas") so the learner knows ` +
    `where to look.`;

  const messages = [
    ...history.map((t) => ({
      role: t.role === "ai" ? ("assistant" as const) : ("user" as const),
      content: t.text,
    })),
    { role: "user" as const, content: message },
  ];

  const tools = {
    setLessonCode: tool({
      description:
        "Add or replace a runnable code snippet in the current lesson. Call ONLY when the " +
        "learner is asking for code, an example, or a runnable demonstration. The snippet must " +
        "be distilled and focused on teaching this concept clearly — length serves clarity, " +
        'not a cap. Use mode="replace" to iterate on the same example in place; mode="add" for ' +
        "a distinct additional example.",
      inputSchema: z.object({
        mode: z
          .enum(["add", "replace"])
          .describe("'replace' overwrites the most recent chat-added snippet in place; 'add' appends a new one"),
        language: z
          .enum(["python", "javascript", "typescript", "bash", "json"])
          .describe("source language — only 'python' is runnable in v1; the rest render highlighted but read-only"),
        title: z
          .string()
          .describe("a short, specific title (3-7 words) of what the snippet does, e.g. 'NumPy version of the calculation' — shown on the collapsed card so the learner knows its purpose"),
        code: z
          .string()
          .describe("the snippet itself — distilled, focused, with comments where they earn their place"),
        intro: z
          .string()
          .optional()
          .describe("optional one-sentence paragraph introducing the snippet (e.g. 'Here's that with NumPy:')"),
      }),
      execute: async ({ mode, language, title, code, intro }) => {
        if (isLessonStreaming(concept.id)) {
          return { ok: false as const, error: "the lesson is currently generating — try again in a moment" };
        }
        const lesson = await lessonRepo.get(concept.id);
        if (!lesson) {
          return { ok: false as const, error: "no lesson yet for this concept" };
        }
        const blocks: Block[] = [...lesson.blocks];

        // Build the new chat-added pair (intro paragraph + code block).
        const newPair: Block[] = [];
        if (intro && intro.trim().length > 0) {
          newPair.push({ kind: "paragraph", text: intro, source: "chat" });
        }
        newPair.push({ kind: "code", text: code, language, title, source: "chat" });

        if (mode === "replace") {
          // Find the most recent chat-added code block (walking backward to avoid
          // findLastIndex for broader ES-target compat) and, if its preceding block
          // is a chat-added intro paragraph, sweep both out together so we don't
          // leave an orphaned intro.
          let lastCodeIdx = -1;
          for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks[i];
            if (b.source === "chat" && b.kind === "code") {
              lastCodeIdx = i;
              break;
            }
          }
          if (lastCodeIdx >= 0) {
            const before = blocks[lastCodeIdx - 1];
            const removeFrom =
              before?.source === "chat" && before.kind === "paragraph" ? lastCodeIdx - 1 : lastCodeIdx;
            blocks.splice(removeFrom, lastCodeIdx - removeFrom + 1, ...newPair);
          } else {
            // Nothing chat-added to replace yet — treat as an add.
            blocks.push(...newPair);
          }
        } else {
          blocks.push(...newPair);
        }

        const lenses: LensId[] = Array.from(new Set<LensId>([...lesson.lenses, "code"]));
        const updated = { ...lesson, blocks, lenses, generatedAt: Date.now() };
        await lessonRepo.upsert(updated);
        queryClient.setQueryData(["lesson", concept.id], updated);
        return { ok: true as const, mode, language, lines: code.split("\n").length };
      },
    }),
  };

  const result = streamText({
    model: getModel(MODELS.default),
    system,
    messages,
    tools,
    // One tool call + the model's follow-up text reply = at most ~3 steps.
    stopWhen: stepCountIs(3),
  });
  let full = "";
  for await (const delta of result.textStream) {
    full += delta;
    onDelta(delta);
  }
  return full;
}
