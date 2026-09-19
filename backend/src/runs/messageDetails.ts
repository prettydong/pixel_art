import type { Generation } from "@pixel/contracts";
import type { Db } from "../db/index.js";

export function messageDetails(db: Db, id: string): { reasoning?: string; generation?: Generation } {
  const row = db.prepare("SELECT reasoning,generation FROM message_details WHERE message_id=?").get(id) as { reasoning: string; generation: string | null } | undefined;
  return row ? { reasoning: row.reasoning || undefined, generation: row.generation ? JSON.parse(row.generation) : undefined } : {};
}

export function saveMessageDetails(db: Db, id: string, reasoning: string, generation?: Generation) {
  db.prepare("INSERT INTO message_details(message_id,reasoning,generation) VALUES(?,?,?) ON CONFLICT(message_id) DO UPDATE SET reasoning=excluded.reasoning,generation=excluded.generation")
    .run(id, reasoning, generation ? JSON.stringify(generation) : null);
}

// Fallback only: ASCII averages roughly four characters/token; other scripts one.
export function estimateTokens(text: string): number {
  let ascii = 0, other = 0;
  for (const character of text) { if (character.codePointAt(0)! <= 127) ascii++; else other++; }
  return Math.ceil(ascii / 4 + other);
}

export function generationSnapshot(previous: Generation | undefined, text: string, usage: any, finished: boolean, startedAt: number, updatedAt = Date.now()): Generation {
  const output = usage?.output;
  const reported = typeof output === "number" && Number.isFinite(output) && output > 0;
  return {
    startedAt: previous?.startedAt ?? startedAt,
    updatedAt,
    outputTokens: reported ? output : previous && !previous.estimated ? previous.outputTokens : estimateTokens(text),
    estimated: !reported && (previous?.estimated ?? true),
    finished,
  };
}

/** Keep protocol signatures and binary image payloads out of the public UI. */
export function toolOutput(result: any): string | undefined {
  if (!Array.isArray(result?.content)) return undefined;
  return boundedText(result.content.map((block: any) => block.type === "text" && typeof block.text === "string" ? block.text : `[${block.type === "image" ? "图片" : "非文本"}内容]`).join("\n"));
}
export function boundedText(text: string): string { return text.length > 64000 ? `${text.slice(0, 64000)}\n[内容过长，已截断]` : text; }
export function toolInput(args: unknown): string | undefined { return args === undefined ? undefined : boundedText(JSON.stringify(args, null, 2)); }
