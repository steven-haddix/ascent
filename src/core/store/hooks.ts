// Reactive read/write layer (TanStack Query over the repositories). The UI binds
// to these hooks, never to drizzle directly — keeping the swap-to-sync seam.
import { useEffect, useState } from "react";
import { QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import {
  topicRepo,
  conceptRepo,
  lessonRepo,
  chatRepo,
  noteRepo,
  teachRepo,
  type ConceptRow,
} from "./repositories";
import { startTopic } from "../generation/outline";
import { generateLesson, type LessonContext, type PartialLesson } from "../generation/lesson";
import { chat, type ChatContext } from "../generation/tutor";
import { generateQuiz, type QuizQuestion } from "../generation/quiz";
import { gradeTeachBack, scoreFromRubric, type TeachContext } from "../generation/teachback";
import type { TeachAudience } from "../types";
import { getTutorMode } from "../settings";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

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

/** Branch-grounded chat for a concept: persisted turns + a streamed reply. */
export function useChat(concept: ConceptRow | null, ctx: ChatContext) {
  const turns = useQuery({
    queryKey: ["chat", concept?.id],
    queryFn: () => chatRepo.byConcept(concept!.id),
    enabled: !!concept,
  });
  const [streaming, setStreaming] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const send = async (message: string) => {
    const text = message.trim();
    if (!concept || sending || !text) return;
    const cid = concept.id;
    const history = (turns.data ?? []).map((t) => ({ role: t.role, text: t.text }));
    setSending(true);
    setStreaming("");
    try {
      await chatRepo.append({ id: crypto.randomUUID(), conceptId: cid, role: "user", text, createdAt: Date.now() });
      queryClient.invalidateQueries({ queryKey: ["chat", cid] });
      const reply = await chat(concept, ctx, history, getTutorMode(), text, (d) =>
        setStreaming((s) => (s ?? "") + d),
      );
      await chatRepo.append({ id: crypto.randomUUID(), conceptId: cid, role: "ai", text: reply, createdAt: Date.now() });
    } catch {
      await chatRepo.append({
        id: crypto.randomUUID(),
        conceptId: cid,
        role: "ai",
        text: "(tutor offline — try again)",
        createdAt: Date.now(),
      });
    } finally {
      setStreaming(null);
      setSending(false);
      queryClient.invalidateQueries({ queryKey: ["chat", cid] });
    }
  };

  return { turns: turns.data ?? [], streaming, sending, send };
}

/** Notes for a concept. */
export const useNotes = (conceptId: string | null) =>
  useQuery({
    queryKey: ["notes", conceptId],
    queryFn: () => noteRepo.byConcept(conceptId!),
    enabled: !!conceptId,
  });

export function useAddNote(conceptId: string) {
  return useMutation({
    mutationFn: (text: string) =>
      noteRepo.create({ id: crypto.randomUUID(), conceptId, text, createdAt: Date.now() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notes", conceptId] }),
  });
}

/** Quiz for a concept — generated on demand, held in the cache (not persisted). */
export const useQuiz = (conceptId: string | null) =>
  useQuery<QuizQuestion[] | null>({
    queryKey: ["quiz", conceptId],
    queryFn: () => null,
    enabled: false,
    initialData: null,
  });

export function useGenerateQuiz(concept: ConceptRow, topicTitle: string) {
  return useMutation({
    mutationFn: () => generateQuiz(concept, topicTitle),
    onSuccess: (questions) => queryClient.setQueryData(["quiz", concept.id], questions),
  });
}

/** Teach-back attempts for a concept, oldest → newest (the last is the current grade). */
export const useTeachAttempts = (conceptId: string | null) =>
  useQuery({
    queryKey: ["teach", conceptId],
    queryFn: () => teachRepo.byConcept(conceptId!),
    enabled: !!conceptId,
  });

/** The Feynman loop: grade the explanation → persist the attempt → bump the
 *  concept's mastery (app owns the math) → auto-fork each gap as a remedial
 *  branch. Returns the grade + computed masteryDelta for the result view. */
export function useTeachBack(concept: ConceptRow, ctx: TeachContext) {
  return useMutation({
    mutationFn: async ({ text, audience }: { text: string; audience: TeachAudience }) => {
      const grade = await gradeTeachBack(concept, ctx, text, audience);

      const attemptScore = scoreFromRubric(grade.rubric);
      const oldMastery = concept.mastery;
      // EMA toward this attempt — repeated good teach-backs converge up; a weak one pulls down.
      const newMastery = clamp01(round2(0.4 * oldMastery + 0.6 * attemptScore));
      const masteryDelta = round2(newMastery - oldMastery);
      const now = Date.now();

      await teachRepo.create({
        id: crypto.randomUUID(),
        conceptId: concept.id,
        audience,
        text,
        rubric: grade.rubric,
        verdict: grade.verdict,
        annotations: grade.annotations,
        gaps: grade.gaps,
        masteryDelta,
        createdAt: now,
      });

      await conceptRepo.update(concept.id, {
        mastery: newMastery,
        status:
          newMastery >= 0.8 ? "complete" : concept.status === "queued" ? "visited" : concept.status,
      });

      // Each gap becomes a remedial child concept; it generates a lesson on first
      // visit. Await all inserts so the refetch below sees the new branches.
      await Promise.all(
        grade.gaps.map((gap, i) =>
          conceptRepo.create({
            id: crypto.randomUUID(),
            topicId: concept.topicId,
            parentId: concept.id,
            title: gap.title,
            summary: gap.reason,
            status: "queued",
            state: "outline",
            order: now + i,
            mastery: 0,
            remedial: true,
            createdAt: now,
          }),
        ),
      );

      return { ...grade, masteryDelta };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teach", concept.id] });
      queryClient.invalidateQueries({ queryKey: ["concepts"] });
    },
  });
}
