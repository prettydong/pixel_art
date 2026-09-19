import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { EventEmitter } from "node:events";
import { existsSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { config, projectRoot, type ModelConfig } from "../config.js";
import { ensureUserWorkspace, securePath } from "../workspace/index.js";

export function prepareUserAgentConfig(userId: string, models: ModelConfig) {
  const p = ensureUserWorkspace(userId);
  const target = resolve(p.agent, "models.json");
  if (existsSync(target)) securePath(p.user, ".pi/agent/models.json");
  // Parallel conversations may read this file. Publish a complete snapshot atomically.
  const temporary = resolve(p.agent, `models-${randomUUID()}.tmp`);
  writeFileSync(temporary, JSON.stringify({ providers: models.providers ?? {} }), { mode: 0o600, flag: "wx" });
  renameSync(temporary, target);
  const settings = resolve(p.agent, "settings.json");
  if (!existsSync(settings)) writeFileSync(settings, JSON.stringify({ packages: [] }), { mode: 0o600, flag: "wx" });
  else securePath(p.user, ".pi/agent/settings.json");
  return p.agent;
}

export type RpcEvent = Record<string, any>;
/** Strict LF-delimited JSON protocol. A run owns exactly one supervised process group. */
export class PiProcess extends EventEmitter {
  readonly child: ChildProcess;
  private buffer = "";
  private stopPromise?: Promise<void>;
  private timer: NodeJS.Timeout;
  private requests = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  constructor(args: string[], cwd: string, agentDir: string, envNames: string[], workspaceEnv: Record<string, string>) {
    super();
    const piCli = resolve(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"))), "cli.js");
    const env: NodeJS.ProcessEnv = {};
    // Node does not automatically inherit macOS system proxy settings. Preserve
    // explicit proxy configuration without forwarding the whole server environment.
    const networkEnv = ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy", "NODE_USE_ENV_PROXY"];
    for (const name of ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TERM", ...networkEnv, ...envNames]) if (process.env[name] !== undefined) env[name] = process.env[name];
    env.PI_CODING_AGENT_DIR = agentDir;
    Object.assign(env, workspaceEnv);
    this.child = spawn(process.execPath, [resolve(projectRoot, "scripts/pi-supervisor.mjs"), piCli, "--mode", "rpc", "--no-approve", "--no-context-files", "--no-extensions", "--extension", resolve(projectRoot, "backend/extensions/pixel-charts.js"), "--no-prompt-templates", "--no-themes", "--no-skills", ...args], { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe", "ipc"] });
    this.child.stdout!.setEncoding("utf8");
    this.child.stdout!.on("data", (chunk: string) => this.read(chunk));
    // Drain stderr without forwarding credentials or provider request bodies to clients/logs.
    this.child.stderr!.on("data", () => {});
    this.child.stdin!.on("error", () => {});
    this.child.on("error", () => this.emit("failure", new Error("无法启动 Pi 子进程")));
    this.child.on("exit", (code, signal) => { clearTimeout(this.timer); for (const request of this.requests.values()) { clearTimeout(request.timer); request.reject(new Error("Pi 已退出")); } this.requests.clear(); this.emit("exit", code, signal); });
    this.timer = setTimeout(() => this.emit("failure", new Error("任务超过运行时限")), config.runTimeout);
  }
  private read(chunk: string) {
    this.buffer += chunk;
    if (this.buffer.length > 16 * 1024 * 1024) { this.emit("failure", new Error("Pi 输出超过单条协议消息限制")); return; }
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, ""); this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let event: RpcEvent; try { event = JSON.parse(line); } catch { this.emit("failure", new Error("Pi 返回了无效协议数据")); return; }
      if (event.type === "response" && typeof event.id === "string") {
        const request = this.requests.get(event.id);
        if (request) { clearTimeout(request.timer); this.requests.delete(event.id); if (event.success) request.resolve(event.data); else request.reject(new Error("Pi 命令失败；请检查模型配置与服务凭据")); }
      }
      this.emit("event", event);
    }
  }
  command(type: string, values: Record<string, unknown> = {}, timeout = 30000): Promise<any> {
    if (!this.child.stdin?.writable) return Promise.reject(new Error("Pi 输入通道已关闭"));
    const id = `${type}-${Date.now()}-${Math.random()}`;
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.requests.delete(id); reject(new Error("Pi 命令响应超时")); }, timeout); this.requests.set(id, { resolve, reject, timer }); this.child.stdin!.write(`${JSON.stringify({ id, type, ...values })}\n`); });
  }
  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = new Promise<void>((resolveDone) => {
      clearTimeout(this.timer);
      const pid = this.child.pid;
      if (!pid) { resolveDone(); return; }
      const signal = (name: NodeJS.Signals) => { try { process.kill(-pid, name); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") this.emit("failure", new Error("无法清理 Pi 进程组")); } };
      let timeout: NodeJS.Timeout;
      const done = () => { clearTimeout(timeout); this.child.off("close", done); resolveDone(); };
      if (this.child.exitCode !== null || this.child.signalCode !== null) { signal("SIGKILL"); resolveDone(); return; }
      this.child.once("close", done);
      timeout = setTimeout(() => { signal("SIGKILL"); }, 3000);
      signal("SIGTERM");
    });
    return this.stopPromise;
  }
}
