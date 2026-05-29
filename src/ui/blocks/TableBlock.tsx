import type { Block } from "../../core/types";
import { RichText } from "./RichText";

/** A comparison / structured-fact table. Styled to the theme tokens. Tolerates
 *  ragged rows that arrive mid-stream by padding to the header count. */
export function TableBlock({ block }: { block: Block }) {
  const headers = block.headers ?? [];
  const rows = block.rows ?? [];
  const cols = Math.max(headers.length, ...rows.map((r) => r.length), 1);

  return (
    <figure className="my-6 overflow-x-auto">
      <table className="w-full border-collapse text-left font-sans text-[13.5px]">
        {headers.length > 0 && (
          <thead>
            <tr className="border-b border-rule-strong">
              {Array.from({ length: cols }, (_, i) => (
                <th key={i} className="px-3 py-2 font-semibold text-ink">
                  <RichText text={headers[i] ?? ""} keyPrefix={`h${i}`} />
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b border-rule last:border-0">
              {Array.from({ length: cols }, (_, c) => (
                <td key={c} className="px-3 py-2 align-top text-ink-2">
                  <RichText text={row[c] ?? ""} keyPrefix={`r${r}c${c}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {block.title && (
        <figcaption className="mt-1.5 text-center font-sans text-[11.5px] text-ink-3">{block.title}</figcaption>
      )}
    </figure>
  );
}
