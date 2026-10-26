import { cardParametersFor, encodeCard } from "@pixel/contracts/chat-cards";

// Loaded only for supervised task turns. The tools return validated card data
// that the chat renders; they never change the task themselves.
export default function pixelChatCards(pi) {
  if (process.env.PIXEL_TASK_TOOLS !== "1") return;

  pi.registerTool({
    name: "pixel_ask_user",
    label: "向用户提问",
    description: "在聊天中展示一个可点击的问题卡片（单选、多选、确认或参数表单），用户的回答会作为下一条消息发回。",
    promptSnippet: "用可点击卡片向用户提问",
    promptGuidelines: [
      "配置缺少关键参数、或需要用户在几种方案中选择时，调用 pixel_ask_user，不要用长段文字列问题。数值参数用 form，方案选择用 single / multi，执行前确认用 confirm。",
      "一次只问一个问题卡片；有默认值时写进 description 或选项说明。调用成功后用一句话说明在等待回答，然后结束本轮，不要自行假设答案继续执行。",
    ],
    parameters: cardParametersFor("ask"),
    async execute(_toolCallId, parameters, signal) {
      if (signal?.aborted) throw new Error("提问已取消");
      return { content: [{ type: "text", text: encodeCard({ kind: "ask", ...parameters }) }], details: {} };
    },
  });

  pi.registerTool({
    name: "pixel_configure_solver",
    label: "配置修补运行",
    description: "提出一组修补运行（架构 × wafer 全组合），聊天中显示配置卡片，由用户点击加入“修补运行”页的待运行列表。不会启动修补。",
    promptSnippet: "提出修补运行的架构 × wafer 组合",
    promptGuidelines: [
      "用户要求配置、准备或比较修补运行组合时，调用 pixel_configure_solver，architectureIds 与 waferIds 必须来自 PIXEL_TASK_CONTEXT 的 architectures[].id 和 wafers[].id，不要猜测 ID。",
      "pixel_configure_solver 只生成待应用的配置卡片；说明用户需点击卡片加入待运行列表，并在“修补运行”页手动启动，不要声称已运行或已有结果。",
    ],
    parameters: cardParametersFor("solver"),
    async execute(_toolCallId, parameters, signal) {
      if (signal?.aborted) throw new Error("配置已取消");
      return { content: [{ type: "text", text: encodeCard({ kind: "solver", ...parameters }) }], details: {} };
    },
  });
}
