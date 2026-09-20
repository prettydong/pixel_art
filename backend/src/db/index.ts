import { migrateTasks } from "../tasks/index.js";
import Database from "better-sqlite3";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { chmodSync, closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { config, prepareData } from "../config.js";
import { migrateUserWorkspaces, migrateSessionCwds } from "../workspace/migrate.js";

export type Db = Database.Database;
export function openDatabase() {
  prepareData();
  const db = new Database(resolve(config.dataDir, "pixel.sqlite"));
  db.pragma("journal_mode = WAL"); db.pragma("foreign_keys = ON"); db.pragma("busy_timeout = 5000");
  chmodSync(resolve(config.dataDir, "pixel.sqlite"), 0o600);
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','user')), enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS login_sessions(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_user ON login_sessions(user_id);
    CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, mode TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
    CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), user_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL, model_id TEXT NOT NULL, provider TEXT, model TEXT, pricing_known INTEGER NOT NULL DEFAULT 0, idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, created_at INTEGER NOT NULL, finished_at INTEGER, error TEXT, pid INTEGER, native_start INTEGER NOT NULL DEFAULT 0, UNIQUE(user_id,idempotency_key));
    CREATE UNIQUE INDEX IF NOT EXISTS single_active_run ON runs(conversation_id) WHERE status IN ('starting','running','cancelling');
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), run_id TEXT NOT NULL REFERENCES runs(id), role TEXT NOT NULL, text TEXT NOT NULL, file_ids TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id,created_at);
    CREATE TABLE IF NOT EXISTS message_details(message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, reasoning TEXT NOT NULL DEFAULT '', generation TEXT);
    CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id), payload TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS events_run ON events(run_id,id);
    CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), name TEXT NOT NULL, relative_path TEXT NOT NULL, size INTEGER NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(conversation_id,relative_path));
    CREATE TABLE IF NOT EXISTS usage(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), conversation_id TEXT NOT NULL REFERENCES conversations(id), run_id TEXT NOT NULL REFERENCES runs(id), model_id TEXT NOT NULL, actual_provider TEXT, actual_model TEXT, source_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, granularity TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, cost REAL, cost_basis TEXT NOT NULL, duration_ms INTEGER, status TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS usage_user_date ON usage(user_id,created_at);
    INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(1,${Date.now()});
  `);
  try { migrateUserWorkspaces(db); migrateSessionCwds(db); migrateTasks(db); }
  catch (error) { db.close(); throw error; }
  return db;
}
export async function acquireLock(): Promise<() => Promise<void>> {
  prepareData();
  if (process.platform === "linux") {
    const lock = createServer(socket => socket.destroy());
    const key = createHash("sha256").update(config.dataDir).digest("hex");
    await new Promise<void>((resolveReady, reject) => {
      lock.once("error", reject);
      lock.listen(`\0pixel-chat-${key}`, () => { lock.off("error", reject); resolveReady(); });
    });
    return () => new Promise<void>((resolveClosed, reject) => lock.close(error => error ? reject(error) : resolveClosed()));
  }
  return acquirePortableLock();
}
function acquirePortableLock(): () => Promise<void> {
  prepareData();
  const filename = resolve(config.dataDir, "server.lock");
  const claim = () => { const fd = openSync(filename, "wx", 0o600); writeFileSync(fd, String(process.pid)); closeSync(fd); };
  try { claim(); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pid = Number(readFileSync(filename, "utf8"));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid server.lock; inspect it before removing manually");
    try { process.kill(pid, 0); throw new Error(`Data directory already in use by PID ${pid}`); }
    catch (probe) { if ((probe as NodeJS.ErrnoException).code !== "ESRCH") throw probe; }
    // Stale locks must be cleared explicitly: concurrent starts cannot race to remove each other's locks.
    throw new Error(`Stale server.lock (PID ${pid}). Confirm no service is running, then remove ${filename}. Interrupted runs will be recovered on startup.`);
  }
  return async () => { if (readFileSync(filename, "utf8") === String(process.pid)) unlinkSync(filename); };
}
