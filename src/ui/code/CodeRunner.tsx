import { useEffect, useState } from "react";
import { HighlightedCode } from "./HighlightedCode";
import { runPython, type PythonResult } from "../../core/code/python";

/** A single snippet in the Code lens: edit it, run it (Python only in v1), see
 *  stdout / stderr / the final expression / Python errors. The output panel and
 *  loading note appear below the code on demand. */
export function CodeRunner({
  code: initial,
  language,
  title,
}: {
  code: string;
  language: string;
  title?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(initial);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [output, setOutput] = useState<PythonResult | null>(null);

  // The chat agent (setLessonCode) can replace this snippet in place. `code` was
  // seeded from `initial` only on mount, so when the incoming snippet changes,
  // resync the editor buffer and drop stale output — otherwise the runner keeps
  // showing/running the old code. User edits to an unchanged snippet are untouched.
  useEffect(() => {
    setCode(initial);
    setOutput(null);
    setEditing(false);
  }, [initial]);

  const canRun = language.toLowerCase() === "python" || language.toLowerCase() === "py";

  const run = async () => {
    setRunning(true);
    setOutput(null);
    setProgress("Loading Python…");
    try {
      const result = await runPython(code, (msg) => setProgress(msg));
      setOutput(result);
    } catch (err) {
      setOutput({
        stdout: "",
        stderr: "",
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  return (
    <div className="overflow-hidden rounded-md border border-rule">
      <div className="flex items-center justify-between gap-3 border-b border-rule bg-surface-2 px-3 py-1.5 font-sans">
        <span className="flex min-w-0 flex-col gap-0.5">
          {title?.trim() ? (
            <>
              <span className="truncate text-[12.5px] font-medium text-ink-2">{title.trim()}</span>
              <span className="text-[9.5px] uppercase tracking-wider text-ink-3">{language}</span>
            </>
          ) : (
            <span className="text-[10.5px] uppercase tracking-wider text-ink-3">{language}</span>
          )}
        </span>
        <div className="flex shrink-0 items-center gap-2 uppercase tracking-wider">
          <button
            onClick={() => setEditing((v) => !v)}
            className="rounded px-2 py-0.5 text-[10.5px] tracking-wider text-ink-3 hover:bg-surface hover:text-ink"
          >
            {editing ? "Done" : "Edit"}
          </button>
          {canRun ? (
            <button
              onClick={run}
              disabled={running}
              className="rounded bg-ink px-2.5 py-0.5 text-[10.5px] uppercase tracking-wider text-surface hover:bg-accent disabled:opacity-50"
            >
              {running ? "Running…" : "▶ Run"}
            </button>
          ) : (
            <span
              title="Only Python is runnable in v1"
              className="text-[10.5px] italic text-ink-3"
            >
              read-only
            </span>
          )}
        </div>
      </div>

      {editing ? (
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          rows={Math.max(5, code.split("\n").length + 1)}
          className="block w-full resize-y border-0 bg-surface p-3 font-mono text-[12.5px] leading-[1.55] text-ink outline-none"
        />
      ) : (
        <HighlightedCode code={code} language={language} />
      )}

      {progress && (
        <div className="flex items-center gap-2 border-t border-rule bg-surface-2 px-3 py-1.5 font-sans text-[11px] text-ink-3">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          {progress}
        </div>
      )}

      {output && <OutputPanel output={output} />}
    </div>
  );
}

function OutputPanel({ output }: { output: PythonResult }) {
  const empty =
    !output.stdout && !output.stderr && !output.error && output.result === undefined;
  return (
    <div className="border-t border-rule bg-surface p-3 font-mono text-[12px] leading-relaxed">
      {output.stdout && <pre className="m-0 whitespace-pre-wrap text-ink-2">{output.stdout}</pre>}
      {output.stderr && (
        <pre className="m-0 whitespace-pre-wrap text-amber-700">{output.stderr}</pre>
      )}
      {output.error && <pre className="m-0 whitespace-pre-wrap text-red-600">{output.error}</pre>}
      {output.error && /ModuleNotFoundError|ImportError/.test(output.error) && (
        <p className="mt-2 font-sans text-[11px] leading-relaxed text-ink-3">
          That package isn't available in the in-browser Python runtime. Runnable snippets can use
          the standard library plus numpy, pandas, scipy, scikit-learn, sympy, and matplotlib.
        </p>
      )}
      {output.result !== undefined && (
        <div className="mt-1.5 border-t border-rule pt-1.5 text-ink-3">
          <span className="mr-2 text-[10.5px] uppercase tracking-wider">↳</span>
          <span className="text-ink-2">{output.result}</span>
        </div>
      )}
      {empty && <span className="text-ink-3">(no output)</span>}
    </div>
  );
}
