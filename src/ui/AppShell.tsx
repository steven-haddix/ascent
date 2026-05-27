import { useEffect, useState } from "react";
import type { ConceptRow } from "../core/store/repositories";
import { ConceptTree } from "./ConceptTree";
import { Trailhead } from "./Trailhead";
import { LessonPane } from "./LessonPane";
import { ChatDrawer } from "./ChatDrawer";
import { PreviewPane } from "./PreviewPane";

const THEMES = ["cream", "paper", "dark"] as const;
type Theme = (typeof THEMES)[number];

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem("ascent-theme", theme);
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("ascent-theme") as Theme) || "cream",
  );
  useEffect(() => applyTheme(theme), [theme]);
  return (
    <button
      title={`Theme: ${theme}`}
      onClick={() => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length])}
      className="grid h-7 w-7 place-items-center rounded-md border border-transparent text-ink-3 hover:border-rule hover:bg-surface-2 hover:text-ink"
    >
      <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1a7 7 0 1 0 0 14V1z" />
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1" />
      </svg>
    </button>
  );
}

function Topbar() {
  return (
    <header className="grid h-[52px] shrink-0 grid-cols-[280px_1fr_280px] items-center border-b border-rule bg-surface px-4">
      <div className="flex items-center gap-2.5">
        <div className="grid h-7 w-7 place-items-center rounded-md bg-ink text-surface">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
            <circle cx="6" cy="6" r="2" fill="currentColor" />
            <circle cx="14" cy="6" r="2" fill="currentColor" opacity="0.4" />
            <circle cx="10" cy="14" r="2" fill="currentColor" />
            <path d="M6 6 L10 14 M14 6 L10 14" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
          </svg>
        </div>
        <div className="leading-tight">
          <div className="text-[13px] font-semibold tracking-tight text-ink">Ascent</div>
          <div className="font-mono text-[10.5px] text-ink-3">tree-driven learning</div>
        </div>
      </div>
      <div className="flex justify-center">
        <button className="flex w-full max-w-[520px] items-center gap-2.5 rounded-lg border border-rule bg-surface-2 px-3 py-1.5 text-left text-[12.5px] text-ink-3 hover:border-rule-strong hover:text-ink-2">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
            <circle cx="6" cy="6" r="4" />
            <path d="M9 9 L12 12" />
          </svg>
          <span className="flex-1">Jump to a branch, run a command, or ask…</span>
          <span className="rounded border border-rule bg-surface px-1.5 py-0.5 font-mono text-[10.5px]">⌘K</span>
        </button>
      </div>
      <div className="flex items-center justify-end gap-2.5">
        <ThemeToggle />
        <div className="grid h-7 w-7 place-items-center rounded-full bg-ink text-[10.5px] font-semibold text-surface">⛰</div>
      </div>
    </header>
  );
}

function EmptyPane({ eyebrow, title, hint }: { eyebrow: string; title: string; hint: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-8 text-center">
      <div className="text-[10.5px] font-medium uppercase tracking-wider text-ink-3">{eyebrow}</div>
      <div className="font-serif text-lg text-ink-2">{title}</div>
      <div className="max-w-[26ch] text-xs text-ink-3">{hint}</div>
    </div>
  );
}

function Sidebar({
  concepts,
  selectedConceptId,
  onSelectConcept,
  onNewTopic,
}: {
  concepts: ConceptRow[];
  selectedConceptId: string | null;
  onSelectConcept: (id: string) => void;
  onNewTopic: () => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-r border-rule bg-surface">
      <div className="flex items-center justify-between px-3.5 pb-2 pt-3.5">
        <span className="text-[10.5px] font-medium uppercase tracking-wider text-ink-3">Learning tree</span>
      </div>
      <div className="min-h-0 flex-1">
        {concepts.length > 0 ? (
          <ConceptTree concepts={concepts} selectedId={selectedConceptId} onSelect={onSelectConcept} />
        ) : (
          <EmptyPane eyebrow="Empty" title="No topic open" hint="Start a topic to grow a tree of concepts." />
        )}
      </div>
      <div className="border-t border-rule p-3.5">
        <button
          onClick={onNewTopic}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-ink py-1.5 text-xs font-medium text-surface hover:opacity-90"
        >
          <svg width="11" height="11" viewBox="0 0 11 11">
            <path d="M5.5 1.5 L5.5 9.5 M1.5 5.5 L9.5 5.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
          </svg>
          New topic
        </button>
      </div>
    </aside>
  );
}

/** Path of concept titles from the root to `id` (for the breadcrumb). */
function pathTo(concepts: ConceptRow[], id: string): string[] {
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const path: string[] = [];
  let cur: ConceptRow | undefined = byId.get(id);
  while (cur) {
    path.unshift(cur.title);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path;
}

interface AppShellProps {
  activeTopicId: string | null;
  concepts: ConceptRow[];
  selectedConceptId: string | null;
  onSelectConcept: (id: string) => void;
  onStartTopic: (title: string) => void;
  starting: boolean;
  startError?: string | null;
  onNewTopic: () => void;
  onFork: (title: string, summary?: string) => void;
}

export function AppShell(props: AppShellProps) {
  const {
    activeTopicId,
    concepts,
    selectedConceptId,
    onSelectConcept,
    onStartTopic,
    starting,
    startError,
    onNewTopic,
    onFork,
  } = props;

  const selected = concepts.find((c) => c.id === selectedConceptId) ?? null;
  const topicTitle = concepts.find((c) => !c.parentId)?.title ?? "";

  return (
    <div className="flex h-screen flex-col">
      <Topbar />
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(360px,440px)]">
        <Sidebar
          concepts={concepts}
          selectedConceptId={selectedConceptId}
          onSelectConcept={onSelectConcept}
          onNewTopic={onNewTopic}
        />
        <main className="relative min-h-0 min-w-0 bg-bg">
          {!activeTopicId ? (
            <Trailhead onStart={onStartTopic} busy={starting} error={startError} />
          ) : selected ? (
            <>
              <div className="h-full overflow-y-auto">
                <LessonPane
                  key={selected.id}
                  concept={selected}
                  concepts={concepts}
                  path={pathTo(concepts, selected.id)}
                  topicTitle={topicTitle}
                  onFork={onFork}
                />
              </div>
              <ChatDrawer
                key={selected.id}
                concept={selected}
                ctx={{ topicTitle, path: pathTo(concepts, selected.id), summary: selected.summary }}
              />
            </>
          ) : (
            <EmptyPane eyebrow="Lesson" title="Pick a concept" hint="Select a concept in the tree to begin." />
          )}
        </main>
        <aside className="flex min-h-0 flex-col border-l border-rule bg-surface">
          {selected ? (
            <PreviewPane
              key={selected.id}
              concept={selected}
              ctx={{ topicTitle, path: pathTo(concepts, selected.id) }}
            />
          ) : (
            <EmptyPane
              eyebrow="Preview"
              title="Nothing pinned"
              hint="Notes, quizzes, and more attach to the concept you're learning."
            />
          )}
        </aside>
      </div>
    </div>
  );
}
