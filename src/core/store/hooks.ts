// Reactive read/write layer (TanStack Query over the repositories). The UI binds
// to these hooks, never to drizzle directly — keeping the swap-to-sync seam.
import { useEffect, useState } from "react";
import { QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { topicRepo, conceptRepo, lessonRepo, type ConceptRow } from "./repositories";
import { startTopic } from "../generation/outline";
import { generateLesson, type LessonContext, type PartialLesson } from "../generation/lesson";

export const queryClient = new QueryClient();

export const useTopics = (enabled = true) =>
  useQuery({ queryKey: ["topics"], queryFn: () => topicRepo.list(), enabled });

export const useConcepts = (topicId: string | null) =>
  useQuery({
    queryKey: ["concepts", topicId],
    queryFn: () => conceptRepo.byTopic(topicId as string),
    enabled: !!topicId,
  });

export function useStartTopic() {
  return useMutation({
    mutationFn: (title: string) => startTopic(title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["topics"] });
      queryClient.invalidateQueries({ queryKey: ["concepts"] });
    },
  });
}

/** Fork a new concept under a parent; resolves to the new concept id. */
export function useForkConcept() {
  return useMutation({
    mutationFn: async ({
      topicId,
      parentId,
      title,
      summary,
    }: {
      topicId: string;
      parentId: string;
      title: string;
      summary?: string;
    }) => {
      const id = crypto.randomUUID();
      const now = Date.now();
      await conceptRepo.create({
        id,
        topicId,
        parentId,
        title,
        summary: summary ?? null, // a forked term's gloss / branch reason = its lesson focus
        status: "queued",
        state: "outline",
        order: now, // append after existing siblings
        mastery: 0,
        remedial: false,
        createdAt: now,
      });
      return id;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["concepts"] }),
  });
}

/** A concept's lesson: fetched if present, generated on first visit.
 *  Render LessonPane with key={concept.id} so this hook's state is per-concept. */
export function useConceptLesson(concept: ConceptRow | null, ctx: LessonContext) {
  const lesson = useQuery({
    queryKey: ["lesson", concept?.id],
    // map drizzle's `undefined` (no row) to null — TanStack Query forbids undefined.
    queryFn: async () => (await lessonRepo.get(concept!.id)) ?? null,
    enabled: !!concept,
  });

  const [partial, setPartial] = useState<PartialLesson | null>(null);
  const gen = useMutation({
    mutationFn: () => generateLesson(concept!, ctx, (p) => setPartial(p)),
    onSuccess: (row) => {
      // Write straight into the cache so the final lesson renders instantly.
      setPartial(null);
      queryClient.setQueryData(["lesson", concept?.id], row);
      queryClient.invalidateQueries({ queryKey: ["concepts"] });
    },
    onError: () => setPartial(null),
  });

  useEffect(() => {
    if (concept && lesson.isFetched && lesson.data === null && !gen.isPending && !gen.isError) {
      gen.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [concept?.id, lesson.isFetched, lesson.data]);

  return {
    lesson: lesson.data ?? null,
    partial,
    generating: gen.isPending,
    error: gen.error ? ((gen.error as Error).message ?? String(gen.error)) : null,
    retry: () => gen.mutate(),
  };
}
