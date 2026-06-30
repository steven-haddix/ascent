import { dlog } from "../debug";
import { mediaProviderRegistry } from "../media/registry";
import { isGenerative } from "../media/types";
import { cacheGeneratedAsset, providerRequest } from "../providerExecutor";
import { queryClient } from "../store/queryClient";
import { mediaRepo, type MediaAssetInsert, type MediaAssetRow } from "../store/repositories";
import type { Block } from "../types";

const running = new Set<string>();
const activeSignatures = new Map<string, string>();
const queued = new Map<string, GeneratedImageJobInput>();
const settled = new Set<string>();
const keyOf = (conceptId: string, mediaId: string) => `${conceptId}:${mediaId}`;

export interface GeneratedImageJobInput {
  conceptId: string;
  mediaId: string;
  prompt: string;
  purpose?: string;
  preferredProviderId?: string;
}

function publish(row: MediaAssetRow) {
  queryClient.setQueryData(["media", row.conceptId, row.mediaId], row);
}

export function isGeneratedImageJobRunning(conceptId: string, mediaId: string): boolean {
  return running.has(keyOf(conceptId, mediaId));
}

/** Generate and locally cache one illustration. Providers are tried in enabled
 *  registry order, so an outage on one can fail over to the other. */
export function ensureGeneratedImageJob(input: GeneratedImageJobInput, force = false): void {
  const key = keyOf(input.conceptId, input.mediaId);
  const signature = `${key}|${input.prompt}|${input.preferredProviderId ?? "auto"}`;
  if (running.has(key)) {
    if (activeSignatures.get(key) !== signature) queued.set(key, input);
    return;
  }
  if (!force && settled.has(signature)) return;
  running.add(key);
  activeSignatures.set(key, signature);

  void (async () => {
    const now = Date.now();
    const base: MediaAssetInsert = {
      conceptId: input.conceptId,
      mediaId: input.mediaId,
      kind: "generated-image",
      providerId: input.preferredProviderId ?? null,
      query: input.prompt,
      status: "generating",
      localPath: null,
      width: null,
      height: null,
      license: null,
      attribution: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const existing = await mediaRepo.get(input.conceptId, input.mediaId);
      if (!force && existing?.kind === "generated-image" && existing.query === input.prompt && existing.status !== "generating") {
        settled.add(signature);
        return;
      }
      await mediaRepo.upsert(base);
      publish(base as MediaAssetRow);

      let providers = mediaProviderRegistry.enabled().filter(isGenerative);
      if (input.preferredProviderId) {
        providers = providers.filter((p) => p.id === input.preferredProviderId);
      }
      if (providers.length === 0) {
        throw new Error(
          input.preferredProviderId
            ? "The requested image provider is not enabled"
            : "No generative image provider is enabled",
        );
      }

      let lastError: unknown;
      for (const provider of providers) {
        try {
          const descriptor = provider.buildGenerate(input.prompt, {
            size: "1536x864",
            aspectRatio: "16:9",
            quality: "medium",
            n: 1,
          });
          const response = await providerRequest(descriptor);
          const body = JSON.parse(response.body) as unknown;
          if (response.status < 200 || response.status >= 300) {
            const message =
              typeof body === "object" && body && "error" in body
                ? JSON.stringify((body as { error?: unknown }).error)
                : `HTTP ${response.status}`;
            throw new Error(message);
          }
          const result = provider.parseGenerate(body);
          if (result.payload.kind !== "generated-image") throw new Error("Provider returned the wrong media kind");
          const cached = await cacheGeneratedAsset(
            result.payload.data,
            result.payload.mimeType,
            `${input.conceptId}:${input.mediaId}:${input.prompt}:${provider.id}`,
          );
          // A tutor refinement arrived while this provider was working. Do not
          // publish the stale image; `finally` immediately starts the queued prompt.
          if (queued.has(key)) return;
          const ready: MediaAssetInsert = {
            ...base,
            status: "ready",
            providerId: provider.id,
            localPath: cached.localPath,
            width: cached.width ?? result.payload.width ?? null,
            height: cached.height ?? result.payload.height ?? null,
            license: result.license,
            attribution: result.attribution,
            updatedAt: Date.now(),
          };
          await mediaRepo.upsert(ready);
          publish(ready as MediaAssetRow);
          return;
        } catch (err) {
          lastError = err;
          dlog("generated-image", provider.id, "failed:", err instanceof Error ? err.message : String(err));
        }
      }
      throw lastError ?? new Error("Image generation failed");
    } catch (err) {
      const failed: MediaAssetInsert = {
        ...base,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        updatedAt: Date.now(),
      };
      try {
        await mediaRepo.upsert(failed);
        publish(failed as MediaAssetRow);
      } catch {
        /* best-effort failure state */
      }
    } finally {
      running.delete(key);
      activeSignatures.delete(key);
      settled.add(signature);
      const next = queued.get(key);
      if (next) {
        queued.delete(key);
        ensureGeneratedImageJob(next, true);
      }
    }
  })();
}

export function scanForGeneratedImageJobs(
  conceptId: string,
  blocks: ReadonlyArray<Block | undefined> | undefined,
): void {
  for (const block of blocks ?? []) {
    if (block?.kind === "generated-image" && block.mediaId && block.prompt) {
      ensureGeneratedImageJob({
        conceptId,
        mediaId: block.mediaId,
        prompt: block.prompt,
        purpose: block.purpose,
      });
    }
  }
}

export function resumeGeneratedImageJobIfStuck(row: MediaAssetRow): void {
  if (row.kind !== "generated-image" || row.status !== "generating" || isGeneratedImageJobRunning(row.conceptId, row.mediaId)) {
    return;
  }
  ensureGeneratedImageJob(
    {
      conceptId: row.conceptId,
      mediaId: row.mediaId,
      prompt: row.query,
      preferredProviderId: row.providerId ?? undefined,
    },
    true,
  );
}
