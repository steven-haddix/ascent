// Parent-side widget sandbox plumbing: load the prebuilt runtime bundle, read
// the current theme's design tokens, and assemble the iframe srcdoc. The srcdoc
// is identical for every widget — the compiled code + tokens travel over
// postMessage after the frame signals ready — so the assembled string is built
// once per runtime load.

/** Theme custom properties forwarded into the sandbox so generated code can
 *  style with var(--color-…) and match the app (re-sent on theme switch). */
const TOKEN_PROPS = [
  "--color-surface",
  "--color-surface-2",
  "--color-ink",
  "--color-ink-2",
  "--color-ink-3",
  "--color-ink-4",
  "--color-rule",
  "--color-rule-strong",
  "--color-accent",
  "--font-sans",
  "--font-serif",
];

export function readWidgetTokens(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  for (const p of TOKEN_PROPS) {
    const v = cs.getPropertyValue(p).trim();
    if (v) out[p] = v;
  }
  return out;
}

/** The scheme the sandbox document must declare. An embedded document whose
 *  color-scheme mismatches the parent's gets an OPAQUE white canvas painted
 *  behind it (the "white widget in dark mode" bug) — transparency only works
 *  when both agree. */
export function readColorScheme(): "dark" | "light" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

let runtimePromise: Promise<string> | null = null;

/** Fetch public/widget-runtime.js once (built by `bun run build:widget-runtime`,
 *  which the dev/build scripts run). A miss is a build-setup error, surfaced on
 *  the widget card; the cache is cleared so a later mount can try again. */
export function loadWidgetRuntime(): Promise<string> {
  runtimePromise ??= fetch("/widget-runtime.js")
    .then(async (r) => {
      const text = r.ok ? await r.text() : "";
      if (!text || text.trimStart().startsWith("<")) {
        throw new Error("widget runtime missing — run `bun run build:widget-runtime` (the dev/build scripts do this)");
      }
      return text;
    })
    .catch((err) => {
      runtimePromise = null;
      throw err;
    });
  return runtimePromise;
}

/** The sandbox document. Inline classic script (no module/CORS concerns in dev or
 *  behind Tauri's protocol); `</script` inside the bundle is split so it can't
 *  close the tag early. The CURRENT theme's tokens + color-scheme are baked into
 *  the document so the first paint already matches the app (no white flash, no
 *  mismatched-scheme backdrop); later theme switches re-arrive over postMessage.
 *  The body paints var(--color-surface) itself — same as the card it sits in —
 *  rather than relying on iframe transparency. */
export function buildWidgetSrcdoc(
  runtime: string,
  tokens: Record<string, string>,
  colorScheme: "dark" | "light",
): string {
  const safe = runtime.replace(/<\/script/gi, "<\\/script");
  // Values come from our own stylesheet; the angle-bracket strip just makes
  // breaking out of the <style> tag impossible regardless.
  const vars = Object.entries(tokens)
    .map(([k, v]) => `${k}: ${v.replace(/[<>]/g, "")};`)
    .join(" ");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { color-scheme: ${colorScheme}; ${vars} }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { background: var(--color-surface, transparent); color: var(--color-ink, #1a1815); font-family: var(--font-sans, system-ui), sans-serif; font-size: 14px; }
</style>
</head>
<body>
<div id="root"></div>
<script>${safe}</script>
</body>
</html>`;
}
