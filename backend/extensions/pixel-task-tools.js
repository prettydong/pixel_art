const CREATE_ARCHITECTURE_PARAMETERS = {
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

function requestArchitectureCreation(toolCallId, parameters, signal) {
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
      else finish(resolve, { success: false, error: typeof message.error === "string" ? message.error : "新增架构失败" });
    };
    const onAbort = () => fail("新增架构已取消");
    const onDisconnect = () => fail("任务服务连接已断开");
    const timeout = setTimeout(() => fail("新增架构超时"), 15_000);

    process.on("message", onMessage);
    signal?.addEventListener("abort", onAbort, { once: true });
    process.once("disconnect", onDisconnect);
    if (signal?.aborted) { onAbort(); return; }
    try {
      process.send({ type: "pixel_task_request", id: toolCallId, operation: "create_architecture", parameters }, (error) => {
        if (error) fail("无法发送新增架构请求");
      });
    } catch {
      fail("无法发送新增架构请求");
    }
  });
}

/** Loaded only for supervised task turns; this extension has no database or file access. */
export default function pixelTaskTools(pi) {
  if (process.env.PIXEL_TASK_TOOLS !== "1" || !process.send || !process.connected) return;

  pi.registerTool({
    name: "pixel_create_architecture",
    label: "新增架构",
    description: "保存一个新的架构定义。description 直接传入内容，或 descriptionFile 指向本轮工作目录内的文件；两者只能选一个。",
    promptSnippet: "新增架构",
    promptGuidelines: [
      "用户要求添加架构时，直接调用 pixel_create_architecture，不要让用户手动录入。",
      "pixel_create_architecture 的 description 与 descriptionFile 只能选一个；不要猜测 CCR 或切分参数。",
      "pixel_create_architecture 成功且 contextUpdated 为 true 后，读取更新的 PIXEL_TASK_CONTEXT 再做预览或评估；contextUpdated 为 false 时说明架构已保存、本轮上下文未更新，下一轮再预览。",
      "只有 pixel_create_architecture 返回成功时才能说明架构已保存。",
    ],
    parameters: CREATE_ARCHITECTURE_PARAMETERS,
    async execute(toolCallId, parameters, signal) {
      const invalid = parameterError(parameters);
      if (invalid) throw new Error(invalid);
      if (signal?.aborted) throw new Error("新增架构已取消");
      const response = await requestArchitectureCreation(toolCallId, parameters, signal);
      if (!response.success) throw new Error(response.error);
      const result = response.result;
      const architecture = result?.architecture;
      if (!architecture || typeof architecture.id !== "string" || typeof architecture.name !== "string" || typeof architecture.fingerprint !== "string") {
        throw new Error("任务服务返回了无效的架构结果");
      }
      const contextUpdated = result.contextUpdated === true;
      return {
        content: resultContent({
          success: true,
          architecture: { id: architecture.id, name: architecture.name, fingerprint: architecture.fingerprint },
          created: result.created === true,
          contextUpdated,
          message: contextUpdated ? "架构已保存，本轮上下文已更新。" : "架构已保存；本轮上下文未更新，请下一轮再做预览。",
        }),
        details: { ...result, architecture },
      };
    },
  });
}
