/**
 * Reprise — variation de stock des inventaires complets déjà validés (scénario 2, constat 133, mig 627).
 *
 * Avant la correction, la validation d'un inventaire ne passait aucune écriture : le compte 3121
 * restait au solde saisi à la main. Ce script comptabilise, dans l'ordre chronologique, la variation
 * de stock de chaque inventaire complet de matières déjà validé (même règle que la validation :
 * postStockVariation). Idempotent : un inventaire déjà comptabilisé est ignoré.
 *
 * Usage (base locale uniquement) : cd server && npx tsx scripts/reprise-variation-stock-inventaires.ts
 */
import { db } from '../src/config/database.js';
import { postStockVariation } from '../src/repositories/stock-count.repository.js';

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) throw new Error('Base non locale : reprise refusée.');
  const counts = (await db.query(
    `SELECT id, number, store_id, count_date, validated_by FROM stock_counts
      WHERE status = 'validated' ORDER BY count_date, validated_at`)).rows;
  for (const c of counts) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const delta = await postStockVariation(client, c, c.validated_by ?? null);
      await client.query('COMMIT');
      console.log(`${c.number} (${String(c.count_date).slice(0, 10)}) : ${delta == null ? 'rien à passer' : `variation ${delta.toFixed(2)} DH`}`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`${c.number} : échec`, (e as Error).message);
    } finally {
      client.release();
    }
  }
  await db.end?.();
}

main().catch((e) => { console.error(e); process.exit(1); });
