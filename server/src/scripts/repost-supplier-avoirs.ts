/**
 * Reprise des avoirs fournisseurs déduits d'un règlement (plan compta, étape 2, audit C-01).
 *
 * Avant la correction, un règlement de mode `avoir` était comptabilisé 4411 D / 5161 C : la
 * caisse baissait sans sortie d'argent et la charge et la TVA restaient inchangées. Ce script
 * extourne ces écritures et repasse le bon schéma (4411 D / charge C / TVA récupérable C) via
 * regeneratePaymentEntries, sur la date de l'écriture d'origine ou, si sa période est close, au
 * premier jour de la période ouverte (règle de fn_accounting_date).
 *
 * Mode :
 *   (défaut)  simulation : liste les règlements concernés et l'écriture qui serait passée.
 *   --apply   extourne et régénère, une transaction par règlement.
 *
 *   DATABASE_URL=… npx tsx src/scripts/repost-supplier-avoirs.ts [--apply]
 *
 * À lancer à la main, après accord, sur un exercice ouvert.
 */
import { db } from '../config/database.js';
import { PAYMENT_SELECT, fromPaymentEmission, regeneratePaymentEntries } from '../services/journal-generator.service.js';
import { systemUserId } from '../services/system-user.js';

async function main() {
  const apply = process.argv.includes('--apply');
  const rows = (await db.query(
    `SELECT p.id, p.amount, p.payment_date::text AS payment_date, i.invoice_number,
            (SELECT string_agg(je.entry_number, ', ') FROM journal_entries je
              WHERE je.source_id = p.id AND je.source_kind = 'payment' AND je.status <> 'reversed') AS entries
       FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id
      WHERE p.payment_method = 'avoir' AND p.credit_note_id IS NULL AND p.voids_payment_id IS NULL
      ORDER BY p.payment_date, p.created_at`)).rows as Array<{ id: string; amount: string; payment_date: string; invoice_number: string | null; entries: string | null }>;

  console.log(`${rows.length} règlement(s) de mode avoir.`);
  const userId = await systemUserId();
  let done = 0, failed = 0;
  for (const r of rows) {
    const label = `${r.payment_date} · ${r.amount} DH · facture ${r.invoice_number ?? '?'} · écriture(s) actuelle(s) : ${r.entries ?? 'aucune'}`;
    if (!apply) {
      const p = (await db.query(PAYMENT_SELECT, [r.id])).rows[0];
      try {
        const e = await fromPaymentEmission(db, p);
        console.log(`  [simulation] ${label}\n     → ${e?.lines.map(l => `${l.account_code} D${l.debit}/C${l.credit}`).join(' ; ')}`);
      } catch (err) {
        console.log(`  [simulation] ${label}\n     → IMPOSSIBLE : ${err instanceof Error ? err.message : err}`);
      }
      continue;
    }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      await regeneratePaymentEntries(client, r.id, userId);
      await client.query('COMMIT');
      done++;
      console.log(`  [repris] ${label}`);
    } catch (err) {
      await client.query('ROLLBACK');
      failed++;
      console.log(`  [ÉCHEC] ${label} : ${err instanceof Error ? err.message : err}`);
    } finally {
      client.release();
    }
  }
  if (apply) console.log(`Terminé : ${done} repris, ${failed} en échec.`);
  else console.log('Simulation : relancer avec --apply pour reprendre.');
  await db.pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
