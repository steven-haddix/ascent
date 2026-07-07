import { createAnthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import { defaultSettingsMiddleware, type LanguageModelMiddleware, type Tool } from "ai";
import { z } from "zod";
import type { AiTaskId } from "../tasks";
import type { ProviderSettingsEnvelope, TextProviderAdapter } from "./types";

export const ANTHROPIC_SETTINGS_VERSION = 1;

const EffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
const AnthropicSettingsSchema = z.object({
  thinking: z.discriminatedUnion("type", [
    z.object({ type: z.literal("disabled") }),
    z.object({ type: z.literal("adaptive"), display: z.enum(["omitted", "summarized"]).optional() }),
    z.object({ type: z.literal("enabled"), budgetTokens: z.number().int().min(1024) }),
  ]),
  effort: EffortSchema.optional(),
});

export type AnthropicModelSettings = z.infer<typeof AnthropicSettingsSchema>;
export type AnthropicEffort = z.infer<typeof EffortSchema>;

export interface AnthropicModelCapabilities {
  thinking: "adaptive" | "manual";
  effortLevels: AnthropicEffort[];
}

/** These scenarios deliberately use Anthropic's forced JSON-tool structured-output
 *  fallback. Anthropic rejects forced tool choice when extended thinking is active.
 *  Effort remains available because it does not require thinking blocks. */
export function anthropicThinkingAvailable(task?: AiTaskId): boolean {
  return task !== "lesson" && task !== "teachback" && task !== "extract";
}

/** Provider-owned capability matrix. Nothing outside the Anthropic adapter needs
 *  to know what adaptive thinking, manual budgets, or effort levels mean. */
export function anthropicModelCapabilities(modelId: string): AnthropicModelCapabilities {
  if (
    modelId.includes("claude-opus-4-8") ||
    modelId.includes("claude-opus-4-7") ||
    modelId.includes("claude-sonnet-5")
  ) {
    return { thinking: "adaptive", effortLevels: ["low", "medium", "high", "xhigh", "max"] };
  }
  if (modelId.includes("claude-sonnet-4-6") || modelId.includes("claude-opus-4-6")) {
    return { thinking: "adaptive", effortLevels: ["low", "medium", "high", "max"] };
  }
  if (modelId.includes("claude-opus-4-5")) {
    return { thinking: "manual", effortLevels: ["low", "medium", "high"] };
  }
  // Haiku 4.5 and earlier Claude 4 models use manual budget_tokens and do not
  // support the effort parameter.
  return { thinking: "manual", effortLevels: [] };
}

export function defaultAnthropicSettings(modelId: string, _task?: AiTaskId): AnthropicModelSettings {
  const { effortLevels } = anthropicModelCapabilities(modelId);
  return {
    thinking: { type: "disabled" },
    ...(effortLevels.includes("high") ? { effort: "high" as const } : {}),
  };
}

export function parseAnthropicSettings(
  modelId: string,
  value: unknown,
  task?: AiTaskId,
): AnthropicModelSettings {
  const parsed = AnthropicSettingsSchema.safeParse(value);
  if (!parsed.success) return defaultAnthropicSettings(modelId, task);

  const capabilities = anthropicModelCapabilities(modelId);
  const thinking =
    !anthropicThinkingAvailable(task)
      ? { type: "disabled" as const }
      : capabilities.thinking === "adaptive"
        ? parsed.data.thinking.type === "adaptive"
          ? parsed.data.thinking
          : { type: "disabled" as const }
        : parsed.data.thinking.type === "enabled"
          ? parsed.data.thinking
          : { type: "disabled" as const };
  const effort = parsed.data.effort;

  return {
    thinking,
    ...(effort && capabilities.effortLevels.includes(effort) ? { effort } : {}),
  };
}

export function anthropicSettingsEnvelope(settings: AnthropicModelSettings): ProviderSettingsEnvelope {
  return { adapter: "anthropic", version: ANTHROPIC_SETTINGS_VERSION, value: settings };
}

function toProviderOptions(settings: AnthropicModelSettings): AnthropicLanguageModelOptions {
  if (settings.thinking.type === "adaptive") {
    return {
      thinking: { type: "adaptive", display: settings.thinking.display ?? "omitted" },
      ...(settings.effort ? { effort: settings.effort } : {}),
    };
  }
  if (settings.thinking.type === "enabled") {
    return {
      thinking: { type: "enabled", budgetTokens: settings.thinking.budgetTokens },
      ...(settings.effort ? { effort: settings.effort } : {}),
    };
  }
  return {
    thinking: { type: "disabled" },
    ...(settings.effort ? { effort: settings.effort } : {}),
  };
}

export const anthropicTextAdapter: TextProviderAdapter = {
  id: "anthropic",
  settingsVersion: ANTHROPIC_SETTINGS_VERSION,

  buildModel({ route, modelId, fetch }) {
    const anthropic = createAnthropic({ apiKey: "route-managed", fetch, baseURL: route.baseURL });
    return anthropic(modelId);
  },

  defaultSettings({ modelId, task }) {
    return defaultAnthropicSettings(modelId, task);
  },

  parseSettings({ modelId, value, task }) {
    return parseAnthropicSettings(modelId, value, task);
  },

  settingsMiddleware({ modelId, task, settings }): LanguageModelMiddleware {
    const value = parseAnthropicSettings(modelId, settings, task);
    return defaultSettingsMiddleware({
      settings: { providerOptions: { anthropic: toProviderOptions(value) } },
    });
  },

  buildNativeWebSearchTool({ route, fetch, maxUses }): Tool {
    const anthropic = createAnthropic({ apiKey: "route-managed", fetch, baseURL: route.baseURL });
    return anthropic.tools.webSearch_20250305({ maxUses }) as Tool;
  },
};
