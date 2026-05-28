import type { Block } from "../../core/types";
import { useMermaid } from "./useMermaid";

/** A Mermaid diagram rendered inline. While mermaid loads it shows a placeholder;
 *  on a parse error (including mid-stream partial specs) it falls back to the
 *  diagram source so nothing breaks. Re-renders when the theme changes. */
export function DiagramBlock({ block }: { block: Block }) {
  const spec = block.text ?? "";
  const themeKey = document.documentElement.dataset.theme ?? "cream";
  const { svg, error } = useMermaid(spec, themeKey);

  if (error) {
    return (
      <figure className="my-6 overflow-hidden rounded-md border border-rule">
        <div className="border-b border-rule bg-surface-2 px-3 py-1 font-sans text-[10.5px] uppercase tracking-wider text-ink-3">
          diagram source
        </div>
        <pre className="m-0 overflow-auto px-4 py-3 font-mono text-[12px] leading-[1.5] text-ink-2">{spec}</pre>
        {block.title && (
          <figcaption className="border-t border-rule px-4 py-1.5 text-center font-sans text-[11.5px] text-ink-3">
            {block.title}
          </figcaption>
        )}
      </figure>
    );
  }

  return (
    <figure className="my-6 flex flex-col items-center">
      {svg ? (
        <div
          className="ascent-diagram w-full [&>svg]:mx-auto [&>svg]:h-auto [&>svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="flex items-center gap-2 py-6 font-sans text-[12px] text-ink-3">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          Rendering diagram…
        </div>
      )}
      {block.title && (
        <figcaption className="mt-1.5 text-center font-sans text-[11.5px] text-ink-3">{block.title}</figcaption>
      )}
    </figure>
  );
}
