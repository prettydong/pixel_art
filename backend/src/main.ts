import { acquireLock, openDatabase } from "./db/index.js";
import { config, readModels } from "./config.js";
import { Runs } from "./runs/index.js";
import { createServer } from "./server.js";

const release = await acquireLock();
// Let a crashed parent's supervisor stop its writers before migrating session files.
await new Promise(resolve => setTimeout(resolve, 2000));
let cleanup = false;
let closeDatabase = () => {};
try {
  const db = openDatabase();
  closeDatabase = () => db.close();
  const models = readModels();
  const runs = new Runs(db, models);
  runs.recover();
  const app = await createServer(db, runs, models);
  const shutdown = async () => { if (cleanup) return; cleanup = true; await runs.shutdown(); await app.close(); db.close(); await release(); };
  process.once("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
  process.once("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  if (!cleanup) { closeDatabase(); await release(); }
  console.error(error instanceof Error ? error.message : "Server startup failed");
  process.exitCode = 1;
}
