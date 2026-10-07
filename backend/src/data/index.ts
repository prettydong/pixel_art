import { randomUUID } from 'node:crypto';
import { constants, closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idSchema } from '@pixel/contracts';
import { decodeWafer, MAX_FAILS, MAX_WAFER_BYTES, validateWaferLayout, type ProductRecord, type WaferRecord } from '@pixel/contracts/wafer-data';
import { validateGenerationOptions, type GenerationMetadata } from '@pixel/contracts/wafer-spatial';
import { currentUser } from '../auth/index.js';
import type { Db } from '../db/index.js';
import { HttpError, missing } from '../errors.js';
import { fileById, filePath, publicFile } from '../files/index.js';

type ProductRow = { id: string; user_id: string; name: string; chip_count: number; region_count: number; rows: number; cols: number; created_at: number };
type WaferRow = { id: string; product_id: string; name: string; file_id: string; fail_count: number; occupied_region_count: number; synthetic: number; created_at: number; generation_json: string | null };

const nameSchema = z.string().trim().min(1).max(120);
const dimensionSchema = z.number().int().min(1).max(1_000_000);
const productSchema = z.object({ name: nameSchema, chipCount: dimensionSchema, regionCount: dimensionSchema, rows: dimensionSchema, cols: dimensionSchema }).strict();
const generationSchema = z.object({
  pattern: z.enum(['random', 'center', 'donut', 'edge-ring', 'edge-local', 'local', 'scratch', 'mixed']),
  seed: z.number().int().min(0).max(0xffffffff), meanFails: z.number().min(0).max(MAX_FAILS),
  strength: z.number().min(0).max(30), dispersion: z.number().min(0.2).max(100),
  model: z.literal('spatial-gamma-poisson-v2'), geometry: z.literal('disk-grid-v1'),
}).strict();
const waferSchema = z.object({ fileId: idSchema, name: nameSchema, generation: generationSchema.nullish() }).strict();

export function migrateProducts(db: Db) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS products(
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
        chip_count INTEGER NOT NULL, region_count INTEGER NOT NULL, rows INTEGER NOT NULL, cols INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS products_user ON products(user_id,created_at);
      CREATE TABLE IF NOT EXISTS wafers(
        id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), name TEXT NOT NULL,
        file_id TEXT NOT NULL UNIQUE REFERENCES files(id), fail_count INTEGER NOT NULL,
        occupied_region_count INTEGER NOT NULL, synthetic INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS wafers_product ON wafers(product_id,created_at);
    `);
    const columns = db.prepare('PRAGMA table_info(wafers)').all() as { name: string }[];
    if (!columns.some(column => column.name === 'generation_json')) db.exec('ALTER TABLE wafers ADD COLUMN generation_json TEXT');
    const record = db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(?,?)');
    record.run(5, Date.now());
    record.run(6, Date.now());
  })();
}

function productRow(db: Db, userId: string, productId: string): ProductRow {
  const row = db.prepare('SELECT * FROM products WHERE id=? AND user_id=?').get(productId, userId) as ProductRow | undefined;
  if (!row) throw missing();
  return row;
}

function publicProduct(row: ProductRow): ProductRecord {
  return { id: row.id, name: row.name, chipCount: row.chip_count, regionCount: row.region_count, rows: row.rows, cols: row.cols, createdAt: row.created_at };
}

function publicWafer(db: Db, userId: string, row: WaferRow): WaferRecord {
  return {
    id: row.id, productId: row.product_id, name: row.name, fileId: row.file_id,
    failCount: row.fail_count, occupiedRegionCount: row.occupied_region_count,
    synthetic: Boolean(row.synthetic), createdAt: row.created_at,
    file: publicFile(fileById(db, userId, null, row.file_id)),
    generation: row.generation_json ? JSON.parse(row.generation_json) as GenerationMetadata : null,
  };
}

/** Only registered wafers owned by this user and included in the task's file list. */
export function waferContext(db: Db, userId: string, fileIds: readonly string[]) {
  if (!fileIds.length) return [];
  const requested = new Set(fileIds);
  const rows = db.prepare('SELECT w.* FROM wafers w JOIN products p ON p.id=w.product_id WHERE p.user_id=? ORDER BY w.created_at,w.id').all(userId) as WaferRow[];
  return rows.filter(row => requested.has(row.file_id)).map(row => ({
    ...publicWafer(db, userId, row), product: publicProduct(productRow(db, userId, row.product_id)),
  }));
}

export function registerDataRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/products', async request => {
    const user = currentUser(db, request);
    const rows = db.prepare('SELECT * FROM products WHERE user_id=? ORDER BY created_at,id').all(user.id) as ProductRow[];
    return { items: rows.map(publicProduct) };
  });
  app.post('/api/products', async (request, reply) => {
    const user = currentUser(db, request);
    const input = productSchema.parse(request.body);
    try { validateWaferLayout(input); }
    catch (error) { throw new HttpError(400, 'INVALID_LAYOUT', error instanceof Error ? error.message : '产品结构无效'); }
    const id = randomUUID();
    db.prepare('INSERT INTO products(id,user_id,name,chip_count,region_count,rows,cols,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, user.id, input.name, input.chipCount, input.regionCount, input.rows, input.cols, Date.now());
    reply.code(201);
    return publicProduct(productRow(db, user.id, id));
  });
  app.get('/api/products/:id/wafers', async request => {
    const user = currentUser(db, request);
    const product = productRow(db, user.id, idSchema.parse((request.params as { id: string }).id));
    const rows = db.prepare('SELECT * FROM wafers WHERE product_id=? ORDER BY created_at,id').all(product.id) as WaferRow[];
    return { items: rows.map(row => publicWafer(db, user.id, row)) };
  });
  app.post('/api/products/:id/wafers', async (request, reply) => {
    const user = currentUser(db, request);
    const product = productRow(db, user.id, idSchema.parse((request.params as { id: string }).id));
    const input = waferSchema.parse(request.body);
    const file = fileById(db, user.id, null, input.fileId);
    if (file.kind !== 'upload' || !file.name.toLowerCase().endsWith('.pwafer')) throw new HttpError(400, 'INVALID_WAFER', '请选择上传的 .pwafer 文件');
    // Validate the same opened file descriptor that is read; never follow a replaced symlink.
    const fd = openSync(filePath(file), constants.O_RDONLY | constants.O_NOFOLLOW);
    let decoded: ReturnType<typeof decodeWafer>;
    try {
      const info = fstatSync(fd);
      if (!info.isFile() || info.size > MAX_WAFER_BYTES) throw new HttpError(400, 'INVALID_WAFER', 'wafer 文件无效或超过 25 MiB');
      try { decoded = decodeWafer(readFileSync(fd)); }
      catch (error) { throw new HttpError(400, 'INVALID_WAFER', error instanceof Error ? error.message : 'wafer 文件无效'); }
    } finally { closeSync(fd); }
    const expected = publicProduct(product);
    if ((['chipCount', 'regionCount', 'rows', 'cols'] as const).some(key => decoded.layout[key] !== expected[key])) {
      throw new HttpError(400, 'LAYOUT_MISMATCH', 'wafer 的布局与产品定义不一致');
    }
    if (input.generation && !decoded.synthetic) throw new HttpError(400, 'INVALID_GENERATION', '只有合成 wafer 可以保存生成参数');
    const generation = input.generation ? { ...validateGenerationOptions(input.generation), model: input.generation.model, geometry: input.generation.geometry } : null;
    const generationJson = generation ? JSON.stringify(generation) : null;
    const existing = db.prepare('SELECT * FROM wafers WHERE file_id=?').get(file.id) as WaferRow | undefined;
    if (existing) {
      if (existing.product_id !== product.id || existing.name !== input.name || existing.generation_json !== generationJson ||
          existing.fail_count !== decoded.failCount || existing.occupied_region_count !== decoded.groups.length || Boolean(existing.synthetic) !== decoded.synthetic) {
        throw new HttpError(409, 'WAFER_ALREADY_REGISTERED', '此文件已经登记为另一份 wafer，请重新上传或使用已有记录');
      }
      return publicWafer(db, user.id, existing);
    }
    const id = randomUUID();
    db.prepare('INSERT INTO wafers(id,product_id,name,file_id,fail_count,occupied_region_count,synthetic,created_at,generation_json) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id, product.id, input.name, file.id, decoded.failCount, decoded.groups.length, Number(decoded.synthetic), Date.now(), generationJson);
    reply.code(201);
    return publicWafer(db, user.id, db.prepare('SELECT * FROM wafers WHERE id=?').get(id) as WaferRow);
  });
}
