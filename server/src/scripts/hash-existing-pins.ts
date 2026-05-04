/**
 * One-time script to hash existing plaintext PIN codes in the database.
 * Run with: npx tsx server/src/scripts/hash-existing-pins.ts
 */
import { db } from '../config/database.js';
import { hashPin } from '../utils/hash.js';

async function main() {
  const result = await db.query(
    "SELECT id, pin_code FROM users WHERE pin_code IS NOT NULL AND pin_code != '' AND pin_code NOT LIKE '$2b$%'"
  );

  console.log(`Found ${result.rows.length} users with plaintext PINs to hash.`);

  for (const user of result.rows) {
    const hashed = await hashPin(user.pin_code);
    await db.query('UPDATE users SET pin_code = $1 WHERE id = $2', [hashed, user.id]);
    console.log(`  Hashed PIN for user ${user.id}`);
  }

  console.log('Done.');
  await db.pool.end();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
