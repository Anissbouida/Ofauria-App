import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../../migrations');

// OWASP A08-1 : checksum SHA-256 du contenu de la migration.
function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

async function migrate() {
  // Create migrations tracking table (la colonne checksum est ajoutee par
  // la migration 102 elle-meme).
  await db.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Recupere les migrations deja appliquees avec leur checksum (si colonne existe).
  let executed: Map<string, string | null> = new Map();
  try {
    const res = await db.query('SELECT name, checksum FROM _migrations ORDER BY name');
    executed = new Map(res.rows.map((r: { name: string; checksum: string | null }) => [r.name, r.checksum]));
  } catch {
    // Colonne checksum pas encore presente (premier run avant 102) :
    // on fait fallback sur la liste des noms.
    const res = await db.query('SELECT name FROM _migrations ORDER BY name');
    executed = new Map(res.rows.map((r: { name: string }) => [r.name, null]));
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let tampered = 0;

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    const checksum = sha256(sql);

    if (executed.has(file)) {
      const stored = executed.get(file) ?? null;
      if (stored === null) {
        // Legacy : on remplit retroactivement.
        await db.query('UPDATE _migrations SET checksum = $1 WHERE name = $2', [checksum, file]);
        console.log(`⏭ ${file} (checksum backfilled)`);
      } else if (stored !== checksum) {
        console.error(`❌ ${file}: checksum mismatch (stored=${stored.slice(0, 12)}..., current=${checksum.slice(0, 12)}...)`);
        console.error('   La migration a ete modifiee apres son application. Refusez ou investiguez.');
        tampered++;
      } else {
        console.log(`⏭ ${file} (already executed, checksum OK)`);
      }
      continue;
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      // Essaye d'inserer avec checksum, fallback sur sans-checksum si colonne absente
      try {
        await client.query(
          'INSERT INTO _migrations (name, checksum) VALUES ($1, $2)',
          [file, checksum],
        );
      } catch {
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      }
      await client.query('COMMIT');
      console.log(`✅ ${file}  (sha=${checksum.slice(0, 12)}...)`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`❌ ${file}:`, err);
      process.exit(1);
    } finally {
      client.release();
    }
  }

  if (tampered > 0) {
    console.error(`\n⚠️  ${tampered} migration(s) modifiee(s) apres application (OWASP A08-1).`);
    process.exit(2);
  }

  console.log('\nMigrations complete.');
  await db.pool.end();
}

migrate();
