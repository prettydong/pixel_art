import type { Mode } from "@pixel/contracts";
import type { Conversation, InteractiveTool, MessageTool, ToolResult } from "./chatTypes";
import { toolAnswer } from "./chatTools";
import { requestId } from "./api";

export type DemoReply = { text: string; tools?: MessageTool[] };
const notice = "> 本地工具演示：仅记录输入并模拟回复，未连接模型、读取附件或执行评估计算。";
const base = (title: string) => ({ id: requestId(), title, status: "pending" as const });
const escapeCell = (value: unknown) => String(value).replace(/[\\`*_{}\[\]<>()#!~|]/g, "\\$&").replace(/\r?\n/g, " ");

export function initialDemoReply(mode: Mode): DemoReply {
  if (mode === "数据分析") return {
    text: `## 数据分析准备\n\n${notice}\n\n请先选择本轮的**分析目标**，提交后再选择统计指标。\n\n- [ ] 选择分析目标\n- [ ] 确定统计指标\n\n任务列表用于展示进度，请使用下方工具回答。`,
    tools: [{ ...base("选择分析目标"), type: "single", options: [
      { value: "distribution", label: "失效分布", description: "观察失效地址的分布" },
      { value: "clusters", label: "聚集特征", description: "查看行列聚集情况" },
      { value: "comparison", label: "条件比较", description: "比较不同测试条件" },
    ] }],
  };
  if (mode === "产品架构设置") return {
    text: `## 产品架构参数\n\n${notice}\n\n填写阵列规模与冗余资源。数字范围是**演示输入约束**，不代表真实产品规格。`,
    tools: [{ ...base("填写产品架构"), type: "form", fields: [
      { id: "product", label: "产品名称", type: "text", required: true },
      { id: "rows", label: "阵列行数", type: "number", required: true, min: 1, max: 1048576 },
      { id: "columns", label: "阵列列数", type: "number", required: true, min: 1, max: 1048576 },
      { id: "spareRows", label: "冗余行数", type: "number", required: true, min: 0, max: 4096 },
      { id: "notes", label: "共享范围与备注", type: "text" },
    ] }],
  };
  return {
    text: `## 示例修补规则\n\n${notice}\n\n1. 优先使用冗余行覆盖整行聚集失效。\n2. 再处理剩余离散失效。\n3. 资源耗尽时标记为不可修补。\n\n这是待讨论的示例，尚未校验资源约束。是否将它记录为本轮演示规则？`,
    tools: [{ ...base("确认示例修补规则"), type: "confirm", confirmLabel: "确认记录", cancelLabel: "取消规则" }],
  };
}

export function nextDemoReply(tool: InteractiveTool, result: ToolResult, conversation: Conversation): DemoReply {
  const answer = toolAnswer({ ...tool, status: "submitted", result });
  if (tool.type === "single") return {
    text: `## 选择统计指标\n\n已记录目标：**${escapeCell(answer)}**。\n\n至少选择一项指标，再生成配置摘要。\n\n${notice}`,
    tools: [{ ...base("选择统计指标"), type: "multi", options: [
      { value: "count", label: "失效数量" }, { value: "ratio", label: "失效占比" },
      { value: "rows", label: "行分布" }, { value: "columns", label: "列分布" },
    ] }],
  };
  if (tool.type === "multi") {
    const goal = conversation.messages.flatMap(message => message.tools || []).filter(item => item.type === "single" && item.status === "submitted").at(-1);
    return { text: `## 分析配置摘要\n\n| 项目 | 已选内容 |\n| --- | --- |\n| 分析目标 | ${escapeCell(goal ? toolAnswer(goal) : "未记录")} |\n| 统计指标 | ${escapeCell(answer)} |\n\n- [x] 选择分析目标\n- [x] 确定统计指标\n- [ ] 接入真实数据并计算\n\n${notice}` };
  }
  if (tool.type === "form" && result.type === "form") {
    // JSON strings may contain backticks; make the fence longer than any input run.
    const json = JSON.stringify(result.value, null, 2);
    const fence = "`".repeat(Math.max(3, ...Array.from(json.matchAll(/`+/g), match => match[0].length + 1)));
    return { text: `## 架构参数已记录\n\n| 参数 | 输入值 |\n| --- | --- |\n${tool.fields.map(field => `| ${escapeCell(field.label)} | ${escapeCell(result.value[field.id] ?? "未填写")} |`).join("\n")}\n\n### 参数示例\n\n${fence}json\n${json}\n${fence}\n\n${notice}` };
  }
  return { text: `## ${result.type === "confirm" && result.value ? "已记录示例规则" : "已取消示例规则"}\n\n${result.type === "confirm" && result.value ? "示例规则已作为本轮输入保存；尚未执行修补计算。" : "本轮未采用这组示例规则。可以发送新消息开始下一轮。"}\n\n${notice}` };
}
