import { useEffect, useState } from "react";
import type { ConceptRow, TopicRow } from "../core/store/repositories";
import { ConceptTree } from "./ConceptTree";
import { Trailhead } from "./Trailhead";
import { LessonPane } from "./LessonPane";
import { ChatDrawer } from "./ChatDrawer";
import { PreviewPane } from "./PreviewPane";
import { Settings } from "./Settings";
import { CommandPalette, type Command } from "./CommandPalette";
import {
  THEMES,
  getTheme,
  setTheme as persistTheme,
  applyTheme,
  getPreviewWidth,
  setPreviewWidth as persistPreviewWidth,
  PREVIEW_WIDTH,
  type Theme,
} from "../core/settings";

function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  return (
    <button
      title={`Theme: ${theme} — click to cycle`}
      onClick={() => onChange(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length])}
      className="grid h-7 w-7 place-items-center rounded-md border border-transparent text-ink-3 hover:border-rule hover:bg-surface-2 hover:text-ink"
    >
      <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1a7 7 0 1 0 0 14V1z" />
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1" />
      </svg>
    </button>
  );
}

function Topbar({
  theme,
  onChangeTheme,
  onOpenSettings,
  onOpenPalette,
}: {
  theme: Theme;
  onChangeTheme: (t: Theme) => void;
  onOpenSettings: () => void;
  onOpenPalette: () => void;
}) {
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
        <button
          onClick={onOpenPalette}
          className="flex w-full max-w-[520px] items-center gap-2.5 rounded-lg border border-rule bg-surface-2 px-3 py-1.5 text-left text-[12.5px] text-ink-3 hover:border-rule-strong hover:text-ink-2"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
            <circle cx="6" cy="6" r="4" />
            <path d="M9 9 L12 12" />
          </svg>
          <span className="flex-1">Jump to a concept or run a command…</span>
          <span className="rounded border border-rule bg-surface px-1.5 py-0.5 font-mono text-[10.5px]">⌘K</span>
        </button>
      </div>
      <div className="flex items-center justify-end gap-2.5">
        <ThemeToggle theme={theme} onChange={onChangeTheme} />
        <button
          onClick={onOpenSettings}
          title="Settings"
          className="grid h-7 w-7 place-items-center rounded-md border border-transparent text-ink-3 hover:border-rule hover:bg-surface-2 hover:text-ink"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          >
            <path d="M2 4h12 M2 8h12 M2 12h12" />
            <circle cx="6" cy="4" r="1.7" fill="currentColor" stroke="none" />
            <circle cx="10.5" cy="8" r="1.7" fill="currentColor" stroke="none" />
            <circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none" />
          </svg>
        </button>
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
  topics,
  activeTopicId,
  concepts,
  selectedConceptId,
  onSelectTopic,
  onSelectConcept,
  onNewTopic,
}: {
  topics: TopicRow[];
  activeTopicId: string | null;
  concepts: ConceptRow[];
  selectedConceptId: string | null;
  onSelectTopic: (id: string) => void;
  onSelectConcept: (id: string) => void;
  onNewTopic: () => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-r border-rule bg-surface">
      {topics.length > 0 && (
        <div className="shrink-0 border-b border-rule">
          <div className="px-3.5 pb-1.5 pt-3.5">
            <span className="text-[10.5px] font-medium uppercase tracking-wider text-ink-3">Topics</span>
          </div>
          <div className="max-h-44 overflow-y-auto px-2 pb-2">
            {topics.map((t) => (
              <button
                key={t.id}
                onClick={() => onSelectTopic(t.id)}
                title={t.title}
                className={`block w-full truncate rounded-md px-2 py-1.5 text-left text-[12.5px] ${
                  t.id === activeTopicId
                    ? "bg-surface-2 font-medium text-ink"
                    : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                }`}
              >
                {t.title}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between px-3.5 pb-2 pt-3.5">
        <span className="text-[10.5px] font-medium uppercase tracking-wider text-ink-3">Learning tree</span>
      </div>
      <div className="min-h-0 flex-1">
        {concepts.length > 0 ? (
          <ConceptTree concepts={concepts} selectedId={selectedConceptId} onSelect={onSelectConcept} />
        ) : (
          <EmptyPane eyebrow="Empty" title="No topic open" hint="Pick a topic above, or start a new one." />
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
  topics: TopicRow[];
  activeTopicId: string | null;
  onSelectTopic: (id: string) => void;
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
    topics,
    activeTopicId,
    onSelectTopic,
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

  // The chat drawer overlays the lesson; track its height so the lesson reserves
  // matching scroll room beneath its content (you can always scroll past it).
  const [chatHeight, setChatHeight] = useState(72);

  // Right preview panel is drag-resizable; width persists to localStorage.
  const [previewWidth, setPreviewWidth] = useState<number>(() => getPreviewWidth());
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    let next = previewWidth;
    const onMove = (ev: PointerEvent) => {
      // Keep the middle lesson pane from collapsing — cap so it always has room.
      const max = Math.min(PREVIEW_WIDTH.max, window.innerWidth - 520);
      next = Math.min(max, Math.max(PREVIEW_WIDTH.min, window.innerWidth - ev.clientX));
      setPreviewWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      persistPreviewWidth(next);
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Theme is owned here so the topbar toggle and the Settings panel stay in sync.
  const [theme, setThemeState] = useState<Theme>(() => getTheme());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const changeTheme = (t: Theme) => {
    setThemeState(t);
    persistTheme(t); // writes localStorage + applies to <html>
  };
  useEffect(() => {
    applyTheme(theme); // ensure <html> matches on mount (main.tsx also applies pre-paint)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global ⌘K / Ctrl-K toggles the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Concepts (jump-to) + a few actions. Rebuilt each render — cheap, and the
  // palette only mounts when open.
  const commands: Command[] = [
    ...topics.map((t) => ({
      id: `topic:${t.id}`,
      label: t.title,
      hint: t.id === activeTopicId ? "Current topic" : "Switch topic",
      section: "Topics",
      keywords: "switch open tree",
      run: () => onSelectTopic(t.id),
    })),
    ...concepts.map((c) => ({
      id: `concept:${c.id}`,
      label: c.title,
      hint: pathTo(concepts, c.id).slice(0, -1).join(" / ") || "Root",
      section: "Jump to",
      run: () => onSelectConcept(c.id),
    })),
    {
      id: "act:new-topic",
      label: "New topic",
      hint: "Start a fresh learning tree",
      section: "Actions",
      keywords: "create add",
      run: onNewTopic,
    },
    {
      id: "act:settings",
      label: "Open Settings",
      hint: "API key, model, theme",
      section: "Actions",
      keywords: "preferences key model api",
      run: () => setSettingsOpen(true),
    },
    ...THEMES.map((t) => ({
      id: `act:theme-${t}`,
      label: `Theme: ${t[0].toUpperCase()}${t.slice(1)}`,
      section: "Actions",
      keywords: "appearance color mode",
      run: () => changeTheme(t),
    })),
  ];

  return (
    <div className="flex h-screen flex-col">
      <Topbar
        theme={theme}
        onChangeTheme={changeTheme}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenPalette={() => setPaletteOpen(true)}
      />
      <div
        className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)]"
        style={{ gridTemplateColumns: `minmax(220px,260px) minmax(0,1fr) ${previewWidth}px` }}
      >
        <Sidebar
          topics={topics}
          activeTopicId={activeTopicId}
          concepts={concepts}
          selectedConceptId={selectedConceptId}
          onSelectTopic={onSelectTopic}
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
                  bottomInset={chatHeight + 24}
                />
              </div>
              <ChatDrawer
                key={selected.id}
                concept={selected}
                ctx={{ topicTitle, path: pathTo(concepts, selected.id), summary: selected.summary }}
                onHeightChange={setChatHeight}
              />
            </>
          ) : (
            <EmptyPane eyebrow="Lesson" title="Pick a concept" hint="Select a concept in the tree to begin." />
          )}
        </main>
        <aside className="relative flex min-h-0 flex-col border-l border-rule bg-surface">
          <div
            onPointerDown={startResize}
            title="Drag to resize"
            className="absolute left-0 top-0 z-10 h-full w-1.5 -translate-x-1/2 cursor-col-resize hover:bg-rule-strong"
          />
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
      {settingsOpen && (
        <Settings theme={theme} onChangeTheme={changeTheme} onClose={() => setSettingsOpen(false)} />
      )}
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
