import { anthropicTextAdapter } from "./anthropic";
import type { ProviderSettingsEnvelope, TextProviderAdapter } from "./types";
import type { AiTaskId } from "../tasks";

const adapters = new Map<string, TextProviderAdapter>();
adapters.set(anthropicTextAdapter.id, anthropicTextAdapter);

export function getTextProviderAdapter(id: string): TextProviderAdapter {
  const adapter = adapters.get(id);
  if (!adapter) throw new Error(`Text provider adapter "${id}" is not registered.`);
  return adapter;
}

export function findTextProviderAdapter(id: string): TextProviderAdapter | undefined {
  return adapters.get(id);
}

export function resolveTextProviderSettings(args: {
  adapterId: string;
  modelId: string;
  task?: AiTaskId;
  envelope: ProviderSettingsEnvelope | null;
}): { adapter: TextProviderAdapter; value: unknown } {
  const adapter = getTextProviderAdapter(args.adapterId);
  const envelope = args.envelope;
  const value =
    envelope?.adapter === adapter.id && envelope.version === adapter.settingsVersion
      ? adapter.parseSettings({ modelId: args.modelId, value: envelope.value, task: args.task })
      : adapter.defaultSettings({ modelId: args.modelId, task: args.task });
  return { adapter, value };
}

export type { ProviderSettingsEnvelope, TextProviderAdapter } from "./types";
