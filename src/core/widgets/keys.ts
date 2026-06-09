// Widget key derivation — the one place a placeholder block's model-minted slug
// becomes the (conceptId, widgetId) row key. The lesson stream scanner (job
// kickoff) and the renderer (row lookup) both go through widgetKeysFor, so they
// can never disagree about which row a block points to.
import type { Block } from "../types";

const MAX_SLUG = 48;

/** Normalize a model-minted slug to a safe kebab key; derives one from the title
 *  when the slug is missing/empty, and falls back to the block position. */
export function normalizeWidgetSlug(
  raw: string | undefined,
  title: string | undefined,
  index: number,
): string {
  const base = (raw?.trim() || title?.trim() || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, "");
  return base || `widget-${index + 1}`;
}

/** Per-block widget keys for a lesson's block list: normalized slugs, with
 *  collisions deduped deterministically by block order (`slug`, `slug-2`, …).
 *  Widget blocks missing a title or spec are skipped — the same completeness
 *  rule the scanner and renderer apply — so the keys agree whether computed
 *  over raw or renderable-filtered blocks. Safe on streaming partials: keys for
 *  earlier blocks never change as later blocks append. */
export function widgetKeysFor(
  blocks: ReadonlyArray<Pick<Block, "kind" | "widgetId" | "title" | "spec"> | undefined>,
): Map<number, string> {
  const keys = new Map<number, string>();
  const seen = new Map<string, number>();
  blocks.forEach((b, i) => {
    if (b?.kind !== "widget" || !b.title?.trim() || !b.spec?.trim()) return;
    const slug = normalizeWidgetSlug(b.widgetId, b.title, i);
    const n = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, n);
    keys.set(i, n === 1 ? slug : `${slug}-${n}`);
  });
  return keys;
}
