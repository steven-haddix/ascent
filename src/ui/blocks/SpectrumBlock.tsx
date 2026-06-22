import type { Block } from "../../core/types";
import { isSpectrumBlock } from "../../core/visuals/guards";

// Native, dependency-free SVG spectrum: items placed along a continuum (a political
// spectrum, a scale, a gradient of positions). Model emits {axis, items}; we render
// deterministically. Labels alternate above/below the axis to reduce overlap.
const W = 660;
const H = 132;
const PADX = 28;
const AXIS_Y = 66;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function SpectrumBlock({ block }: { block: Block }) {
  if (!isSpectrumBlock(block) || block.items.length === 0) {
    return (
      <div className="my-6 rounded-md border border-dashed border-rule p-4 text-center font-sans text-[12px] text-ink-3">
        Preparing spectrum…
      </div>
    );
  }
  const { min, max } = block.axis;
  const span = max - min || 1;
  const endLabels = block.axis.labels ?? [];
  const xOf = (at: number) => PADX + ((clamp(at, min, max) - min) / span) * (W - 2 * PADX);

  return (
    <figure className="my-6 font-sans" role="img" aria-label={block.alt || block.title || "Spectrum"}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {/* axis */}
        <line x1={PADX} y1={AXIS_Y} x2={W - PADX} y2={AXIS_Y} stroke="var(--color-rule-strong)" strokeWidth={1.5} />
        {/* end caps */}
        {[min, max].map((v, i) => (
          <line key={i} x1={xOf(v)} y1={AXIS_Y - 5} x2={xOf(v)} y2={AXIS_Y + 5} stroke="var(--color-rule-strong)" strokeWidth={1.5} />
        ))}
        {/* end labels (or numeric endpoints) */}
        <text x={PADX} y={AXIS_Y + 22} textAnchor="start" fontSize={11} fill="var(--color-ink-3)" fontFamily="var(--font-sans)">
          {endLabels[0] ?? String(min)}
        </text>
        <text x={W - PADX} y={AXIS_Y + 22} textAnchor="end" fontSize={11} fill="var(--color-ink-3)" fontFamily="var(--font-sans)">
          {endLabels[endLabels.length - 1] ?? String(max)}
        </text>
        {/* items: dot on the axis, label staggered above (even) / below (odd) */}
        {block.items.map((it, i) => {
          const x = xOf(it.at);
          const above = i % 2 === 0;
          const labelY = above ? AXIS_Y - 14 : AXIS_Y + 36;
          const anchor = x < PADX + 40 ? "start" : x > W - PADX - 40 ? "end" : "middle";
          return (
            <g key={i}>
              <circle cx={x} cy={AXIS_Y} r={4} fill="var(--color-accent)" />
              {above && <line x1={x} y1={AXIS_Y - 4} x2={x} y2={AXIS_Y - 11} stroke="var(--color-rule-strong)" strokeWidth={1} />}
              {!above && <line x1={x} y1={AXIS_Y + 4} x2={x} y2={AXIS_Y + 22} stroke="var(--color-rule-strong)" strokeWidth={1} />}
              <text x={x} y={labelY} textAnchor={anchor} fontSize={12} fill="var(--color-ink)" fontFamily="var(--font-sans)">
                {it.label.length > 22 ? `${it.label.slice(0, 21)}…` : it.label}
              </text>
            </g>
          );
        })}
      </svg>
      {block.title && <figcaption className="mt-1 text-center text-[11.5px] text-ink-3">{block.title}</figcaption>}
    </figure>
  );
}
