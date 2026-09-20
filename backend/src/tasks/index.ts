import { createHash, randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { posix } from "node:path";
import { validateArchitectureScene } from "@pixel/contracts/architecture-scene";
import type { FastifyInstance } from "fastify";
import { architectureSchema, idSchema, taskFileSchema, taskNameSchema, type EvaluationTask, type TaskArchitecture, type TaskDetail } from "@pixel/contracts";
import type { Db } from "../db/index.js";
import { currentUser } from "../auth/index.js";
import { missing } from "../errors.js";
import { fileById, filePath, publicFile, type FileRow } from "../files/index.js";

const architectureFingerprint = (id: string, name: string, description: string) => createHash('sha256').update(JSON.stringify([id, name, description])).digest('hex');

type TaskRow = { id: string; user_id: string; name: string; updated_at: number };
export function migrateTasks(db: Db) {
  if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=4").get()) return;
  db.transaction(() => {
    db.exec(`
      CREATE TABLE tasks(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, updated_at INTEGER NOT NULL);
      ALTER TABLE conversations ADD COLUMN task_id TEXT REFERENCES tasks(id);
      CREATE INDEX conversations_task ON conversations(task_id,deleted_at);
      CREATE TABLE task_files(task_id TEXT NOT NULL REFERENCES tasks(id), file_id TEXT NOT NULL REFERENCES files(id), PRIMARY KEY(task_id,file_id));
      CREATE TABLE task_architectures(id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), name TEXT NOT NULL, description TEXT NOT NULL, created_at INTEGER NOT NULL);
    `);
    const rows = db.prepare("SELECT id,user_id,title,updated_at FROM conversations WHERE deleted_at IS NULL").all() as { id: string; user_id: string; title: string; updated_at: number }[];
    for (const row of rows) {
      const id = randomUUID();
      db.prepare("INSERT INTO tasks VALUES(?,?,?,?)").run(id, row.user_id, row.title, row.updated_at);
      db.prepare("UPDATE conversations SET task_id=? WHERE id=?").run(id, row.id);
      // Only associate inputs actually attached to this evaluation, not every user upload.
      db.prepare(`INSERT OR IGNORE INTO task_files SELECT ?,f.id FROM messages m,json_each(m.file_ids) j
        JOIN files f ON f.id=j.value WHERE m.conversation_id=? AND f.user_id=? AND f.kind='upload'`).run(id, row.id, row.user_id);
    }
    db.prepare("INSERT INTO schema_migrations VALUES(4,?)").run(Date.now());
  })();
}
export function taskRow(db: Db, id: string, userId: string) {
  const row = db.prepare("SELECT * FROM tasks WHERE id=? AND user_id=?").get(id, userId) as TaskRow | undefined;
  if (!row) throw missing();
  return row;
}
export function createTask(db: Db, userId: string, name: string) {
  const id = randomUUID();
  db.prepare("INSERT INTO tasks VALUES(?,?,?,?)").run(id, userId, name, Date.now());
  return taskRow(db, id, userId);
}
export function publicTask(db: Db, row: TaskRow): EvaluationTask {
  const stats = db.prepare(`SELECT MAX(c.updated_at) updated, COUNT(f.id) count FROM conversations c
    LEFT JOIN files f ON f.conversation_id=c.id AND f.kind='artifact' WHERE c.task_id=? AND c.deleted_at IS NULL`).get(row.id) as { updated: number | null; count: number };
  return { id: row.id, name: row.name, updated: Math.max(row.updated_at, stats.updated ?? 0), artifactCount: stats.count };
}
export function taskFiles(db: Db, taskId: string, userId: string) {
  return db.prepare(`SELECT f.* FROM files f WHERE f.user_id=? AND (
    (f.kind='upload' AND EXISTS(SELECT 1 FROM task_files tf WHERE tf.task_id=? AND tf.file_id=f.id)) OR
    (f.kind='artifact' AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=f.conversation_id AND c.task_id=? AND c.deleted_at IS NULL)))
    ORDER BY f.created_at,f.id`).all(userId, taskId, taskId) as FileRow[];
}
export function taskDetail(db: Db, row: TaskRow): TaskDetail {
  const files = taskFiles(db, row.id, row.user_id);
  const architectures = db.prepare("SELECT id,name,description FROM task_architectures WHERE task_id=? ORDER BY created_at,id").all(row.id) as TaskArchitecture[];
  // Show every evaluated configuration from the framework's immutable source snapshots.
  for (const file of files) {
    if (file.kind !== 'artifact' || !/(^|\/)sources\/00_experiment\.json$/.test(file.name)) continue;
    try {
      const path = filePath(file);
      if (statSync(path).size > 1024 * 1024) continue;
      const config = JSON.parse(readFileSync(path, 'utf8'));
      if (!config?.array || !config?.device) continue;
      architectures.push({ fingerprint: '', id: file.id, name: file.name.replace(/\/sources\/00_experiment\.json$/, ''),
        description: JSON.stringify({ array: config.array, device: config.device }, null, 2),
        sourceConversationId: file.conversation_id!, sourceFile: publicFile(file) });
    } catch { /* A missing or invalid snapshot must not prevent opening the task. */ }
  }
  const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
  for (const architecture of architectures) {
    architecture.fingerprint = architectureFingerprint(architecture.id, architecture.name, architecture.description);
    architecture.previews = [];
    architecture.previewIssues = [];
  }
  for (const file of files) {
    if (file.kind !== 'artifact' || !file.name.endsWith('/architecture-preview.json')) continue;
    let architecture: TaskArchitecture | undefined;
    try {
      const manifestPath = filePath(file);
      if (statSync(manifestPath).size > 100000) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      architecture = architectures.find(item => item.id === manifest.architectureId);
      if (!architecture || manifest.protocol !== 'pixel-architecture-preview/v1' || manifest.taskId !== row.id) continue;
      if (manifest.fingerprint !== architecture.fingerprint) { architecture.previewIssues!.push('架构已有修改，旧版本预览未作为当前预览展示。'); continue; }
      const sibling = (entry: { name: string; sha256: string }) => {
        if (!entry || !/^(scene\.json|draw\.mjs|recipe\.(py|mjs))$/.test(entry.name)) throw new Error('预览文件名无效');
        const record = files.find(item => item.conversation_id === file.conversation_id && item.name === posix.join(posix.dirname(file.name), entry.name));
        if (!record) throw new Error('预览文件不完整');
        const path = filePath(record);
        if (statSync(path).size > 1000000) throw new Error('预览文件过大');
        const bytes = readFileSync(path);
        if (hash(bytes) !== entry.sha256) throw new Error('预览文件指纹不匹配');
        return { record, bytes };
      };
      if (manifest.scene?.name !== 'scene.json' || !/^recipe\.(py|mjs)$/.test(manifest.recipe?.name)) throw new Error('预览文件角色无效');
      if (typeof manifest.runId !== 'string' || !db.prepare('SELECT 1 FROM runs WHERE id=? AND conversation_id=? AND user_id=?').get(manifest.runId, file.conversation_id, row.user_id)) throw new Error('预览执行来源无效');
      const sceneFile = sibling(manifest.scene); const recipe = sibling(manifest.recipe);
      const scene = validateArchitectureScene(JSON.parse(sceneFile.bytes.toString('utf8')));
      if (scene.architectureId !== architecture.id || scene.fingerprint !== architecture.fingerprint) throw new Error('绘图描述与架构不匹配');
      if (!Number.isSafeInteger(manifest.createdAt) || manifest.createdAt < 0) throw new Error('预览时间无效');
      const themeSnapshot: Record<string, { light: string; dark: string }> = {};
      for (const token of Object.values(scene.palette)) {
        const colors = manifest.themeSnapshot?.[token];
        if (!colors || !/^#[a-fA-F0-9]{6}$/.test(colors.light) || !/^#[a-fA-F0-9]{6}$/.test(colors.dark)) throw new Error('主题颜色记录不完整');
        themeSnapshot[token] = { light: colors.light, dark: colors.dark };
      }
      if (scene.draw && manifest.draw?.name !== 'draw.mjs') throw new Error('缺少draw函数');
      const drawFile = scene.draw ? sibling(manifest.draw) : undefined;
      const draw = drawFile ? { source: drawFile.bytes.toString('utf8'), file: publicFile(drawFile.record), sha256: manifest.draw.sha256 } : undefined;
      architecture.previews!.push({ draw, scene, file: publicFile(sceneFile.record), recipe: publicFile(recipe.record), createdAt: manifest.createdAt, sceneHash: manifest.scene.sha256, themeSnapshot });
    } catch { architecture?.previewIssues!.push('有一份预览未通过完整性校验，请重新生成。'); }
  }
  for (const architecture of architectures) architecture.previews!.sort((a, b) => b.createdAt - a.createdAt);
  const reports: TaskDetail['reports'] = [];
  for (const file of files) {
    if (file.kind !== 'artifact' || !/(^|\/)report\.md$/.test(file.name)) continue;
    try {
      const path = filePath(file);
      if (statSync(path).size <= 100000) reports.push({ fileId: file.id, text: readFileSync(path, 'utf8') });
    } catch { /* Downloads remain available even if a report cannot be previewed. */ }
  }
  return { ...publicTask(db, row), architectures, reports, files: files.map(publicFile) };
}
export function registerTaskRoutes(app: FastifyInstance, db: Db) {
  const owned = (request: { params: unknown }) => {
    return idSchema.parse((request.params as Record<string, unknown>).id);
  };
  app.get('/api/tasks', async request => {
    const user = currentUser(db, request);
    return { items: (db.prepare('SELECT * FROM tasks WHERE user_id=?').all(user.id) as TaskRow[]).map(row => publicTask(db, row)).sort((a, b) => b.updated - a.updated) };
  });
  app.post('/api/tasks', async (request, reply) => {
    const user = currentUser(db, request); const body = taskNameSchema.parse(request.body);
    reply.code(201); return publicTask(db, createTask(db, user.id, body.name));
  });
  app.get('/api/tasks/:id', async request => taskDetail(db, taskRow(db, owned(request), currentUser(db, request).id)));
  app.patch('/api/tasks/:id', async request => {
    const row = taskRow(db, owned(request), currentUser(db, request).id); const body = taskNameSchema.parse(request.body);
    db.prepare('UPDATE tasks SET name=?,updated_at=? WHERE id=?').run(body.name, Date.now(), row.id);
    return publicTask(db, taskRow(db, row.id, row.user_id));
  });
  app.post('/api/tasks/:id/architectures', async (request, reply) => {
    const row = taskRow(db, owned(request), currentUser(db, request).id); const body = architectureSchema.parse(request.body);
    const id = randomUUID();
    db.transaction(() => {
      db.prepare('INSERT INTO task_architectures VALUES(?,?,?,?,?)').run(id, row.id, body.name, body.description, Date.now());
      db.prepare('UPDATE tasks SET updated_at=? WHERE id=?').run(Date.now(), row.id);
    })();
    reply.code(201); return { id, ...body, fingerprint: architectureFingerprint(id, body.name, body.description) };
  });
  app.patch('/api/tasks/:id/architectures/:architectureId', async request => {
    const row = taskRow(db, owned(request), currentUser(db, request).id); const body = architectureSchema.parse(request.body);
    const id = idSchema.parse((request.params as Record<string, unknown>).architectureId);
    const result = db.prepare('UPDATE task_architectures SET name=?,description=? WHERE id=? AND task_id=?').run(body.name, body.description, id, row.id);
    if (!result.changes) throw missing();
    db.prepare('UPDATE tasks SET updated_at=? WHERE id=?').run(Date.now(), row.id);
    return { id, ...body, fingerprint: architectureFingerprint(id, body.name, body.description) };
  });
  app.post('/api/tasks/:id/files', async request => {
    const row = taskRow(db, owned(request), currentUser(db, request).id); const body = taskFileSchema.parse(request.body);
    const file = fileById(db, row.user_id, null, body.fileId);
    db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO task_files VALUES(?,?)').run(row.id, file.id);
      db.prepare('UPDATE tasks SET updated_at=? WHERE id=?').run(Date.now(), row.id);
    })();
    return publicFile(file);
  });
}
