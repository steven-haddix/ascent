// Lightweight namespaced console logging for the generation/streaming pipeline.
// On by default; silence it at runtime with:  localStorage.setItem("ascent-debug","off")
// Filter the console by "[ascent:" to see only these.
function enabled(): boolean {
  try {
    return localStorage.getItem("ascent-debug") !== "off";
  } catch {
    return true;
  }
}

export function dlog(ns: string, ...args: unknown[]): void {
  if (enabled()) console.log(`%c[ascent:${ns}]`, "color:#c4622d;font-weight:600", ...args);
}

function fmt(a: unknown): string {
  if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`;
  if (typeof a === "string") return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

/** Error-level logging for genuine failures. ALWAYS emits (independent of the
 *  ascent-debug flag), to two places a dev can reliably find:
 *   1. the webview console via console.error (shows under an "Errors" filter), and
 *   2. the Rust process stderr via `frontend_log`, so it lands in the `tauri dev`
 *      terminal without opening the web inspector.
 *  UI surfaces stay GENERIC — the detail belongs in the log, not the user's face.
 *  Never throws (the Tauri invoke is best-effort; absent in tests/browser). */
export function derror(ns: string, ...args: unknown[]): void {
  console.error(`[ascent:${ns}]`, ...args);
  try {
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("frontend_log", { level: "error", scope: ns, message: args.map(fmt).join(" ") }))
      .catch(() => {});
  } catch {
    /* non-Tauri env — console.error already emitted */
  }
}

/** Milliseconds since some origin, for relative timing in logs. */
export function now(): number {
  return performance.now();
}

/** Format an elapsed time from a start mark. */
export function since(t0: number): string {
  return `${(performance.now() - t0).toFixed(0)}ms`;
}
