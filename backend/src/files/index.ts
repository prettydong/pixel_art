import { constants, existsSync, lstatSync, openSync, closeSync, readdirSync, realpathSync, statSync, fstatSync, createReadStream } from "node:fs";
import { relative, join, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type { FileRecord } from "@pixel/contracts";
import type { Db } from "../db/index.js";
import { missing } from "../errors.js";
import { ensureWorkspace, ensureUserWorkspace, paths, securePath } from "../workspace/index.js";
export { ensureWorkspace, paths, securePath } from "../workspace/index.js";

export type FileRow = { id: string; user_id: string; conversation_id: string | null; name: string; relative_path: string; size: number; kind: "upload" | "artifact"; created_at: number };
export const publicFile = (r: FileRow): FileRecord => ({ id: r.id, conversationId: r.conversation_id, name: r.name, size: r.size, kind: r.kind, createdAt: r.created_at });

export function filePath(row: FileRow) {
  const p = ensureUserWorkspace(row.user_id);
  const root = row.kind === "upload" ? p.uploads : row.conversation_id ? paths(row.user_id, row.conversation_id).artifacts : undefined;
  if (!root) throw missing();
  // A file record must never expose sessions, configuration or arbitrary work files.
  const filename = securePath(p.user, row.relative_path);
  const safe = securePath(root, relative(root, filename));
  if (!statSync(safe).isFile()) throw missing();
  return safe;
}
export function openDownload(row: FileRow) {
  const filename = filePath(row);
  const scope = row.kind === "upload" ? ensureUserWorkspace(row.user_id).uploads : paths(row.user_id, row.conversation_id!).artifacts;
  if (!statSync(filename).isFile()) throw missing();
  const fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(fd).isFile()) throw missing();
    if (process.platform === "linux" && !realpathSync("/proc/self/fd/" + fd).startsWith(realpathSync(scope) + sep)) throw missing();
  } catch (error) { closeSync(fd); throw error; }
  return createReadStream(filename, { fd, autoClose: true });
}
export function listFiles(db: Db, userId: string, conversationId: string) {
  return (db.prepare("SELECT * FROM files WHERE user_id=? AND (kind='upload' OR conversation_id=?) ORDER BY created_at,id").all(userId, conversationId) as FileRow[]).map(publicFile);
}
export function listUploads(db: Db, userId: string) {
  return (db.prepare("SELECT * FROM files WHERE user_id=? AND kind='upload' ORDER BY created_at,id").all(userId) as FileRow[]).map(publicFile);
}
export function fileById(db: Db, userId: string, conversationId: string | null, fileId: string) {
  const row = db.prepare("SELECT * FROM files WHERE id=? AND user_id=? AND (kind='upload' OR conversation_id=?)").get(fileId, userId, conversationId) as FileRow | undefined;
  if (!row) throw missing();
  return row;
}
function scan(db: Db, userId: string, conversationId: string | null, kind: FileRow['kind']) {
  const p = ensureUserWorkspace(userId);
  const root = kind === "upload" ? p.uploads : ensureWorkspace(userId, conversationId!).artifacts;
  const added: FileRecord[] = [];
  function walk(directory: string, depth: number) {
    if (depth > 12) return;
    securePath(p.user, relative(p.user, directory));
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const filename = join(directory, entry.name);
      if (entry.isDirectory()) { walk(filename, depth + 1); continue; }
      if (!entry.isFile()) continue;
      const safe = securePath(root, relative(root, filename));
      if (!lstatSync(safe).isFile()) continue;
      const info = statSync(safe);
      const rel = relative(p.user, safe);
      const existing = db.prepare("SELECT * FROM files WHERE user_id=? AND relative_path=?").get(userId, rel) as FileRow | undefined;
      if (existing) {
        if (existing.size !== info.size) { db.prepare("UPDATE files SET size=? WHERE id=?").run(info.size, existing.id); added.push(publicFile({ ...existing, size: info.size })); }
        continue;
      }
      const id = randomUUID();
      db.prepare("INSERT INTO files(id,user_id,conversation_id,name,relative_path,size,kind,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(id, userId, conversationId, relative(root, safe), rel, info.size, kind, Date.now());
      added.push(publicFile(fileById(db, userId, conversationId, id)));
    }
  }
  if (existsSync(root)) walk(root, 0);
  return added;
}
export const scanUploads = (db: Db, userId: string) => scan(db, userId, null, "upload");
export const scanArtifacts = (db: Db, userId: string, conversationId: string) => scan(db, userId, conversationId, "artifact");
