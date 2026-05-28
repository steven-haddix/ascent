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

/** Milliseconds since some origin, for relative timing in logs. */
export function now(): number {
  return performance.now();
}

/** Format an elapsed time from a start mark. */
export function since(t0: number): string {
  return `${(performance.now() - t0).toFixed(0)}ms`;
}
