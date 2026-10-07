import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idSchema, type DemoTask } from '@pixel/contracts';
import { decodeWafer, type WaferLayout } from '@pixel/contracts/wafer-data';
import { validateGenerationOptions, type GenerationMetadata } from '@pixel/contracts/wafer-spatial';
import { currentUser } from '../auth/index.js';
import { projectRoot } from '../config.js';
import { waferContext } from '../data/index.js';
import type { Db } from '../db/index.js';
import { HttpError } from '../errors.js';
import { fileById, filePath } from '../files/index.js';
import { createTask, createTaskArchitecture, publicTask, taskDetail, taskRow } from '../tasks/index.js';
import { ensureUserWorkspace } from '../workspace/index.js';

const layout: WaferLayout = { chipCount: 200, regionCount: 16, rows: 32768, cols: 2048 };
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
type Sample = { name: string; file: string; sha256: string; bytes: number; failCount: number; occupiedRegionCount: number; generation: GenerationMetadata };

export function migrateDemos(db: Db) {
  if (db.prepare('SELECT 1 FROM schema_migrations WHERE version=10').get()) return;
  db.transaction(() => {
    db.exec(`CREATE TABLE demo_loads(
      user_id TEXT NOT NULL REFERENCES users(id), request_key TEXT NOT NULL,
      task_id TEXT NOT NULL REFERENCES tasks(id), PRIMARY KEY(user_id,request_key)
    )`);
    db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(10,?)').run(Date.now());
  })();
}

function response(db: Db, userId: string, taskId: string): DemoTask {
  const task = taskRow(db, taskId, userId);
  const detail = taskDetail(db, task);
  return { task: publicTask(db, task), architectures: detail.architectures, wafers: waferContext(db, userId, detail.files.map(file => file.id)).map(wafer => ({ id: wafer.id, name: wafer.name })) };
}

/** Load configuration and fixed synthetic inputs only. No code generation or Solver entry point. */
function loadDejoa(db: Db, userId: string, requestKey: string): DemoTask {
  const previous = db.prepare('SELECT task_id FROM demo_loads WHERE user_id=? AND request_key=?').get(userId, requestKey) as { task_id: string } | undefined;
  if (previous) {
    const task = db.prepare('SELECT deleted_at FROM tasks WHERE id=?').get(previous.task_id) as { deleted_at: number | null };
    if (task.deleted_at !== null) throw new HttpError(409, 'DEMO_DELETED', '此演示任务已删除，请重新加载演示。');
    return response(db, userId, previous.task_id);
  }
  const bundle = join(projectRoot, 'backend/demos/dejoa');
  const manifest = JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8')) as { wafers: Sample[] };
  if (manifest.wafers.length !== 3) throw new Error('DEJOA demo bundle is incomplete');
  const samples = manifest.wafers.map((sample, index) => {
    const expectedName = `DEJOA-${String(index + 1).padStart(3, '0')}`;
    if (sample.name !== expectedName || sample.file !== `${expectedName}.pwafer`) throw new Error('Invalid DEJOA demo filename');
    const bytes = readFileSync(join(bundle, sample.file));
    const decoded = decodeWafer(bytes);
    if (sha(bytes) !== sample.sha256 || bytes.length !== sample.bytes || !decoded.synthetic || decoded.failCount !== sample.failCount || decoded.groups.length !== sample.occupiedRegionCount
      || (Object.keys(layout) as (keyof WaferLayout)[]).some(key => decoded.layout[key] !== layout[key])) throw new Error('DEJOA demo input fingerprint or layout mismatch');
    validateGenerationOptions(sample.generation);
    if (sample.generation.model !== 'spatial-gamma-poisson-v2' || sample.generation.geometry !== 'disk-grid-v1') throw new Error('Invalid DEJOA generation metadata');
    return { ...sample, bytes };
  });
  const workspace = ensureUserWorkspace(userId);
  const createdFiles: string[] = [];
  let taskId: string;
  try {
    taskId = db.transaction(() => {
      let product = db.prepare('SELECT id FROM products WHERE user_id=? AND name=? AND chip_count=? AND region_count=? AND rows=? AND cols=? ORDER BY created_at,id LIMIT 1')
        .get(userId, 'DEJOA', layout.chipCount, layout.regionCount, layout.rows, layout.cols) as { id: string } | undefined;
      const now = Date.now();
      if (!product) {
        product = { id: randomUUID() };
        db.prepare('INSERT INTO products(id,user_id,name,chip_count,region_count,rows,cols,created_at) VALUES(?,?,?,?,?,?,?,?)')
          .run(product.id, userId, 'DEJOA', layout.chipCount, layout.regionCount, layout.rows, layout.cols, now);
      }
      const names = new Set((db.prepare('SELECT name FROM tasks WHERE user_id=?').all(userId) as { name: string }[]).map(task => task.name));
      let name = 'DEJOA demo'; let suffix = 2;
      while (names.has(name)) name = `DEJOA demo ${suffix++}`;
      const task = createTask(db, userId, name);
      for (const sample of samples) {
        const candidates = db.prepare('SELECT file_id,generation_json FROM wafers WHERE product_id=? AND name=?').all(product.id, sample.name) as { file_id: string; generation_json: string | null }[];
        const existing = candidates.find(wafer => {
          try {
            if (!wafer.generation_json || JSON.stringify(JSON.parse(wafer.generation_json)) !== JSON.stringify(sample.generation)) return false;
            return sha(readFileSync(filePath(fileById(db, userId, null, wafer.file_id)))) === sample.sha256;
          } catch { return false; }
        });
        let fileId = existing?.file_id;
        if (!fileId) {
          fileId = randomUUID();
          const filename = join(workspace.uploads, `${fileId}-${sample.file}`);
          writeFileSync(filename, sample.bytes, { flag: 'wx', mode: 0o600 }); createdFiles.push(filename);
          db.prepare('INSERT INTO files(id,user_id,conversation_id,name,relative_path,size,kind,created_at) VALUES(?,?,NULL,?,?,?,?,?)')
            .run(fileId, userId, sample.file, relative(workspace.user, filename), sample.bytes.length, 'upload', now);
          db.prepare('INSERT INTO wafers(id,product_id,name,file_id,fail_count,occupied_region_count,synthetic,created_at,generation_json) VALUES(?,?,?,?,?,?,1,?,?)')
            .run(randomUUID(), product.id, sample.name, fileId, sample.failCount, sample.occupiedRegionCount, now, JSON.stringify(sample.generation));
        }
        db.prepare('INSERT INTO task_files(task_id,file_id) VALUES(?,?)').run(task.id, fileId);
      }
      for (const [rows, cols] of [[128, 2], [64, 2], [128, 1]]) {
        createTaskArchitecture(db, task.id, userId, { name: `DEJOA · R${rows} C${cols}`, description: JSON.stringify({
          kind: 'pixel-architecture', version: 2, template: 'ccr-segmented', model: 'region-ccr',
          array: { rows: layout.rows, cols: layout.cols, coordinate_base: 0 },
          device: { spare_rows: rows, ccr_groups_per_segment: 8, ccr_spares_per_group: Array(8).fill(cols), row_layout: {
            section_count: 16, sections_per_segment: 1, section_group_size: 2048, subsection_size: 2048, subsections_per_group: 1,
          } }, notes: '',
        }, null, 2) });
      }
      db.prepare('INSERT INTO demo_loads(user_id,request_key,task_id) VALUES(?,?,?)').run(userId, requestKey, task.id);
      return task.id;
    }).immediate();
  } catch (error) {
    for (const filename of createdFiles) { try { unlinkSync(filename); } catch { /* Retain the original failure. */ } }
    throw error;
  }
  return response(db, userId, taskId);
}

export function registerDemoRoutes(app: FastifyInstance, db: Db) {
  const schema = z.object({ idempotencyKey: idSchema }).strict();
  app.post('/api/demos/dejoa', async (request, reply) => {
    const user = currentUser(db, request);
    const body = schema.parse(request.body);
    const demo = loadDejoa(db, user.id, body.idempotencyKey);
    reply.code(201); return demo;
  });
}
