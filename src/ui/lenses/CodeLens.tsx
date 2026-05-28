import { useQuery } from "@tanstack/react-query";
import { lessonRepo } from "../../core/store/repositories";
import type { Block } from "../../core/types";
import { CodeRunner } from "../code/CodeRunner";
import type { LensProps } from "./types";

/** The Code lens: collects every `code` block from the current lesson and renders
 *  each as an editable + runnable snippet. Python runs locally via Pyodide. The
 *  lens tab is only declared by lessons that actually contain code (see lesson.ts
 *  lenses derivation), so an empty state here is a rare edge. */
export function CodeLens({ concept }: LensProps) {
  // Shares the ["lesson", id] cache with the center pane — no extra fetch.
  const lesson = useQuery({
    queryKey: ["lesson", concept.id],
    queryFn: async () => (await lessonRepo.get(concept.id)) ?? null,
  });

  const blocks = (lesson.data?.blocks as Block[] | undefined) ?? [];
  const codeBlocks = blocks.filter(
    (b) => b.kind === "code" && typeof b.text === "string" && b.text.trim().length > 0,
  );

  if (codeBlocks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-8 text-center">
        <p className="text-sm text-ink-2">No runnable code in this lesson.</p>
        <p className="max-w-[28ch] text-[12px] text-ink-3">
          The Code tab appears for lessons that include code snippets.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <p className="text-[11.5px] text-ink-3">
        Tweak any snippet and Run it locally. First run downloads Python (~10MB) and takes a
        few seconds; after that it's instant.
      </p>
      {codeBlocks.map((b, i) => (
        <CodeRunner key={i} code={b.text ?? ""} language={b.language ?? "python"} title={b.title} />
      ))}
    </div>
  );
}
