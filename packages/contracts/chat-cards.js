import { z } from "zod";

// Authored ESM like charts.js: Pi extensions validate before returning, the
// browser validates again before rendering. Only completed calls of these
// named tools become cards, never prose.
export const cardProtocol = "pixel-card/v1";
export const cardTools = Object.freeze({
  pixel_ask_user: { kind: "ask", label: "向用户提问" },
  pixel_configure_solver: { kind: "solver", label: "配置 Solver" },
});
const label = (max) => z.string().trim().min(1).max(max).regex(/^[^\x00-\x1f\x7f]*$/, "不能包含换行或控制字符");
const id = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/, "只能使用字母、数字、_ . : -");
const unique = values => new Set(values).size === values.length;

const askSchema = z.object({
  type: z.enum(["single", "multi", "confirm", "form"]).describe("single 单选、multi 多选、confirm 确认、form 填写参数"),
  title: label(120).describe("问题本身，简短明确"),
  description: z.string().trim().min(1).max(600).optional().describe("必要的背景或默认值说明"),
  options: z.array(z.object({
    value: id, label: label(80), description: label(200).optional(),
  }).strict()).min(2).max(8).optional().describe("single / multi 必填，2–8 项"),
  fields: z.array(z.object({
    id, label: label(80), type: z.enum(["text", "number"]), required: z.boolean().optional(),
    min: z.number().finite().optional(), max: z.number().finite().optional(),
  }).strict()).min(1).max(8).optional().describe("form 必填，1–8 个字段"),
  confirmLabel: label(24).optional(),
  cancelLabel: label(24).optional(),
}).strict();

const solverSchema = z.object({
  architectureIds: z.array(z.string().min(1).max(64)).min(1).max(20).describe("任务上下文 architectures[].id"),
  waferIds: z.array(z.string().min(1).max(64)).min(1).max(50).describe("任务上下文 wafers[].id"),
  note: label(300).optional().describe("一句话说明这样组合的理由"),
}).strict();

const schemas = { ask: askSchema, solver: solverSchema };

export function cardParametersFor(kind) {
  if (!Object.hasOwn(schemas, kind)) throw new Error("不支持的卡片类型");
  return z.toJSONSchema(schemas[kind], { target: "draft-7" });
}

export function createCard(kind, input) {
  if (!Object.hasOwn(schemas, kind)) throw new Error("不支持的卡片类型");
  const result = schemas[kind].safeParse(input);
  if (!result.success) throw new Error(result.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  const card = { kind, ...result.data };
  if (kind === "ask") {
    const choice = card.type === "single" || card.type === "multi";
    if (choice !== !!card.options) throw new Error(choice ? "single / multi 必须提供 options" : "只有 single / multi 可以提供 options");
    if ((card.type === "form") !== !!card.fields) throw new Error(card.type === "form" ? "form 必须提供 fields" : "只有 form 可以提供 fields");
    if (card.type !== "confirm" && (card.confirmLabel || card.cancelLabel)) throw new Error("只有 confirm 可以提供 confirmLabel / cancelLabel");
    if (card.options && !unique(card.options.map(option => option.value))) throw new Error("options 的 value 不能重复");
    if (card.fields) {
      if (!unique(card.fields.map(field => field.id))) throw new Error("fields 的 id 不能重复");
      if (card.fields.some(field => ["__proto__", "constructor", "prototype"].includes(field.id))) throw new Error("fields 的 id 无效");
      if (card.fields.some(field => field.type === "text" && (field.min !== undefined || field.max !== undefined))) throw new Error("text 字段不能设置 min / max");
      if (card.fields.some(field => field.min !== undefined && field.max !== undefined && field.min > field.max)) throw new Error("min 不能大于 max");
    }
  } else {
    if (!unique(card.architectureIds) || !unique(card.waferIds)) throw new Error("架构或 wafer ID 不能重复");
    if (card.architectureIds.length * card.waferIds.length > 100) throw new Error("组合数不能超过 100");
  }
  return card;
}

export function encodeCard(card) {
  const { kind, ...parameters } = card;
  return JSON.stringify({ protocol: cardProtocol, card: createCard(kind, parameters) });
}

export function readCardTool(tool) {
  if (!tool || !Object.hasOwn(cardTools, tool.name) || tool.status !== "completed" || typeof tool.text !== "string" || tool.text.length > 32000) return null;
  try {
    const envelope = JSON.parse(tool.text);
    if (envelope?.protocol !== cardProtocol || !envelope.card || envelope.card.kind !== cardTools[tool.name].kind) return null;
    const { kind, ...parameters } = envelope.card;
    return createCard(kind, parameters);
  } catch { return null; }
}
