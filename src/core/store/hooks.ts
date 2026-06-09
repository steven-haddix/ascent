// Reactive read/write layer (TanStack Query over the repositories). The UI binds
// to these hooks, never to drizzle directly — keeping the swap-to-sync seam.
import { useCallback, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  topicRepo,
  conceptRepo,
  lessonRepo,
  linkRepo,
  chatRepo,
  noteRepo,
  teachRepo,
  highlightRepo,
  usageRepo,
  widgetRepo,
  type ConceptRow,
  type UsageTotals,
  type UsageByModel,
  type UsageDay,
} from "./repositories";
import { findExistingConcept, normalizeTitle } from "./match";
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
import type { TeachAudience, TopicBrief, TeachGap, ExistingConcept } from "../types";
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

/** A built widget payload for a lesson's `widget` placeholder block. The builder
 *  job (widgetJobs.ts) publishes every state change into this key, so the card
 *  moves generating → ready/failed live. */
export const useWidget = (conceptId: string, widgetId: string) =>
  useQuery({
    queryKey: ["widget", conceptId, widgetId],
    queryFn: async () => (await widgetRepo.get(conceptId, widgetId)) ?? null,
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
      remedial,
    }: {
      topicId: string;
      parentId: string;
      title: string;
      summary?: string;
      /** mark this fork as a teach-back remedial branch (the ↻ badge in the tree) */
      remedial?: boolean;
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
        remedial: remedial ?? false,
        createdAt: now,
      });
      return id;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["concepts"] }),
  });
}

/** Delete a concept node. `removedIds` is the exact set to hard-delete (a single id
 *  for "keep sub-concepts", or the whole subtree from `descendantIds` for a cascade)
 *  — the caller computes it from the in-memory tree, keeping this layer free of tree
 *  logic. When `reparent` is given, the node's direct children are first moved up to
 *  `newParentId` so they survive. In-flight generations for removed nodes are aborted
 *  (their catch resolves to an error snapshot, so a finishing stream can't re-upsert a
 *  deleted lesson) and their cached lesson bodies are dropped. */
export function useDeleteConcept() {
  return useMutation({
    mutationFn: async ({
      removedIds,
      reparent,
    }: {
      removedIds: string[];
      reparent?: { childIds: string[]; newParentId: string | null };
    }) => {
      for (const id of removedIds) cancelLessonStream(id);
      if (reparent) await conceptRepo.reparent(reparent.childIds, reparent.newParentId);
      await conceptRepo.removeMany(removedIds);
      for (const id of removedIds) queryClient.removeQueries({ queryKey: ["lesson", id] });
      return removedIds;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["concepts"] });
      queryClient.invalidateQueries({ queryKey: ["links"] });
    },
  });
}

/** A concept's lesson: read if present, generated (streamed) on demand via `generate`.
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

  // Generation is explicit (the Generate button) — no auto-fire on open. `generate`
  // starts the stream; the registry dedupes, so a double click or returning mid-stream
  // is a no-op. `loaded` lets the view distinguish "no lesson yet" from "still looking
  // it up," so the idle CTA never flashes before a persisted lesson resolves on return.
  return {
    lesson: lesson.data ?? null,
    loaded: lesson.isFetched,
    partial: stream?.status === "streaming" ? stream.partial : null,
    generating: stream?.status === "streaming",
    error: stream?.status === "error" ? stream.error : null,
    generate: () => {
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

/** A concept's learner highlights (the personal annotation layer). */
export const useHighlights = (conceptId: string | null) =>
  useQuery({
    queryKey: ["highlights", conceptId],
    queryFn: () => highlightRepo.byConcept(conceptId!),
    enabled: !!conceptId,
  });

/** Insert a highlight, or — if one with the same anchor already exists — return its
 *  id (updating its gloss if a new one is supplied). Dedup lives here, not in the
 *  DB, so acting on the same selection twice never stacks duplicates. */
export function useAddHighlight(conceptId: string) {
  return useMutation({
    mutationFn: async ({
      exact,
      prefix,
      suffix,
      gloss,
    }: {
      exact: string;
      prefix: string;
      suffix: string;
      gloss?: string | null;
    }) => {
      const existing = (await highlightRepo.byConcept(conceptId)).find(
        (h) => h.exact === exact && h.prefix === prefix && h.suffix === suffix,
      );
      if (existing) {
        if (gloss && gloss !== existing.gloss) await highlightRepo.setGloss(existing.id, gloss);
        return existing.id;
      }
      const id = crypto.randomUUID();
      await highlightRepo.create({ id, conceptId, exact, prefix, suffix, gloss: gloss ?? null, createdAt: Date.now() });
      return id;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["highlights", conceptId] }),
  });
}

/** Delete a highlight (the popover's Remove action). */
export function useRemoveHighlight(conceptId: string) {
  return useMutation({
    mutationFn: (id: string) => highlightRepo.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["highlights", conceptId] }),
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

/** The Feynman loop: grade the explanation (with the topic's existing concepts, so
 *  the grader can link a gap to a lesson the learner already has) → persist the
 *  attempt → bump the concept's mastery (app owns the math). Gaps are NOT forked
 *  here — the result view surfaces them as click-to-fork / click-to-revisit
 *  suggestions. We only eagerly record a cross-link edge for gaps the grader matched
 *  to an existing concept (a backlink, not a new node). Returns the grade — with each
 *  gap's handle resolved to a conceptId — plus masteryDelta for the result view. */
export function useTeachBack(concept: ConceptRow, ctx: TeachContext) {
  return useMutation({
    mutationFn: async ({ text, audience }: { text: string; audience: TeachAudience }) => {
      // Offer the grader every other concept in the topic (each with a stable handle)
      // so it can link a gap to an existing lesson instead of pointing at a duplicate —
      // the same context the lesson generator gets.
      const all = await conceptRepo.byTopic(concept.topicId);
      const existingConcepts: ExistingConcept[] = all
        .filter((c) => c.id !== concept.id)
        .map((c, i) => ({ handle: `c${i + 1}`, conceptId: c.id, title: c.title, summary: c.summary }));

      const grade = await gradeTeachBack(concept, { ...ctx, existingConcepts }, text, audience);

      // Resolve each gap's cited handle → conceptId (handle first, normalized-title
      // fallback if the model echoed a title; then a plain title match even when it
      // cited nothing). A resolved gap renders as a Link to revisit; an unresolved one
      // as a new branch the learner can fork on click. Nothing is forked here.
      const byHandle = new Map(existingConcepts.map((c) => [c.handle, c.conceptId]));
      const byTitle = new Map(existingConcepts.map((c) => [normalizeTitle(c.title), c.conceptId]));
      const gaps: TeachGap[] = grade.gaps.map((g) => {
        const ref = (g.handle ?? "").trim();
        let conceptId = ref ? (byHandle.get(ref) ?? byTitle.get(normalizeTitle(ref))) : undefined;
        if (!conceptId) conceptId = findExistingConcept(g.title, all, concept.id)?.id;
        if (conceptId === concept.id) conceptId = undefined; // never self-link
        return { title: g.title, reason: g.reason, conceptId: conceptId ?? null };
      });

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
        gaps,
        masteryDelta,
        createdAt: now,
      });

      await conceptRepo.update(concept.id, {
        mastery: newMastery,
        status:
          newMastery >= 0.8 ? "complete" : concept.status === "queued" ? "visited" : concept.status,
      });

      // Eager, deduped backlink edges for gaps the grader matched to an existing
      // concept (the unique (source,target) index makes a repeat a no-op). New gaps
      // create nothing — the learner forks them from the result view if they want to.
      await Promise.all(
        gaps
          .filter((g) => g.conceptId)
          .map((g) =>
            linkRepo.create({
              id: crypto.randomUUID(),
              topicId: concept.topicId,
              sourceConceptId: concept.id,
              targetConceptId: g.conceptId as string,
              reason: g.reason || null,
              createdAt: now,
            }),
          ),
      );

      return { ...grade, gaps, masteryDelta };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teach", concept.id] });
      queryClient.invalidateQueries({ queryKey: ["concepts"] });
      queryClient.invalidateQueries({ queryKey: ["links"] });
    },
  });
}
