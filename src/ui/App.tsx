import { useEffect, useState } from "react";
import { runMigrations } from "../core/store/migrate";
import { secretStore } from "../core/secrets";
import { useTopics, useConcepts, useStartTopic } from "../core/store/hooks";
import { FirstRun } from "./FirstRun";
import { AppShell } from "./AppShell";

type Phase = "loading" | "first-run" | "ready";

export function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      await runMigrations();
      const hasKey = await secretStore.hasApiKey();
      setPhase(hasKey ? "ready" : "first-run");
    })().catch((err) => {
      console.error("[ascent] startup failed:", err);
      setPhase("first-run");
    });
  }, []);

  const topics = useTopics(phase === "ready");
  const concepts = useConcepts(activeTopicId);
  const startTopic = useStartTopic();

  // Open the most recent topic on first load.
  useEffect(() => {
    if (phase === "ready" && !activeTopicId && topics.data && topics.data.length > 0) {
      const recent = topics.data[topics.data.length - 1];
      setActiveTopicId(recent.id);
      setSelectedConceptId(recent.rootConceptId ?? null);
    }
  }, [phase, activeTopicId, topics.data]);

  const handleStartTopic = (title: string) => {
    startTopic.mutate(title, {
      onSuccess: ({ topicId, rootConceptId }) => {
        setActiveTopicId(topicId);
        setSelectedConceptId(rootConceptId);
      },
    });
  };

  if (phase === "loading") {
    return <div className="grid h-screen place-items-center bg-bg text-sm text-ink-3">Loading…</div>;
  }
  if (phase === "first-run") {
    return <FirstRun onDone={() => setPhase("ready")} />;
  }

  return (
    <AppShell
      activeTopicId={activeTopicId}
      concepts={concepts.data ?? []}
      selectedConceptId={selectedConceptId}
      onSelectConcept={setSelectedConceptId}
      onStartTopic={handleStartTopic}
      starting={startTopic.isPending}
      onNewTopic={() => {
        setActiveTopicId(null);
        setSelectedConceptId(null);
      }}
    />
  );
}
