import { randomBytes, scrypt, timingSafeEqual, createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { User } from "@pixel/contracts";
import type { Db } from "../db/index.js";
import { config } from "../config.js";
import { HttpError } from "../errors.js";
const scryptAsync = promisify(scrypt);
export type UserRow = { id: string; username: string; role: "user" | "admin"; enabled: number; password_hash: string; created_at: number };
export const publicUser = (r: UserRow): User => ({ id: r.id, username: r.username, role: r.role, enabled: Boolean(r.enabled), createdAt: r.created_at });
export async function hashPassword(password: string) { const salt = randomBytes(16).toString("hex"); const key = await scryptAsync(password, salt, 64) as Buffer; return `${salt}:${key.toString("hex")}`; }
export async function verifyPassword(password: string, stored: string) { const [salt, hash] = stored.split(":"); const actual = await scryptAsync(password, salt, 64) as Buffer; const expected = Buffer.from(hash, "hex"); return expected.length === actual.length && timingSafeEqual(expected, actual); }
const tokenHash = (s: string) => createHash("sha256").update(s).digest("hex");
export const cookieName = "pixel_session";
export function currentUser(db: Db, request: FastifyRequest): UserRow {
  const token = request.cookies[cookieName];
  const row = token ? db.prepare("SELECT u.* FROM users u JOIN login_sessions s ON s.user_id=u.id WHERE s.id=? AND s.expires_at>? AND u.enabled=1").get(tokenHash(token), Date.now()) as UserRow | undefined : undefined;
  if (!row) throw new HttpError(401, "UNAUTHENTICATED", "请先登录");
  return row;
}
export function requireAdmin(user: UserRow) { if (user.role !== "admin") throw new HttpError(403, "FORBIDDEN", "需要管理员权限"); }
export function setLogin(db: Db, reply: FastifyReply, userId: string) { const token = randomBytes(32).toString("hex"); db.prepare("DELETE FROM login_sessions WHERE expires_at<=?").run(Date.now()); db.prepare("INSERT INTO login_sessions VALUES(?,?,?)").run(tokenHash(token), userId, Date.now() + config.sessionTtl); reply.setCookie(cookieName, token, { path: "/", httpOnly: true, sameSite: "strict", secure: config.cookieSecure, maxAge: config.sessionTtl / 1000 }); }
export function logout(db: Db, request: FastifyRequest, reply: FastifyReply) { const token = request.cookies[cookieName]; if (token) db.prepare("DELETE FROM login_sessions WHERE id=?").run(tokenHash(token)); reply.clearCookie(cookieName, { path: "/" }); }
export async function createUser(db: Db, username: string, password: string, role: User["role"], beforeInsert?: () => void) { const id = randomUUID(); const hash = await hashPassword(password); beforeInsert?.(); try { db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES(?,?,?,?,?)").run(id, username, hash, role, Date.now()); } catch (error) { if ((error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") throw new HttpError(409, "USERNAME_TAKEN", "用户名已存在"); throw error; } return publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(id) as UserRow); }
