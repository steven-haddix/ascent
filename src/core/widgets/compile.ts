// Widget source handling: pull the component out of the model's plain-text reply
// and compile its JSX to plain JS. Compilation is the first reliability gate —
// a syntax error here is fed back to the model for one retry (widget.ts).

/** Extract the widget component source from a model reply: the first fenced code
 *  block that defines `function Widget`, or the whole reply when the model sent
 *  bare code. Returns null when no such definition exists (a generation failure). */
export function extractWidgetSource(reply: string): string | null {
  const definesWidget = (s: string) => /function\s+Widget\s*\(/.test(s);
  const fences = [...reply.matchAll(/```[a-zA-Z]*[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  for (const f of fences) if (definesWidget(f)) return f.trim();
  if (fences.length === 0 && definesWidget(reply)) return reply.trim();
  return null;
}

/** Compile widget JSX/TS to plain JS (`React.createElement` calls — the sandbox
 *  provides the `React` global). Sucrase is lazy-loaded (like katex/mermaid) so
 *  the main bundle doesn't pay for it. Throws with the parser's message. */
export async function compileWidget(source: string): Promise<string> {
  const { transform } = await import("sucrase");
  return transform(source, { transforms: ["jsx", "typescript"], production: true }).code;
}
