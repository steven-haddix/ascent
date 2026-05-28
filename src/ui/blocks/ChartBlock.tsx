import type { Block } from "../../core/types";

// Compact, dependency-free SVG charts (line / area / scatter / bar). Themed via
// token colors; tolerates partial/half-streamed series. Data is typically
// illustrative (the shape of a curve, a rough comparison), not precise.

const W = 640;
const H = 320;
const PAD = { top: 14, right: 16, bottom: 40, left: 52 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;
const SERIES_COLORS = ["var(--color-accent)", "#3b82f6", "#16a34a", "#a855f7", "#d97706"];

const fmt = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString() : Math.abs(n) < 1 ? n.toFixed(2) : n.toFixed(1);

interface CleanSeries {
  name?: string;
  points: { x: number | string; y: number }[];
}

function clean(block: Block): CleanSeries[] {
  return (block.series ?? [])
    .map((s) => ({
      name: s.name,
      points: (s.points ?? []).filter(
        (p) => p && typeof p.y === "number" && Number.isFinite(p.y) && p.x !== undefined && p.x !== null,
      ),
    }))
    .filter((s) => s.points.length > 0);
}

function Frame({ block, children, legend }: { block: Block; children: React.ReactNode; legend: CleanSeries[] }) {
  const showLegend = legend.length > 1 || (legend[0]?.name?.trim().length ?? 0) > 0;
  return (
    <figure className="my-6">
      {showLegend && (
        <div className="mb-1.5 flex flex-wrap justify-center gap-x-4 gap-y-1 font-sans text-[11.5px] text-ink-2">
          {legend.map((s, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
              {s.name || `Series ${i + 1}`}
            </span>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
        {children}
      </svg>
      {(block.title || block.xLabel || block.yLabel) && (
        <figcaption className="mt-1 text-center font-sans text-[11.5px] text-ink-3">{block.title}</figcaption>
      )}
    </figure>
  );
}

function YAxis({ yMin, yMax, yLabel }: { yMin: number; yMax: number; yLabel?: string }) {
  const ticks = 4;
  return (
    <>
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = yMin + ((yMax - yMin) * i) / ticks;
        const y = PAD.top + INNER_H - (INNER_H * i) / ticks;
        return (
          <g key={i}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="var(--color-rule)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y + 3} textAnchor="end" fontSize={10} fill="var(--color-ink-3)" fontFamily="var(--font-mono)">
              {fmt(v)}
            </text>
          </g>
        );
      })}
      {yLabel && (
        <text
          x={12}
          y={PAD.top + INNER_H / 2}
          textAnchor="middle"
          fontSize={10.5}
          fill="var(--color-ink-3)"
          fontFamily="var(--font-sans)"
          transform={`rotate(-90 12 ${PAD.top + INNER_H / 2})`}
        >
          {yLabel}
        </text>
      )}
    </>
  );
}

function XAxisLabel({ xLabel }: { xLabel?: string }) {
  if (!xLabel) return null;
  return (
    <text x={PAD.left + INNER_W / 2} y={H - 6} textAnchor="middle" fontSize={10.5} fill="var(--color-ink-3)" fontFamily="var(--font-sans)">
      {xLabel}
    </text>
  );
}

function BarChart({ block, series }: { block: Block; series: CleanSeries[] }) {
  const cats: string[] = [];
  for (const s of series) for (const p of s.points) if (!cats.includes(String(p.x))) cats.push(String(p.x));
  const ys = series.flatMap((s) => s.points.map((p) => p.y));
  const yMax = Math.max(0, ...ys);
  const yMin = Math.min(0, ...ys);
  const yScale = (y: number) => PAD.top + INNER_H - ((y - yMin) / (yMax - yMin || 1)) * INNER_H;
  const groupW = INNER_W / Math.max(cats.length, 1);
  const barW = (groupW * 0.72) / series.length;

  return (
    <Frame block={block} legend={series}>
      <YAxis yMin={yMin} yMax={yMax} yLabel={block.yLabel} />
      <line x1={PAD.left} y1={yScale(yMin)} x2={W - PAD.right} y2={yScale(yMin)} stroke="var(--color-rule-strong)" strokeWidth={1} />
      {cats.map((cat, ci) => (
        <g key={ci}>
          {series.map((s, si) => {
            const p = s.points.find((pt) => String(pt.x) === cat);
            if (!p) return null;
            const x = PAD.left + ci * groupW + groupW * 0.14 + si * barW;
            const y = yScale(p.y);
            return (
              <rect key={si} x={x} y={Math.min(y, yScale(0))} width={barW} height={Math.abs(yScale(0) - y)} fill={SERIES_COLORS[si % SERIES_COLORS.length]} rx={1.5} />
            );
          })}
          <text x={PAD.left + ci * groupW + groupW / 2} y={H - PAD.bottom + 14} textAnchor="middle" fontSize={10} fill="var(--color-ink-3)" fontFamily="var(--font-sans)">
            {cat.length > 10 ? `${cat.slice(0, 9)}…` : cat}
          </text>
        </g>
      ))}
      <XAxisLabel xLabel={block.xLabel} />
    </Frame>
  );
}

function XYChart({ block, series, type }: { block: Block; series: CleanSeries[]; type: "line" | "area" | "scatter" }) {
  const numericX = series.every((s) => s.points.every((p) => Number.isFinite(Number(p.x))));
  const xOf = (p: { x: number | string }, i: number) => (numericX ? Number(p.x) : i);
  const sorted = series.map((s) => ({
    ...s,
    pts: s.points.map((p, i) => ({ x: xOf(p, i), y: p.y, label: p.x })).sort((a, b) => a.x - b.x),
  }));
  const xs = sorted.flatMap((s) => s.pts.map((p) => p.x));
  const ys = sorted.flatMap((s) => s.pts.map((p) => p.y));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xScale = (x: number) => PAD.left + ((x - xMin) / (xMax - xMin || 1)) * INNER_W;
  const yScale = (y: number) => PAD.top + INNER_H - ((y - yMin) / (yMax - yMin || 1)) * INNER_H;
  const baseY = PAD.top + INNER_H;

  return (
    <Frame block={block} legend={series}>
      <YAxis yMin={yMin} yMax={yMax} yLabel={block.yLabel} />
      {sorted.map((s, si) => {
        const color = SERIES_COLORS[si % SERIES_COLORS.length];
        const path = s.pts.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p.x).toFixed(1)} ${yScale(p.y).toFixed(1)}`).join(" ");
        return (
          <g key={si}>
            {type === "area" && s.pts.length > 1 && (
              <path
                d={`${path} L${xScale(s.pts[s.pts.length - 1].x).toFixed(1)} ${baseY} L${xScale(s.pts[0].x).toFixed(1)} ${baseY} Z`}
                fill={color}
                opacity={0.12}
              />
            )}
            {type !== "scatter" && s.pts.length > 1 && <path d={path} fill="none" stroke={color} strokeWidth={2} />}
            {(type === "scatter" || s.pts.length === 1) &&
              s.pts.map((p, i) => <circle key={i} cx={xScale(p.x)} cy={yScale(p.y)} r={3} fill={color} />)}
          </g>
        );
      })}
      {/* x endpoints */}
      <text x={PAD.left} y={H - PAD.bottom + 14} textAnchor="start" fontSize={10} fill="var(--color-ink-3)" fontFamily="var(--font-mono)">
        {numericX ? fmt(xMin) : ""}
      </text>
      <text x={W - PAD.right} y={H - PAD.bottom + 14} textAnchor="end" fontSize={10} fill="var(--color-ink-3)" fontFamily="var(--font-mono)">
        {numericX ? fmt(xMax) : ""}
      </text>
      <XAxisLabel xLabel={block.xLabel} />
    </Frame>
  );
}

export function ChartBlock({ block }: { block: Block }) {
  const series = clean(block);
  if (series.length === 0) {
    return (
      <div className="my-6 rounded-md border border-dashed border-rule p-4 text-center font-sans text-[12px] text-ink-3">
        Preparing chart…
      </div>
    );
  }
  const type = block.chartType ?? "line";
  return type === "bar" ? <BarChart block={block} series={series} /> : <XYChart block={block} series={series} type={type} />;
}
