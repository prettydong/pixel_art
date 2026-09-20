import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { config, projectRoot } from "../config.js";
import { HttpError, missing } from "../errors.js";

function checkId(id: string) { if (!/^[a-f0-9-]{36}$/.test(id)) throw missing(); }
export function userPaths(userId: string) {
  checkId(userId);
  const user = resolve(config.dataDir, "users", userId);
  return { user, uploads: resolve(user, "uploads"), skills: resolve(user, ".pi/skills"), agent: resolve(user, ".pi/agent") };
}
export function paths(userId: string, conversationId: string) {
  checkId(conversationId);
  const u = userPaths(userId);
  const root = resolve(u.user, "conversations", conversationId);
  const work = resolve(root, "work");
  return { ...u, root, work, repair: resolve(work, "repair-evaluation"), artifacts: resolve(work, "artifacts"), session: resolve(root, "session.jsonl") };
}
export function securePath(root: string, child: string) {
  const result = resolve(root, child);
  const rel = relative(root, result);
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || rel.startsWith(sep)) throw new HttpError(400, "INVALID_PATH", "非法文件路径");
  let cursor = root;
  if (lstatSync(root).isSymbolicLink()) throw missing();
  for (const part of rel.split(sep)) { cursor = join(cursor, part); if (lstatSync(cursor).isSymbolicLink()) throw missing(); }
  const actual = realpathSync(result);
  if (!actual.startsWith(`${realpathSync(root)}${sep}`)) throw missing();
  return result;
}
export function ensureDirectory(dir: string) {
  const rel = relative(config.dataDir, dir);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw missing();
  let cursor = config.dataDir;
  for (const part of rel.split(sep)) {
    cursor = join(cursor, part);
    if (!existsSync(cursor)) mkdirSync(cursor, { mode: 0o700 });
    const info = lstatSync(cursor);
    if (info.isSymbolicLink() || !info.isDirectory()) throw missing();
  }
  securePath(config.dataDir, rel);
}
// Seed only missing files, preserving user skills and per-conversation devices.
function seedMissingFiles(source: string, destination: string) {
  ensureDirectory(destination);
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name.startsWith(".") || entry.name === "__pycache__") continue;
    const target = join(destination, entry.name);
    if (entry.isDirectory()) seedMissingFiles(join(source, entry.name), target);
    else if (entry.isFile() && !existsSync(target)) copyFileSync(join(source, entry.name), target, constants.COPYFILE_EXCL);
  }
}
export function ensureUserWorkspace(userId: string) {
  const p = userPaths(userId);
  for (const dir of [p.user, p.uploads, p.skills, p.agent]) ensureDirectory(dir);
  for (const skill of ["data-analysis", "repair-evaluation"]) {
    seedMissingFiles(resolve(projectRoot, "backend/skills", skill), resolve(p.skills, skill));
  }
  return p;
}
export function ensureWorkspace(userId: string, conversationId: string) {
  ensureUserWorkspace(userId);
  const p = paths(userId, conversationId);
  for (const dir of [p.root, p.work, p.artifacts]) ensureDirectory(dir);
  seedMissingFiles(resolve(projectRoot, "backend/repair-evaluation"), p.repair);
  return p;
}
