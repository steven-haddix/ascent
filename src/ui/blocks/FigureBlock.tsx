import type { Block } from "../../core/types";
import { isFigureBlock } from "../../core/visuals/guards";

// Native labeled-figure block (Visual §4 `figure`) — THE humanities primitive: a base
// vector scene the model draws (viewBox 0 0 100 100) with callout labels pointing at
// parts. A provider-sourced image (`mediaId`) is the Wave-5 path; v1 is vector-first.
//
// The base SVG is model-authored (trusted, like Mermaid output) but sanitized
// defensively before inlining — strip <script>/<foreignObject>/event handlers/js: urls.
function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "");
}

export function FigureBlock({ block }: { block: Block }) {
  if (!isFigureBlock(block) || !block.figure.svg) {
    // mediaId-only figures resolve via the media job (Wave 5); until then, or when the
    // model emitted no svg, fall back to the alt text rather than an empty frame.
    return (
      <div className="my-6 rounded-md border border-dashed border-rule p-4 text-center font-sans text-[12px] text-ink-3">
        {block.alt || "Preparing figure…"}
      </div>
    );
  }
  const svg = sanitizeSvg(block.figure.svg);
  const labels = block.labels ?? [];
  return (
    <figure className="my-6 font-sans" role="img" aria-label={block.alt || block.title || "Figure"}>
      <div className="relative mx-auto max-w-[520px]">
        {/* base vector scene (model-drawn, sanitized); forced to fill its box */}
        <div className="[&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
        {/* callout labels, aligned to the base's 0..100 viewBox */}
        {labels.length > 0 && (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
            {labels.map((l, i) => {
              const anchor = l.at.x < 18 ? "start" : l.at.x > 82 ? "end" : "middle";
              return (
                <g key={i}>
                  <circle cx={l.at.x} cy={l.at.y} r={1.4} fill="var(--color-accent)" />
                  <text
                    x={l.at.x}
                    y={l.at.y < 8 ? l.at.y + 5 : l.at.y - 3}
                    textAnchor={anchor}
                    fontSize={3.6}
                    fill="var(--color-ink)"
                    fontFamily="var(--font-sans)"
                    style={{ paintOrder: "stroke", stroke: "var(--color-surface)", strokeWidth: 0.8 }}
                  >
                    {l.text}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
      {block.title && <figcaption className="mt-1 text-center text-[11.5px] text-ink-3">{block.title}</figcaption>}
    </figure>
  );
}
