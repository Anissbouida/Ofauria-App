/**
 * Nettoyage des ecritures comptables orphelines.
 *
 * Une ecriture est orpheline si sa source metier (payment / invoice / sale)
 * a ete supprimee AVANT que le hook de reversion ne soit en place. Resultat :
 * l'ecriture reste dans le grand livre et fausse la reconciliation.
 *
 * Ce script trouve ces ecritures (source_id absent des trois tables sources)
 * et les reverse proprement via reverseEntriesForSource (suppression + delettrage).
 *
 * Mode :
 *   --dry-run (defaut) : liste les orphelines sans rien supprimer.
 *   --apply            : supprime + delettre.
 *
 * Usage :
 *   npx tsx src/scripts/cleanup-orphan-entries.ts            # dry-run
 *   npx tsx src/scripts/cleanup-orphan-entries.ts --apply
 */

import { db } from '../config/database.js';
import { reverseEntriesForSource } from '../services/journal-generator.service.js';

async function main() {
  const apply = process.argv.includes('--apply');

  // Ecritures dont la source n'existe dans AUCUNE des tables metier.
  const orphans = await db.query(
    `SELECT DISTINCT je.source_id, je.source_kind,
            STRING_AGG(je.entry_number, ', ') AS entry_numbers
     FROM journal_entries je
     WHERE je.source_kind IN ('payment', 'invoice', 'sale', 'backfill')
       AND je.source_id IS NOT NULL
       AND je.source_id NOT IN (SELECT id FROM payments)
       AND je.source_id NOT IN (SELECT id FROM invoices)
       AND je.source_id NOT IN (SELECT id FROM sales)
     GROUP BY je.source_id, je.source_kind`
  );

  if (orphans.rows.length === 0) {
    console.log('Aucune ecriture orpheline.');
    await db.pool.end();
    return;
  }

  console.log(`${orphans.rows.length} source(s) orpheline(s) trouvee(s) :`);
  for (const o of orphans.rows) {
    console.log(`  - ${o.entry_numbers} (source_id=${String(o.source_id).slice(0, 8)})`);
  }

  if (!apply) {
    console.log('\nDRY-RUN : rien supprime. Relance avec --apply pour nettoyer.');
    await db.pool.end();
    return;
  }

  let totalRemoved = 0, totalUnlettered = 0;
  for (const o of orphans.rows) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const result = await reverseEntriesForSource(client, {
        sourceId: o.source_id,
        sourceKinds: ['payment', 'invoice', 'sale', 'backfill'],
      });
      await client.query('COMMIT');
      totalRemoved += result.removed;
      totalUnlettered += result.unlettered;
      console.log(`  ✓ ${o.entry_numbers} : ${result.removed} ecriture(s), ${result.unlettered} ligne(s) delettree(s)`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ✗ ${o.entry_numbers} : ${err instanceof Error ? err.message : err}`);
    } finally {
      client.release();
    }
  }

  console.log(`\nTermine : ${totalRemoved} ecriture(s) supprimee(s), ${totalUnlettered} ligne(s) delettree(s).`);
  await db.pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
