// TutorService — branch-grounded chat. Streams a reply about the current concept
// in the learner's chosen tutor mode, and now exposes a single tool (setLessonCode)
// that the model can call when the learner asks for code: it adds or replaces a
// snippet directly in the lesson body, which makes the Code tab and inline
// highlighted block appear/update without a full regenerate.
import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { getModelFor } from "../ai/service";
import { lessonRepo, widgetRepo, type ConceptRow } from "../store/repositories";
import { queryClient } from "../store/queryClient";
import { isLessonStreaming } from "./lessonStreams";
import { ensureWidgetJob } from "./widgetJobs";
import { widgetKeysFor } from "../widgets/keys";
import { mediaProviderRegistry } from "../media/registry";
import { isGenerative } from "../media/types";
import type { Block, LensId } from "../types";
import { ensureGeneratedImageJob } from "./generatedImageJobs";

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
  /** the topic's intake brief summary — keeps tutoring aligned with the learner's goal */
  briefSummary?: string | null;
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
  const generatedImageProviders = mediaProviderRegistry.enabled().filter(isGenerative);
  const generatedImageAvailability = generatedImageProviders.length
    ? `Generated-image providers currently available: ${generatedImageProviders.map((p) => `${p.label} (${p.id})`).join(", ")}.`
    : `No generated-image provider is currently enabled. Do not call setLessonImage.`;
  const system =
    `${TUTOR_MODES[mode]} The learner is studying "${concept.title}" within "${ctx.topicTitle}" ` +
    `(${ctx.path.join(" > ")}).${ctx.summary ? ` This concept covers: ${ctx.summary}.` : ""}` +
    `${ctx.briefSummary ? ` Learner brief: ${ctx.briefSummary}.` : ""} ` +
    `Ground answers in this concept. Keep text replies to 2-4 short sentences unless asked ` +
    `for more. Be concrete. No markdown.\n\n` +
    `If the learner asks for code, an example, or a runnable demonstration, you may call ` +
    `setLessonCode to add a snippet directly into the lesson — it appears highlighted in the ` +
    `body and runnable in the Code tab on the right. Always give the snippet a short, specific ` +
    `title (3-7 words) of what it does, so the learner understands it while it's collapsed. ` +
    `Python runs locally via Pyodide, so runnable Python may import ONLY the standard library ` +
    `or numpy / pandas / scipy / scikit-learn / sympy / matplotlib — never torch / tensorflow / ` +
    `keras / jax; implement ML ideas from scratch with numpy so the snippet actually runs. ` +
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
    `where to look.\n\n` +
    `If the learner asks for something INTERACTIVE — "let me play with it", "can I try ` +
    `different values", "show me a slider / simulation / visualization I can manipulate" — call ` +
    `setLessonWidget instead: a separate builder agent constructs a small interactive component ` +
    `from your spec and it appears inline in the lesson. Give it a short title (3-7 words) and a ` +
    `self-contained 2-5 sentence spec naming the variables the learner controls (with ranges), ` +
    `what responds and how, and the insight the interaction should surface — the builder sees ` +
    `ONLY your spec, never this conversation. Use mode="replace" to revise the previous ` +
    `chat-added widget ("make the slider logarithmic"), mode="add" for a new one. Building takes ` +
    `a moment, so acknowledge with something like "Building that interactive demo in the lesson ` +
    `↓". Call it only when interaction genuinely beats prose, code, or a static chart.\n\n` +
    `${generatedImageAvailability} If the learner asks to SEE a specific scene, reconstruction, ` +
    `visual analogy, environment, or richly illustrated concept, you may call setLessonImage. ` +
    `Use it when a generated illustration adds visual intuition that prose, an exact chart, or a ` +
    `simple diagram cannot. It is not factual evidence and may contain inaccuracies, so keep exact ` +
    `labels, measurements, and claims in the lesson text. Give the builder a vivid self-contained ` +
    `prompt describing subject, composition, viewpoint, style, and teaching focus; avoid important ` +
    `text inside the image. Use mode="replace" when the learner refines the last requested image ` +
    `and mode="add" for a distinct one. If they explicitly request OpenAI or Gemini, select that ` +
    `provider; otherwise use auto. Acknowledge that the illustration is generating in the lesson ↓.`;

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
          .describe(
            "the snippet itself — distilled, focused, with comments where they earn their place. Runnable Python may use only the stdlib or numpy/pandas/scipy/scikit-learn/sympy/matplotlib (never torch/tensorflow/keras/jax)",
          ),
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
    setLessonWidget: tool({
      description:
        "Add or replace a small interactive widget in the current lesson. A separate builder " +
        "agent constructs it from your spec — call ONLY when the learner wants to manipulate " +
        "something (sliders, stepping through states, toggling parameters), not for content " +
        'prose/code/charts already cover. mode="replace" revises the most recent chat-added ' +
        'widget in place; mode="add" appends a new one.',
      inputSchema: z.object({
        mode: z
          .enum(["add", "replace"])
          .describe("'replace' rebuilds the most recent chat-added widget in place; 'add' appends a new one"),
        title: z.string().describe("a short, specific title (3-7 words) of what the widget does, e.g. 'Learning rate playground'"),
        spec: z
          .string()
          .describe(
            "2-5 self-contained sentences for the builder (it sees ONLY this): the variables the learner controls (with ranges), what responds and how, and the insight the interaction should surface",
          ),
      }),
      execute: async ({ mode, title, spec }) => {
        if (isLessonStreaming(concept.id)) {
          return { ok: false as const, error: "the lesson is currently generating — try again in a moment" };
        }
        const lesson = await lessonRepo.get(concept.id);
        if (!lesson) {
          return { ok: false as const, error: "no lesson yet for this concept" };
        }
        const blocks: Block[] = [...lesson.blocks];

        // Locate the most recent chat-added widget for replace mode; fall through
        // to add when there is none yet.
        let replaceIdx = -1;
        if (mode === "replace") {
          for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks[i];
            if (b.source === "chat" && b.kind === "widget") {
              replaceIdx = i;
              break;
            }
          }
        }

        let blockIdx: number;
        if (replaceIdx >= 0) {
          // Keep the slug so the (conceptId, widgetId) row — and the block's spot
          // in the lesson — carry over; the builder overwrites the row in place.
          blocks[replaceIdx] = { ...blocks[replaceIdx], title, spec };
          blockIdx = replaceIdx;
        } else {
          blocks.push({ kind: "widget", widgetId: title, title, spec, source: "chat" });
          blockIdx = blocks.length - 1;
        }
        // The shared key helper resolves the final slug (normalized, deduped
        // against every other widget in the lesson) exactly as the renderer will.
        const widgetKey = widgetKeysFor(blocks).get(blockIdx)!;
        const prevSource =
          replaceIdx >= 0 ? ((await widgetRepo.get(concept.id, widgetKey))?.source ?? undefined) : undefined;

        const updated = { ...lesson, blocks, generatedAt: Date.now() };
        await lessonRepo.upsert(updated);
        queryClient.setQueryData(["lesson", concept.id], updated);
        ensureWidgetJob({
          conceptId: concept.id,
          conceptTitle: concept.title,
          widgetId: widgetKey,
          title,
          spec,
          topicTitle: ctx.topicTitle,
          path: ctx.path,
          prevSource,
        });
        return { ok: true as const, mode: replaceIdx >= 0 ? ("replace" as const) : ("add" as const), title };
      },
    }),
    setLessonImage: tool({
      description:
        "Add or replace an AI-generated illustration in the lesson. Call when the learner asks " +
        "to see a specific scene, reconstruction, visual analogy, or richly illustrated concept. " +
        "Do not use it for exact data, labels, measurements, or factual evidence.",
      inputSchema: z.object({
        mode: z
          .enum(["add", "replace"])
          .describe("'replace' revises the most recent chat-added generated image; 'add' appends a distinct image"),
        title: z.string().describe("short 3-7 word caption for the illustration"),
        prompt: z
          .string()
          .describe("vivid self-contained image prompt covering subject, composition, viewpoint, style, and teaching focus; avoid text in-image"),
        purpose: z.string().describe("one sentence explaining what the learner should notice or understand"),
        alt: z.string().describe("concise accessible description of the intended image"),
        provider: z
          .enum(["auto", "openai-images", "gemini-images"])
          .default("auto")
          .describe("use a named provider only when the learner explicitly requests it; otherwise auto"),
      }),
      execute: async ({ mode, title, prompt, purpose, alt, provider }) => {
        if (isLessonStreaming(concept.id)) {
          return { ok: false as const, error: "the lesson is currently generating — try again in a moment" };
        }
        const preferredProviderId = provider === "auto" ? undefined : provider;
        const candidates = preferredProviderId
          ? generatedImageProviders.filter((p) => p.id === preferredProviderId)
          : generatedImageProviders;
        if (candidates.length === 0) {
          return {
            ok: false as const,
            error: preferredProviderId
              ? "that image provider is not enabled in Settings"
              : "no image-generation provider is enabled in Settings",
          };
        }
        const lesson = await lessonRepo.get(concept.id);
        if (!lesson) return { ok: false as const, error: "no lesson yet for this concept" };
        const blocks: Block[] = [...lesson.blocks];

        let replaceIdx = -1;
        if (mode === "replace") {
          for (let i = blocks.length - 1; i >= 0; i--) {
            if (blocks[i].source === "chat" && blocks[i].kind === "generated-image") {
              replaceIdx = i;
              break;
            }
          }
        }
        const mediaId =
          replaceIdx >= 0 && blocks[replaceIdx].mediaId
            ? blocks[replaceIdx].mediaId!
            : `generated-${crypto.randomUUID()}`;
        const imageBlock: Block = {
          kind: "generated-image",
          mediaId,
          title,
          prompt,
          purpose,
          alt,
          source: "chat",
        };
        if (replaceIdx >= 0) blocks[replaceIdx] = imageBlock;
        else blocks.push(imageBlock);

        const lenses: LensId[] = Array.from(new Set<LensId>([...lesson.lenses, "viz"]));
        const updated = { ...lesson, blocks, lenses, generatedAt: Date.now() };
        await lessonRepo.upsert(updated);
        queryClient.setQueryData(["lesson", concept.id], updated);
        ensureGeneratedImageJob({
          conceptId: concept.id,
          mediaId,
          prompt,
          purpose,
          preferredProviderId,
        });
        return {
          ok: true as const,
          mode: replaceIdx >= 0 ? ("replace" as const) : ("add" as const),
          provider: preferredProviderId ?? "auto",
          title,
        };
      },
    }),
  };

  const result = streamText({
    model: getModelFor("tutor"),
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
