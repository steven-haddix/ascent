import { useQuery } from "@tanstack/react-query";
import { documentRepo, sourceRefRepo } from "../core/store/repositories";
import { DocumentSourceRow, documentMarker } from "./DocumentSourceRow";

/** The lesson's provenance footer: the library documents this generation ACTUALLY
 *  drew on (lesson_source_refs — snapshotted post-stream, not "everything in the
 *  library"). Renders nothing when the lesson used no library sources. */
export function SourcesUsed({ conceptId }: { conceptId: string }) {
  const q = useQuery({
    queryKey: ["sourceRefs", conceptId],
    queryFn: async () => {
      const refs = await sourceRefRepo.listByConcept(conceptId);
      const out = [];
      for (const ref of refs.sort((a, b) => a.rank - b.rank)) {
        const doc = await documentRepo.get(ref.documentId);
        if (doc) out.push({ ref, doc });
      }
      return out;
    },
  });
  const rows = q.data ?? [];
  if (!rows.length) return null;

  return (
    <div data-find-ignore className="mt-8 border-t border-rule pt-3">
      <span className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-ink-4">
        Sources used
      </span>
      <ul className="mt-2 flex flex-col gap-1.5">
        {rows.map(({ ref, doc }) => {
          const locators = (ref.locators as string[]).filter(Boolean).join(", ");
          return (
            <li key={doc.id}>
              <DocumentSourceRow
                marker={documentMarker(doc.mime, doc.kind)}
                title={doc.title}
                url={doc.url}
                detail={locators ? `Cited in this lesson · ${locators}` : "Cited in this lesson"}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
