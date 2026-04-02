import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../../migrations');

async function migrate() {
  // Create migrations tracking table
  await db.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const executed = await db.query('SELECT name FROM _migrations ORDER BY name');
  const executedNames = new Set(executed.rows.map((r: { name: string }) => r.name));

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (executedNames.has(file)) {
      console.log(`⏭ ${file} (already executed)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    const client = await db.getClient();

    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`✅ ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`❌ ${file}:`, err);
      process.exit(1);
    } finally {
      client.release();
    }
  }

  console.log('\nMigrations complete.');
  await db.pool.end();
}

migrate();
