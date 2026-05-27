// Reactive read/write layer (TanStack Query over the repositories). The UI binds
// to these hooks, never to drizzle directly — keeping the swap-to-sync seam.
import { QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { topicRepo, conceptRepo } from "./repositories";
import { startTopic } from "../generation/outline";

export const queryClient = new QueryClient();

/** Topics list. Gated until the store is ready (migrations applied). */
export const useTopics = (enabled = true) =>
  useQuery({ queryKey: ["topics"], queryFn: () => topicRepo.list(), enabled });

/** Concepts for the active topic. */
export const useConcepts = (topicId: string | null) =>
  useQuery({
    queryKey: ["concepts", topicId],
    queryFn: () => conceptRepo.byTopic(topicId as string),
    enabled: !!topicId,
  });

/** Start a topic: AI outline -> persisted concept tree. */
export function useStartTopic() {
  return useMutation({
    mutationFn: (title: string) => startTopic(title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["topics"] });
      queryClient.invalidateQueries({ queryKey: ["concepts"] });
    },
  });
}
