import { constants, copyFileSync, existsSync, lstatSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, relative, resolve } from "node:path";
import type { Db } from "../db/index.js";
import { config } from "../config.js";
import { ensureDirectory, ensureWorkspace, securePath } from "./index.js";

/** Startup-only migration under the server lock. Old files remain as a rollback copy. */
export function migrateUserWorkspaces(db: Db) {
  if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=2").get()) return;
  const conversations = db.prepare("SELECT id,user_id FROM conversations").all() as { id: string; user_id: string }[];
  const changedPaths = new Map<string, string>();
  const copy = (source: string, target: string) => {
    securePath(config.dataDir, relative(config.dataDir, source));
    if (!lstatSync(source).isFile()) throw new Error(`Migration expected a regular file: ${source}`);
    if (existsSync(target)) {
      securePath(config.dataDir, relative(config.dataDir, target));
      if (!readFileSync(source).equals(readFileSync(target))) throw new Error(`Migration destination differs; original retained: ${target}`);
    } else copyFileSync(source, target, constants.COPYFILE_EXCL);
  };
  const copyTree = (source: string, target: string) => {
    securePath(config.dataDir, relative(config.dataDir, source));
    ensureDirectory(target);
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`Migration refuses symbolic link: ${join(source, entry.name)}`);
      if (entry.isDirectory()) copyTree(join(source, entry.name), join(target, entry.name));
      else if (entry.isFile()) copy(join(source, entry.name), join(target, entry.name));
    }
  };
  for (const c of conversations) {
    const p = ensureWorkspace(c.user_id, c.id);
    const old = resolve(config.dataDir, "conversations", c.id);
    if (existsSync(join(old, "session.jsonl"))) copy(join(old, "session.jsonl"), p.session);
    if (existsSync(join(old, "work"))) {
      securePath(config.dataDir, relative(config.dataDir, join(old, "work")));
      for (const entry of readdirSync(join(old, "work"), { withFileTypes: true })) {
        const source = join(old, "work", entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Migration refuses symbolic link: ${source}`);
        // Namespace legacy uploads to avoid same-name collisions across conversations.
        const destination = entry.name === "uploads" ? join(p.uploads, "legacy", c.id) : join(p.work, entry.name);
        if (entry.isDirectory()) copyTree(source, destination);
        else if (entry.isFile()) copy(source, destination);
      }
    }
    const files = db.prepare("SELECT id,kind,relative_path FROM files WHERE conversation_id=?").all(c.id) as { id: string; kind: string; relative_path: string }[];
    for (const file of files) {
      // Validate even missing legacy paths lexically before remapping them.
      const prefix = file.kind === "upload" ? "uploads/" : "artifacts/";
      if (!file.relative_path.startsWith(prefix) || file.relative_path.split(/[\\/]/).includes("..")) throw new Error(`Invalid legacy file path: ${file.id}`);
      changedPaths.set(file.id, file.kind === "upload"
        ? `uploads/legacy/${c.id}/${file.relative_path.slice(prefix.length)}`
        : `conversations/${c.id}/work/${file.relative_path}`);
    }
  }
  db.transaction(() => {
    db.exec(`CREATE TABLE files_v2(
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      conversation_id TEXT REFERENCES conversations(id), name TEXT NOT NULL,
      relative_path TEXT NOT NULL, size INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('upload','artifact')),
      created_at INTEGER NOT NULL, UNIQUE(user_id,relative_path),
      CHECK((kind='upload' AND conversation_id IS NULL) OR (kind='artifact' AND conversation_id IS NOT NULL))
    );`);
    const files = db.prepare("SELECT f.*,c.user_id FROM files f JOIN conversations c ON c.id=f.conversation_id").all() as { id: string; user_id: string; conversation_id: string; name: string; size: number; kind: string; created_at: number }[];
    const insert = db.prepare("INSERT INTO files_v2(id,user_id,conversation_id,name,relative_path,size,kind,created_at) VALUES(?,?,?,?,?,?,?,?)");
    for (const f of files) insert.run(f.id, f.user_id, f.kind === "upload" ? null : f.conversation_id, f.name, changedPaths.get(f.id), f.size, f.kind, f.created_at);
    db.exec("DROP TABLE files; ALTER TABLE files_v2 RENAME TO files; CREATE INDEX files_owner_kind ON files(user_id,kind,conversation_id);");
    db.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(2,?)").run(Date.now());
  })();
}

/** Pi restores cwd from its session header, overriding the process startup cwd.
 * Keep a snapshot until migration commits, so file replacement and SQL offsets
 * can be retried together after interruption without changing usage boundaries twice.
 */
export function migrateSessionCwds(db: Db) {
  if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=3").get()) return;
  const offsets: { id: string; headerEnd: number; delta: number }[] = [];
  const conversations = db.prepare("SELECT id,user_id FROM conversations").all() as { id: string; user_id: string }[];
  for (const c of conversations) {
    const p = ensureWorkspace(c.user_id, c.id);
    if (!existsSync(p.session)) continue;
    securePath(p.root, "session.jsonl");
    const backup = join(p.root, "session.before-user-cwd.jsonl");
    if (existsSync(backup)) securePath(p.root, "session.before-user-cwd.jsonl");
    const original = readFileSync(existsSync(backup) ? backup : p.session);
    if (!original.length) continue;
    const newline = original.indexOf(10);
    const headerEnd = newline < 0 ? original.length : newline + 1;
    const header = JSON.parse(original.subarray(0, headerEnd).toString("utf8"));
    if (header.type !== "session") throw new Error(`Invalid Pi session header: ${c.id}`);
    if (header.cwd === p.user) continue;
    const replacement = Buffer.from(JSON.stringify({ ...header, cwd: p.user }) + "\n");
    const updated = Buffer.concat([replacement, original.subarray(headerEnd)]);
    const current = readFileSync(p.session);
    if (!current.equals(original) && !current.equals(updated)) throw new Error(`Session changed during cwd migration: ${c.id}`);
    if (!existsSync(backup)) copyFileSync(p.session, backup, constants.COPYFILE_EXCL);
    const temporary = join(p.root, `session-${randomUUID()}.tmp`);
    writeFileSync(temporary, updated, { flag: "wx", mode: 0o600 });
    renameSync(temporary, p.session);
    offsets.push({ id: c.id, headerEnd, delta: replacement.length - headerEnd });
  }
  db.transaction(() => {
    for (const o of offsets) db.prepare("UPDATE runs SET native_start=native_start+? WHERE conversation_id=? AND native_start>=?").run(o.delta, o.id, o.headerEnd);
    db.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(3,?)").run(Date.now());
  })();
}
