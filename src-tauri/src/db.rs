//! Local SQLite access for Ascent (the Rust side of the data layer).
//!
//! Drizzle (via its `sqlite-proxy` driver) runs in the webview and calls the
//! `run_sql` Tauri command; this module executes the SQL against a real SQLite
//! file and serializes results back.
//!
//! Why rusqlite (and not tauri-plugin-sql)?
//!   1. `sqlite-proxy` expects each row as a POSITIONAL ARRAY of column values
//!      (`any[][]`). tauri-plugin-sql returns row *objects* (column->value),
//!      which forces the well-known empty-`get()` workaround. By owning the
//!      serialization here we return exactly the shape Drizzle wants.
//!   2. rusqlite lets us register `sqlite-vec` via `sqlite3_auto_extension`,
//!      so vector search (future SemanticIndex) works on the same connection —
//!      no parallel DB layer. tauri-plugin-sql (sqlx) cannot load extensions.
//!
//! Spike scope: prove the serialization contract + that sqlite-vec loads and
//! answers a KNN query. Tauri command wiring + connection-in-state come in M1.
#![allow(dead_code)]

use rusqlite::{ffi::sqlite3_auto_extension, types::ValueRef, Connection};
use serde_json::Value;
use std::sync::Once;

static VEC_INIT: Once = Once::new();

/// Register sqlite-vec for every connection opened afterwards. Idempotent.
fn register_sqlite_vec() {
    VEC_INIT.call_once(|| {
        // SAFETY: the canonical sqlite-vec registration. The fn pointer matches
        // SQLite's auto-extension entrypoint signature; this is the pattern from
        // the sqlite-vec crate docs.
        unsafe {
            sqlite3_auto_extension(Some(std::mem::transmute(
                sqlite_vec::sqlite3_vec_init as *const (),
            )));
        }
    });
}

/// Open (or create) a connection with sqlite-vec available.
pub fn open(path: &str) -> rusqlite::Result<Connection> {
    register_sqlite_vec();
    Connection::open(path)
}

/// In-memory connection (tests / ephemeral).
pub fn open_in_memory() -> rusqlite::Result<Connection> {
    register_sqlite_vec();
    Connection::open_in_memory()
}

/// The execution mode Drizzle's sqlite-proxy asks for on each statement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Method {
    Run,
    All,
    Get,
    Values,
}

/// Result returned to the proxy: `rows` is an array of positional value arrays.
/// For `Get`, Drizzle expects at most one row; we return 0 or 1 entries and let
/// the JS shim flatten to a single row / undefined.
#[derive(Debug, serde::Serialize)]
pub struct SqlResult {
    pub rows: Vec<Vec<Value>>,
}

fn value_to_json(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => Value::from(f),
        ValueRef::Text(t) => Value::from(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Value::from(b.to_vec()),
    }
}

fn json_to_sql(v: &Value) -> rusqlite::types::Value {
    use rusqlite::types::Value as S;
    match v {
        Value::Null => S::Null,
        Value::Bool(b) => S::Integer(*b as i64),
        Value::Number(n) => n
            .as_i64()
            .map(S::Integer)
            .unwrap_or_else(|| S::Real(n.as_f64().unwrap_or(0.0))),
        Value::String(s) => S::Text(s.clone()),
        // arrays/objects (e.g. JSON columns) are stored as text
        other => S::Text(other.to_string()),
    }
}

/// Execute one statement on behalf of the sqlite-proxy driver.
pub fn run_sql(
    conn: &Connection,
    sql: &str,
    params: &[Value],
    method: Method,
) -> rusqlite::Result<SqlResult> {
    let bound: Vec<rusqlite::types::Value> = params.iter().map(json_to_sql).collect();

    if method == Method::Run {
        conn.execute(sql, rusqlite::params_from_iter(bound.iter()))?;
        return Ok(SqlResult { rows: vec![] });
    }

    let mut stmt = conn.prepare(sql)?;
    let col_count = stmt.column_count();
    let mapped = stmt.query_map(rusqlite::params_from_iter(bound.iter()), |row| {
        let mut out = Vec::with_capacity(col_count);
        for i in 0..col_count {
            out.push(value_to_json(row.get_ref(i)?));
        }
        Ok(out)
    })?;

    let mut rows = Vec::new();
    for r in mapped {
        rows.push(r?);
    }
    if method == Method::Get {
        rows.truncate(1);
    }
    Ok(SqlResult { rows })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sqlite_vec_loads() {
        let conn = open_in_memory().unwrap();
        let version: String = conn
            .query_row("SELECT vec_version()", [], |r| r.get(0))
            .expect("vec_version() should work if sqlite-vec is registered");
        assert!(!version.is_empty(), "got vec_version = {version}");
    }

    #[test]
    fn run_all_get_and_empty_get() {
        let conn = open_in_memory().unwrap();
        run_sql(
            &conn,
            "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)",
            &[],
            Method::Run,
        )
        .unwrap();
        run_sql(
            &conn,
            "INSERT INTO users (id, name) VALUES (?, ?), (?, ?)",
            &[json!(1), json!("Ada"), json!(2), json!("Alan")],
            Method::Run,
        )
        .unwrap();

        // ALL → array of positional rows
        let all = run_sql(&conn, "SELECT id, name FROM users ORDER BY id", &[], Method::All).unwrap();
        assert_eq!(all.rows.len(), 2);
        assert_eq!(all.rows[0], vec![json!(1), json!("Ada")]);
        assert_eq!(all.rows[1], vec![json!(2), json!("Alan")]);

        // GET hit → exactly one positional row
        let hit = run_sql(&conn, "SELECT id, name FROM users WHERE id = ?", &[json!(1)], Method::Get).unwrap();
        assert_eq!(hit.rows.len(), 1);
        assert_eq!(hit.rows[0], vec![json!(1), json!("Ada")]);

        // GET miss → ZERO rows, and crucially: NO error (this is the case that
        // breaks the tauri-plugin-sql object-shape path).
        let miss = run_sql(&conn, "SELECT id, name FROM users WHERE id = ?", &[json!(999)], Method::Get).unwrap();
        assert_eq!(miss.rows.len(), 0, "empty get must yield 0 rows, not an error");
    }

    #[test]
    fn vec_knn_query() {
        // Proves the future SemanticIndex seam: a vec0 virtual table + KNN search.
        let conn = open_in_memory().unwrap();
        run_sql(
            &conn,
            "CREATE VIRTUAL TABLE vec_items USING vec0(embedding float[4])",
            &[],
            Method::Run,
        )
        .unwrap();
        run_sql(
            &conn,
            "INSERT INTO vec_items(rowid, embedding) VALUES (?, ?), (?, ?)",
            &[json!(1), json!("[0.10,0.10,0.10,0.10]"), json!(2), json!("[0.90,0.90,0.90,0.90]")],
            Method::Run,
        )
        .unwrap();

        let near = run_sql(
            &conn,
            "SELECT rowid, distance FROM vec_items \
             WHERE embedding MATCH ? ORDER BY distance LIMIT 1",
            &[json!("[0.12,0.09,0.11,0.10]")],
            Method::All,
        )
        .unwrap();
        assert_eq!(near.rows.len(), 1);
        assert_eq!(near.rows[0][0], json!(1), "nearest neighbor should be rowid 1");
    }
}
