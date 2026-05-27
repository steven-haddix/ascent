import { defineConfig } from "drizzle-kit";

// Generate-only workflow: `bunx drizzle-kit generate` emits SQL migrations that
// the app applies at startup via the Rust db_execute command (see migrate.ts).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/core/store/schema.ts",
  out: "./src/core/store/migrations",
});
