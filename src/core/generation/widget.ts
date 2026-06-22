// Widget builder — the cheaper subagent that turns a placeholder's spec into a
// working component. Plain-text generation (NOT structured output: code inside
// JSON strings degrades, and big schemas are the known stall risk), extracted
// from the reply and compiled with sucrase. The compile error, if any, is the
// caller's to feed back for a retry (widgetJobs.ts owns the loop).
import { generateText } from "ai";
import { getModelFor } from "../ai/service";
import { dlog, since } from "../debug";
import { extractWidgetSource, compileWidget } from "../widgets/compile";

export interface WidgetGenInput {
  conceptTitle: string;
  /** topic + path context when available (lesson stream has it; retry may not) */
  topicTitle?: string;
  path?: string[];
  title: string;
  spec: string;
  /** the previous attempt's source — set when iterating via chat "replace" */
  prevSource?: string;
  /** the previous attempt's compile/render error — set on retry */
  priorError?: string;
  signal?: AbortSignal;
}

const CONTRACT = `RULES (the runtime is unforgiving — follow exactly):
- Define exactly ONE top-level \`function Widget()\` returning JSX. No other top-level statements
  except small helper functions/constants it uses.
- NO imports, NO exports, NO require. \`React\` is in scope as a global — use hooks as
  \`React.useState\`, \`React.useMemo\`, etc. (do NOT destructure at top level via import).
- \`d3\` is also in scope as a global (a lean subset: d3-scale, d3-shape, d3-array, d3-force)
  for MATH/LAYOUT only — e.g. \`d3.scaleLinear()\`, \`d3.line()\`, \`d3.forceSimulation()\`. Render
  with React + inline SVG as usual; never let d3 touch the DOM. Most widgets need no d3 — reach
  for it only for genuinely novel interaction (e.g. a draggable force layout).
- Self-contained: no fetch/XHR, no window.parent/top, no localStorage, no external assets,
  images, or fonts. All data is computed or inlined.
- Style with inline style objects. These CSS custom properties are defined and match the app
  theme — use them instead of hardcoded colors: var(--color-surface), var(--color-surface-2),
  var(--color-ink) (text), var(--color-ink-2), var(--color-ink-3) (muted), var(--color-rule)
  (borders), var(--color-accent) (highlight). Background is already the app's; don't paint a
  page background.
- Draw visuals with inline SVG, not canvas. Keep the whole widget under ~480px tall; it fills
  the available width.
- Native inputs (range sliders, buttons) are fine; label every control and show current values.
- When a visual encodes values (heatmap cells, bars, points), expose the numbers: render them
  inline when they fit, or drive a visible readout element from hover/click state (e.g. a line
  under the chart showing "score[2][3] = 0.412"). NEVER use native tooltips — \`title\`
  attributes and SVG \`<title>\` elements do NOT appear in this environment.
- No try/catch around the whole component, no console noise, no TODOs — finished code only.

Reply with ONLY the component in a single fenced code block:
\`\`\`jsx
function Widget() {
  ...
}
\`\`\``;

/** One generation attempt: prompt → extract → compile. Throws (with a message
 *  meant to be model-readable) on extraction or compile failure. */
export async function generateWidget(
  input: WidgetGenInput,
): Promise<{ source: string; compiled: string }> {
  const t0 = performance.now();
  const where = input.topicTitle
    ? `the topic "${input.topicTitle}"${input.path?.length ? ` (${input.path.join(" > ")})` : ""}`
    : `a learning app`;
  const revise = input.prevSource
    ? `\n\nThe learner is iterating on an existing widget. Its current source:\n\`\`\`jsx\n${input.prevSource}\n\`\`\`\nRebuild it to satisfy the new spec — keep what still applies.`
    : "";
  const retry = input.priorError
    ? `\n\nYour previous attempt FAILED with this error — fix it:\n${input.priorError}`
    : "";

  dlog("widget", "gen start:", input.title);
  const { text } = await generateText({
    model: getModelFor("widget"),
    abortSignal: input.signal,
    prompt: `You build one small interactive React widget that will be embedded inline in a lesson
about "${input.conceptTitle}" within ${where}. A learner manipulates it to feel an idea, not just
read it. You see only this brief, so make the widget self-explanatory.

Widget title: ${input.title}
What it must do (the spec): ${input.spec}

${CONTRACT}${revise}${retry}`,
  });

  const source = extractWidgetSource(text);
  if (!source) {
    throw new Error("reply did not contain a fenced code block defining `function Widget()`");
  }
  const compiled = await compileWidget(source);
  dlog("widget", "gen ok:", input.title, "@", since(t0));
  return { source, compiled };
}
