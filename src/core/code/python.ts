// Python execution via Pyodide. Loaded lazily on the first Run (dynamic import +
// CDN assets) so the initial app bundle stays small and offline-capable — only the
// learners who actually run a snippet pay the ~10MB download once per session.
// Pyodide is fully sandboxed (no filesystem / network unless we bridge it; we don't).
import type { PyodideInterface } from "pyodide";

// The CDN folder must match the installed package version exactly.
const PYODIDE_VERSION = "0.29.4";
const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyodidePromise: Promise<PyodideInterface> | null = null;

/** Load (or return the already-loading promise for) the Pyodide runtime. Safe to
 *  call concurrently — every caller awaits the same singleton. */
export function loadPyodideRuntime(
  onProgress?: (msg: string) => void,
): Promise<PyodideInterface> {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      onProgress?.("Downloading Python runtime…");
      const { loadPyodide } = await import("pyodide");
      onProgress?.("Initializing…");
      const py = await loadPyodide({ indexURL: PYODIDE_INDEX_URL });
      onProgress?.("Ready.");
      return py;
    })();
  }
  return pyodidePromise;
}

export interface PythonResult {
  stdout: string;
  stderr: string;
  /** repr of the final expression, when it produced a value */
  result?: string;
  /** Python exception message, if execution raised */
  error?: string;
}

/** Run a Python snippet under the shared Pyodide runtime, capturing stdout, stderr,
 *  and the value of the final expression. Exceptions are returned as `error`
 *  rather than thrown so the UI can render them inline. */
export async function runPython(
  code: string,
  onProgress?: (msg: string) => void,
): Promise<PythonResult> {
  const py = await loadPyodideRuntime(onProgress);
  // Auto-load any Pyodide-bundled packages the snippet imports (numpy, pandas,
  // scipy, scikit-learn, sympy, matplotlib, …). Packages with no WASM build —
  // torch, tensorflow — simply aren't loaded here; the import then fails with a
  // clear ModuleNotFoundError that the UI explains.
  onProgress?.("Loading packages…");
  try {
    await py.loadPackagesFromImports(code);
  } catch {
    // a package may be unavailable / unfetchable — let it surface as an ImportError on run
  }
  onProgress?.("Running…");
  let stdout = "";
  let stderr = "";
  py.setStdout({ batched: (s: string) => (stdout += s + "\n") });
  py.setStderr({ batched: (s: string) => (stderr += s + "\n") });
  try {
    const value = await py.runPythonAsync(code);
    return {
      stdout,
      stderr,
      result: value === undefined || value === null ? undefined : String(value),
    };
  } catch (err) {
    return { stdout, stderr, error: err instanceof Error ? err.message : String(err) };
  }
}
