import { randomUUID } from "node:crypto";
import type { UsageRecord, UsageResponse } from "@pixel/contracts";
import type { Db } from "../db/index.js";
import type { RunRow } from "../conversations/index.js";
import { HttpError } from "../errors.js";
export type NativeEntry = { id: string; type: string; timestamp?: string; message?: Record<string, any>; usage?: Record<string, any> };
const numberOrNull = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
export function usageRecord(row: any): UsageRecord { return { id: row.id, userId: row.user_id, username: row.username, conversationId: row.conversation_id, runId: row.run_id, modelId: row.model_id, actualProvider: row.actual_provider, actualModel: row.actual_model, sourceId: row.source_id, kind: row.kind, granularity: row.granularity, inputTokens: row.input_tokens, outputTokens: row.output_tokens, cacheReadTokens: row.cache_read_tokens, cacheWriteTokens: row.cache_write_tokens, cost: row.cost, costBasis: row.cost_basis, durationMs: row.duration_ms, status: row.status, createdAt: row.created_at }; }
export function insertUsage(db: Db, run: RunRow, detail: { source: string; kind: UsageRecord["kind"]; granularity: UsageRecord["granularity"]; usage?: Record<string, any>; duration?: number; status: string; timestamp?: number; actualProvider?: string; actualModel?: string }): UsageRecord | undefined {
  let u = detail.usage; const id = randomUUID();
  // Pi initializes failed/aborted assistant messages with zero placeholders; these are not known free calls.
  if ((detail.status === "error" || detail.status === "aborted") && u && !(u.input || u.output || u.cacheRead || u.cacheWrite)) u = undefined;
  // Snapshot the administrator's pricing attestation on the run. Native costs are
  // accepted only for the exact model whose configured rates were checked.
  const knownPricing = run.pricing_known === 1 && detail.kind === "model"
    && detail.actualProvider === run.provider && detail.actualModel === run.model;
  const existing = db.prepare("SELECT * FROM usage WHERE source_id=?").get(detail.source) as any;
  const values = { input: numberOrNull(u?.input), output: numberOrNull(u?.output), cacheRead: numberOrNull(u?.cacheRead), cacheWrite: numberOrNull(u?.cacheWrite), cost: knownPricing ? numberOrNull(u?.cost?.total) : null, duration: numberOrNull(detail.duration) };
  if (existing) {
    const improved = (existing.input_tokens === null && values.input !== null) || (existing.output_tokens === null && values.output !== null) || (existing.cost === null && values.cost !== null) || (existing.duration_ms === null && values.duration !== null);
    if (!improved) return;
    db.prepare("UPDATE usage SET input_tokens=coalesce(input_tokens,?),output_tokens=coalesce(output_tokens,?),cache_read_tokens=coalesce(cache_read_tokens,?),cache_write_tokens=coalesce(cache_write_tokens,?),cost=coalesce(cost,?),duration_ms=coalesce(duration_ms,?),cost_basis=CASE WHEN cost IS NULL AND ? IS NOT NULL THEN ? ELSE cost_basis END WHERE id=?").run(values.input, values.output, values.cacheRead, values.cacheWrite, values.cost, values.duration, values.cost, "administrator-verified Pi model pricing estimate; USD, not provider invoice", existing.id);
  } else {
    db.prepare("INSERT INTO usage(id,user_id,conversation_id,run_id,model_id,actual_provider,actual_model,source_id,kind,granularity,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,cost,cost_basis,duration_ms,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, run.user_id, run.conversation_id, run.id, run.model_id, detail.actualProvider ?? null, detail.actualModel ?? null, detail.source, detail.kind, detail.granularity, values.input, values.output, values.cacheRead, values.cacheWrite, values.cost, values.cost !== null ? "administrator-verified Pi model pricing estimate; USD, not provider invoice" : "unavailable: pricing not verified, actual model unknown, or provider cost missing", values.duration, detail.status, detail.timestamp ?? Date.now());
  }
  return usageRecord(db.prepare("SELECT usage.*,users.username FROM usage JOIN users ON users.id=usage.user_id WHERE usage.id=?").get(existing?.id ?? id));
}
export function nativeUsage(db: Db, run: RunRow, entry: NativeEntry) {
  const message = entry.message;
  if (entry.type === "message" && message?.role === "assistant") return insertUsage(db, run, { source: `${run.conversation_id}:native:${entry.id}`, kind: "model", granularity: "call", usage: message.usage, actualProvider: message.provider, actualModel: message.model, duration: typeof message.timestamp === "number" && entry.timestamp ? Math.max(0, Date.parse(entry.timestamp) - message.timestamp) : undefined, status: message.stopReason ?? "unknown", timestamp: Date.parse(entry.timestamp ?? "") || run.created_at });
  if (entry.type === "compaction" || entry.type === "branch_summary") return insertUsage(db, run, { source: `${run.conversation_id}:native:${entry.id}`, kind: "compaction", granularity: "aggregate", usage: entry.usage, status: "completed", timestamp: Date.parse(entry.timestamp ?? "") || run.created_at });
  if (entry.type === "message" && message?.role === "toolResult") return insertUsage(db, run, { source: `${run.id}:tool:${message.toolCallId ?? entry.id}`, kind: "tool", granularity: "call", usage: message.usage, status: message.isError ? "failed" : "completed", timestamp: Date.parse(entry.timestamp ?? "") || run.created_at });
}
export function queryUsage(db: Db, query: Record<string, unknown>, userId?: string): UsageResponse {
  const where: string[] = []; const args: (string | number)[] = [];
  const integer = (key: string, fallback: number, max = Number.MAX_SAFE_INTEGER) => { const n = Number(query[key] ?? fallback); if (!Number.isSafeInteger(n) || n < 0 || n > max) throw new HttpError(400, "INVALID_QUERY", `${key} 参数无效`); return n; };
  if (userId) { where.push("u.user_id=?"); args.push(userId); }
  else if (query.userId) { where.push("u.user_id=?"); args.push(String(query.userId)); }
  if (query.modelId) { where.push("u.model_id=?"); args.push(String(query.modelId)); }
  if (query.from !== undefined) { where.push("u.created_at>=?"); args.push(integer("from", 0)); }
  if (query.to !== undefined) { where.push("u.created_at<=?"); args.push(integer("to", 0)); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const summary = db.prepare(`SELECT count(*) records, coalesce(sum(input_tokens),0) inputTokens, coalesce(sum(output_tokens),0) outputTokens, coalesce(sum(cache_read_tokens),0) cacheReadTokens, coalesce(sum(cache_write_tokens),0) cacheWriteTokens, coalesce(sum(cost),0) estimatedCost, coalesce(sum(CASE WHEN kind!='tool' AND (input_tokens IS NULL OR output_tokens IS NULL OR cost IS NULL) THEN 1 ELSE 0 END),0) unknownRecords, count(DISTINCT run_id) runs, coalesce(sum(CASE WHEN kind='tool' THEN 1 ELSE 0 END),0) toolCalls FROM usage u ${clause}`).get(...args) as UsageResponse["summary"];
  const rows = db.prepare(`SELECT u.*,users.username FROM usage u JOIN users ON users.id=u.user_id ${clause} ORDER BY u.created_at DESC,u.id LIMIT ? OFFSET ?`).all(...args, integer("limit", 100, 500), integer("offset", 0));
  return { summary, total: summary.records, records: rows.map(usageRecord) };
}
