import type { ProviderSettingsEnvelope } from "../../core/ai/text/registry";
import type { AiTaskId } from "../../core/ai/tasks";

export interface ProviderSettingsPanelProps {
  modelId: string;
  task?: AiTaskId;
  envelope: ProviderSettingsEnvelope | null;
  onChange: (settings: ProviderSettingsEnvelope) => void;
}
