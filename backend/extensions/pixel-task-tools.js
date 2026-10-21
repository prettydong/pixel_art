import { encodeCard } from "@pixel/contracts/chat-cards";

const PROPOSE_ARCHITECTURE_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    description: { type: "string", minLength: 1, maxLength: 30000, description: "架构完整文本；与 descriptionFile 二选一" },
    descriptionFile: { type: "string", minLength: 1, maxLength: 4096, description: "相对本轮 work 或绝对文件路径；与 description 二选一" },
  },
};

function parameterError(parameters) {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) return "参数必须是对象";
  const keys = Object.keys(parameters);
  if (keys.some((key) => !["name", "description", "descriptionFile"].includes(key))) return "参数包含不支持的字段";
  const { name, description, descriptionFile } = parameters;
  if (typeof name !== "string" || name.length < 1 || name.length > 120) return "name 必须是 1 到 120 个字符";
  const hasDescription = Object.hasOwn(parameters, "description");
  const hasDescriptionFile = Object.hasOwn(parameters, "descriptionFile");
  if (hasDescription === hasDescriptionFile) return "description 与 descriptionFile 必须且只能提供一个";
  if (hasDescription && (typeof description !== "string" || description.length < 1 || description.length > 30000)) return "description 必须是 1 到 30000 个字符";
  if (hasDescriptionFile && (typeof descriptionFile !== "string" || descriptionFile.length < 1 || descriptionFile.length > 4096)) return "descriptionFile 必须是 1 到 4096 个字符";
  return null;
}

function resultContent(value) {
  return [{ type: "text", text: JSON.stringify(value) }];
}

function requestArchitectureProposal(toolCallId, parameters, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      process.off("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
      process.off("disconnect", onDisconnect);
      callback(value);
    };
    const fail = (message) => finish(reject, new Error(message));
    const onMessage = (message) => {
      if (!message || message.type !== "pixel_task_response" || message.id !== toolCallId) return;
      if (message.success === true) finish(resolve, { success: true, result: message.result });
      else finish(resolve, { success: false, error: typeof message.error === "string" ? message.error : "架构提议失败" });
    };
    const onAbort = () => fail("架构提议已取消");
    const onDisconnect = () => fail("任务服务连接已断开");
    const timeout = setTimeout(() => fail("架构提议超时"), 15_000);

    process.on("message", onMessage);
    signal?.addEventListener("abort", onAbort, { once: true });
    process.once("disconnect", onDisconnect);
    if (signal?.aborted) { onAbort(); return; }
    try {
      process.send({ type: "pixel_task_request", id: toolCallId, operation: "prepare_architecture", parameters }, (error) => {
        if (error) fail("无法发送架构提议请求");
      });
    } catch {
      fail("无法发送架构提议请求");
    }
  });
}

/** Loaded only for supervised task turns; this extension has no database or file access. */
export default function pixelTaskTools(pi) {
  if (process.env.PIXEL_TASK_TOOLS !== "1" || !process.send || !process.connected) return;

  pi.registerTool({
    name: "pixel_propose_architecture",
    label: "提议架构",
    description: "在聊天中展示一个架构提议卡片，用户核对后点击保存才会加入任务；本工具不保存任何内容。description 直接传入内容，或 descriptionFile 指向本轮工作目录内的文件；两者只能选一个。",
    promptSnippet: "提议架构，由用户确认保存",
    promptGuidelines: [
      "只有在 row / col 尺寸、备用 row 数、segment 映射、CCR 子组数与每组容量都已由用户给出或确认后，才调用 pixel_propose_architecture；缺少的先用 pixel_ask_user 的 form 问清，不要猜测或套用示例值。",
      "pixel_propose_architecture 的 description 与 descriptionFile 只能选一个。",
      "pixel_propose_architecture 只展示待确认的卡片，不会保存。调用后请用户核对并点击保存，然后结束本轮；不要说架构已添加，也不要在本轮基于它做预览或评估。",
      "返回 status 为 name-conflict 时，说明已有同名但内容不同的架构，请用户在卡片中改名；identical 表示任务中已有相同架构，无需再保存。",
    ],
    parameters: PROPOSE_ARCHITECTURE_PARAMETERS,
    async execute(toolCallId, parameters, signal) {
      const invalid = parameterError(parameters);
      if (invalid) throw new Error(invalid);
      if (signal?.aborted) throw new Error("架构提议已取消");
      const response = await requestArchitectureProposal(toolCallId, parameters, signal);
      if (!response.success) throw new Error(response.error);
      const { name, description, status } = response.result ?? {};
      if (typeof name !== "string" || typeof description !== "string" || !["new", "identical", "name-conflict"].includes(status)) throw new Error("任务服务返回了无效的架构提议");
      return { content: [{ type: "text", text: encodeCard({ kind: "architecture", name, description, status }) }], details: {} };
    },
  });
}
