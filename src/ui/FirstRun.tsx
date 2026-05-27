import { useState } from "react";
import { secretStore } from "../core/secrets";

/** First-run gate: capture the BYO API key into the OS keychain. No account. */
export function FirstRun({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!value.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await secretStore.setApiKey(value.trim());
      onDone();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  return (
    <div className="grid h-full place-items-center bg-bg p-8">
      <div className="w-full max-w-md rounded-xl border border-rule bg-surface p-7 shadow-sm">
        <h1 className="font-serif text-2xl tracking-tight text-ink">Welcome to Ascent</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          Ascent runs on your own API key. It's stored in your macOS Keychain and never leaves your
          machine.
        </p>

        <label className="mt-6 block text-[10.5px] font-medium uppercase tracking-wider text-ink-3">
          Anthropic API key
        </label>
        <input
          type="password"
          value={value}
          autoFocus
          spellCheck={false}
          placeholder="sk-ant-…"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          className="mt-1.5 w-full rounded-md border border-rule-strong bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
        />
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

        <button
          onClick={save}
          disabled={saving || !value.trim()}
          className="mt-5 w-full rounded-md bg-ink py-2 text-sm font-medium text-surface transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save & continue"}
        </button>
        <p className="mt-3 text-center text-[11px] text-ink-3">
          No account needed. You can change this later in Settings.
        </p>
      </div>
    </div>
  );
}
