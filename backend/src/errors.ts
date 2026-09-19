export class HttpError extends Error { constructor(public statusCode: number, public code: string, message: string) { super(message); } }
export const missing = () => new HttpError(404, "NOT_FOUND", "资源不存在");

// Provider errors may contain request data or credentials. Return fixed messages
// for recognized failures instead of forwarding their raw text to the browser.
export function modelFailureMessage(error: unknown): string {
  const message = typeof error === "string" ? error : "";
  if (/connection error|fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|TLS|certificate/i.test(message)) return "无法连接模型服务，请检查服务器网络和代理配置";
  if (/timeout|timed out|ETIMEDOUT/i.test(message)) return "模型服务连接或响应超时，请稍后重试";
  if (/\b401\b|\b403\b|invalid.?api.?key|authentication|unauthorized|forbidden/i.test(message)) return "模型服务鉴权失败，请检查服务端 API 密钥和访问权限";
  if (/\b402\b|insufficient.?balance|insufficient.?quota/i.test(message)) return "模型服务余额或额度不足，请检查服务商账户";
  if (/\b429\b|rate.?limit/i.test(message)) return "模型服务请求过于频繁，请稍后重试";
  return "模型调用失败，请检查服务端配置";
}
