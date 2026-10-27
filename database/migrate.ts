import { readdir, readFile } from 'node:fs/promises';
import { pool } from '../server/db.ts';

async function migrate() {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const filenames = await readdir('database/migrations');
    const migrations = filenames
      .filter((name) => /^\d+_.*\.sql$/.test(name))
      .sort();

    for (const filename of migrations) {
      const applied = await client.query(
        'SELECT filename FROM schema_migrations WHERE filename = $1',
        [filename],
      );

      if (applied.rowCount) {
        console.log(`Already applied: ${filename}`);
        continue;
      }

      const sql = await readFile(`database/migrations/${filename}`, 'utf8');

      // The schema change and its completed record must succeed together.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [filename],
        );
        await client.query('COMMIT');
        console.log(`Applied: ${filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

try {
  await migrate();
} catch (error) {
  console.error(
    'Migration failed:',
    error instanceof Error ? error.message : 'Unknown error',
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
