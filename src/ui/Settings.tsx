import { useEffect, useState, type ReactNode } from "react";
import { secretStore } from "../core/secrets";
import { ROUTE_OPTIONS, getRoute, type Route, type RouteModel } from "../core/ai/routes";
import { AI_TASKS, type AiTask, type AiTaskId } from "../core/ai/tasks";
import {
  getModelId,
  setModelId,
  getRouteId,
  setRouteId,
  getTaskModelId,
  setTaskModelId,
  getTaskRouteId,
  setTaskRouteId,
  hasTaskOverride,
  clearTaskOverride,
  getTaskInheritedModelId,
  getTutorMode,
  setTutorMode,
  THEMES,
  type Theme,
} from "../core/settings";
import { TUTOR_MODES, type TutorMode } from "../core/generation/tutor";
import { UsageSection } from "./UsageSection";
import { mediaProviderRegistry, isMediaProviderEnabled, setMediaProviderEnabled } from "../core/media/registry";
import { aiProviderRegistry, isAiProviderEnabled, setAiProviderEnabled } from "../core/ai/providers/registry";

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mb-2 text-[10.5px] font-medium uppercase tracking-wider text-ink-3">{children}</div>;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      stroke="currentColor"
      strokeWidth="1.4"
      fill="none"
      className={`shrink-0 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M2 3.5 L5 6.5 L8 3.5" />
    </svg>
  );
}

function modelLabel(route: Route, id: string): string {
  return route.models.find((m) => m.id === id)?.label ?? id;
}

/** Radio list of a route's models — shared by the default picker and each scenario. */
function ModelList({
  models,
  selectedId,
  onPick,
}: {
  models: RouteModel[];
  selectedId: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {models.map((m) => (
        <button
          key={m.id}
          onClick={() => onPick(m.id)}
          className={`flex items-start gap-3 rounded-md border px-3 py-2 text-left ${
            selectedId === m.id ? "border-accent bg-accent/10" : "border-rule hover:border-rule-strong"
          }`}
        >
          <span
            className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border ${
              selectedId === m.id ? "border-accent bg-accent" : "border-rule-strong"
            }`}
          />
          <span>
            <span className="block text-[13px] font-medium text-ink">{m.label}</span>
            <span className="block text-[11.5px] text-ink-3">{m.blurb}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Provider chips. Shown inside expanded editors so the provider is a per-pick
 *  choice, not a page-level global. */
function ProviderPicker({ selectedId, onPick }: { selectedId: string; onPick: (id: string) => void }) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wider text-ink-4">Provider</div>
      <div className="flex gap-1.5">
        {ROUTE_OPTIONS.map((r) => (
          <button
            key={r.id}
            onClick={() => onPick(r.id)}
            className={`rounded-md border px-3 py-1.5 text-[12px] ${
              selectedId === r.id ? "border-accent bg-accent/10 text-ink" : "border-rule text-ink-2 hover:border-rule-strong"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** One provider's key: a status row (masked — the key is write-only from JS and
 *  lives only in the Keychain) that expands into the input only when editing. */
function ProviderKeyRow({
  route,
  open,
  onToggle,
  divider,
}: {
  route: Route;
  open: boolean;
  onToggle: () => void;
  divider: boolean;
}) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    setHasKey(null);
    secretStore.hasApiKey(route.secretName).then(setHasKey).catch(() => setHasKey(false));
  }, [route.secretName]);

  // Collapsing discards any half-typed key and transient messages.
  useEffect(() => {
    if (!open) {
      setInput("");
      setMsg(null);
      setConfirmClear(false);
    }
  }, [open]);

  const save = async () => {
    const v = input.trim();
    if (!v || saving) return;
    setSaving(true);
    setMsg(null);
    try {
      await secretStore.setApiKey(route.secretName, v);
      setHasKey(true);
      setInput("");
      setMsg("Key saved.");
    } catch (e) {
      setMsg(`Couldn't save: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    try {
      await secretStore.clearApiKey(route.secretName);
      setHasKey(false);
      setConfirmClear(false);
      setMsg("Key removed.");
    } catch (e) {
      setMsg(`Couldn't remove: ${String(e)}`);
    }
  };

  const mask = route.authScheme === "x-api-key" ? "sk-ant-••••••••••••" : "••••••••••••••••";

  return (
    <div className={divider ? "border-t border-rule" : ""}>
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2/60">
        <span className="w-24 shrink-0 text-[13px] font-medium text-ink">{route.label}</span>
        <span className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-ink-3">
          <span className={`h-2 w-2 shrink-0 rounded-full ${hasKey ? "bg-accent" : "border border-rule-strong"}`} />
          {hasKey === null ? (
            "Checking…"
          ) : hasKey ? (
            <span className="truncate font-mono text-[11.5px] tracking-wide">{mask}</span>
          ) : (
            "No key set"
          )}
        </span>
        <span className="shrink-0 text-[12px] text-accent">{hasKey ? "Edit" : "Add key"}</span>
        <Chevron open={open} />
      </button>
      {open && (
        <div className="border-t border-rule/60 bg-surface-2/40 px-3 py-3">
          <input
            type="password"
            value={input}
            autoFocus
            spellCheck={false}
            placeholder={hasKey ? "Enter a new key to replace…" : route.authScheme === "bearer" ? "API key…" : "sk-ant-…"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            className="w-full rounded-md border border-rule-strong bg-surface px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={save}
              disabled={saving || !input.trim()}
              className="rounded-md bg-ink px-3 py-1.5 text-[12.5px] font-medium text-surface hover:bg-accent disabled:opacity-40"
            >
              {saving ? "Saving…" : hasKey ? "Replace key" : "Save key"}
            </button>
            {hasKey &&
              (confirmClear ? (
                <span className="flex items-center gap-2 text-[12px]">
                  <span className="text-ink-3">Remove the saved key?</span>
                  <button
                    onClick={clear}
                    className="rounded-md border border-red-400 px-2 py-1 text-red-600 hover:bg-red-400/10"
                  >
                    Remove
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    className="rounded-md border border-rule px-2 py-1 text-ink-2 hover:border-rule-strong"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmClear(true)}
                  className="rounded-md border border-rule px-3 py-1.5 text-[12.5px] text-ink-2 hover:border-rule-strong hover:text-ink"
                >
                  Remove key
                </button>
              ))}
          </div>
          {msg && <p className="mt-2 text-[12px] text-ink-3">{msg}</p>}
          <p className="mt-1 text-[11px] text-ink-4">
            Stored in your macOS Keychain. The key can't be displayed back — only replaced or removed.
          </p>
        </div>
      )}
    </div>
  );
}

/** One scenario's row: collapsed it shows the resolved model (and a "Default"
 *  badge when inheriting); expanded it offers "Use default" plus a provider +
 *  model pick that pins both for this scenario. */
function ScenarioRow({
  task,
  open,
  onToggle,
  onChanged,
  divider,
}: {
  task: AiTask;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
  divider: boolean;
}) {
  const overridden = hasTaskOverride(task.id);
  const route = getRoute(getTaskRouteId(task.id));
  const modelId = getTaskModelId(task.id);

  const defaultRoute = getRoute(getRouteId());
  const inheritedLabel = modelLabel(defaultRoute, getTaskInheritedModelId(task.id));

  // Picking a model pins the provider too, so the scenario keeps what the user
  // saw even if the default provider changes later.
  const pick = (id: string) => {
    setTaskRouteId(task.id, route.id);
    setTaskModelId(task.id, id);
    onChanged();
    onToggle();
  };

  const useDefault = () => {
    clearTaskOverride(task.id);
    onChanged();
    onToggle();
  };

  return (
    <div className={divider ? "border-t border-rule" : ""}>
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2/60">
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{task.label}</span>
        {overridden ? (
          <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-ink-2">
            <span className="font-medium text-ink">{modelLabel(route, modelId)}</span>
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-ink-3">{route.label}</span>
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-ink-3">
            {modelLabel(route, modelId)}
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10.5px]">Default</span>
          </span>
        )}
        <Chevron open={open} />
      </button>
      {open && (
        <div className="border-t border-rule/60 bg-surface-2/40 px-3 py-3">
          <button
            onClick={useDefault}
            className={`mb-3 flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left ${
              !overridden ? "border-accent bg-accent/10" : "border-rule hover:border-rule-strong"
            }`}
          >
            <span
              className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border ${
                !overridden ? "border-accent bg-accent" : "border-rule-strong"
              }`}
            />
            <span>
              <span className="block text-[13px] font-medium text-ink">Use default — {inheritedLabel}</span>
              <span className="block text-[11.5px] text-ink-3">Follows the default model above.</span>
            </span>
          </button>
          <ProviderPicker
            selectedId={route.id}
            onPick={(id) => {
              setTaskRouteId(task.id, id);
              onChanged();
            }}
          />
          <ModelList models={route.models} selectedId={overridden ? modelId : null} onPick={pick} />
        </div>
      )}
    </div>
  );
}

/** A configurable "source" (media or AI provider): an enable toggle, a one-line
 *  descriptor, and — for key-needing providers — an inline Keychain key control
 *  (`provider:<id>`, write-only from JS like the route keys). */
function SourceRow({
  id,
  label,
  sub,
  needsKey,
  enabled,
  onToggle,
  divider,
}: {
  id: string;
  label: string;
  sub: string;
  needsKey: boolean;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  divider: boolean;
}) {
  const account = `provider:${id}`;
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");

  useEffect(() => {
    if (!needsKey) return;
    setHasKey(null);
    secretStore
      .hasApiKey(account)
      .then(setHasKey)
      .catch(() => setHasKey(false));
  }, [account, needsKey]);

  const save = async () => {
    const v = input.trim();
    if (!v) return;
    try {
      await secretStore.setApiKey(account, v);
      setHasKey(true);
      setInput("");
      setEditing(false);
    } catch {
      setHasKey(false);
    }
  };

  return (
    <div className={divider ? "border-t border-rule" : ""}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          onClick={() => onToggle(!enabled)}
          aria-pressed={enabled}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${enabled ? "bg-accent" : "bg-rule-strong"}`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface transition-all ${enabled ? "left-[18px]" : "left-0.5"}`}
          />
        </button>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-ink">{label}</span>
          <span className="block text-[11.5px] text-ink-3">{sub}</span>
        </span>
        {needsKey && enabled && (
          <span className="flex shrink-0 items-center gap-1.5 text-[12px]">
            <span className={`h-2 w-2 rounded-full ${hasKey ? "bg-accent" : "border border-rule-strong"}`} />
            <button onClick={() => setEditing((e) => !e)} className="text-accent">
              {hasKey ? "Edit key" : "Add key"}
            </button>
          </span>
        )}
      </div>
      {needsKey && enabled && editing && (
        <div className="border-t border-rule/60 bg-surface-2/40 px-3 py-3">
          <input
            type="password"
            value={input}
            autoFocus
            spellCheck={false}
            placeholder="API key…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            className="w-full rounded-md border border-rule-strong bg-surface px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
          />
          <button
            onClick={save}
            disabled={!input.trim()}
            className="mt-2 rounded-md bg-ink px-3 py-1.5 text-[12.5px] font-medium text-surface hover:bg-accent disabled:opacity-40"
          >
            Save key
          </button>
          <p className="mt-1 text-[11px] text-ink-4">
            Stored in your macOS Keychain (write-only — replace or remove only).
          </p>
        </div>
      )}
    </div>
  );
}

const TABS = [
  { id: "model", label: "Models" },
  { id: "sources", label: "Sources" },
  { id: "cost", label: "Cost" },
  { id: "appearance", label: "Appearance" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const TASK_IDS = Object.keys(AI_TASKS) as AiTaskId[];

/** Settings modal. The Models tab is organized the way it's used: per-provider
 *  API keys (global, masked, edit-in-place), one default model (collapsed to the
 *  current pick), and a scenario list where each AI use case can pin its own
 *  provider + model or follow the default. Theme is driven by the parent
 *  (onChangeTheme) so the topbar toggle stays in sync. */
export function Settings({
  theme,
  onChangeTheme,
  onClose,
}: {
  theme: Theme;
  onChangeTheme: (t: Theme) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabId>("model");
  // Which disclosure is open — "default", `key:<routeId>`, or `task:<taskId>`.
  // One at a time keeps the page short, which is the point.
  const [open, setOpen] = useState<string | null>(null);
  // Settings live in localStorage and are read during render; bump to re-read
  // after a child writes.
  const [, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);
  const toggle = (id: string) => setOpen((cur) => (cur === id ? null : id));

  const [tutor, setTutor] = useState<TutorMode>(() => getTutorMode());

  const defaultRoute = getRoute(getRouteId());
  const defaultModelId = getModelId();
  const defaultOption = defaultRoute.models.find((m) => m.id === defaultModelId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const chooseDefaultRoute = (id: string) => {
    setRouteId(id);
    // Re-validate the chosen model against the new route's catalog and persist
    // the resolved id (a stale id falls back to the route default).
    setModelId(getModelId());
    refresh();
  };

  const chooseDefaultModel = (id: string) => {
    setModelId(id);
    refresh();
    setOpen(null);
  };

  const chooseTutor = (m: TutorMode) => {
    setTutor(m);
    setTutorMode(m);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[600px] max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-xl border border-rule bg-surface shadow-xl"
      >
        {/* Nav sidebar */}
        <nav className="flex w-44 shrink-0 flex-col border-r border-rule bg-surface-2/40 py-3">
          <div className="px-4 pb-2 pt-1 font-serif text-lg text-ink">Settings</div>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`mx-2 rounded-md px-3 py-2 text-left text-[13px] ${
                tab === t.id ? "bg-accent/10 font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-end border-b border-rule px-5 py-3.5">
            <button
              onClick={onClose}
              title="Close (Esc)"
              className="grid h-7 w-7 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink"
            >
              <svg width="13" height="13" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.4" fill="none">
                <path d="M2 2 L12 12 M12 2 L2 12" />
              </svg>
            </button>
          </div>

          <div className="flex flex-col gap-6 overflow-y-auto px-5 py-5">
          {tab === "model" && (
          <>
          {/* API keys — one per provider, shared by every scenario on that provider */}
          <section>
            <SectionLabel>API keys</SectionLabel>
            <div className="overflow-hidden rounded-md border border-rule">
              {ROUTE_OPTIONS.map((r, i) => (
                <ProviderKeyRow
                  key={r.id}
                  route={r}
                  divider={i > 0}
                  open={open === `key:${r.id}`}
                  onToggle={() => toggle(`key:${r.id}`)}
                />
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-ink-4">
              One key per provider, used by every scenario that sends requests there.
            </p>
          </section>

          {/* Default model — collapsed to the current pick */}
          <section>
            <SectionLabel>Default model</SectionLabel>
            <button
              onClick={() => toggle("default")}
              className={`flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left ${
                open === "default" ? "border-accent" : "border-rule hover:border-rule-strong"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-ink">
                  {defaultOption?.label ?? defaultModelId}
                </span>
                {defaultOption && <span className="block text-[11.5px] text-ink-3">{defaultOption.blurb}</span>}
              </span>
              <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-ink-3">
                {defaultRoute.label}
              </span>
              <Chevron open={open === "default"} />
            </button>
            {open === "default" && (
              <div className="mt-1.5 rounded-md border border-rule bg-surface-2/40 px-3 py-3">
                <ProviderPicker selectedId={defaultRoute.id} onPick={chooseDefaultRoute} />
                <ModelList models={defaultRoute.models} selectedId={defaultModelId} onPick={chooseDefaultModel} />
              </div>
            )}
            <p className="mt-1.5 text-[11px] text-ink-4">
              Used by any scenario below that doesn't set its own model.
            </p>
          </section>

          {/* Scenarios — per-use-case provider + model pins */}
          <section>
            <SectionLabel>Scenarios</SectionLabel>
            <div className="overflow-hidden rounded-md border border-rule">
              {TASK_IDS.map((id, i) => (
                <ScenarioRow
                  key={id}
                  task={AI_TASKS[id]}
                  divider={i > 0}
                  open={open === `task:${id}`}
                  onToggle={() => toggle(`task:${id}`)}
                  onChanged={refresh}
                />
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-ink-4">
              Each scenario can pin its own provider and model — e.g. keep lessons on a flagship
              model while widgets run on something fast and cheap.
            </p>
          </section>
          </>
          )}

          {tab === "sources" && (
            <>
              {/* Media providers — where lessons pull real images/assets from */}
              <section>
                <SectionLabel>Media sources</SectionLabel>
                <div className="overflow-hidden rounded-md border border-rule">
                  {mediaProviderRegistry.list().map((p, i) => (
                    <SourceRow
                      key={p.id}
                      id={p.id}
                      label={p.label}
                      sub={`${p.kinds.join(", ")} · ${p.needsKey ? "key required" : "no key needed"}`}
                      needsKey={p.needsKey}
                      enabled={isMediaProviderEnabled(p.id)}
                      onToggle={(on) => {
                        setMediaProviderEnabled(p.id, on);
                        refresh();
                      }}
                      divider={i > 0}
                    />
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-ink-4">
                  Real images for lessons (figures, maps). Wikimedia Commons needs no key. Disabled or offline,
                  lessons fall back to vector figures and prose.
                </p>
              </section>

              {/* Embedding providers — light up the cross-lesson SemanticIndex */}
              <section>
                <SectionLabel>Embeddings</SectionLabel>
                <div className="overflow-hidden rounded-md border border-rule">
                  {aiProviderRegistry.embeddingProviders().map((p, i) => (
                    <SourceRow
                      key={p.id}
                      id={p.id}
                      label={p.label}
                      sub={`Embeddings · ${p.needsKey ? "key required" : `local (${p.baseUrl ?? "localhost"})`}`}
                      needsKey={p.needsKey}
                      enabled={isAiProviderEnabled(p.id)}
                      onToggle={(on) => {
                        setAiProviderEnabled(p.id, on);
                        refresh();
                      }}
                      divider={i > 0}
                    />
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-ink-4">
                  Optional. Enables semantic cross-lesson links (the SemanticIndex). Lessons still cohere via the
                  course canon without it.
                </p>
              </section>
            </>
          )}

          {tab === "cost" && (
            /* Usage */
            <UsageSection />
          )}

          {tab === "appearance" && (
          <>
          {/* Appearance */}
          <section>
            <SectionLabel>Appearance</SectionLabel>
            <div className="flex gap-1.5">
              {THEMES.map((t) => (
                <button
                  key={t}
                  onClick={() => onChangeTheme(t)}
                  className={`flex-1 rounded-md border px-3 py-2 text-[12.5px] capitalize ${
                    theme === t ? "border-accent bg-accent/10 text-ink" : "border-rule text-ink-2 hover:border-rule-strong"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </section>

          {/* Default tutor mode */}
          <section>
            <SectionLabel>Default tutor mode</SectionLabel>
            <div className="flex gap-1.5">
              {(Object.keys(TUTOR_MODES) as TutorMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => chooseTutor(m)}
                  className={`flex-1 rounded-md border px-3 py-2 text-[12.5px] ${
                    tutor === m ? "border-accent bg-accent/10 text-ink" : "border-rule text-ink-2 hover:border-rule-strong"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-ink-4">
              Sets the default for new chats. A lesson's chat can still switch modes on the fly.
            </p>
          </section>
          </>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
