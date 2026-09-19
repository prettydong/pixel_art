import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createUserSchema } from "@pixel/contracts";
import { acquireLock, openDatabase } from "./db/index.js";
import { createUser } from "./auth/index.js";

// Offline bootstrap only: never run a second SQLite writer beside the web service.
const release = await acquireLock();
await new Promise(resolve => setTimeout(resolve, 2000));
let closeDatabase = () => {};
try {
  const db = openDatabase();
  closeDatabase = () => db.close();
  const username = process.argv[2];
  if (!username) throw new Error("Usage: npm run admin:create -- <username> (read password from PIXEL_ADMIN_PASSWORD or stdin)");
  let password = process.env.PIXEL_ADMIN_PASSWORD;
  if (!password) {
    if (stdin.isTTY) throw new Error("For hidden input, use: read -s PIXEL_ADMIN_PASSWORD; export PIXEL_ADMIN_PASSWORD; npm run admin:create -- <username>; unset PIXEL_ADMIN_PASSWORD");
    const reader = createInterface({ input: stdin });
    try { password = (await reader[Symbol.asyncIterator]().next()).value as string | undefined; } finally { reader.close(); }
  }
  const body = createUserSchema.parse({ username, password, role: "admin" });
  const user = await createUser(db, body.username, body.password, body.role);
  stdout.write(`Created administrator ${user.username} (${user.id})\n`);
} catch (error) { console.error(error instanceof Error ? error.message : "Admin creation failed"); process.exitCode = 1; }
finally { closeDatabase(); await release(); }
