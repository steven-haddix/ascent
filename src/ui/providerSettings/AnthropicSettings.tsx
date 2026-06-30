import {
  ANTHROPIC_SETTINGS_VERSION,
  anthropicModelCapabilities,
  anthropicSettingsEnvelope,
  anthropicThinkingAvailable,
  defaultAnthropicSettings,
  parseAnthropicSettings,
  type AnthropicEffort,
  type AnthropicModelSettings,
} from "../../core/ai/text/anthropic";
import type { ProviderSettingsPanelProps } from "./types";

const BUDGETS = [1024, 4096, 8192, 16384] as const;

function labelEffort(value: AnthropicEffort): string {
  return value === "xhigh" ? "X-high" : value[0].toUpperCase() + value.slice(1);
}

export function AnthropicSettings({ modelId, task, envelope, onChange }: ProviderSettingsPanelProps) {
  const capabilities = anthropicModelCapabilities(modelId);
  const raw =
    envelope?.adapter === "anthropic" && envelope.version === ANTHROPIC_SETTINGS_VERSION
      ? envelope.value
      : defaultAnthropicSettings(modelId, task);
  const settings = parseAnthropicSettings(modelId, raw, task);
  const thinkingAvailable = anthropicThinkingAvailable(task);
  const thinkingOn = settings.thinking.type !== "disabled";

  const commit = (next: AnthropicModelSettings) => onChange(anthropicSettingsEnvelope(next));
  const setThinking = (on: boolean) => {
    commit({
      ...settings,
      thinking: on
        ? capabilities.thinking === "adaptive"
          ? { type: "adaptive", display: "omitted" }
          : { type: "enabled", budgetTokens: 4096 }
        : { type: "disabled" },
    });
  };

  return (
    <div className="mt-3 border-t border-rule pt-3">
      <div className="mb-2 text-[10.5px] font-medium uppercase tracking-wider text-ink-4">
        Anthropic options
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[12.5px] font-medium text-ink">
            {capabilities.thinking === "adaptive" ? "Adaptive thinking" : "Extended thinking"}
          </div>
          <div className="mt-0.5 text-[11px] leading-4 text-ink-3">
            {thinkingAvailable
              ? capabilities.thinking === "adaptive"
                ? "Claude decides when and how long to reason."
                : "Claude reasons within a fixed token budget."
              : "Unavailable here because this scenario requires forced JSON-tool output."}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={thinkingOn}
          disabled={!thinkingAvailable}
          onClick={() => setThinking(!thinkingOn)}
          className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            thinkingOn ? "bg-accent" : "bg-rule-strong"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
              thinkingOn ? "translate-x-[18px]" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {settings.thinking.type === "enabled" && (
        <div className="mt-3">
          <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wider text-ink-4">
            Thinking budget
          </div>
          <div className="flex flex-wrap gap-1.5">
            {BUDGETS.map((budget) => (
              <button
                type="button"
                key={budget}
                onClick={() => commit({ ...settings, thinking: { type: "enabled", budgetTokens: budget } })}
                className={`rounded-md border px-2 py-1 text-[11.5px] ${
                  settings.thinking.type === "enabled" && settings.thinking.budgetTokens === budget
                    ? "border-accent bg-accent/10 text-ink"
                    : "border-rule text-ink-2 hover:border-rule-strong"
                }`}
              >
                {budget >= 1024 ? `${budget / 1024}k` : budget}
              </button>
            ))}
          </div>
        </div>
      )}

      {capabilities.effortLevels.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wider text-ink-4">Effort</div>
          <div className="flex flex-wrap gap-1.5">
            {capabilities.effortLevels.map((effort) => (
              <button
                type="button"
                key={effort}
                onClick={() => commit({ ...settings, effort })}
                className={`rounded-md border px-2 py-1 text-[11.5px] ${
                  settings.effort === effort
                    ? "border-accent bg-accent/10 text-ink"
                    : "border-rule text-ink-2 hover:border-rule-strong"
                }`}
              >
                {labelEffort(effort)}
              </button>
            ))}
          </div>
          <div className="mt-1 text-[10.5px] text-ink-4">Controls response depth and, when enabled, thinking depth.</div>
        </div>
      )}
    </div>
  );
}
