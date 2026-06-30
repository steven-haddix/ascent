import { describe, expect, it } from "vitest";
import { generateText, wrapLanguageModel } from "ai";
import { getRoute } from "../routes";
import {
  anthropicModelCapabilities,
  anthropicTextAdapter,
  parseAnthropicSettings,
  type AnthropicModelSettings,
} from "./anthropic";
import type { RouteFetch } from "./types";

function response(model: string): Response {
  return new Response(
    JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model,
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 2, output_tokens: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

async function requestBody(modelId: string, settings: AnthropicModelSettings): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> | null = null;
  const fetch: RouteFetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return response(modelId);
  };
  const route = getRoute("anthropic");
  const model = wrapLanguageModel({
    model: anthropicTextAdapter.buildModel({ route, modelId, fetch }),
    middleware: anthropicTextAdapter.settingsMiddleware({ modelId, task: "tutor", settings }),
  });
  await generateText({ model, prompt: "Say ok", maxOutputTokens: 8_000 });
  if (!body) throw new Error("Expected the Anthropic adapter to issue a request");
  return body;
}

describe("Anthropic text-provider settings", () => {
  it("sends adaptive thinking and effort for Opus", async () => {
    const body = await requestBody("claude-opus-4-7", {
      thinking: { type: "adaptive", display: "omitted" },
      effort: "xhigh",
    });
    expect(body.thinking).toEqual({ type: "adaptive", display: "omitted" });
    expect(body.output_config).toEqual({ effort: "xhigh" });
  });

  it("sends a manual thinking budget for Haiku without effort", async () => {
    const body = await requestBody("claude-haiku-4-5-20251001", {
      thinking: { type: "enabled", budgetTokens: 4096 },
    });
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
    expect(body.output_config).toBeUndefined();
  });

  it("omits thinking when disabled while retaining explicit effort", async () => {
    const body = await requestBody("claude-sonnet-4-6", {
      thinking: { type: "disabled" },
      effort: "medium",
    });
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toEqual({ effort: "medium" });
  });

  it("keeps unsupported provider values out of a model's resolved settings", () => {
    expect(anthropicModelCapabilities("claude-haiku-4-5-20251001").effortLevels).toEqual([]);
    expect(
      parseAnthropicSettings("claude-sonnet-4-6", {
        thinking: { type: "adaptive" },
        effort: "xhigh",
      }),
    ).toEqual({ thinking: { type: "adaptive" } });
  });

  it("disables thinking for forced JSON-tool scenarios", () => {
    expect(
      parseAnthropicSettings(
        "claude-sonnet-4-6",
        { thinking: { type: "adaptive" }, effort: "high" },
        "lesson",
      ),
    ).toEqual({ thinking: { type: "disabled" }, effort: "high" });
  });
});
