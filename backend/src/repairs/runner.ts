import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import type { RepairDataset, RepairSummary } from "@pixel/contracts";
import { decodeWafer } from "@pixel/contracts/wafer-data";

const MAX_DEV_SOURCE_BYTES = 256 * 1024;
const COMPILE_TIMEOUT_MS = 60_000;
const RUN_TIMEOUT_MS = 10 * 60_000;
const MAX_COMPILE_LOG_BYTES = 2 * 1024 * 1024;
const MAX_RUNTIME_LOG_BYTES = 8 * 1024 * 1024;
const MAX_RESULT_BYTES = 256 * 1024 * 1024;
const STDERR_TAIL_BYTES = 16 * 1024;
const PROGRESS_INTERVAL_MS = 200;
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repairCppRoot = resolve(backendRoot, "repair-cpp");
const supervisorPath = resolve(backendRoot, "../scripts/repair-supervisor.mjs");

type Phase = "compiling" | "running";
type Architecture = { id: string; name: string; description: string; fingerprint: string };
type ExecuteOptions = {
  directory: string;
  waferPath: string;
  devSource: Buffer;
  architecture: Architecture;
  dataset: RepairDataset;
  signal: AbortSignal;
  expectedInputHash?: string;
  onPhase: (phase: Phase) => void;
  onProgress: (processed: number, total: number) => void;
};

type Manifest = {
  version: 1;
  algorithm: "repairMost-v1";
  architecture: Architecture;
  dataset: RepairDataset;
  hashes: { waferSha256: string; devSourceSha256: string; inputTextSha256: string; coreSourceSha256: Record<"model.hpp" | "repair_most.hpp" | "main.cpp", string> };
  compileCommand: string[];
  startedAt: string;
  completedAt?: string;
  failedAt?: string;
  error?: string;
  summary?: RepairSummary;
};

function sha256(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
function isInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value); }
function sameLayout(a: { chipCount: number; regionCount: number; rows: number; cols: number }, b: RepairDataset) {
  return a.chipCount === b.chipCount && a.regionCount === b.regionCount && a.rows === b.rows && a.cols === b.cols;
}

async function writeManifest(directory: string, manifest: Manifest) {
  await writeFile(resolve(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function writeInputText(path: string, decoded: ReturnType<typeof decodeWafer>, signal: AbortSignal) {
  const file = await open(path, "wx");
  const hash = createHash("sha256");
  const write = async (text: string) => {
    if (signal.aborted) throw new Error("修补任务已取消");
    const bytes = Buffer.from(text, "utf8");
    hash.update(bytes);
    await file.writeFile(bytes);
  };
  try {
    const { layout } = decoded;
    await write(`PIXEL_REPAIR_INPUT_V1 ${layout.chipCount} ${layout.regionCount} ${layout.rows} ${layout.cols} ${decoded.failCount} ${decoded.groups.length}\n`);
    for (const group of decoded.groups) {
      await write(`${group.regionIndex} ${group.positions.length}`);
      // Do not materialize a wafer-sized line: keep each write bounded even for dense regions.
      for (let index = 0; index < group.positions.length; index += 1024) {
        await write(` ${Array.from(group.positions.subarray(index, index + 1024)).join(" ")}`);
      }
      await write("\n");
    }
  } finally { await file.close(); }
  return hash.digest("hex");
}

function commandWithLimits(command: string, args: string[], cpuSeconds: number) {
  // prlimit is opportunistic; it constrains this local process but is not a sandbox.
  if (process.platform === "linux" && existsSync("/usr/bin/prlimit")) {
    return { command: "/usr/bin/prlimit", args: [`--as=${2 * 1024 * 1024 * 1024}`, `--cpu=${cpuSeconds}`, `--fsize=${MAX_RESULT_BYTES}`, "--", command, ...args] };
  }
  return { command, args };
}

async function runProcess(options: {
  directory: string; command: string; args: string[]; logPath: string; timeoutMs: number;
  maxLogBytes: number; signal: AbortSignal; onStdoutLine?: (line: string) => void;
}): Promise<void> {
  const { directory, command, args, logPath, timeoutMs, maxLogBytes, signal, onStdoutLine } = options;
  if (signal.aborted) throw new Error("修补任务已取消");
  const log = await open(logPath, "w");
  if (signal.aborted) { await log.close(); throw new Error("修补任务已取消"); }
  const child = spawn(process.execPath, [supervisorPath, command, ...args], {
    cwd: directory, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TMPDIR: "/tmp" },
  });
  let outputBytes = 0;
  let stdoutTail = "";
  let killed = false;
  let killReason = "";
  let outputError: Error | undefined;
  let logError: Error | undefined;
  let stderrTail = "";
  let logWrite = Promise.resolve();
  let forceKillTimer: NodeJS.Timeout | undefined;
  const killGroup = (signalName: NodeJS.Signals) => {
    if (child.pid && process.platform !== "win32") { try { process.kill(-child.pid, signalName); } catch { /* process exited */ } }
    else { try { child.kill(signalName); } catch { /* process exited */ } }
  };
  const stop = (reason: string) => {
    if (killed) return;
    killed = true; killReason = reason;
    killGroup("SIGTERM");
    forceKillTimer = setTimeout(() => killGroup("SIGKILL"), 2_000);
    forceKillTimer.unref();
  };
  const append = (chunk: Buffer) => {
    outputBytes += chunk.length;
    if (outputBytes > maxLogBytes) stop(`输出超过 ${(maxLogBytes / 1024 / 1024).toFixed(0)} MiB 限制`);
    // After quota is reached do not keep queueing unbounded writes while the process dies.
    if (outputBytes > maxLogBytes) return;
    logWrite = logWrite.then(() => log.writeFile(chunk)).catch(error => { logError = error instanceof Error ? error : new Error(String(error)); });
  };
  child.stdout!.on("data", (chunk: Buffer) => {
    append(chunk);
    if (!onStdoutLine) return;
    try {
      stdoutTail += chunk.toString("utf8");
      let newline: number;
      while ((newline = stdoutTail.indexOf("\n")) >= 0) {
        const line = stdoutTail.slice(0, newline); stdoutTail = stdoutTail.slice(newline + 1);
        if (line.length > 1024 * 1024) { stop("solver 输出行过长"); return; }
        onStdoutLine(line);
      }
      if (stdoutTail.length > 1024 * 1024) stop("solver 输出行过长");
    } catch (error) {
      outputError = error instanceof Error ? error : new Error(String(error));
      stop(outputError.message);
    }
  });
  child.stderr!.on("data", (chunk: Buffer) => {
    stderrTail = `${stderrTail}${chunk.toString("utf8")}`.slice(-STDERR_TAIL_BYTES);
    append(chunk);
  });
  const abort = () => stop("修补任务已取消");
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => stop(`执行超过 ${Math.floor(timeoutMs / 1000)} 秒时限`), timeoutMs);
  try {
    const result = await new Promise<{ code: number | null; spawnError?: Error }>(finish => {
      child.once("error", spawnError => finish({ code: null, spawnError }));
      child.once("close", code => finish({ code }));
    });
    if (result.spawnError) {
      if ((result.spawnError as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`无法启动 ${command}；请安装 g++ 编译器`);
      throw new Error(`无法启动 ${command}: ${result.spawnError.message}`);
    }
    if (outputError) throw outputError;
    if (killed) throw new Error(killReason);
    if (onStdoutLine && stdoutTail.trim()) throw new Error("solver stdout 包含未结束的 JSONL 行");
    if (result.code !== 0) {
      const detail = stderrTail.trim().slice(-STDERR_TAIL_BYTES);
      if (command === "/usr/bin/prlimit" && /(?:execute|run).*g\+\+|g\+\+.*(?:not found|no such file)/i.test(detail)) throw new Error(`无法启动 g++ 编译器：${detail}`);
      throw new Error(`${command} 以退出码 ${result.code ?? "未知"} 结束：${detail || `请查看 ${logPath}`}`);
    }
  } finally {
    clearTimeout(timeout); signal.removeEventListener("abort", abort);
    if (forceKillTimer) clearTimeout(forceKillTimer);
    // The supervisor parent has closed; force-kill its process group so descendants cannot survive it.
    killGroup("SIGKILL");
    await logWrite; await log.close();
    if (logError) throw logError;
  }
}

function expectedInitialGoods(decoded: ReturnType<typeof decodeWafer>) {
  const occupiedChips = new Uint8Array(decoded.layout.chipCount);
  for (const group of decoded.groups) occupiedChips[Math.floor(group.regionIndex / decoded.layout.regionCount)] = 1;
  return { regions: decoded.layout.chipCount * decoded.layout.regionCount - decoded.groups.length, chips: decoded.layout.chipCount - occupiedChips.reduce((total, present) => total + present, 0) };
}

function validateSummary(value: unknown, dataset: RepairDataset, initiallyGood: { regions: number; chips: number }): RepairSummary {
  if (!value || typeof value !== "object") throw new Error("solver 未输出有效 summary");
  const input = value as Record<string, unknown>;
  const keys = ["totalRegions", "initiallyGoodRegions", "repairedRegions", "passedRegions", "unresolvedRegions", "totalChips", "initiallyGoodChips", "passedChips", "unresolvedChips"] as const;
  if (input.algorithm !== "repairMost" || !keys.every(key => isInteger(input[key]) && input[key] >= 0) || typeof input.regionYield !== "number" || typeof input.chipYield !== "number" || !Number.isFinite(input.regionYield) || !Number.isFinite(input.chipYield)) throw new Error("solver summary 字段非法");
  const summary = input as unknown as RepairSummary;
  const totalRegions = dataset.chipCount * dataset.regionCount;
  if (summary.totalRegions !== totalRegions || summary.totalChips !== dataset.chipCount ||
      summary.initiallyGoodRegions !== initiallyGood.regions || summary.initiallyGoodChips !== initiallyGood.chips ||
      summary.initiallyGoodRegions + summary.repairedRegions !== summary.passedRegions || summary.passedRegions + summary.unresolvedRegions !== totalRegions ||
      summary.initiallyGoodRegions > summary.passedRegions || summary.initiallyGoodChips > summary.passedChips || summary.passedChips + summary.unresolvedChips !== dataset.chipCount ||
      Math.abs(summary.regionYield - summary.passedRegions / totalRegions) > 1e-12 || Math.abs(summary.chipYield - summary.passedChips / dataset.chipCount) > 1e-12) {
    throw new Error("solver summary 与完整 wafer 布局不一致");
  }
  return summary;
}

function sameSummary(left: RepairSummary, right: RepairSummary) {
  return left.algorithm === right.algorithm && left.totalRegions === right.totalRegions && left.initiallyGoodRegions === right.initiallyGoodRegions && left.repairedRegions === right.repairedRegions && left.passedRegions === right.passedRegions && left.unresolvedRegions === right.unresolvedRegions && left.totalChips === right.totalChips && left.initiallyGoodChips === right.initiallyGoodChips && left.passedChips === right.passedChips && left.unresolvedChips === right.unresolvedChips && left.regionYield === right.regionYield && left.chipYield === right.chipYield;
}

async function verifyResultTail(path: string, dataset: RepairDataset, initiallyGood: { regions: number; chips: number }, stdoutSummary: RepairSummary) {
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_RESULT_BYTES) throw new Error("result.jsonl 缺失或超过 256 MiB 限制");
  const file = await open(path, "r");
  try {
    const length = Math.min(info.size, 64 * 1024);
    const bytes = Buffer.alloc(length);
    await file.read(bytes, 0, length, info.size - length);
    const last = bytes.toString("utf8").trimEnd().split("\n").at(-1);
    if (!last) throw new Error("result.jsonl 缺少末尾 summary");
    let event: unknown; try { event = JSON.parse(last); } catch { throw new Error("result.jsonl 末尾不是 JSON"); }
    if (!event || typeof event !== "object" || (event as Record<string, unknown>).type !== "summary") throw new Error("result.jsonl 末尾不是 summary");
    const resultSummary = validateSummary(event, dataset, initiallyGood);
    if (!sameSummary(resultSummary, stdoutSummary)) throw new Error("result.jsonl 末尾 summary 与 stdout 不一致");
  } finally { await file.close(); }
}

export async function executeRepair(options: ExecuteOptions): Promise<RepairSummary> {
  const { directory, waferPath, devSource, architecture, dataset, signal, expectedInputHash, onPhase, onProgress } = options;
  if (devSource.length > MAX_DEV_SOURCE_BYTES) throw new Error("dev.hpp 超过 256 KiB 限制");
  await mkdir(directory, { recursive: true });
  const waferBytes = await readFile(waferPath);
  const waferSha256 = sha256(waferBytes);
  if (expectedInputHash !== undefined && expectedInputHash !== waferSha256) throw new Error("wafer 输入哈希与入队快照不一致");
  const decoded = decodeWafer(waferBytes);
  if (!sameLayout(decoded.layout, dataset) || decoded.failCount !== dataset.failCount || decoded.synthetic !== dataset.synthetic) throw new Error("wafer 内容与任务数据集元信息不一致");
  const inputWafer = resolve(directory, "input.pwafer");
  const devPath = resolve(directory, "dev.hpp");
  const inputText = resolve(directory, "input.txt");
  const resultPath = resolve(directory, "result.jsonl");
  const compileCommand = ["g++", "-std=c++17", "-O2", "-Wall", "-Wextra", "-pedantic", "main.cpp", "-o", "repair-solver"];
  const coreNames = ["model.hpp", "repair_most.hpp", "main.cpp"] as const;
  const coreSources = Object.fromEntries(await Promise.all(coreNames.map(async name => [name, await readFile(resolve(repairCppRoot, name))]))) as Record<typeof coreNames[number], Buffer>;
  let manifest: Manifest | undefined;
  try {
    await writeFile(inputWafer, waferBytes, { flag: "wx" });
    await writeFile(devPath, devSource, { flag: "wx" });
    for (const name of coreNames) await writeFile(resolve(directory, name), coreSources[name], { flag: "wx" });
    const inputTextSha256 = await writeInputText(inputText, decoded, signal);
    const hashes = { waferSha256, devSourceSha256: sha256(devSource), inputTextSha256, coreSourceSha256: Object.fromEntries(coreNames.map(name => [name, sha256(coreSources[name])])) as Manifest["hashes"]["coreSourceSha256"] };
    manifest = { version: 1, algorithm: "repairMost-v1", architecture, dataset, hashes, compileCommand, startedAt: new Date().toISOString() };
    await writeManifest(directory, manifest);
    onPhase("compiling");
    const compile = commandWithLimits("g++", compileCommand.slice(1), 55);
    await runProcess({ directory, ...compile, logPath: resolve(directory, "compile.log"), timeoutMs: COMPILE_TIMEOUT_MS, maxLogBytes: MAX_COMPILE_LOG_BYTES, signal });
    onPhase("running");
    let summary: RepairSummary | undefined;
    let summaryCount = 0;
    let lastProgressAt = 0;
    let lastProcessed = 0;
    const initiallyGood = expectedInitialGoods(decoded);
    const run = commandWithLimits("./repair-solver", ["input.txt", "result.jsonl"], 600);
    await runProcess({ directory, ...run, logPath: resolve(directory, "runtime.log"), timeoutMs: RUN_TIMEOUT_MS, maxLogBytes: MAX_RUNTIME_LOG_BYTES, signal, onStdoutLine(line) {
      if (!line) return;
      let event: unknown; try { event = JSON.parse(line); } catch { throw new Error("solver stdout 不是 JSONL"); }
      if (!event || typeof event !== "object") throw new Error("solver stdout 事件非法");
      const record = event as Record<string, unknown>;
      if (record.type === "progress") {
        if (!isInteger(record.processedRegions) || !isInteger(record.totalRegions) || record.totalRegions !== dataset.chipCount * dataset.regionCount || record.processedRegions < lastProcessed || record.processedRegions > record.totalRegions) throw new Error("solver progress 非法");
        lastProcessed = record.processedRegions;
        const now = Date.now(); if (now - lastProgressAt >= PROGRESS_INTERVAL_MS || record.processedRegions === record.totalRegions) { lastProgressAt = now; onProgress(record.processedRegions, record.totalRegions); }
      } else if (record.type === "summary") {
        summaryCount++; summary = validateSummary(record, dataset, initiallyGood);
      } else throw new Error("solver stdout 事件类型非法");
    } });
    if (summaryCount !== 1 || !summary) throw new Error(summaryCount ? "solver 输出了多个 summary" : "solver 未输出 summary");
    await verifyResultTail(resultPath, dataset, initiallyGood, summary);
    const [sourceWafer, finalWafer, finalDev, finalInputText, ...coreChecks] = await Promise.all([readFile(waferPath), readFile(inputWafer), readFile(devPath), readFile(inputText), ...coreNames.flatMap(name => [readFile(resolve(repairCppRoot, name)), readFile(resolve(directory, name))])]);
    if (sha256(sourceWafer) !== hashes.waferSha256 || sha256(finalWafer) !== hashes.waferSha256 || sha256(finalDev) !== hashes.devSourceSha256 || sha256(finalInputText) !== hashes.inputTextSha256 || coreChecks.some((source, index) => sha256(source) !== hashes.coreSourceSha256[coreNames[Math.floor(index / 2)]])) throw new Error("执行期间源输入、输入文本、核心模板或 dev.hpp 被修改");
    manifest.completedAt = new Date().toISOString(); manifest.summary = summary;
    await writeManifest(directory, manifest);
    return summary;
  } catch (error) {
    if (manifest) {
      manifest.failedAt = new Date().toISOString(); manifest.error = error instanceof Error ? error.message : String(error);
      await writeManifest(directory, manifest);
    }
    throw error instanceof Error ? error : new Error(String(error));
  }
}
