import { useEffect, useRef, useState } from "react";
import { runMigrations } from "../core/store/migrate";
import { secretStore } from "../core/secrets";
import { useTopics, useConcepts, useStartTopic, useForkConcept } from "../core/store/hooks";
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
  const fork = useForkConcept();

  // Open the most recent topic once, on first load — but never again. "New topic"
  // clears activeTopicId to show the Trailhead; keying this effect off !activeTopicId
  // would immediately re-open the existing topic, defeating the button.
  const didInitialOpen = useRef(false);
  useEffect(() => {
    if (phase !== "ready" || didInitialOpen.current || !topics.data) return;
    didInitialOpen.current = true;
    if (topics.data.length > 0) {
      const recent = topics.data[topics.data.length - 1];
      setActiveTopicId(recent.id);
      setSelectedConceptId(recent.rootConceptId ?? null);
    }
  }, [phase, topics.data]);

  const handleSelectTopic = (topicId: string) => {
    const topic = topics.data?.find((t) => t.id === topicId);
    setActiveTopicId(topicId);
    setSelectedConceptId(topic?.rootConceptId ?? null);
  };

  const handleStartTopic = (title: string) => {
    startTopic.mutate(title, {
      onSuccess: ({ topicId, rootConceptId }) => {
        setActiveTopicId(topicId);
        setSelectedConceptId(rootConceptId);
      },
    });
  };

  const handleFork = (title: string, summary?: string) => {
    if (!activeTopicId || !selectedConceptId) return;
    fork.mutate(
      { topicId: activeTopicId, parentId: selectedConceptId, title, summary },
      { onSuccess: (newId) => setSelectedConceptId(newId) }, // select it -> generates on visit
    );
  };

  if (phase === "loading") {
    return <div className="grid h-screen place-items-center bg-bg text-sm text-ink-3">Loading…</div>;
  }
  if (phase === "first-run") {
    return <FirstRun onDone={() => setPhase("ready")} />;
  }

  return (
    <AppShell
      topics={topics.data ?? []}
      activeTopicId={activeTopicId}
      onSelectTopic={handleSelectTopic}
      concepts={concepts.data ?? []}
      selectedConceptId={selectedConceptId}
      onSelectConcept={setSelectedConceptId}
      onStartTopic={handleStartTopic}
      starting={startTopic.isPending}
      startError={startTopic.error ? ((startTopic.error as Error).message ?? String(startTopic.error)) : null}
      onNewTopic={() => {
        setActiveTopicId(null);
        setSelectedConceptId(null);
      }}
      onFork={handleFork}
    />
  );
}
