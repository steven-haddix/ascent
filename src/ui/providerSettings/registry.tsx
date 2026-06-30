import type { ComponentType } from "react";
import { AnthropicSettings } from "./AnthropicSettings";
import type { ProviderSettingsPanelProps } from "./types";

const PANELS: Record<string, ComponentType<ProviderSettingsPanelProps>> = {
  anthropic: AnthropicSettings,
};

export function ProviderSettingsPanel(
  props: ProviderSettingsPanelProps & { adapterId: string },
) {
  const Panel = PANELS[props.adapterId];
  if (!Panel) return null;
  return <Panel modelId={props.modelId} task={props.task} envelope={props.envelope} onChange={props.onChange} />;
}
