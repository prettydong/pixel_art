import { isActiveRun, type Conversation, type Message, type Run, type RunStatus, type Mode, type RunEventPayload } from "@pixel/contracts";
import type { Db } from "../db/index.js";
import { listFiles } from "../files/index.js";
import { missing } from "../errors.js";
import { messageDetails } from "../runs/messageDetails.js";
export type ConversationRow = { task_id: string; id: string; user_id: string; title: string; mode: Mode; updated_at: number; deleted_at: number | null };
export type RunRow = { id: string; conversation_id: string; user_id: string; status: RunStatus; model_id: string; provider: string | null; model: string | null; pricing_known: number; idempotency_key: string; request_hash: string; created_at: number; finished_at: number | null; error: string | null; pid: number | null; native_start: number };
export type MessageRow = { id: string; conversation_id: string; run_id: string; role: "user" | "assistant"; text: string; file_ids: string; created_at: number };
export const publicRun = (r: RunRow): Run => ({ id: r.id, conversationId: r.conversation_id, status: r.status, modelId: r.model_id, createdAt: r.created_at, finishedAt: r.finished_at, error: r.error });
export function conversationRow(db: Db, id: string, userId: string) { const r = db.prepare("SELECT * FROM conversations WHERE id=? AND user_id=? AND deleted_at IS NULL").get(id, userId) as ConversationRow | undefined; if (!r) throw missing(); return r; }
export function runRow(db: Db, id: string) { const r = db.prepare("SELECT * FROM runs WHERE id=?").get(id) as RunRow | undefined; if (!r) throw missing(); return r; }
export function ownedRun(db: Db, id: string, userId: string) { const r = runRow(db, id); conversationRow(db, r.conversation_id, userId); if (r.user_id !== userId) throw missing(); return r; }
export function publicMessage(db: Db, r: MessageRow): Message {
  const owner = db.prepare("SELECT user_id FROM conversations WHERE id=?").get(r.conversation_id) as { user_id: string };
  const selected = new Set<string>(JSON.parse(r.file_ids));
  return { id: r.id, role: r.role, text: r.text, files: listFiles(db, owner.user_id, r.conversation_id).filter(f => selected.has(f.id)), runId: r.run_id, createdAt: r.created_at, ...messageDetails(db, r.id) };
}
export function conversation(db: Db, row: ConversationRow): Conversation {
  const active = db.prepare("SELECT * FROM runs WHERE conversation_id=? AND status IN ('starting','running','cancelling')").get(row.id) as RunRow | undefined;
  const last = db.prepare("SELECT * FROM runs WHERE conversation_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(row.id) as RunRow | undefined;
  const messages = (db.prepare("SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at,rowid").all(row.id) as MessageRow[]).map(m => publicMessage(db, m));
  const byId = new Map(messages.map(message => [message.id, message]));
  const latestAssistant = new Map<string, string>();
  const toolOwners = new Map<string, string>();
  // Reuse durable events so tool positions/statuses survive refresh and work for
  // older conversations whose tool events did not carry an explicit message ID.
  const events = db.prepare("SELECT e.run_id,e.payload,e.created_at,r.status FROM events e JOIN runs r ON r.id=e.run_id WHERE r.conversation_id=? AND json_extract(e.payload,'$.type') IN ('message.updated','tool.status') ORDER BY e.id").all(row.id) as { run_id: string; payload: string; created_at: number; status: RunStatus }[];
  for (const record of events) {
    const event = JSON.parse(record.payload) as RunEventPayload;
    if (event.type === "message.updated" && event.message.role === "assistant") latestAssistant.set(record.run_id, event.message.id);
    if (event.type !== "tool.status") continue;
    const key = `${record.run_id}:${event.toolCallId}`;
    const owner = event.messageId ?? toolOwners.get(key) ?? latestAssistant.get(record.run_id);
    const message = owner ? byId.get(owner) : undefined;
    if (!message || message.role !== "assistant" || message.runId !== record.run_id) continue;
    toolOwners.set(key, message.id);
    const calls = message.toolCalls ?? [];
    const previous = calls.find(call => call.id === event.toolCallId);
    const tool = { id: event.toolCallId, name: event.name, status: event.status === "running" && !isActiveRun(record.status) ? "interrupted" as const : event.status, text: event.text ?? previous?.text, input: event.input ?? previous?.input, durationMs: event.durationMs ?? previous?.durationMs, updatedAt: record.created_at };
    message.toolCalls = calls.some(call => call.id === tool.id) ? calls.map(call => call.id === tool.id ? tool : call) : [...calls, tool];
  }
  return { taskId: row.task_id, id: row.id, title: row.title, mode: row.mode, updated: row.updated_at, messages, activeRun: active ? publicRun(active) : null, lastRun: last ? publicRun(last) : null };
}
