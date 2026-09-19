import type { InteractiveTool, Message, MessageTool, ToolField, ToolOption, ToolResult } from "./chatTypes";
import { chartMarkdown, readChartTool } from "@pixel/contracts/charts";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const unique = (values: string[]) => new Set(values).size === values.length;

/** Shared by storage recovery and the submission boundary, not just form controls. */
export function validToolResult(tool: InteractiveTool, result: unknown): result is ToolResult {
  if (!record(result) || result.toolId !== tool.id || result.type !== tool.type) return false;
  const value = result.value;
  switch (tool.type) {
    case "single": return typeof value === "string" && tool.options.some(option => option.value === value);
    case "multi": return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === "string" && tool.options.some(option => option.value === item)) && unique(value);
    case "confirm": return typeof value === "boolean";
    case "form": return record(value) && Object.keys(value).every(key => tool.fields.some(field => field.id === key)) && tool.fields.every(field => {
      const entry = Object.hasOwn(value, field.id) ? value[field.id] : undefined;
      if (entry === undefined || entry === "") return !field.required;
      if (field.type === "text") return typeof entry === "string" && (!field.required || !!entry.trim());
      return typeof entry === "number" && Number.isFinite(entry) && (field.min === undefined || entry >= field.min) && (field.max === undefined || entry <= field.max);
    });
  }
}

function validOptions(value: unknown): value is ToolOption[] {
  return Array.isArray(value) && value.length > 0 && value.every(option => record(option) && nonempty(option.value) && nonempty(option.label) && (option.description === undefined || typeof option.description === "string")) && unique(value.map(option => option.value));
}
function validFields(value: unknown): value is ToolField[] {
  return Array.isArray(value) && value.length > 0 && value.every(field => record(field) && nonempty(field.id) && !["__proto__", "constructor", "prototype"].includes(field.id) && nonempty(field.label) && (field.type === "text" || field.type === "number") && (field.required === undefined || typeof field.required === "boolean") && (field.min === undefined || (typeof field.min === "number" && Number.isFinite(field.min))) && (field.max === undefined || (typeof field.max === "number" && Number.isFinite(field.max))) && (field.min === undefined || field.max === undefined || Number(field.min) <= Number(field.max))) && unique(value.map(field => field.id));
}

export function normalizeTools(value: unknown, prefix: string, seen = new Set<string>()): MessageTool[] | undefined {
  if (value === undefined) return undefined;
  const entries = Array.isArray(value) ? value : [value];
  return entries.map((raw, index) => {
    const fallback: MessageTool = { id: `${prefix}:unavailable:${index}`, type: "unavailable", title: record(raw) && nonempty(raw.title) ? raw.title : "无法读取的交互工具", status: "expired" };
    if (!record(raw) || !nonempty(raw.id) || seen.has(raw.id) || !nonempty(raw.title) || (raw.status !== "pending" && raw.status !== "submitted" && raw.status !== "expired") || (raw.description !== undefined && typeof raw.description !== "string")) return fallback;
    seen.add(raw.id);
    if (raw.type === "single" || raw.type === "multi") { if (!validOptions(raw.options)) return fallback; }
    else if (raw.type === "form") { if (!validFields(raw.fields)) return fallback; }
    else if (raw.type === "confirm") {
      if ((raw.confirmLabel !== undefined && typeof raw.confirmLabel !== "string") || (raw.cancelLabel !== undefined && typeof raw.cancelLabel !== "string")) return fallback;
    } else return fallback;
    const tool = raw as InteractiveTool;
    if (tool.status === "submitted" && !validToolResult(tool, tool.result)) return fallback;
    return { ...tool, result: tool.status === "submitted" ? tool.result : undefined };
  });
}

export function toolAnswer(tool: MessageTool): string {
  if (tool.type === "unavailable") return "工具数据无法读取";
  const result = tool.result;
  if (!result || !validToolResult(tool, result)) return tool.status === "expired" ? "已失效" : "待回答";
  if (result.type === "confirm") return result.value ? "已确认" : "已取消";
  if (tool.type === "single" && result.type === "single") return tool.options.find(option => option.value === result.value)!.label;
  if (tool.type === "multi" && result.type === "multi") return tool.options.filter(option => result.value.includes(option.value)).map(option => option.label).join("、");
  if (tool.type === "form" && result.type === "form") return tool.fields.map(field => `${field.label}：${Object.hasOwn(result.value, field.id) ? result.value[field.id] : "未填写"}`).join("\n");
  return "无法读取回答";
}

export function messageMarkdown(message: Message): string {
  const toolText = message.tools?.map(tool => {
    const lines = [`交互工具：${tool.title}`];
    if (tool.type !== "unavailable" && tool.description) lines.push(tool.description);
    if (tool.type === "single" || tool.type === "multi") lines.push(...tool.options.map(option => `- ${option.label}${option.description ? `：${option.description}` : ""}`));
    if (tool.type === "form") lines.push(...tool.fields.map(field => `- ${field.label}（${field.type === "number" ? "数字" : "文本"}${field.required ? "，必填" : ""}${field.min !== undefined ? `，最小 ${field.min}` : ""}${field.max !== undefined ? `，最大 ${field.max}` : ""}）`));
    if (tool.type === "confirm") lines.push(`选项：${tool.confirmLabel || "确认"} / ${tool.cancelLabel || "取消"}`);
    lines.push(`回答：${toolAnswer(tool)}`);
    return lines.join("\n");
  }).join("\n\n");
  const charts = message.toolCalls?.flatMap(tool => {
    const chart = readChartTool(tool);
    return chart ? [chartMarkdown(chart)] : [];
  });
  return [message.text, ...(charts ?? []), toolText].filter(Boolean).join("\n\n");
}
