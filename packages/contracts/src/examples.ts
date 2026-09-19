import type { Run, RunEvent } from "./index.js";

const run: Run = {
  id: "11111111-1111-4111-8111-111111111111",
  conversationId: "22222222-2222-4222-8222-222222222222",
  status: "running", modelId: "internal/example", createdAt: 1800000000000,
  finishedAt: null, error: null,
};

// Documentation fixtures only; never sent by the real service.
export const exampleEvents: RunEvent[] = [
  { id: 1, runId: run.id, createdAt: run.createdAt, type: "run.status", run },
  { id: 2, runId: run.id, createdAt: run.createdAt + 100, type: "text.delta", messageId: "assistant-1", delta: "正在读取上传的数据。" },
  { id: 3, runId: run.id, createdAt: run.createdAt + 200, type: "tool.status", toolCallId: "tool-1", name: "read", status: "running" },
  { id: 4, runId: run.id, createdAt: run.createdAt + 300, type: "tool.status", toolCallId: "tool-1", name: "read", status: "completed" },
  { id: 5, runId: run.id, createdAt: run.createdAt + 400, type: "message.updated", message: { id: "assistant-1", role: "assistant", text: "正在读取上传的数据。", files: [], runId: run.id, createdAt: run.createdAt + 100 } },
  { id: 6, runId: run.id, createdAt: run.createdAt + 500, type: "run.status", run: { ...run, status: "completed", finishedAt: run.createdAt + 500 } },
];
