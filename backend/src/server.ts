import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { constants, createWriteStream, existsSync, statSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { changePasswordSchema, createConversationSchema, createRunSchema, idSchema, loginSchema, updateConversationSchema } from "@pixel/contracts";
import type { Db } from "./db/index.js";
import { config, type ModelConfig } from "./config.js";
import { HttpError, missing } from "./errors.js";
import { currentUser, hashPassword, logout, publicUser, requireAdmin, setLogin, verifyPassword, type UserRow } from "./auth/index.js";
import { conversation, conversationRow, ownedRun, publicRun, type ConversationRow } from "./conversations/index.js";
import { ensureWorkspace, fileById, listFiles, listUploads, scanUploads, openDownload, publicFile } from "./files/index.js";
import { ensureDirectory, ensureUserWorkspace } from "./workspace/index.js";
import { queryUsage } from "./usage/index.js";
import { registerUserRoutes } from "./users/index.js";
import { createTask, registerTaskRoutes, taskRow } from "./tasks/index.js";
import type { Runs } from "./runs/index.js";

export async function createServer(db: Db, runs: Runs, models: ModelConfig) {
  const app = Fastify({ logger: true, bodyLimit: 1024 * 1024, trustProxy: false });
  await app.register(cookie);
  await app.register(multipart, { limits: { files: 1, fields: 0, parts: 1, fileSize: config.uploadLimit } });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "same-origin");
    if (request.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    const origin = request.headers.origin;
    // Browser writes require the deployment's exact public origin. Non-browser clients can supply Origin explicitly.
    if (origin !== config.origin || request.headers["sec-fetch-site"] === "cross-site") throw new HttpError(403, "INVALID_ORIGIN", "请求来源不匹配，请检查 PIXEL_ORIGIN");
    const type = request.headers["content-type"] ?? "";
    if ((Number(request.headers["content-length"] ?? 0) > 0 || request.headers["transfer-encoding"]) && !type.startsWith("application/json") && !type.startsWith("multipart/form-data;")) throw new HttpError(415, "INVALID_CONTENT_TYPE", "写入请求必须使用 JSON 或文件上传格式");
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: { code: "INVALID_INPUT", message: error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") } });
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    const known = error as { code?: string; statusCode?: number };
    if (known.statusCode && known.statusCode >= 400 && known.statusCode < 500) return reply.code(known.statusCode).send({ error: { code: known.code ?? "BAD_REQUEST", message: known.statusCode === 413 ? "文件或请求超过大小限制" : "请求格式不正确" } });
    app.log.error({ code: known.code ?? "INTERNAL_ERROR" }, "Request failed");
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "服务器内部错误" } });
  });
  const param = (request: { params: unknown }, name = "id") => idSchema.parse((request.params as Record<string, unknown>)[name]);
  const loginAttempts = new Map<string, { count: number; expires: number }>();
  app.post("/api/auth/login", async (request, reply) => {
    const body = loginSchema.parse(request.body); const key = `${request.ip}:${body.username.toLowerCase()}`;
    let attempt = loginAttempts.get(key);
    if (!attempt || attempt.expires <= Date.now()) { attempt = { count: 0, expires: Date.now() + 15 * 60000 }; loginAttempts.set(key, attempt); }
    if (attempt.count >= 20) throw new HttpError(429, "LOGIN_RATE_LIMIT", "登录失败过多，请稍后重试");
    attempt.count++;
    if (loginAttempts.size > 10000) { for (const [k, value] of loginAttempts) if (value.expires <= Date.now()) loginAttempts.delete(k); if (loginAttempts.size > 10000) throw new HttpError(429, "LOGIN_RATE_LIMIT", "登录繁忙，请稍后重试"); }
    const row = db.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE").get(body.username) as UserRow | undefined;
    const hash = row?.password_hash ?? "00000000000000000000000000000000:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
    const valid = await verifyPassword(body.password, hash);
    // Re-read after hashing: disabling/resetting a user must win over an in-flight login.
    const latest = row ? db.prepare("SELECT * FROM users WHERE id=?").get(row.id) as UserRow | undefined : undefined;
    if (!valid || !latest?.enabled || latest.password_hash !== hash) throw new HttpError(401, "INVALID_CREDENTIALS", "用户名或密码不正确");
    loginAttempts.delete(key); logout(db, request, reply); setLogin(db, reply, latest.id); return { user: publicUser(latest) };
  });
  app.post("/api/auth/logout", async (request, reply) => { logout(db, request, reply); return { ok: true }; });
  app.get("/api/me", async request => ({ user: publicUser(currentUser(db, request)) }));
  app.post("/api/auth/password", async (request, reply) => {
    const user = currentUser(db, request); const body = changePasswordSchema.parse(request.body);
    if (!await verifyPassword(body.currentPassword, user.password_hash)) throw new HttpError(400, "WRONG_PASSWORD", "当前密码不正确");
    const hash = await hashPassword(body.password);
    const updated = db.prepare("UPDATE users SET password_hash=? WHERE id=? AND password_hash=? AND enabled=1").run(hash, user.id, user.password_hash);
    if (!updated.changes) throw new HttpError(409, "ACCOUNT_CHANGED", "账号状态已改变，请重新登录");
    db.prepare("DELETE FROM login_sessions WHERE user_id=?").run(user.id); logout(db, request, reply); return { ok: true };
  });
  registerUserRoutes(app, db, runs);
  registerTaskRoutes(app, db);
  app.get("/api/models", async request => { currentUser(db, request); return { items: models.models.map(({ id, label, provider, model }) => ({ id, label, provider, model })) }; });
  app.get("/api/conversations", async request => {
    const user = currentUser(db, request); const q = String((request.query as Record<string, unknown>).q ?? "").slice(0, 200);
    const term = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    return { items: (db.prepare("SELECT * FROM conversations WHERE user_id=? AND deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=conversations.id AND m.text LIKE ? ESCAPE '\\') OR EXISTS(SELECT 1 FROM tasks t WHERE t.id=conversations.task_id AND t.name LIKE ? ESCAPE '\\')) ORDER BY updated_at DESC").all(user.id, term, term, term) as ConversationRow[]).map(row => conversation(db, row)) };
  });
  app.post("/api/conversations", async (request, reply) => {
    const user = currentUser(db, request); const body = createConversationSchema.parse(request.body); const id = randomUUID();
    ensureWorkspace(user.id, id);
    db.transaction(() => {
      const task = body.taskId ? taskRow(db, body.taskId, user.id) : createTask(db, user.id, body.title);
      db.prepare("INSERT INTO conversations(id,user_id,title,mode,updated_at,task_id) VALUES(?,?,?,?,?,?)").run(id, user.id, body.title, body.mode, Date.now(), task.id);
    })();
    reply.code(201); return conversation(db, conversationRow(db, id, user.id));
  });
  app.get("/api/conversations/:id", async request => { const user = currentUser(db, request); return conversation(db, conversationRow(db, param(request), user.id)); });
  app.patch("/api/conversations/:id", async request => {
    const user = currentUser(db, request); const row = conversationRow(db, param(request), user.id); const body = updateConversationSchema.parse(request.body);
    if (body.taskId && body.taskId !== row.task_id) {
      taskRow(db, body.taskId, user.id);
      if (conversation(db, row).activeRun) throw new HttpError(409, "CONVERSATION_BUSY", "请等待当前聊天执行完成后再移动");
    }
    db.transaction(() => {
      db.prepare("UPDATE conversations SET title=?,mode=?,task_id=?,updated_at=? WHERE id=?").run(body.title ?? row.title, body.mode ?? row.mode, body.taskId ?? row.task_id, Date.now(), row.id);
      if (body.taskId) db.prepare(`INSERT OR IGNORE INTO task_files SELECT ?,f.id FROM messages m,json_each(m.file_ids) j
        JOIN files f ON f.id=j.value WHERE m.conversation_id=? AND f.user_id=? AND f.kind='upload'`).run(body.taskId, row.id, user.id);
    })();
    return conversation(db, conversationRow(db, row.id, user.id));
  });
  const deleting = new Set<string>();
  app.delete("/api/conversations/:id", async request => { const user = currentUser(db, request); const row = conversationRow(db, param(request), user.id); deleting.add(row.id); try { const active = conversation(db, row).activeRun; if (active) await runs.cancel(active.id); db.prepare("UPDATE conversations SET deleted_at=? WHERE id=?").run(Date.now(), row.id); } finally { deleting.delete(row.id); } return { ok: true }; });
  app.post("/api/conversations/:id/runs", async (request, reply) => { const user = currentUser(db, request); const row = conversationRow(db, param(request), user.id); if (deleting.has(row.id)) throw new HttpError(409, "CONVERSATION_DELETING", "会话正在删除"); const body = createRunSchema.parse(request.body); const run = runs.create(row.id, user.id, body); reply.code(202); return run; });
  app.get("/api/runs/:id", async request => publicRun(ownedRun(db, param(request), currentUser(db, request).id)));
  app.post("/api/runs/:id/cancel", async request => { const run = ownedRun(db, param(request), currentUser(db, request).id); return runs.cancel(run.id); });
  app.get("/api/runs/:id/events", async (request, reply) => {
    const user = currentUser(db, request); const run = ownedRun(db, param(request), user.id);
    let cursor = Number(request.headers["last-event-id"] ?? (request.query as Record<string, unknown>).after ?? 0);
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new HttpError(400, "INVALID_CURSOR", "事件游标无效");
    reply.hijack(); reply.raw.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "Connection": "keep-alive", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff" });
    let closed = false; let waitingDrain = false; let pumping = false;
    const close = () => { if (closed) return; closed = true; clearInterval(heartbeat); runs.events.off(run.id, notify); reply.raw.end(); };
    const pump = () => {
      if (closed || waitingDrain || pumping) return; pumping = true;
      try {
        const batch = runs.replay(run.id, cursor, 100);
        for (const event of batch) { cursor = event.id; if (!reply.raw.write(`id: ${event.id}\nevent: run\ndata: ${JSON.stringify(event)}\n\n`)) { waitingDrain = true; reply.raw.once("drain", () => { waitingDrain = false; pump(); }); break; } }
        if (!waitingDrain && batch.length === 100) setImmediate(pump);
        if (!waitingDrain && batch.length < 100) { const current = ownedRun(db, run.id, user.id); if (!["starting", "running", "cancelling"].includes(current.status)) close(); }
      } catch { close(); } finally { pumping = false; }
    };
    const notify = () => pump();
    const heartbeat = setInterval(() => { try { currentUser(db, request); ownedRun(db, run.id, user.id); if (!waitingDrain) reply.raw.write(": heartbeat\n\n"); } catch { close(); } }, 15000);
    reply.raw.on("close", close); runs.events.on(run.id, notify); pump();
  });
  app.get("/api/conversations/:id/files", async request => { const user = currentUser(db, request); const row = conversationRow(db, param(request), user.id); scanUploads(db, user.id); return { items: listFiles(db, user.id, row.id) }; });
  app.get("/api/uploads", async request => { const user = currentUser(db, request); scanUploads(db, user.id); return { items: listUploads(db, user.id) }; });
  const upload = async (request: FastifyRequest, reply: FastifyReply, conversationId: string | null) => {
    const user = currentUser(db, request);
    if (conversationId) conversationRow(db, conversationId, user.id);
    const part = await request.file();
    if (!part || part.fieldname !== "file") throw new HttpError(400, "MISSING_FILE", "请选择一个文件");
    const p = ensureUserWorkspace(user.id); const id = randomUUID();
    // Preserve whole Unicode characters while reserving bytes for the UUID.
    let safeName = "";
    for (const character of part.filename.replace(/[\x00-\x1f\x7f/\\]/g, "_")) {
      if (Buffer.byteLength(safeName + character, "utf8") > 180) break;
      safeName += character;
    }
    safeName ||= "file";
    const filename = `${id}-${safeName}`; const destination = join(p.uploads, filename);
    // Readers and scans must never see a partially uploaded file.
    const incoming = join(p.uploads, ".incoming"); ensureDirectory(incoming);
    const temporary = join(incoming, id);
    let published = false;
    try {
      await pipeline(part.file, createWriteStream(temporary, { flags: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode: 0o600 }));
      if (part.file.truncated) throw new HttpError(413, "FILE_TOO_LARGE", "附件超过上传限制");
      const latest = currentUser(db, request);
      if (latest.id !== user.id) throw missing();
      if (conversationId) conversationRow(db, conversationId, user.id);
      ensureUserWorkspace(user.id); ensureDirectory(incoming);
      renameSync(temporary, destination); published = true;
      db.transaction(() => {
        db.prepare("INSERT INTO files(id,user_id,conversation_id,name,relative_path,size,kind,created_at) VALUES(?,?,?,?,?,?,?,?)")
          .run(id, user.id, null, safeName, `uploads/${filename}`, statSync(destination).size, "upload", Date.now());
        if (conversationId) {
          const conversation = conversationRow(db, conversationId, user.id);
          db.prepare("INSERT OR IGNORE INTO task_files VALUES(?,?)").run(conversation.task_id, id);
          db.prepare("UPDATE tasks SET updated_at=? WHERE id=?").run(Date.now(), conversation.task_id);
        }
      })();
    } catch (error) { try { unlinkSync(published ? destination : temporary); } catch {} throw error; }
    reply.code(201); return publicFile(fileById(db, user.id, null, id));
  };
  app.post("/api/uploads", (request, reply) => upload(request, reply, null));
  app.post("/api/conversations/:id/files", (request, reply) => upload(request, reply, param(request)));
  app.get("/api/uploads/:fileId", async (request, reply) => { const user = currentUser(db, request); const file = fileById(db, user.id, null, param(request, "fileId")); reply.header("Content-Type", "application/octet-stream"); reply.header("Content-Disposition", `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, "%27")}`); return reply.send(openDownload(file)); });
  app.get("/api/conversations/:id/files/:fileId", async (request, reply) => { const user = currentUser(db, request); const row = conversationRow(db, param(request), user.id); const file = fileById(db, user.id, row.id, param(request, "fileId")); reply.header("Content-Type", "application/octet-stream"); reply.header("Content-Disposition", `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, "%27")}`); return reply.send(openDownload(file)); });
  app.get("/api/usage", async request => queryUsage(db, request.query as Record<string, unknown>, currentUser(db, request).id));
  app.get("/api/admin/usage", async request => { requireAdmin(currentUser(db, request)); return queryUsage(db, request.query as Record<string, unknown>); });
  app.get("/api/health", async () => ({ ok: true }));
  if (existsSync(config.frontendDir)) {
    await app.register(staticFiles, { root: config.frontendDir, prefix: "/", wildcard: false });
    app.setNotFoundHandler((request, reply) => { if (request.url.startsWith("/api") || request.method !== "GET" || !(request.headers.accept ?? "").includes("text/html")) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "资源不存在" } }); return reply.sendFile("index.html"); });
  }
  return app;
}
