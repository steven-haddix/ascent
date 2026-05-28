// Mermaid render core — isolated so the (large) mermaid library lands in a lazily
// imported chunk; only lessons with a diagram pay for it. Themed from our CSS
// tokens, re-read on each render so a runtime theme switch is reflected.
import mermaid from "mermaid";

let counter = 0;

function themeVariables(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    background: v("--color-surface"),
    primaryColor: v("--color-surface-2"),
    primaryBorderColor: v("--color-rule-strong"),
    primaryTextColor: v("--color-ink"),
    secondaryColor: v("--color-surface"),
    tertiaryColor: v("--color-surface"),
    lineColor: v("--color-ink-3"),
    textColor: v("--color-ink-2"),
    fontFamily: v("--font-sans") || "sans-serif",
    fontSize: "14px",
  };
}

/** Render a Mermaid spec to an SVG string. Throws on a parse error (the caller
 *  falls back to showing the source). securityLevel "strict" sanitizes the spec. */
export async function renderMermaid(spec: string): Promise<string> {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: themeVariables(),
  });
  const { svg } = await mermaid.render(`ascent-mermaid-${counter++}`, spec);
  return svg;
}
