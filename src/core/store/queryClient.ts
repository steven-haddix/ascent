// The single TanStack Query client. Extracted from hooks.ts so non-hook modules
// (e.g. the lesson stream registry) can publish into the cache without importing
// the hooks module — avoiding an import cycle.
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient();
