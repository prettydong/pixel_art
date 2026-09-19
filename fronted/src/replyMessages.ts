import type { Message as ServerMessage } from '@pixel/contracts';
import type { Message } from './chatTypes';

/** Preserve inline tools across text snapshots and stale SSE replay. */
export function mergeMessage(existing: ServerMessage | undefined, incoming: ServerMessage): ServerMessage {
  if (!existing) return incoming;
  const authoritative = incoming.generation?.finished && (!existing.generation || incoming.generation.updatedAt >= existing.generation.updatedAt);
  const calls = new Map(existing.toolCalls?.map(call => [call.id, call]));
  for (const call of incoming.toolCalls ?? []) {
    const previous = calls.get(call.id);
    if (previous?.updatedAt !== undefined && (call.updatedAt ?? 0) < previous.updatedAt) continue;
    if (previous && previous.status !== 'running' && call.status === 'running') continue;
    calls.set(call.id, { ...call, input: call.input ?? previous?.input, text: call.text ?? previous?.text, durationMs: call.durationMs ?? previous?.durationMs });
  }
  return {
    ...incoming,
    text: authoritative ? incoming.text : existing.text.length > incoming.text.length ? existing.text : incoming.text,
    reasoning: authoritative ? incoming.reasoning : (existing.reasoning?.length ?? 0) > (incoming.reasoning?.length ?? 0) ? existing.reasoning : incoming.reasoning,
    generation: !incoming.generation || (existing.generation && (existing.generation.finished && !incoming.generation.finished || existing.generation.updatedAt > incoming.generation.updatedAt)) ? existing.generation : incoming.generation,
    files: [...new Map([...existing.files, ...incoming.files].map(file => [file.id, file])).values()],
    toolCalls: calls.size ? [...calls.values()] : undefined,
  };
}

export type ReplyMessage = Message & { segments?: Message[] };

/** One visible reply per run; native model/tool rounds remain ordered inside it. */
export function groupReplyMessages(messages: Message[]): ReplyMessage[] {
  const result: ReplyMessage[] = [];
  for (const message of messages) {
    const previous = result[result.length - 1];
    if (message.role === 'assistant' && previous?.role === 'assistant' && previous.runId === message.runId) {
      previous.segments!.push(message);
      previous.text = previous.segments!.map(segment => segment.text).filter(Boolean).join('\n\n');
      previous.toolCalls = [...(previous.toolCalls ?? []), ...(message.toolCalls ?? [])];
      previous.files = [...new Map([...previous.files, ...message.files].map(file => [file.id, file])).values()];
    } else {
      result.push(message.role === 'assistant' ? { ...message, id: `${message.runId}:reply`, segments: [message] } : message);
    }
  }
  return result;
}
