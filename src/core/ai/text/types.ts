import type { LanguageModelMiddleware, Tool } from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { Route } from "../routes";
import type { AiTaskId } from "../tasks";

/** JSON-safe provider configuration stored alongside a route/model selection.
 *  Core deliberately treats `value` as opaque; only the named adapter may parse it. */
export interface ProviderSettingsEnvelope {
  adapter: string;
  version: number;
  value: unknown;
}

export type RouteFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface TextProviderAdapter {
  id: string;
  settingsVersion: number;
  buildModel(args: { route: Route; modelId: string; fetch: RouteFetch }): LanguageModelV3;
  defaultSettings(args: { modelId: string; task?: AiTaskId }): unknown;
  parseSettings(args: { modelId: string; value: unknown; task?: AiTaskId }): unknown;
  settingsMiddleware(args: {
    modelId: string;
    task?: AiTaskId;
    settings: unknown;
  }): LanguageModelMiddleware;
  buildNativeWebSearchTool?(args: { route: Route; fetch: RouteFetch; maxUses: number }): Tool;
}
