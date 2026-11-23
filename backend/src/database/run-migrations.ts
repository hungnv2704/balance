import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { DatabaseService } from './database.service';
import { RedactedLogger } from '../shared-kernel/logging/redacted-logger';

export async function runStartupMigrations(
  db: DatabaseService,
  logger: RedactedLogger,
): Promise<void> {
  const migrationsDir =
    process.env.MIGRATIONS_DIR ?? path.resolve(__dirname, '../../../database/migrations');

  let files: string[];
  try {
    files = (await fs.readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    logger.logEvent('warn', 'migrations_dir_missing', 'Migrations', { migrationsDir });
    return;
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const appliedRes = await db.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations',
  );
  const applied = new Set(appliedRes.rows.map((r) => r.filename));

  // If 001_initial_schema.sql was applied manually before schema_migrations existed, mark it applied
  if (!applied.has('001_initial_schema.sql')) {
    const check = await db.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'currencies') AS exists`,
    );
    if (check.rows[0]?.exists) {
      await db.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
        ['001_initial_schema.sql'],
      );
      applied.add('001_initial_schema.sql');
    }
  }

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    logger.logEvent('log', 'migration_applying', 'Migrations', { file });
    await db.query(sql);
    await db.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
      [file],
    );
    logger.logEvent('log', 'migration_applied', 'Migrations', { file });
  }
}
