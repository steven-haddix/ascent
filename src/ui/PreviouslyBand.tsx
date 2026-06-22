/** A top-of-lesson orienting band: "you came from X, which established Y."
 *  Lighter than NextSteps — this is a contextual anchor, not a call to action.
 *  Renders nothing if the parent decides not to mount it. */
export function PreviouslyBand({
  fromTitle,
  recap,
  onGo,
}: {
  fromTitle: string;
  recap: string;
  onGo: () => void;
}) {
  return (
    <div className="mb-7 font-sans">
      <div className="mb-2 border-b border-rule pb-2">
        <span className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">Previously</span>
      </div>
      <button
        onClick={onGo}
        className="w-full rounded-md border border-rule bg-surface px-3 py-2.5 text-left hover:border-accent hover:bg-surface-2"
      >
        <span className="block text-[13px] font-medium text-ink">{fromTitle}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">{recap}</span>
      </button>
    </div>
  );
}
