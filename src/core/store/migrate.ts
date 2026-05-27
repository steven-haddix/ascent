// Migration runner. `drizzle-kit generate` emits .sql files into ./migrations;
// Vite inlines them at build time and we apply any not yet recorded. Runs once
// at app startup, before the UI reads the store.
import { invoke } from "@tauri-apps/api/core";

const files = import.meta.glob("./migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

async function exec(sql: string): Promise<void> {
  await invoke("db_execute", { sql, params: [], method: "run" });
}

export async function runMigrations(): Promise<void> {
  await exec(
    "CREATE TABLE IF NOT EXISTS __ascent_migrations (tag TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );
  const { rows } = await invoke<{ rows: unknown[][] }>("db_execute", {
    sql: "SELECT tag FROM __ascent_migrations",
    params: [],
    method: "all",
  });
  const applied = new Set(rows.map((r) => r[0] as string));

  for (const path of Object.keys(files).sort()) {
    const tag = path.split("/").pop()!.replace(/\.sql$/, "");
    if (applied.has(tag)) continue;
    // drizzle separates statements with this marker; rusqlite executes one at a time.
    for (const stmt of files[path].split("--> statement-breakpoint")) {
      const trimmed = stmt.trim();
      if (trimmed) await exec(trimmed);
    }
    await invoke("db_execute", {
      sql: "INSERT INTO __ascent_migrations (tag, applied_at) VALUES (?, ?)",
      params: [tag, Date.now()],
      method: "run",
    });
  }
}
