import { acquireLock, openDatabase } from "./db/index.js";
import { config, readModels } from "./config.js";
import { Runs } from "./runs/index.js";
import { createServer } from "./server.js";
import { createUser } from "./auth/index.js";
import { createUserSchema, DEFAULT_PASSWORD } from "@pixel/contracts";

const release = await acquireLock();
// Let a crashed parent's supervisor stop its writers before migrating session files.
await new Promise(resolve => setTimeout(resolve, 2000));
let cleanup = false;
let closeDatabase = () => {};
try {
  const db = openDatabase();
  closeDatabase = () => db.close();
  if (process.env.NODE_ENV !== "production" && !db.prepare("SELECT 1 FROM users LIMIT 1").get()) {
    const initial = createUserSchema.parse({ username: "admin", password: process.env.PIXEL_ADMIN_PASSWORD ?? DEFAULT_PASSWORD, role: "admin" });
    await createUser(db, initial.username, initial.password, initial.role);
  }
  const models = readModels();
  const runs = new Runs(db, models);
  runs.recover();
  const app = await createServer(db, runs, models);
  const shutdown = async () => { if (cleanup) return; cleanup = true; await Promise.all([app.close(), runs.shutdown()]); db.close(); await release(); };
  process.once("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
  process.once("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  if (!cleanup) { closeDatabase(); await release(); }
  console.error(error instanceof Error ? error.message : "Server startup failed");
  process.exitCode = 1;
}
