import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { architectureSchema } from '@pixel/contracts';
import type { Db } from '../db/index.js';
import { conversationRow, runRow } from '../conversations/index.js';
import { HttpError } from '../errors.js';
import { paths, securePath } from '../workspace/index.js';
import { createTaskArchitecture, taskDetail, taskFiles, taskRow } from './index.js';

const parametersSchema = z.union([
  architectureSchema,
  z.object({ name: z.string().trim().min(1).max(120), descriptionFile: z.string().min(1).max(4096) }).strict(),
]);
const requestSchema = z.object({
  type: z.literal('pixel_task_request'), id: z.string().min(1).max(512),
  operation: z.literal('create_architecture'), parameters: parametersSchema,
}).strict();
const within = (root: string, path: string) => path.startsWith(root + sep);

function readDescription(db: Db, taskId: string, userId: string, conversationId: string, filename: string) {
  const p = paths(userId, conversationId);
  const requested = resolve(p.work, filename);
  const attached = taskFiles(db, taskId, userId).some(file => resolve(p.user, file.relative_path) === requested);
  if (!within(p.work, requested) && !within(p.uploads, requested) && !attached) throw new HttpError(400, 'INVALID_ARCHITECTURE_FILE', '只能读取本轮工作目录、共享上传目录或当前任务的文件');
  let fd: number | undefined;
  try {
    const source = securePath(p.user, relative(p.user, requested));
    fd = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 120000) throw new HttpError(400, 'INVALID_ARCHITECTURE_FILE', '架构文件必须是 UTF-8 文本，内容不超过 30000 字符');
    if (process.platform === 'linux' && realpathSync(`/proc/self/fd/${fd}`) !== realpathSync(source)) throw new HttpError(400, 'INVALID_ARCHITECTURE_FILE', '架构文件路径已变化，请重试');
    const bytes = Buffer.alloc(120001);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > 120000) throw new HttpError(400, 'INVALID_ARCHITECTURE_FILE', '架构文件超过大小限制');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'INVALID_ARCHITECTURE_FILE', '架构文件不存在、不可读取或不是 UTF-8 文本');
  } finally { if (fd !== undefined) closeSync(fd); }
}

function refreshContext(db: Db, taskId: string, userId: string, conversationId: string, runId: string) {
  const p = paths(userId, conversationId);
  const temporary = resolve(p.work, `task-context-${runId}-${randomUUID()}.tmp`);
  try {
    const target = securePath(p.work, `task-context-${runId}.json`);
    const context = JSON.parse(readFileSync(target, 'utf8'));
    if (context.task?.id !== taskId) return false;
    const detail = taskDetail(db, taskRow(db, taskId, userId));
    context.architectures = detail.architectures.map(({ previews, previewIssues, ...architecture }) => architecture);
    writeFileSync(temporary, JSON.stringify(context, null, 2), { flag: 'wx', mode: 0o600 });
    renameSync(temporary, target);
    return true;
  } catch { return false; }
  finally { try { unlinkSync(temporary); } catch { /* Already renamed, or never created. */ } }
}

/** The parent supplies the run and task identity; the tool cannot choose either. */
export function handleTaskTool(db: Db, scope: { runId: string; taskId: string; enabled: boolean }, message: unknown) {
  const envelope = z.object({ type: z.literal('pixel_task_request'), id: z.string().min(1).max(512) }).safeParse(message);
  if (!envelope.success) return null;
  const response = { type: 'pixel_task_response' as const, id: envelope.data.id };
  try {
    if (!scope.enabled) throw new HttpError(403, 'TASK_TOOL_DISABLED', '本轮不允许新增架构');
    const request = requestSchema.safeParse(message);
    if (!request.success) throw new HttpError(400, 'INVALID_ARCHITECTURE_INPUT', '参数无效：名称 1–120 字符；description 与 descriptionFile 必须且只能提供一项，内容最多 30000 字符');
    const run = runRow(db, scope.runId);
    if (run.status !== 'running') throw new HttpError(409, 'RUN_NOT_ACTIVE', '执行已停止，不能新增架构');
    const user = db.prepare('SELECT enabled FROM users WHERE id=?').get(run.user_id) as { enabled: number } | undefined;
    if (!user?.enabled) throw new HttpError(403, 'USER_DISABLED', '账号已停用');
    const conversation = conversationRow(db, run.conversation_id, run.user_id);
    if (conversation.task_id !== scope.taskId) throw new HttpError(409, 'TASK_CHANGED', '会话所属任务已变化，请在新一轮中重试');
    taskRow(db, scope.taskId, run.user_id);
    const parameters = request.data.parameters;
    const description = 'descriptionFile' in parameters ? readDescription(db, scope.taskId, run.user_id, run.conversation_id, parameters.descriptionFile) : parameters.description;
    const parsed = architectureSchema.safeParse({ name: parameters.name, description });
    if (!parsed.success) throw new HttpError(400, 'INVALID_ARCHITECTURE_INPUT', '架构内容不能为空或超过 30000 字符');
    // A stable UUID makes delivery retries of this tool call idempotent without a new table.
    const hash = createHash('sha256').update(JSON.stringify([scope.runId, request.data.id])).digest('hex');
    const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    const result = createTaskArchitecture(db, scope.taskId, run.user_id, parsed.data, { id, reuseIdentical: true });
    const contextUpdated = refreshContext(db, scope.taskId, run.user_id, run.conversation_id, scope.runId);
    return { ...response, success: true as const, result: { ...result, contextUpdated } };
  } catch (error) {
    return { ...response, success: false as const, error: error instanceof HttpError ? error.message : '新增架构失败，请重试' };
  }
}
