// AIService — the only place that touches the model SDK. Every request is routed
// through Rust (CORS-free; the key is attached in Rust, never in JS).
//   - non-streaming requests -> ai_request (full Response)
//   - streaming requests (body.stream === true) -> ai_stream, whose body chunks
//     arrive over a Tauri Channel and are rebuilt into a streaming Response.
// Provider-agnostic: other providers slot into getModel() later.
import { createAnthropic } from "@ai-sdk/anthropic";
import { wrapLanguageModel, type LanguageModel, type Tool } from "ai";
import { invoke, Channel } from "@tauri-apps/api/core";
import { getModelId, getRouteId, getTaskModelId, getTaskRouteId } from "../settings";
import { getRoute, type Route } from "./routes";
import type { AiTaskId } from "./tasks";
import { recordingMiddleware } from "./usage";
import { dlog, now, since } from "../debug";

function modelOf(body: string | null): string | undefined {
  if (!body) return undefined;
  try {
    return JSON.parse(body).model as string | undefined;
  } catch {
    return undefined;
  }
}

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
  secret: string,
  scheme: string,
  signal?: AbortSignal | null,
): Promise<Response> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const t0 = now();
  dlog("stream", "request →", modelOf(body));
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  let closed = false;
  let chunks = 0;
  let bytes = 0;
  let rejectHead: ((reason: unknown) => void) | null = null;
  // Aborting (idle watchdog or manual Stop) both errors the body stream AND rejects
  // the head wait below — so a stall BEFORE the first byte (e.g. a very slow
  // time-to-first-byte) is recoverable instead of hanging forever on the pending invoke.
  const onAbort = () => {
    dlog("stream", "aborted @", since(t0));
    rejectHead?.(new DOMException("Aborted", "AbortError"));
    if (closed) return;
    closed = true;
    controller.error(new DOMException("Aborted", "AbortError"));
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const channel = new Channel<StreamMsg>();
  channel.onmessage = (msg) => {
    if (closed) return;
    if (msg.event === "chunk") {
      const b = base64ToBytes(msg.data);
      chunks += 1;
      bytes += b.length;
      if (chunks === 1) dlog("stream", "first chunk @", since(t0));
      controller.enqueue(b);
    } else if (msg.event === "done") {
      dlog("stream", `done: ${chunks} chunks, ${bytes}B @`, since(t0));
      closed = true;
      signal?.removeEventListener("abort", onAbort);
      controller.close();
    } else {
      dlog("stream", "error:", msg.message);
      closed = true;
      signal?.removeEventListener("abort", onAbort);
      controller.error(new Error(msg.message));
    }
  };
  // Race the head invoke against abort: the watchdog can fire while we're still
  // waiting for response headers (no stream has started yet).
  const head = await new Promise<StreamHead>((resolve, reject) => {
    rejectHead = reject;
    invoke<StreamHead>("ai_stream", { channel, url, method, headers, body, secret, scheme }).then(resolve, reject);
  });
  rejectHead = null;
  dlog("stream", `head ${head.status} @`, since(t0));
  return new Response(stream, { status: head.status, headers: head.headers });
}

/** Build a fetch bound to a route: the route's Keychain secret name + auth scheme
 *  are threaded to Rust, which reads that secret and attaches the right auth header
 *  (the key never enters JS). One closure per route so multiple providers coexist. */
function makeRouteFetch(secret: string, scheme: string) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
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

    if (wantsStream) return streamingFetch(url, method, headers, body, secret, scheme, init?.signal);

    const t0 = now();
    dlog("req", "request →", modelOf(body));
    const res = await invoke<AiResponse>("ai_request", { url, method, headers, body, secret, scheme });
    dlog("req", `response ${res.status} @`, since(t0));
    return new Response(res.body, { status: res.status, headers: res.headers });
  };
}

/** Construct the raw provider model for a route. Only the Anthropic SDK is wired
 *  today; gateway routes ("openai-compatible") are defined in routes.ts but not yet
 *  built here (they need their SDK + a runnable spike before activation). */
function buildModel(route: Route, modelId: string) {
  const fetch = makeRouteFetch(route.secretName, route.authScheme);
  if (route.sdk === "anthropic") {
    const anthropic = createAnthropic({ apiKey: "route-managed", fetch, baseURL: route.baseURL });
    return anthropic(modelId);
  }
  throw new Error(`Route "${route.id}" (sdk "${route.sdk}") is not wired yet — see routes.ts.`);
}

// Re-exported so existing call sites keep importing MODELS from the service.
export { MODELS } from "./models";

/** Provider-agnostic model factory. Selects the active route (Settings), builds its
 *  provider model, and wraps it with usage-recording middleware so every call's cost
 *  is captured at this one chokepoint. Defaults to the user's chosen model unless a
 *  call passes an explicit id. */
export function getModel(modelId: string = getModelId()) {
  const route = getRoute(getRouteId());
  return wrapLanguageModel({
    model: buildModel(route, modelId),
    middleware: recordingMiddleware(route.id, modelId),
  });
}

/** Per-task model factory (tasks.ts) — resolves the task's route + model from its
 *  Settings overrides and tags usage events with the task id, so each use case's
 *  cost is attributable. New use cases should prefer this over getModel(). */
export function getModelFor(task: AiTaskId) {
  const route = getRoute(getTaskRouteId(task));
  const modelId = getTaskModelId(task);
  return wrapLanguageModel({
    model: buildModel(route, modelId),
    middleware: recordingMiddleware(route.id, modelId, task),
  });
}

/** Cheap check: does the task's active route support native web search? Only the Anthropic SDK is
 *  wired (spec §4); OpenAI-native is blocked on the openai-compatible branch in buildModel. Used by
 *  the search registry's capability gate, so it must stay allocation-free (no model/tool built). */
export function isNativeSearchAvailable(task: AiTaskId): boolean {
  return getRoute(getTaskRouteId(task)).sdk === "anthropic";
}

/** The route-boundary seam for native search (spec §4): returns the route-bound model AND the
 *  web_search server tool, so the native provider never has to reach around getModelFor to the
 *  provider instance. The call still goes through Rust (the route fetch), so the key stays in the
 *  Keychain. Returns null when the active route has no native search. maxUses is capped to bound
 *  cost (search content inflates input tokens — spike §4). */
export function getNativeSearch(task: AiTaskId): { model: LanguageModel; tool: Tool } | null {
  const route = getRoute(getTaskRouteId(task));
  if (route.sdk !== "anthropic") return null;
  const fetch = makeRouteFetch(route.secretName, route.authScheme);
  const provider = createAnthropic({ apiKey: "route-managed", fetch, baseURL: route.baseURL });
  const modelId = getTaskModelId(task);
  const model = wrapLanguageModel({
    model: provider(modelId),
    middleware: recordingMiddleware(route.id, modelId, task),
  });
  const tool = provider.tools.webSearch_20250305({ maxUses: 3 }) as Tool;
  return { model, tool };
}
