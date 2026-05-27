// Drizzle client over the Rust `db_execute` command (sqlite-proxy driver).
//
// The Rust side returns rows as positional value arrays (`rows: unknown[][]`),
// which is exactly the shape sqlite-proxy wants. For `get`, drizzle expects a
// single positional row (or undefined when there's no match) — so we hand back
// `rows[0]`. This contract was validated end-to-end in spikes/drizzle-proxy.mjs.
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { invoke } from "@tauri-apps/api/core";
import * as schema from "./schema";

type ProxyMethod = "run" | "all" | "values" | "get";

export const db = drizzle(
  async (sql: string, params: unknown[], method: ProxyMethod) => {
    const result = await invoke<{ rows: unknown[][] }>("db_execute", { sql, params, method });
    // `get` → single row (or undefined); everything else → array of rows.
    const rows = method === "get" ? result.rows[0] : result.rows;
    return { rows: rows as unknown[] };
  },
  { schema },
);

export type DB = typeof db;
