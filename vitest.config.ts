import { defineConfig } from "vitest/config";

// Pure-logic unit tests (anchoring + mark merging). No DOM, no Vite plugins —
// kept separate from vite.config.ts so the React/Tailwind plugins don't load.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
