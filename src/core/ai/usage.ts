// Usage capture — the single chokepoint that records what every AI call cost.
// Implemented as AI SDK language-model middleware so it wraps the model returned
// by getModel(): every generate/stream round-trip (including each step of a
// multi-step tool call) flows through here, present and future, with no change
// to the call sites. Token usage is read off the result/finish part, priced via
// the active route, and appended to the usage ledger.
import type { LanguageModelMiddleware } from "ai";
import type { LanguageModelV3StreamPart, LanguageModelV3Usage } from "@ai-sdk/provider";
import { getRoute } from "./routes";
import { costFor, type UsageTokens } from "./pricing";
import { usageRepo } from "../store/repositories";
import { queryClient } from "../store/queryClient";
import { dlog } from "../debug";

/** Flatten the AI SDK v3 nested usage into the scalar counts we price + store.
 *  Base input = non-cached tokens (`noCache`), so cache reads aren't double-counted;
 *  cached = cache reads (priced at the route's cache rate). cacheWrite is ignored
 *  (Ascent doesn't use prompt caching; if it ever does, price it here). */
function tokensOf(usage: LanguageModelV3Usage | undefined): UsageTokens {
  return {
    inputTokens: usage?.inputTokens.noCache ?? usage?.inputTokens.total ?? 0,
    outputTokens: usage?.outputTokens.total ?? 0,
    cachedInputTokens: usage?.inputTokens.cacheRead ?? 0,
  };
}

/** Price the usage and append a ledger row. Fire-and-forget: recording must never
 *  block or fail a generation. Skips no-op finishes (no tokens observed). */
function record(routeId: string, modelId: string, usage: LanguageModelV3Usage | undefined, providerMetadata: unknown): void {
  const tokens = tokensOf(usage);
  const input = tokens.inputTokens ?? 0;
  const output = tokens.outputTokens ?? 0;
  const cached = tokens.cachedInputTokens ?? 0;
  if (input === 0 && output === 0 && cached === 0) return;

  const { costUsd, source } = costFor(getRoute(routeId), modelId, tokens, providerMetadata);
  usageRepo
    .insert({
      id: crypto.randomUUID(),
      provider: routeId,
      model: modelId,
      inputTokens: input,
      outputTokens: output,
      cachedInputTokens: cached,
      costUsd,
      costSource: source,
      createdAt: Date.now(),
    })
    .then(() => queryClient.invalidateQueries({ queryKey: ["usage"] }))
    .catch((e) => dlog("usage", "record failed:", String(e)));
}

/** Middleware bound to the route + model that constructed it (in getModel). */
export function recordingMiddleware(routeId: string, modelId: string): LanguageModelMiddleware {
  return {
    specificationVersion: "v3",
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate();
      record(routeId, modelId, result.usage, result.providerMetadata);
      return result;
    },
    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream();
      const tap = new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
        transform(part, controller) {
          // The single 'finish' part carries the round-trip's usage + metadata.
          if (part.type === "finish") record(routeId, modelId, part.usage, part.providerMetadata);
          controller.enqueue(part);
        },
      });
      return { stream: stream.pipeThrough(tap), ...rest };
    },
  };
}
