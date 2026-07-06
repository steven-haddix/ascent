// Topic-creation session — a single-flight module store (the lessonStreams pattern:
// module-level state + useSyncExternalStore) shared by the center intake flow AND
// the right-pane Brief. One topic is created at a time, so a singleton is right.
//
// It owns the draft-topic lifecycle end to end: a hidden `draft` topic is minted
// the moment attachments or an interview need a real topicId to bind to, the
// interview runs doc-aware waves against it, and generation streams the outline
// (finalizeDraftTopic) into the same row, promoting it to `ready`. Cancel deletes
// the draft; a crash leaves it for the startup sweep. A runToken invalidates the
// async tail of an abandoned/superseded run so late callbacks can't mutate a fresh
// session.
import { useSyncExternalStore } from "react";
import type { IntakeAnswer, IntakeQuestion, TopicBrief } from "../types";
import { planWave, facetsFromAnswers } from "./intake";
import {
  createDraftTopic,
  deleteDraftTopic,
  finalizeDraftTopic,
  type FinalizeResult,
  type PartialOutline,
} from "./outline";
import { awaitTopicIngestion, saveUploadToLibrary } from "../knowledge/ingest";
import { guessRole } from "../knowledge/types";
import { sourceRepo } from "../store/repositories";
import { dlog } from "../debug";

export type IntakePhase = "compose" | "planning" | "asking" | "brief" | "creating" | "done" | "error";

export interface IntakeLogRow {
  id: string;
  text: string;
  state: "doing" | "done" | "failed";
}
export interface RevealedConcept {
  title: string;
  depth: number;
}

export interface IntakeSnapshot {
  phase: IntakePhase;
  draftTopicId: string | null;
  title: string;
  history: IntakeAnswer[];
  wave: IntakeQuestion[];
  qIndex: number;
  waveIndex: number;
  draftSelected?: string;
  draftOther: string;
  summary: string;
  facets: { label: string; value: string }[];
  log: IntakeLogRow[];
  revealed: RevealedConcept[];
  result: FinalizeResult | null;
  /** an error confined to the current phase (planning or creating); the flow stays put */
  error: string | null;
}

function blank(): IntakeSnapshot {
  return {
    phase: "compose",
    draftTopicId: null,
    title: "",
    history: [],
    wave: [],
    qIndex: 0,
    waveIndex: 0,
    draftSelected: undefined,
    draftOther: "",
    summary: "",
    facets: [],
    log: [],
    revealed: [],
    result: null,
    error: null,
  };
}

let state: IntakeSnapshot = blank();
let runToken = 0;
let draftInFlight: Promise<string> | null = null;
// In-flight uploads (arrayBuffer → store → bind → enqueue extraction). Planning and
// generation await these BEFORE reading the library, so a file dropped a moment
// before "Continue" is bound-and-extracted first — never planned around.
const pendingAttaches = new Set<Promise<void>>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}
function set(patch: Partial<IntakeSnapshot>): void {
  state = { ...state, ...patch };
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function getSnapshot(): IntakeSnapshot {
  return state;
}
export function useIntakeSession(): IntakeSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}
export function getIntakeSnapshot(): IntakeSnapshot {
  return state;
}

/** Fresh compose session. Invalidates any in-flight async tail of a prior run. */
export function resetIntake(): void {
  runToken += 1;
  draftInFlight = null;
  state = blank();
  emit();
}

/** Ensure a draft topic exists (single-flight) so attachments/interview can bind. */
export function ensureDraft(): Promise<string> {
  if (state.draftTopicId) return Promise.resolve(state.draftTopicId);
  if (draftInFlight) return draftInFlight;
  draftInFlight = createDraftTopic(state.title).then((id) => {
    set({ draftTopicId: id });
    draftInFlight = null;
    return id;
  });
  return draftInFlight;
}

export function setIntakeTitle(title: string): void {
  set({ title });
}

/** Attach uploaded files to the draft's library (compose dropzone). The returned
 *  promise is tracked so planning/generation can await it (a file dropped just
 *  before "Continue" must be bound before we read the library). Ingestion then runs
 *  in the background and publishes to ["library", draftId] for the views. */
export function attachIntakeFiles(files: File[]): Promise<void> {
  const p = doAttach(files);
  pendingAttaches.add(p);
  void p.finally(() => pendingAttaches.delete(p));
  return p;
}

async function doAttach(files: File[]): Promise<void> {
  const topicId = await ensureDraft();
  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = file.type || (/\.(md|markdown)$/i.test(file.name) ? "text/markdown" : "text/plain");
      await saveUploadToLibrary(
        { name: file.name, bytes, mime },
        { scope: "topic", topicId, kind: mime === "application/pdf" ? "pdf" : "notes", role: guessRole(file.name) },
      );
    } catch (err) {
      dlog("intake", "attach failed:", err instanceof Error ? err.message : String(err));
    }
  }
}

/** Await pending uploads to bind AND their extraction to finish. This is the
 *  invariant the whole flow depends on: we NEVER plan an interview or an outline
 *  before the attached documents are extracted — that's the entire point of
 *  attaching them. Resolves immediately when nothing is pending (the no-docs path
 *  pays no latency). */
async function awaitDocsReady(topicId: string): Promise<void> {
  if (pendingAttaches.size) await Promise.allSettled([...pendingAttaches]);
  await awaitTopicIngestion(topicId);
}

async function hasReadyDocs(topicId: string): Promise<boolean> {
  const entries = await sourceRepo.listByTopic(topicId);
  return entries.some((e) => e.document.status === "ready");
}

async function planCurrentWave(): Promise<void> {
  const token = runToken;
  set({ phase: "planning", error: null });
  try {
    const topicId = await ensureDraft();
    // Docs must be extracted BEFORE we plan — the interview's whole value is
    // asking questions grounded in the material (e.g. "your syllabus stops at X…").
    await awaitDocsReady(topicId);
    if (token !== runToken) return;
    const result = await planWave(state.title, state.history, state.waveIndex, topicId);
    if (token !== runToken) return;
    if (result.done) {
      set({ phase: "brief", summary: result.summary, facets: facetsFromAnswers(state.history) });
    } else {
      set({
        phase: "asking",
        wave: result.questions,
        qIndex: 0,
        waveIndex: state.waveIndex + 1,
        draftSelected: undefined,
        draftOther: "",
      });
    }
  } catch (err) {
    if (token !== runToken) return;
    set({ phase: "error", error: err instanceof Error ? err.message : String(err) });
  }
}

/** Compose → interview. */
export function beginInterview(): void {
  if (!state.title.trim()) return;
  void planCurrentWave();
}

export function selectOption(option: string): void {
  set({ draftSelected: state.draftSelected === option ? undefined : option });
}
export function setOther(text: string): void {
  set({ draftOther: text });
}

/** Commit the current question's answer and advance (or plan the next wave). */
export function answerNext(): void {
  const q = state.wave[state.qIndex];
  if (!q) return;
  const answer: IntakeAnswer = {
    prompt: q.prompt,
    selected: state.draftSelected,
    other: state.draftOther.trim() || undefined,
    facetLabel: q.facetLabel,
  };
  const history = [...state.history, answer];
  const facets = facetsFromAnswers(history);
  if (state.qIndex < state.wave.length - 1) {
    set({ history, facets, qIndex: state.qIndex + 1, draftSelected: undefined, draftOther: "" });
    return;
  }
  set({ history, facets });
  void planCurrentWave(); // wave exhausted → next batch (or brief)
}

export function answerBack(): void {
  if (state.qIndex === 0) return;
  const prev = state.history[state.history.length - 1];
  const history = state.history.slice(0, -1);
  set({
    history,
    facets: facetsFromAnswers(history),
    qIndex: state.qIndex - 1,
    draftSelected: prev?.selected,
    draftOther: prev?.other ?? "",
  });
}

/** Jump back to an earlier question in the CURRENT wave (transcript rewind). */
export function rewindToQuestion(localIndex: number): void {
  if (localIndex >= state.qIndex) return;
  const waveStart = state.history.length - state.qIndex; // history len when this wave began
  const target = state.history[waveStart + localIndex];
  const history = state.history.slice(0, waveStart + localIndex);
  set({
    history,
    facets: facetsFromAnswers(history),
    qIndex: localIndex,
    draftSelected: target?.selected,
    draftOther: target?.other ?? "",
  });
}

export function restartInterview(): void {
  runToken += 1; // drop any in-flight plan
  set({ history: [], facets: [], summary: "", wave: [], qIndex: 0, waveIndex: 0, draftSelected: undefined, draftOther: "" });
  void planCurrentWave();
}

function briefValue(): TopicBrief | undefined {
  if (!state.history.length && !state.summary) return undefined;
  return { summary: state.summary, answers: state.history, facets: state.facets };
}

function log(id: string, text: string, s: IntakeLogRow["state"]): void {
  const rows = state.log.filter((r) => r.id !== id);
  set({ log: [...rows, { id, text, state: s }] });
}

/** Map a streamed outline partial to the revealed concept list (root + concepts). */
function revealFromPartial(p: PartialOutline): RevealedConcept[] {
  const out: RevealedConcept[] = [];
  if (p.title) out.push({ title: p.title, depth: 0 });
  for (const c of p.concepts ?? []) {
    if (!c?.title) continue;
    out.push({ title: c.title, depth: 1 });
    for (const ch of c.children ?? []) {
      if (ch?.title) out.push({ title: ch.title, depth: 2 });
    }
  }
  return out;
}

/** Stream the outline into the draft and reveal the tree. Retry-safe (finalize
 *  clears any half-built tree first). Always waits for docs to extract first, so
 *  the outline is grounded in the material rather than planned around it. */
async function runGeneration(): Promise<void> {
  const token = runToken;
  set({ phase: "creating", error: null, log: [], revealed: [] });
  try {
    const topicId = await ensureDraft();
    // Are there docs to wait for? (bindings present, or an upload still in flight)
    const willHaveDocs = pendingAttaches.size > 0 || (await sourceRepo.listByTopic(topicId)).length > 0;
    if (willHaveDocs) log("src", "Reading your sources…", "doing");
    await awaitDocsReady(topicId);
    if (token !== runToken) return;
    const hasDocs = await hasReadyDocs(topicId);
    if (willHaveDocs) log("src", hasDocs ? "Sources indexed" : "No sources could be read", hasDocs ? "done" : "failed");

    log("trunk", "Sketching the trunk…", "doing");
    let trunkDone = false;

    const result = await finalizeDraftTopic(topicId, state.title, briefValue(), {
      onPartial: (partial) => {
        if (token !== runToken) return;
        const revealed = revealFromPartial(partial);
        if (!trunkDone && partial.title) {
          trunkDone = true;
          log("trunk", `Trunk placed: ${partial.title}`, "done");
          log("br", "Growing branches…", "doing");
        }
        set({ revealed });
      },
    });
    if (token !== runToken) return;

    const levels = state.revealed.reduce((m, r) => Math.max(m, r.depth + 1), 1);
    log("br", `${state.revealed.length} concepts across ${levels} levels`, "done");
    if (hasDocs) {
      log("gr", `${result.citedConceptIds.length} lessons will cite your sources`, "done");
    }
    set({ phase: "done", result });
  } catch (err) {
    if (token !== runToken) return;
    log("br", "Generation stalled", "failed");
    set({ phase: "error", error: err instanceof Error ? err.message : String(err) });
  }
}

/** Generate from the brief (review screen). */
export function generateTree(): void {
  void runGeneration();
}

/** Skip the interview entirely — generate straight from the title (compose screen). */
export function skipToGenerate(): void {
  set({ summary: "", history: [], facets: [] });
  void runGeneration();
}

/** Retry a failed generation (finalize is retry-safe). */
export function retryGeneration(): void {
  void runGeneration();
}

/** Abandon the session: delete the draft (blob-aware) and reset to a blank compose. */
export async function cancelIntake(): Promise<void> {
  const draftId = state.draftTopicId;
  runToken += 1;
  draftInFlight = null;
  state = blank();
  emit();
  if (draftId) await deleteDraftTopic(draftId);
}
