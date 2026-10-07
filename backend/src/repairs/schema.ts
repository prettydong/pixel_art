import type { Db } from '../db/index.js';

export function migrateRepairs(db: Db) {
  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=8').get()) db.transaction(() => {
    db.exec(`
      CREATE TABLE repair_batches(
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), user_id TEXT NOT NULL REFERENCES users(id),
        request_key TEXT NOT NULL, request_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
        UNIQUE(user_id,request_key)
      );
      CREATE TABLE repair_programs(
        id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES repair_batches(id), architecture_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued', conversation_id TEXT REFERENCES conversations(id), run_id TEXT REFERENCES runs(id),
        dev_source TEXT, error TEXT
      );
      CREATE TABLE repair_jobs(
        id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES repair_batches(id), program_id TEXT NOT NULL REFERENCES repair_programs(id),
        task_id TEXT NOT NULL REFERENCES tasks(id), user_id TEXT NOT NULL REFERENCES users(id), dataset_json TEXT NOT NULL,
        input_hash TEXT NOT NULL, model_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
        created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER, processed_regions INTEGER NOT NULL DEFAULT 0,
        error TEXT, summary_json TEXT
      );
      CREATE INDEX repair_jobs_queue ON repair_jobs(status,created_at);
      CREATE INDEX repair_jobs_task ON repair_jobs(task_id,created_at);
    `);
    db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(8,?)').run(Date.now());
  })();
  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=9').get()) db.transaction(() => {
    db.exec(`
      ALTER TABLE repair_batches ADD COLUMN auto_conclusion INTEGER NOT NULL DEFAULT 1;
      CREATE TABLE repair_conclusions(
        task_id TEXT PRIMARY KEY REFERENCES tasks(id), batch_id TEXT NOT NULL REFERENCES repair_batches(id),
        updated_at INTEGER NOT NULL, jobs_json TEXT NOT NULL
      );
    `);
    db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(9,?)').run(Date.now());
  })();
}
