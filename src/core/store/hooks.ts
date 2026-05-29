// Reactive read/write layer (TanStack Query over the repositories). The UI binds
// to these hooks, never to drizzle directly — keeping the swap-to-sync seam.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  topicRepo,
  conceptRepo,
  lessonRepo,
  linkRepo,
  chatRepo,
  noteRepo,
  teachRepo,
  usageRepo,
  type ConceptRow,
  type UsageTotals,
  type UsageByModel,
  type UsageDay,
} from "./repositories";
import { findExistingConcept } from "./match";
import { startTopic } from "../generation/outline";
import type { LessonContext } from "../generation/lesson";
import {
  ensureLessonStream,
  cancelLessonStream,
  getLessonStreamSnapshot,
  subscribeLessonStream,
} from "../generation/lessonStreams";
import { chat, type ChatContext } from "../generation/tutor";
import { generateQuiz, type QuizQuestion } from "../generation/quiz";
import { gradeTeachBack, scoreFromRubric, type TeachContext } from "../generation/teachback";
import type { TeachAudience, TopicBrief } from "../types";
import { getTutorMode } from "../settings";
import { queryClient } from "./queryClient";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

export { queryClient };

export const useTopics = (enabled = true) =>
  useQuery({ queryKey: ["topics"], queryFn: () => topicRepo.list(), enabled });

export const useConcepts = (topicId: string | null) =>
  useQuery({
    queryKey: ["concepts", topicId],
    queryFn: () => conceptRepo.byTopic(topicId as string),
    enabled: !!topicId,
  });

/** Cross-link edges for a topic — the graph layer beyond the parent/child tree.
 *  Eager edge creation invalidates ["links"], so a consumer (graph view, backlinks)
 *  stays live. No reader ships in this slice; it's here for ⌘G / backlinks. */
export const useConceptLinks = (topicId: string | null) =>
  useQuery({
    queryKey: ["links", topicId],
    queryFn: () => linkRepo.byTopic(topicId as string),
    enabled: !!topicId,
  });

export function useStartTopic() {
  return useMutation({
    mutationFn: ({ title, brief }: { title: string; brief?: TopicBrief | null }) =>
      startTopic(title, brief),
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

/** A concept's lesson: read if present, generated (streamed) on first visit.
 *  Generation lives in the lessonStreams registry — outside React — so a stream
 *  survives navigating away and is deduplicated: returning to a concept that is
 *  still generating attaches to the live stream instead of starting a duplicate.
 *  Render LessonPane with key={concept.id} so this hook is per-concept. */
export function useConceptLesson(concept: ConceptRow | null, ctx: LessonContext) {
  const lesson = useQuery({
    queryKey: ["lesson", concept?.id],
    // map drizzle's `undefined` (no row) to null — TanStack Query forbids undefined.
    queryFn: async () => (await lessonRepo.get(concept!.id)) ?? null,
    enabled: !!concept,
  });

  const id = concept?.id ?? "";
  const subscribe = useCallback((cb: () => void) => subscribeLessonStream(id, cb), [id]);
  const getSnapshot = useCallback(() => getLessonStreamSnapshot(id), [id]);
  const stream = useSyncExternalStore(subscribe, getSnapshot);

  // Auto-generate on first visit only if absent AND no stream is already tracked for
  // this concept (the registry also dedupes; this avoids even calling it on return).
  useEffect(() => {
    if (concept && lesson.isFetched && lesson.data === null && !stream) {
      ensureLessonStream(concept, ctx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [concept?.id, lesson.isFetched, lesson.data, stream]);

  return {
    lesson: lesson.data ?? null,
    partial: stream?.status === "streaming" ? stream.partial : null,
    generating: stream?.status === "streaming",
    error: stream?.status === "error" ? stream.error : null,
    retry: () => {
      if (concept) ensureLessonStream(concept, ctx);
    },
    stop: () => {
      if (concept) cancelLessonStream(concept.id);
    },
  };
}

/** Whether a lesson is currently generating for this concept — reactive, so a
 *  tree row can show a loader even when that concept's LessonPane isn't mounted
 *  (you navigated away while it generates in the background). */
export function useLessonStreaming(conceptId: string): boolean {
  const subscribe = useCallback((cb: () => void) => subscribeLessonStream(conceptId, cb), [conceptId]);
  const getSnapshot = useCallback(() => getLessonStreamSnapshot(conceptId), [conceptId]);
  return useSyncExternalStore(subscribe, getSnapshot)?.status === "streaming";
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

export function useGenerateQuiz(
  concept: ConceptRow,
  topicTitle: string,
  briefSummary?: string | null,
) {
  return useMutation({
    mutationFn: () => generateQuiz(concept, topicTitle, briefSummary),
    onSuccess: (questions) => queryClient.setQueryData(["quiz", concept.id], questions),
  });
}

/** How many days the Usage view's over-time window covers. */
export const USAGE_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

export interface UsageSummary {
  totals: UsageTotals;
  byModel: UsageByModel[];
  daily: UsageDay[];
}

/** Aggregated AI spend for the Settings Usage view. The usage middleware
 *  invalidates ["usage"] after each recorded call, so an open panel stays live. */
export function useUsageSummary(enabled = true) {
  return useQuery<UsageSummary>({
    queryKey: ["usage"],
    queryFn: async () => {
      const since = Date.now() - USAGE_WINDOW_DAYS * DAY_MS;
      const [totals, byModel, daily] = await Promise.all([
        usageRepo.totals(),
        usageRepo.byModel(),
        usageRepo.daily(since),
      ]);
      return { totals, byModel, daily };
    },
    enabled,
  });
}

/** Wipe the usage ledger (the Reset button in Settings). */
export function useClearUsage() {
  return useMutation({
    mutationFn: () => usageRepo.clear(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["usage"] }),
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

      // Each gap becomes a remedial child concept — UNLESS that concept already
      // exists in the tree, in which case we link to it instead of duplicating it
      // (the same dedup guard the lesson suggestions use). `pool` grows as we add
      // children so two identically-named gaps in one batch don't double-fork.
      const pool: ConceptRow[] = [...(await conceptRepo.byTopic(concept.topicId))];
      let order = now;
      for (const gap of grade.gaps) {
        const match = findExistingConcept(gap.title, pool, concept.id);
        if (match) {
          await linkRepo.create({
            id: crypto.randomUUID(),
            topicId: concept.topicId,
            sourceConceptId: concept.id,
            targetConceptId: match.id,
            reason: gap.reason || null,
            createdAt: now,
          });
          continue;
        }
        const child: ConceptRow = {
          id: crypto.randomUUID(),
          topicId: concept.topicId,
          parentId: concept.id,
          title: gap.title,
          summary: gap.reason,
          status: "queued",
          state: "outline",
          order: order++,
          mastery: 0,
          remedial: true,
          createdAt: now,
        };
        await conceptRepo.create(child);
        pool.push(child);
      }

      return { ...grade, masteryDelta };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teach", concept.id] });
      queryClient.invalidateQueries({ queryKey: ["concepts"] });
      queryClient.invalidateQueries({ queryKey: ["links"] });
    },
  });
}
