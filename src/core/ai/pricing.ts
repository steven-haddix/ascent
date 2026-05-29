// Cost resolution: turn a route + model + token usage into a USD cost. Provider-
// agnostic by construction — token counts are the ground truth (the AI SDK
// normalizes them across providers), and the dollar figure is derived per route:
// a gateway that reports its own cost wins; otherwise we compute from the route's
// published rate table; otherwise we keep the tokens and report no price.
import type { Route } from "./routes";

export type CostSource = "reported" | "rates" | "unknown";

/** Normalized token counts from the AI SDK's usage object (fields may be absent). */
export interface UsageTokens {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}

export interface CostResult {
  /** USD, or null when the route can't price this model. */
  costUsd: number | null;
  source: CostSource;
}

const PER_MILLION = 1_000_000;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function costFor(
  route: Route,
  modelId: string,
  usage: UsageTokens,
  providerMetadata?: unknown,
): CostResult {
  // A gateway that bills and reports a dollar amount is authoritative — prefer it.
  if (route.costMode === "reported" && route.extractReportedCost) {
    const reported = route.extractReportedCost(providerMetadata);
    if (typeof reported === "number" && Number.isFinite(reported)) {
      return { costUsd: round6(reported), source: "reported" };
    }
  }

  // Otherwise compute from this route's per-model rates.
  const rates = route.rates?.[modelId];
  if (rates) {
    const input = usage.inputTokens ?? 0;
    const output = usage.outputTokens ?? 0;
    const cached = usage.cachedInputTokens ?? 0;
    // Anthropic's input_tokens already excludes cache reads, so summing is correct.
    // Cache reads bill at 0.1x base input unless the route states otherwise.
    const cachedRate = rates.cachedInput ?? rates.input * 0.1;
    const cost = (input * rates.input + output * rates.output + cached * cachedRate) / PER_MILLION;
    return { costUsd: round6(cost), source: "rates" };
  }

  // Unknown model on this route (e.g. a BYO provider with no rates entered) —
  // tokens are still tracked; the UI shows "price unknown".
  return { costUsd: null, source: "unknown" };
}
