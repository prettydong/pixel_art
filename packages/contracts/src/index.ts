import type { ArchitectureScene } from "../architecture-scene.js";
import { z } from "zod";

export const modes = ["数据分析", "产品架构设置", "修补规则设计"] as const;
export const modeSchema = z.enum(modes);
export type Mode = z.infer<typeof modeSchema>;
export const idSchema = z.string().uuid();
export const passwordSchema = z.string().min(12).max(256);
export const loginSchema = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(256) }).strict();
export const createUserSchema = z.object({ username: z.string().trim().regex(/^[a-zA-Z0-9_.-]{1,64}$/), password: passwordSchema, role: z.enum(["user", "admin"]).default("user") }).strict();
export const updateUserSchema = z.object({ enabled: z.boolean() }).strict();
export const resetPasswordSchema = z.object({ password: passwordSchema }).strict();
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(256), password: passwordSchema }).strict();
export const createConversationSchema = z.object({ title: z.string().trim().min(1).max(120).default("新的评估对话"), mode: modeSchema.default("数据分析"), taskId: idSchema.optional() }).strict();
export const updateConversationSchema = z.object({ title: z.string().trim().min(1).max(120).optional(), mode: modeSchema.optional(), taskId: idSchema.optional() }).strict();
export const createRunSchema = z.object({ text: z.string().trim().min(1).max(100000), mode: modeSchema, modelId: z.string().min(1).max(256), fileIds: z.array(idSchema).max(20).default([]), idempotencyKey: idSchema }).strict();
export type CreateRunInput = z.infer<typeof createRunSchema>;
export type User = { id: string; username: string; role: "admin" | "user"; enabled: boolean; createdAt: number };
export type ModelOption = { id: string; label: string; provider: string; model: string };
/** Uploads belong to the user (conversationId=null); artifacts belong to one conversation. */
export type FileRecord = { id: string; conversationId: string | null; name: string; size: number; kind: "upload" | "artifact"; createdAt: number };
export type ToolCall = { id: string; name: string; status: "running" | "completed" | "failed" | "interrupted"; text?: string; input?: string; durationMs?: number; updatedAt?: number };
/** Per-model-call throughput; elapsed time includes first-token latency, excludes tool execution. */
export type Generation = { startedAt: number; updatedAt: number; outputTokens: number; estimated: boolean; finished: boolean };
export type Message = { id: string; role: "user" | "assistant"; text: string; files: FileRecord[]; runId: string; createdAt: number; toolCalls?: ToolCall[]; reasoning?: string; generation?: Generation };
export const runStatuses = ["starting", "running", "cancelling", "completed", "failed", "cancelled", "interrupted"] as const;
export type RunStatus = typeof runStatuses[number];
export const isActiveRun = (status: RunStatus) => status === "starting" || status === "running" || status === "cancelling";
export type Run = { id: string; conversationId: string; status: RunStatus; modelId: string; createdAt: number; finishedAt: number | null; error: string | null };
export type Conversation = { taskId?: string; id: string; title: string; mode: Mode; updated: number; messages: Message[]; activeRun: Run | null; lastRun: Run | null };
export type UsageRecord = {
  id: string; userId: string; username: string; conversationId: string; runId: string;
  modelId: string; actualProvider: string | null; actualModel: string | null;
  sourceId: string; kind: "model" | "compaction" | "tool" | "unknown";
  granularity: "call" | "aggregate" | "unknown";
  inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null;
  cost: number | null; costBasis: string; durationMs: number | null; status: string; createdAt: number;
};
export type UsageSummary = { records: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; estimatedCost: number; unknownRecords: number; runs: number; toolCalls: number };
export type UsageResponse = { summary: UsageSummary; records: UsageRecord[]; total: number };
export type RunEventPayload =
  | { type: "run.status"; run: Run }
  | { type: "text.delta" | "reasoning.delta"; messageId: string; delta: string; generation?: Generation }
  | { type: "generation.updated"; messageId: string; generation: Generation }
  | { type: "message.updated"; message: Message }
  | { type: "tool.status"; toolCallId: string; messageId?: string; name: string; status: "running" | "completed" | "failed"; text?: string; input?: string; durationMs?: number }
  | { type: "file.created"; file: FileRecord }
  | { type: "usage.updated"; usage: UsageRecord }
  | { type: "error"; code: string; message: string };
export type RunEvent = RunEventPayload & { id: number; runId: string; createdAt: number };
export type ApiError = { error: { code: string; message: string } };
// Collections return { items }; details return the entity directly. Authentication returns { user }.
export type ListResponse<T> = { items: T[] };

export const taskNameSchema = z.object({ name: z.string().trim().min(1).max(120) }).strict();
export const architectureSchema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().min(1).max(30000) }).strict();
export const taskFileSchema = z.object({ fileId: idSchema }).strict();
export type EvaluationTask = { id: string; name: string; updated: number; artifactCount: number };
export type ArchitecturePreview = { draw?: { source: string; file: FileRecord; sha256: string }; scene: ArchitectureScene; file: FileRecord; recipe: FileRecord; createdAt: number; sceneHash: string; themeSnapshot: Record<string, { light: string; dark: string }> };
export type TaskArchitecture = { fingerprint: string; previews?: ArchitecturePreview[]; previewIssues?: string[]; id: string; name: string; description: string; sourceConversationId?: string; sourceFile?: FileRecord };
export type TaskDetail = EvaluationTask & { architectures: TaskArchitecture[]; reports: { fileId: string; text: string }[]; files: FileRecord[] };
