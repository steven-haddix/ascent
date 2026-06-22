import { useEffect, useState } from "react";
import type { Block } from "../../core/types";
import { isMapBlock } from "../../core/visuals/guards";

// App-layer geographic map. The model emits DATA (a projection + marks); we render the
// basemap with d3-geo + bundled world-atlas TopoJSON (lazy-loaded) and project the marks.
// The model never emits geometry. v1 renders the world basemap + pins; region choropleth
// + US states are reserved (would add us-atlas).
const W = 720;
const H = 420;

interface RenderedMap {
  countries: string[];
  pins: { x: number; y: number; label?: string }[];
}

export function MapBlock({ block }: { block: Block }) {
  const valid = isMapBlock(block) && block.marks.length > 0;
  const sig = valid ? JSON.stringify([block.projection, block.marks]) : "";
  const [rendered, setRendered] = useState<RenderedMap | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isMapBlock(block) || block.marks.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const [{ geoPath, geoNaturalEarth1, geoMercator }, topojson, atlasMod] = await Promise.all([
          import("d3-geo"),
          import("topojson-client"),
          import("world-atlas/countries-110m.json"),
        ]);
        const topo = ((atlasMod as { default?: unknown }).default ?? atlasMod) as {
          objects: { countries: unknown };
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fc = topojson.feature(topo as any, topo.objects.countries as any) as unknown as {
          features: unknown[];
        };
        const projection = (block.projection === "mercator" ? geoMercator() : geoNaturalEarth1()).fitSize(
          [W, H],
          fc as never,
        );
        const path = geoPath(projection);
        const countries = (fc.features as never[]).map((f) => path(f) ?? "").filter(Boolean);
        const pins: { x: number; y: number; label?: string }[] = [];
        for (const m of block.marks) {
          if (m.kind !== "pin" || !Array.isArray(m.coords)) continue;
          const xy = projection(m.coords as [number, number]);
          if (xy) pins.push({ x: xy[0], y: xy[1], label: m.label });
        }
        if (!cancelled) setRendered({ countries, pins });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sig, block]);

  if (!valid) {
    return (
      <div className="my-6 rounded-md border border-dashed border-rule p-4 text-center font-sans text-[12px] text-ink-3">
        Preparing map…
      </div>
    );
  }
  if (failed) {
    return (
      <div className="my-6 rounded-md border border-dashed border-rule p-4 text-center font-sans text-[12px] text-ink-3">
        {block.alt || "Map unavailable."}
      </div>
    );
  }

  return (
    <figure className="my-6 font-sans" role="img" aria-label={block.alt || block.title || "Map"}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {rendered?.countries.map((d, i) => (
          <path key={i} d={d} fill="var(--color-surface-2)" stroke="var(--color-rule)" strokeWidth={0.5} />
        ))}
        {rendered?.pins.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={4} fill="var(--color-accent)" stroke="var(--color-surface)" strokeWidth={1} />
            {p.label && (
              <text x={p.x} y={p.y - 7} textAnchor="middle" fontSize={11} fill="var(--color-ink)" fontFamily="var(--font-sans)" style={{ paintOrder: "stroke", stroke: "var(--color-surface)", strokeWidth: 2 }}>
                {p.label}
              </text>
            )}
          </g>
        ))}
        {!rendered && (
          <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={12} fill="var(--color-ink-3)" fontFamily="var(--font-sans)">
            Loading map…
          </text>
        )}
      </svg>
      {block.title && <figcaption className="mt-1 text-center text-[11.5px] text-ink-3">{block.title}</figcaption>}
    </figure>
  );
}
