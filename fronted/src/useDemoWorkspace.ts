import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { modes, type FileRecord, type Mode } from "@pixel/contracts";
import type { Conversation, Message, ToolResult } from "./chatTypes";
import { normalizeTools, toolAnswer, validToolResult } from "./chatTools";
import { initialDemoReply, nextDemoReply, type DemoReply } from "./demoReplies";
import { requestId } from "./api";

const STORAGE_KEY = "pixel-chat-tools-v1";
const legacyModes: Record<string, Mode> = { 灵感搭子: "数据分析", 代码伙伴: "产品架构设置", 深度思考: "修补规则设计" };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const newConversation = (): Conversation => ({ id: requestId(), title: "新的工具演示", mode: "数据分析", updated: Date.now(), messages: [], activeRun: null, lastRun: null });

function readSaved(): Conversation[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem("pixel-chat-v1") ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const seenConversations = new Set<string>();
    return parsed.flatMap((raw): Conversation[] => {
      if (!object(raw) || typeof raw.id !== "string" || !raw.id || seenConversations.has(raw.id) || typeof raw.title !== "string" || !Array.isArray(raw.messages)) return [];
      seenConversations.add(raw.id);
      const mode = typeof raw.mode === "string" && Object.hasOwn(legacyModes, raw.mode) ? legacyModes[raw.mode] : raw.mode;
      if (!modes.includes(mode as Mode)) return [];
      const seenTools = new Set<string>();
      const seenMessages = new Set<string>();
      const messages = raw.messages.flatMap((entry): Message[] => {
        if (!object(entry) || typeof entry.id !== "string" || !entry.id || seenMessages.has(entry.id) || (entry.role !== "user" && entry.role !== "assistant") || typeof entry.text !== "string") return [];
        seenMessages.add(entry.id);
        const files: FileRecord[] = Array.isArray(entry.files) ? entry.files.flatMap((file, index) => {
          const name = typeof file === "string" ? file : object(file) && typeof file.name === "string" ? file.name : null;
          return name === null ? [] : [{ id: `${entry.id}:file:${index}`, conversationId: raw.id as string, name, size: 0, kind: "upload" as const, createdAt: 0 }];
        }) : [];
        const tools = normalizeTools(entry.tools, entry.id, seenTools)?.map(tool => entry.delivery === "streaming" && tool.status === "pending" ? { ...tool, status: "expired" as const } : tool);
        return [{ id: entry.id, role: entry.role as Message["role"], text: entry.text, files, runId: "", createdAt: typeof entry.createdAt === "number" ? entry.createdAt : 0, tools: entry.role === "assistant" ? tools : undefined, delivery: entry.delivery === "streaming" || entry.delivery === "stopped" ? "stopped" : "complete" }];
      });
      return [{ id: raw.id, title: raw.title, mode: mode as Mode, updated: typeof raw.updated === "number" ? raw.updated : 0, activeRun: null, lastRun: null, messages }];
    });
  } catch { return []; }
}

function makeMessage(role: Message["role"], text: string, files: FileRecord[] = []): Message {
  return { id: requestId(), role, text, files, runId: "", createdAt: Date.now(), delivery: "complete" };
}

export function useDemoWorkspace(enabled: boolean) {
  const [conversations, updateConversations] = useState<Conversation[]>(() => {
    if (!enabled) return [];
    const saved = readSaved();
    return saved.length ? saved : [newConversation()];
  });
  const current = useRef(conversations);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const timers = useRef(new Map<string, number>());
  const [storageError, setStorageError] = useState("");
  // Keep a synchronous source of truth so repeated clicks cannot submit twice.
  const setConversations = useCallback((action: SetStateAction<Conversation[]>) => {
    const next = typeof action === "function" ? action(current.current) : action;
    current.current = next;
    updateConversations(next);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations)); setStorageError(""); }
    catch { setStorageError("本地存储不可用，本次演示仅在当前页面保留。"); }
  }, [conversations, enabled]);
  useEffect(() => () => { timers.current.forEach(timer => window.clearInterval(timer)); timers.current.clear(); }, []);

  function stream(id: string, reply: DemoReply) {
    const message = { ...makeMessage("assistant", ""), delivery: "streaming" as const };
    setConversations(prev => prev.map(c => c.id === id ? { ...c, messages: [...c.messages, message] } : c));
    setBusyIds(prev => new Set(prev).add(id));
    let index = 0;
    const timer = window.setInterval(() => {
      index = Math.min(reply.text.length, index + 8);
      const done = index >= reply.text.length;
      setConversations(prev => prev.map(c => c.id === id ? { ...c, messages: c.messages.map(m => m.id === message.id ? { ...m, text: reply.text.slice(0, index), delivery: done ? "complete" : "streaming", tools: done ? reply.tools : undefined } : m) } : c));
      if (done) {
        window.clearInterval(timer); timers.current.delete(id);
        setBusyIds(prev => { const next = new Set(prev); next.delete(id); return next; });
      }
    }, 24);
    timers.current.set(id, timer);
  }

  function send(id: string, text: string, files: FileRecord[]) {
    const conversation = current.current.find(c => c.id === id);
    if (!enabled || !text.trim() || !conversation || timers.current.has(id)) return false;
    setConversations(prev => prev.map(c => c.id === id ? {
      ...c, title: c.messages.length ? c.title : text.slice(0, 22), updated: Date.now(),
      messages: [...c.messages.map(m => ({ ...m, tools: m.tools?.map(tool => tool.status === "pending" ? { ...tool, status: "expired" as const } : tool) })), makeMessage("user", text, files)],
    } : c));
    stream(id, initialDemoReply(conversation.mode));
    return true;
  }

  function submit(id: string, result: ToolResult) {
    const conversation = current.current.find(c => c.id === id);
    if (!enabled || !conversation || timers.current.has(id)) return;
    const message = conversation.messages.find(m => m.role === "assistant" && m.tools?.some(tool => tool.id === result.toolId));
    const tool = message?.tools?.find(item => item.id === result.toolId);
    if (!tool || tool.type === "unavailable" || tool.status !== "pending" || message?.delivery === "streaming" || !validToolResult(tool, result)) return;
    const answered = { ...tool, status: "submitted" as const, result };
    setConversations(prev => prev.map(c => c.id === id ? { ...c, updated: Date.now(), messages: [
      ...c.messages.map(m => m.id === message!.id ? { ...m, tools: m.tools?.map(item => item.id === tool.id ? answered : item) } : m),
      makeMessage("user", `${tool.title}\n${toolAnswer(answered)}`),
    ] } : c));
    stream(id, nextDemoReply(tool, result, current.current.find(c => c.id === id)!));
  }

  function stop(id: string) {
    const timer = timers.current.get(id);
    if (timer === undefined) return;
    window.clearInterval(timer); timers.current.delete(id);
    setBusyIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    setConversations(prev => prev.map(c => c.id === id ? { ...c, messages: c.messages.map(m => m.delivery === "streaming" ? { ...m, delivery: "stopped", tools: m.tools?.map(tool => tool.status === "pending" ? { ...tool, status: "expired" as const } : tool) } : m) } : c));
  }

  function create() {
    const empty = current.current.find(c => !c.messages.length);
    if (empty) return empty;
    const conversation = newConversation();
    setConversations(prev => [conversation, ...prev]);
    return conversation;
  }
  function remove(id: string) {
    stop(id);
    const remaining = current.current.filter(c => c.id !== id);
    if (!remaining.length) remaining.push(newConversation());
    setConversations(remaining);
    return remaining[0];
  }
  function update(id: string, patch: Pick<Partial<Conversation>, "title" | "mode">) {
    setConversations(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  }
  return { conversations, busyIds, storageError, send, submit, stop, create, remove, update };
}
