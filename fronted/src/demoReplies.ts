import { t } from './i18n';
import type { Mode } from "@pixel/contracts";
import type { Conversation, InteractiveTool, MessageTool, ToolResult } from "./chatTypes";
import { toolAnswer } from "./chatTools";
import { requestId } from "./api";

export type DemoReply = { text: string; tools?: MessageTool[] };
const notice = () => t("> 本地工具演示：仅记录输入并模拟回复，未连接模型、读取附件或执行评估计算。");
const base = (title: string) => ({ id: requestId(), title, status: "pending" as const });
const escapeCell = (value: unknown) => String(value).replace(/[\\`*_{}\[\]<>()#!~|]/g, "\\$&").replace(/\r?\n/g, " ");

export function initialDemoReply(mode: Mode): DemoReply {
  if (mode === "数据分析") return {
    text: t("## 数据分析准备\n\n{0}\n\n请先选择本轮的**分析目标**，提交后再选择统计指标。\n\n- [ ] 选择分析目标\n- [ ] 确定统计指标\n\n任务列表用于展示进度，请使用下方工具回答。", notice()),
    tools: [{ ...base(t("选择分析目标")), type: "single", options: [
      { value: "distribution", label: t("失效分布"), description: t("观察失效地址的分布") },
      { value: "clusters", label: t("聚集特征"), description: t("查看 row / col 聚集情况") },
      { value: "comparison", label: t("条件比较"), description: t("比较不同测试条件") },
    ] }],
  };
  if (mode === "产品架构设置") return {
    text: t("## CCR 产品架构参数\n\n{0}\n\n填写单个 Region 的尺寸、Region 共享的全局备用 row 数（默认 128）以及每个 Segment 的 CCR 备用 col 容量。Segment 保留 section/subsection 映射；全局备用 row 由本 Region 内所有 Segment 共享，不跨 Region 借用。col 按零基地址取模分组，col 修复仅覆盖本 Segment，CCR col 资源不跨 Segment、Region 或子组共享。数字范围是**演示输入约束**，不代表真实产品规格。完整参数请在架构配置页填写。", notice()),
    tools: [{ ...base(t("填写产品架构")), type: "form", fields: [
      { id: "product", label: t("产品名称"), type: "text", required: true },
      { id: "rows", label: t("Region row 数"), type: "number", required: true, min: 1, max: 1048576 },
      { id: "columns", label: t("Region col 数"), type: "number", required: true, min: 1, max: 1048576 },
      { id: "spareRows", label: t("Region 全局备用 row"), type: "number", required: true, min: 0, max: 1048576 },
      { id: "ccrGroupsPerSegment", label: t("CCR 子组数 / Segment"), type: "number", required: true, min: 1, max: 256 },
      { id: "ccrSparesPerGroup", label: t("每子组备用 col"), type: "number", required: true, min: 0, max: 1048576 },
      { id: "notes", label: t("Section/subsection 映射与备注"), type: "text" },
    ] }],
  };
  return {
    text: t("## 示例修补规则\n\n{0}\n\n1. 优先使用冗余 row 覆盖整条 row 聚集失效。\n2. 再处理剩余离散失效。\n3. 资源耗尽时标记为不可修补。\n\n这是待讨论的示例，尚未校验资源约束。是否将它记录为本轮演示规则？", notice()),
    tools: [{ ...base(t("确认示例修补规则")), type: "confirm", confirmLabel: t("确认记录"), cancelLabel: t("取消规则") }],
  };
}

export function nextDemoReply(tool: InteractiveTool, result: ToolResult, conversation: Conversation): DemoReply {
  const answer = toolAnswer({ ...tool, status: "submitted", result });
  if (tool.type === "single") return {
    text: t("## 选择统计指标\n\n已记录目标：**{0}**。\n\n至少选择一项指标，再生成配置摘要。\n\n{1}", escapeCell(answer), notice()),
    tools: [{ ...base(t("选择统计指标")), type: "multi", options: [
      { value: "count", label: t("失效数量") }, { value: "ratio", label: t("失效占比") },
      { value: "rows", label: t("row 分布") }, { value: "columns", label: t("col 分布") },
    ] }],
  };
  if (tool.type === "multi") {
    const goal = conversation.messages.flatMap(message => message.tools || []).filter(item => item.type === "single" && item.status === "submitted").at(-1);
    return { text: t("## 分析配置摘要\n\n| 项目 | 已选内容 |\n| --- | --- |\n| 分析目标 | {0} |\n| 统计指标 | {1} |\n\n- [x] 选择分析目标\n- [x] 确定统计指标\n- [ ] 接入真实数据并计算\n\n{2}", escapeCell(goal ? toolAnswer(goal) : t("未记录")), escapeCell(answer), notice()) };
  }
  if (tool.type === "form" && result.type === "form") {
    // JSON strings may contain backticks; make the fence longer than any input run.
    const json = JSON.stringify(result.value, null, 2);
    const fence = "`".repeat(Math.max(3, ...Array.from(json.matchAll(/`+/g), match => match[0].length + 1)));
    return { text: t("## 架构参数已记录\n\n| 参数 | 输入值 |\n| --- | --- |\n{0}\n\n### 参数示例\n\n{1}json\n{2}\n{3}\n\n{4}", tool.fields.map(field => `| ${escapeCell(field.label)} | ${escapeCell(result.value[field.id] ?? t("未填写"))} |`).join("\n"), fence, json, fence, notice()) };
  }
  return { text: `## ${result.type === "confirm" && result.value ? t("已记录示例规则") : t("已取消示例规则")}\n\n${result.type === "confirm" && result.value ? t("示例规则已作为本轮输入保存；尚未执行修补计算。") : t("本轮未采用这组示例规则。可以发送新消息开始下一轮。")}\n\n${notice()}` };
}
