// AIService — the only place that touches the model SDK. Every request is routed
// through the Rust `ai_request` command (CORS-free; the key is attached in Rust
// and never enters JS). Provider-agnostic: other providers slot into getModel()
// later without changing call sites.
import { createAnthropic } from "@ai-sdk/anthropic";
import { invoke } from "@tauri-apps/api/core";

interface AiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const tauriFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url =
    input instanceof URL ? input.href : typeof input === "string" ? input : (input as Request).url;
  const headers: Record<string, string> = {};
  new Headers(init?.headers ?? {}).forEach((value, key) => {
    headers[key] = value;
  });
  const res = await invoke<AiResponse>("ai_request", {
    url,
    method: init?.method ?? "POST",
    headers,
    body: typeof init?.body === "string" ? init.body : null,
  });
  return new Response(res.body, { status: res.status, headers: res.headers });
};

export const MODELS = {
  flagship: "claude-opus-4-7",
  default: "claude-sonnet-4-6",
  fast: "claude-haiku-4-5-20251001",
} as const;

/** Provider-agnostic model factory. Anthropic for now. */
export function getModel(modelId: string = MODELS.default) {
  const anthropic = createAnthropic({ apiKey: "tauri-managed", fetch: tauriFetch });
  return anthropic(modelId);
}
