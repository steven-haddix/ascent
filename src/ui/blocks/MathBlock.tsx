import type { Block } from "../../core/types";
import { useMath } from "./useMath";

/** A display (block-level) equation, centered. Shows raw LaTeX until KaTeX loads. */
export function MathBlock({ block }: { block: Block }) {
  const tex = block.text ?? "";
  const html = useMath(tex, true);
  return (
    <figure className="my-5 overflow-x-auto">
      {html ? (
        <div className="text-center text-ink" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="m-0 text-center font-mono text-[13px] text-ink-2">{tex}</pre>
      )}
      {block.title && (
        <figcaption className="mt-1.5 text-center font-sans text-[11.5px] text-ink-3">{block.title}</figcaption>
      )}
    </figure>
  );
}

/** Inline math inside a paragraph ($…$). Shows raw LaTeX until KaTeX loads. */
export function InlineMath({ tex }: { tex: string }) {
  const html = useMath(tex, false);
  return html ? (
    <span dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <span className="font-mono text-[0.9em] text-ink-2">{tex}</span>
  );
}
