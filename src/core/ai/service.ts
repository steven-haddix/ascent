// AIService — the only place that touches the model SDK. Every request is routed
// through Rust (CORS-free; the key is attached in Rust, never in JS).
//   - non-streaming requests -> ai_request (full Response)
//   - streaming requests (body.stream === true) -> ai_stream, whose body chunks
//     arrive over a Tauri Channel and are rebuilt into a streaming Response.
// Provider-agnostic: other providers slot into getModel() later.
import { createAnthropic } from "@ai-sdk/anthropic";
import { invoke, Channel } from "@tauri-apps/api/core";
import { getModelId } from "../settings";

interface AiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
interface StreamHead {
  status: number;
  headers: Record<string, string>;
}
type StreamMsg =
  | { event: "chunk"; data: string } // base64 of raw body bytes
  | { event: "done" }
  | { event: "error"; message: string };

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function headerObject(init?: RequestInit): Record<string, string> {
  const h: Record<string, string> = {};
  new Headers(init?.headers ?? {}).forEach((v, k) => (h[k] = v));
  return h;
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof URL ? input.href : typeof input === "string" ? input : (input as Request).url;
}

async function streamingFetch(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | null,
  signal?: AbortSignal | null,
): Promise<Response> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  let closed = false;
  // Aborting (idle watchdog or manual Stop) errors the body stream, which unblocks
  // the AI SDK's reader so result.output / partialOutputStream reject instead of
  // hanging forever on a stalled provider connection.
  const onAbort = () => {
    if (closed) return;
    closed = true;
    controller.error(new DOMException("Aborted", "AbortError"));
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const channel = new Channel<StreamMsg>();
  channel.onmessage = (msg) => {
    if (closed) return;
    if (msg.event === "chunk") controller.enqueue(base64ToBytes(msg.data));
    else if (msg.event === "done") {
      closed = true;
      signal?.removeEventListener("abort", onAbort);
      controller.close();
    } else {
      closed = true;
      signal?.removeEventListener("abort", onAbort);
      controller.error(new Error(msg.message));
    }
  };
  const head = await invoke<StreamHead>("ai_stream", { channel, url, method, headers, body });
  return new Response(stream, { status: head.status, headers: head.headers });
}

const tauriFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = urlOf(input);
  const method = init?.method ?? "POST";
  const headers = headerObject(init);
  const body = typeof init?.body === "string" ? init.body : null;

  let wantsStream = false;
  if (body) {
    try {
      wantsStream = JSON.parse(body).stream === true;
    } catch {
      /* body isn't JSON — treat as non-streaming */
    }
  }

  if (wantsStream) return streamingFetch(url, method, headers, body, init?.signal);

  const res = await invoke<AiResponse>("ai_request", { url, method, headers, body });
  return new Response(res.body, { status: res.status, headers: res.headers });
};

// Re-exported so existing call sites keep importing MODELS from the service.
export { MODELS } from "./models";

/** Provider-agnostic model factory. Anthropic for now. Defaults to the model the
 *  user picked in Settings (getModelId), so all generation honors that choice
 *  unless a call passes an explicit id. */
export function getModel(modelId: string = getModelId()) {
  const anthropic = createAnthropic({ apiKey: "tauri-managed", fetch: tauriFetch });
  return anthropic(modelId);
}
