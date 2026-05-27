// TutorService — branch-grounded chat. Streams a reply about the current
// concept, in the learner's chosen tutor mode. Uses the streaming transport
// (streamText -> ai_stream).
import { streamText } from "ai";
import { getModel, MODELS } from "../ai/service";
import type { ConceptRow } from "../store/repositories";

export const TUTOR_MODES = {
  Mentor: "You are a warm, encouraging mentor who blends intuition with rigor.",
  Socratic: "You are a Socratic tutor — answer with one short guiding question back rather than a direct answer, unless the learner asks plainly.",
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
 *  Calls `onDelta` for each token chunk; resolves to the full reply text. */
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
    `Ground answers in this concept. Keep replies to 2-4 short sentences unless asked for more. ` +
    `Be concrete. No markdown.`;

  const messages = [
    ...history.map((t) => ({
      role: t.role === "ai" ? ("assistant" as const) : ("user" as const),
      content: t.text,
    })),
    { role: "user" as const, content: message },
  ];

  const result = streamText({ model: getModel(MODELS.default), system, messages });
  let full = "";
  for await (const delta of result.textStream) {
    full += delta;
    onDelta(delta);
  }
  return full;
}
