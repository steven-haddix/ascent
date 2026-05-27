import { useEffect, useState } from "react";
import { runMigrations } from "../core/store/migrate";
import { secretStore } from "../core/secrets";
import { FirstRun } from "./FirstRun";
import { AppShell } from "./AppShell";

type Phase = "loading" | "first-run" | "ready";

export function App() {
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    (async () => {
      await runMigrations();
      const hasKey = await secretStore.hasApiKey();
      setPhase(hasKey ? "ready" : "first-run");
    })().catch((err) => {
      // If the store/keychain isn't reachable yet, fall through to first-run.
      console.error("[ascent] startup failed:", err);
      setPhase("first-run");
    });
  }, []);

  if (phase === "loading") {
    return <div className="grid h-screen place-items-center bg-bg text-sm text-ink-3">Loading…</div>;
  }
  if (phase === "first-run") {
    return <FirstRun onDone={() => setPhase("ready")} />;
  }
  return <AppShell />;
}
