import type { FastifyInstance } from "fastify";
import { createUserSchema, idSchema, resetPasswordSchema, updateUserSchema } from "@pixel/contracts";
import type { Db } from "../db/index.js";
import type { Runs } from "../runs/index.js";
import { createUser, currentUser, hashPassword, publicUser, requireAdmin, type UserRow } from "../auth/index.js";
import { HttpError, missing } from "../errors.js";

export function registerUserRoutes(app: FastifyInstance, db: Db, runs: Runs) {
  app.get("/api/admin/users", async request => {
    requireAdmin(currentUser(db, request));
    return { items: (db.prepare("SELECT * FROM users ORDER BY created_at").all() as UserRow[]).map(publicUser) };
  });
  app.post("/api/admin/users", async (request, reply) => {
    requireAdmin(currentUser(db, request));
    const body = createUserSchema.parse(request.body);
    const created = await createUser(db, body.username, body.password, body.role, () => requireAdmin(currentUser(db, request)));
    reply.code(201);
    return created;
  });
  app.patch("/api/admin/users/:id", async request => {
    requireAdmin(currentUser(db, request));
    const id = idSchema.parse((request.params as { id: unknown }).id);
    const body = updateUserSchema.parse(request.body);
    const target = db.prepare("SELECT * FROM users WHERE id=?").get(id) as UserRow | undefined;
    if (!target) throw missing();
    if (!body.enabled && target.role === "admin" && target.enabled
      && (db.prepare("SELECT count(*) n FROM users WHERE role='admin' AND enabled=1").get() as { n: number }).n <= 1) {
      throw new HttpError(409, "LAST_ADMIN", "不能停用最后一个管理员");
    }
    db.prepare("UPDATE users SET enabled=? WHERE id=?").run(Number(body.enabled), id);
    if (!body.enabled) {
      db.prepare("DELETE FROM login_sessions WHERE user_id=?").run(id);
      await runs.stopUser(id);
    }
    return publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(id) as UserRow);
  });
  app.post("/api/admin/users/:id/password", async request => {
    requireAdmin(currentUser(db, request));
    const id = idSchema.parse((request.params as { id: unknown }).id);
    const body = resetPasswordSchema.parse(request.body);
    if (!db.prepare("SELECT id FROM users WHERE id=?").get(id)) throw missing();
    const hash = await hashPassword(body.password);
    requireAdmin(currentUser(db, request));
    db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hash, id);
    db.prepare("DELETE FROM login_sessions WHERE user_id=?").run(id);
    await runs.stopUser(id);
    return { ok: true };
  });
}
