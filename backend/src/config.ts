import { existsSync, mkdirSync, readFileSync, chmodSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadEnvFile } from "node:process";
const rootEnv = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(rootEnv)) loadEnvFile(rootEnv);

const modelSchema = z.object({ id: z.string().min(1), label: z.string().min(1), provider: z.string().min(1), model: z.string().min(1), pricingKnown: z.boolean().default(false) }).strict();
const configurationSchema = z.object({ models: z.array(modelSchema).min(1), providers: z.record(z.string(), z.unknown()).optional(), skills: z.array(z.string().min(1)).default([]), env: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).default([]) }).strict();
export type ModelConfig = z.infer<typeof configurationSchema>;
export const projectRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const positive = (name: string, fallback: number) => { const value = Number(process.env[name] ?? fallback); if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`); return value; };
export const config = {
  dataDir: resolve(process.env.PIXEL_DATA_DIR ?? resolve(projectRoot, "data")),
  frontendDir: resolve(process.env.PIXEL_FRONTEND_DIR ?? resolve(projectRoot, "fronted/dist")),
  host: process.env.HOST ?? "127.0.0.1", port: positive("PORT", 3000),
  origin: process.env.PIXEL_ORIGIN ?? "http://localhost:3000",
  cookieSecure: (process.env.PIXEL_ORIGIN ?? "http://localhost:3000").startsWith("https://"),
  sessionTtl: positive("PIXEL_SESSION_DAYS", 7) * 86400000,
  uploadLimit: positive("PIXEL_UPLOAD_MB", 25) * 1024 * 1024,
  runTimeout: positive("PIXEL_RUN_TIMEOUT_SECONDS", 3600) * 1000,
  cancelTimeout: positive("PIXEL_CANCEL_TIMEOUT_SECONDS", 5) * 1000,
  modelFile: resolve(process.env.PIXEL_MODELS_FILE ?? resolve(projectRoot, "backend/models.json")),
};
new URL(config.origin);
export function prepareData() {
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  config.dataDir = realpathSync(config.dataDir);
  chmodSync(config.dataDir, 0o700);
}
export function readModels(): ModelConfig {
  if (!existsSync(config.modelFile)) throw new Error(`Model configuration missing: ${config.modelFile}. Copy backend/models.example.json and configure credentials in the environment.`);
  const value = configurationSchema.parse(JSON.parse(readFileSync(config.modelFile, "utf8")));
  if (new Set(value.models.map(m => m.id)).size !== value.models.length) throw new Error("Model IDs must be unique");
  return value;
}
