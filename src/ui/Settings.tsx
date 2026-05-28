import { useEffect, useState, type ReactNode } from "react";
import { secretStore } from "../core/secrets";
import { MODEL_OPTIONS, type ModelId } from "../core/ai/models";
import { getModelId, setModelId, getTutorMode, setTutorMode, THEMES, type Theme } from "../core/settings";
import { TUTOR_MODES, type TutorMode } from "../core/generation/tutor";

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mb-2 text-[10.5px] font-medium uppercase tracking-wider text-ink-3">{children}</div>;
}

/** Settings modal: manage the BYO API key (set / replace / remove — never shown),
 *  pick the model used for all generation, and set theme + default tutor mode.
 *  Theme is driven by the parent (onChangeTheme) so the topbar toggle stays in sync. */
export function Settings({
  theme,
  onChangeTheme,
  onClose,
}: {
  theme: Theme;
  onChangeTheme: (t: Theme) => void;
  onClose: () => void;
}) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [keyMsg, setKeyMsg] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [model, setModel] = useState<ModelId>(() => getModelId());
  const [tutor, setTutor] = useState<TutorMode>(() => getTutorMode());

  useEffect(() => {
    secretStore.hasApiKey().then(setHasKey).catch(() => setHasKey(false));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const saveKey = async () => {
    const v = keyInput.trim();
    if (!v || savingKey) return;
    setSavingKey(true);
    setKeyMsg(null);
    try {
      await secretStore.setApiKey(v);
      setHasKey(true);
      setKeyInput("");
      setKeyMsg("Key saved.");
    } catch (e) {
      setKeyMsg(`Couldn't save: ${String(e)}`);
    } finally {
      setSavingKey(false);
    }
  };

  const clearKey = async () => {
    try {
      await secretStore.clearApiKey();
      setHasKey(false);
      setConfirmClear(false);
      setKeyMsg("Key removed. Add a new one to keep generating.");
    } catch (e) {
      setKeyMsg(`Couldn't remove: ${String(e)}`);
    }
  };

  const chooseModel = (id: ModelId) => {
    setModel(id);
    setModelId(id);
  };
  const chooseTutor = (m: TutorMode) => {
    setTutor(m);
    setTutorMode(m);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-rule bg-surface shadow-xl"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-rule bg-surface px-5 py-3.5">
          <h2 className="font-serif text-lg text-ink">Settings</h2>
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

        <div className="flex flex-col gap-6 px-5 py-5">
          {/* API key */}
          <section>
            <SectionLabel>API key</SectionLabel>
            <div className="mb-2 flex items-center gap-2 text-[12.5px] text-ink-2">
              <span className={`h-2 w-2 rounded-full ${hasKey ? "bg-accent" : "border border-rule-strong"}`} />
              {hasKey === null
                ? "Checking…"
                : hasKey
                  ? "A key is set — stored in your macOS Keychain."
                  : "No key set."}
            </div>
            <input
              type="password"
              value={keyInput}
              spellCheck={false}
              placeholder={hasKey ? "Enter a new key to replace…" : "sk-ant-…"}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveKey()}
              className="w-full rounded-md border border-rule-strong bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                onClick={saveKey}
                disabled={savingKey || !keyInput.trim()}
                className="rounded-md bg-ink px-3 py-1.5 text-[12.5px] font-medium text-surface hover:bg-accent disabled:opacity-40"
              >
                {savingKey ? "Saving…" : hasKey ? "Replace key" : "Save key"}
              </button>
              {hasKey &&
                (confirmClear ? (
                  <span className="flex items-center gap-2 text-[12px]">
                    <span className="text-ink-3">Remove the saved key?</span>
                    <button
                      onClick={clearKey}
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
            {keyMsg && <p className="mt-2 text-[12px] text-ink-3">{keyMsg}</p>}
            <p className="mt-1 text-[11px] text-ink-4">
              The key is never shown — it's write-only from the app and lives only in your Keychain.
            </p>
          </section>

          {/* Model */}
          <section>
            <SectionLabel>Model</SectionLabel>
            <div className="flex flex-col gap-1.5">
              {MODEL_OPTIONS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => chooseModel(m.id)}
                  className={`flex items-start gap-3 rounded-md border px-3 py-2 text-left ${
                    model === m.id ? "border-accent bg-accent/10" : "border-rule hover:border-rule-strong"
                  }`}
                >
                  <span
                    className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border ${
                      model === m.id ? "border-accent bg-accent" : "border-rule-strong"
                    }`}
                  />
                  <span>
                    <span className="block text-[13px] font-medium text-ink">{m.label}</span>
                    <span className="block text-[11.5px] text-ink-3">{m.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-ink-4">
              Applies to all generation — lessons, chat, quizzes, and teach-back grading.
            </p>
          </section>

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
        </div>
      </div>
    </div>
  );
}
