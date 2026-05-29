// The Usage section of Settings: estimated AI spend (BYO key, your own cost).
// Tokens are ground truth; the dollar figure is estimated from each route's
// published rates (or a gateway's reported cost), so it's labeled accordingly.
import { useState } from "react";
import { useUsageSummary, useClearUsage, USAGE_WINDOW_DAYS } from "../core/store/hooks";
import { getRoute } from "../core/ai/routes";
import type { UsageDay } from "../core/store/repositories";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-[10.5px] font-medium uppercase tracking-wider text-ink-3">{children}</div>;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Estimated-cost formatting. Tiny non-zero amounts read as "<$0.01"; otherwise
 *  2 decimals for dollars, 4 for sub-dollar so per-model rows stay informative. */
function fmtUsd(n: number, precise = false): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(precise && n < 1 ? 4 : 2)}`;
}

/** Friendly label for a recorded (provider, model) pair, e.g. "Anthropic · Opus 4.8". */
function modelLabel(provider: string, modelId: string): string {
  const route = getRoute(provider);
  const m = route.models.find((x) => x.id === modelId);
  return `${route.label} · ${m?.label ?? modelId}`;
}

/** Last-N-days cost as small SVG bars. Builds a dense day axis so gaps render as
 *  empty slots rather than collapsing the timeline. */
function Sparkline({ daily }: { daily: UsageDay[] }) {
  const byDay = new Map(daily.map((d) => [d.day, d.costUsd]));
  const today = new Date();
  const days: number[] = [];
  for (let i = USAGE_WINDOW_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push(byDay.get(key) ?? 0);
  }
  const max = Math.max(...days, 0);
  if (max === 0) return null;

  const W = 240;
  const H = 32;
  const gap = 1;
  const bw = (W - gap * (days.length - 1)) / days.length;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-2 h-8 w-full">
      {days.map((v, i) => {
        const h = v > 0 ? Math.max(2, (v / max) * H) : 0;
        return (
          <rect
            key={i}
            x={i * (bw + gap)}
            y={H - h}
            width={bw}
            height={h}
            rx={0.5}
            className="fill-accent"
            opacity={v > 0 ? 0.85 : 0}
          />
        );
      })}
    </svg>
  );
}

export function UsageSection() {
  const { data, isLoading } = useUsageSummary();
  const clear = useClearUsage();
  const [confirmClear, setConfirmClear] = useState(false);

  const totals = data?.totals;
  const byModel = data?.byModel ?? [];
  const daily = data?.daily ?? [];
  const windowCost = daily.reduce((s, d) => s + d.costUsd, 0);
  const hasData = !!totals && totals.events > 0;

  return (
    <section>
      <SectionLabel>Usage</SectionLabel>

      {isLoading && !data ? (
        <p className="text-[12px] text-ink-3">Loading…</p>
      ) : !hasData ? (
        <p className="text-[12px] text-ink-3">
          No usage yet. Costs appear here as you generate lessons, chat, quizzes, and grades.
        </p>
      ) : (
        <>
          {/* Headline */}
          <div className="rounded-lg border border-rule bg-surface-2 px-4 py-3">
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-2xl text-ink">{fmtUsd(totals.costUsd)}</span>
              <span className="rounded bg-ink/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
                estimated
              </span>
            </div>
            <div className="mt-0.5 text-[11.5px] text-ink-3">
              {fmtTokens(totals.inputTokens)} in · {fmtTokens(totals.outputTokens)} out · {totals.events} calls
            </div>
          </div>

          {totals.hasUnknownCost && (
            <p className="mt-1.5 text-[11px] text-ink-4">
              Some calls used a model with no known rate — those are counted in tokens but not in the dollar estimate.
            </p>
          )}

          {/* By model */}
          <div className="mt-3 flex flex-col gap-1">
            {byModel
              .slice()
              .sort((a, b) => b.costUsd - a.costUsd)
              .map((row) => (
                <div
                  key={`${row.provider}:${row.model}`}
                  className="flex items-center justify-between gap-3 rounded-md px-1 py-1 text-[12px]"
                >
                  <span className="truncate text-ink-2">{modelLabel(row.provider, row.model)}</span>
                  <span className="flex shrink-0 items-center gap-2.5 text-ink-3">
                    <span className="font-mono text-[11px]">
                      {fmtTokens(row.inputTokens)}/{fmtTokens(row.outputTokens)}
                    </span>
                    <span className="w-14 text-right font-medium text-ink">
                      {row.hasUnknownCost ? "—" : fmtUsd(row.costUsd, true)}
                    </span>
                  </span>
                </div>
              ))}
          </div>

          {/* Over time */}
          <div className="mt-3">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-ink-3">Last {USAGE_WINDOW_DAYS} days</span>
              <span className="text-[11.5px] font-medium text-ink-2">{fmtUsd(windowCost)}</span>
            </div>
            <Sparkline daily={daily} />
          </div>

          {/* Reset */}
          <div className="mt-3">
            {confirmClear ? (
              <span className="flex items-center gap-2 text-[12px]">
                <span className="text-ink-3">Clear all usage data?</span>
                <button
                  onClick={() => {
                    clear.mutate();
                    setConfirmClear(false);
                  }}
                  className="rounded-md border border-red-400 px-2 py-1 text-red-600 hover:bg-red-400/10"
                >
                  Clear
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
                className="text-[11.5px] text-ink-3 underline-offset-2 hover:text-ink-2 hover:underline"
              >
                Reset usage data
              </button>
            )}
          </div>
        </>
      )}

      <p className="mt-2 text-[11px] text-ink-4">
        Estimated from published model rates — your provider's invoice is the source of truth.
      </p>
    </section>
  );
}
