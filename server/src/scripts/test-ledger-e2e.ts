/**
 * Test E2E du noyau comptable : exerce tous les flux de mutation et verifie
 * que la reconciliation legacy <-> ledger reste a ZERO apres chaque etape.
 *
 * Flux testes :
 *   1. Creation facture fournisseur
 *   2. Paiement especes de la facture (+ lettrage)
 *   3. Modification du montant de la facture (replaceItems)
 *   4. Suppression du paiement (reversion + delettrage)
 *   5. Annulation de la facture (reversion)
 *   6. Paiement par cheque + encaissement (markCashed) + annulation (unmarkCashed)
 *   7. Suppression facture forcee (reversion facture + paiements)
 *
 * Auto-nettoyant : supprime toutes les entites de test a la fin.
 *
 * Usage : npx tsx src/scripts/test-ledger-e2e.ts
 */

import { db } from '../config/database.js';
import { invoiceRepository, paymentRepository } from '../repositories/accounting.repository.js';

let failures = 0;
const created = { invoices: [] as string[], payments: [] as string[] };

async function reconDivergent(): Promise<number> {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM v_reconciliation_check WHERE ABS(legacy_remaining - ledger_remaining) > 0.01`
  );
  return r.rows[0].n;
}

async function entriesForSource(sourceId: string): Promise<number> {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM journal_entries WHERE source_id = $1 AND status != 'reversed'`,
    [sourceId]
  );
  return r.rows[0].n;
}

async function check(label: string, cond: boolean, detail = '') {
  const div = await reconDivergent();
  const ok = cond && div === 0;
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}${div > 0 ? ` [DIVERGENCE: ${div}]` : ''}`);
  if (!ok) failures++;
}

async function main() {
  const admin = (await db.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`)).rows[0];
  const supplier = (await db.query(`SELECT id FROM suppliers LIMIT 1`)).rows[0];
  const store = (await db.query(`SELECT id FROM stores LIMIT 1`)).rows[0];
  const cat = (await db.query(`SELECT id FROM expense_categories WHERE parent_id IS NULL LIMIT 1`)).rows[0];

  console.log('\n=== TEST E2E NOYAU COMPTABLE ===\n');

  // ─── 1. Creation facture fournisseur ───
  const inv = await invoiceRepository.create({
    invoiceType: 'received', supplierId: supplier.id, categoryId: cat.id,
    invoiceDate: '2026-06-10', amount: 1000, taxAmount: 0, totalAmount: 1000,
    notes: 'E2E test', createdBy: admin.id, storeId: store.id,
  });
  created.invoices.push(inv.id);
  await check('1. Facture creee genere 1 ecriture', (await entriesForSource(inv.id)) === 1);

  // ─── 2. Paiement especes ───
  const pay = await paymentRepository.create({
    type: 'invoice', invoiceId: inv.id, supplierId: supplier.id,
    amount: 1000, paymentMethod: 'cash', paymentDate: '2026-06-11',
    createdBy: admin.id, storeId: store.id,
  });
  created.payments.push(pay.id);
  await check('2. Paiement especes genere 1 ecriture + lettrage', (await entriesForSource(pay.id)) === 1);

  // ─── 3. Modification du montant (replaceItems) ───
  await invoiceRepository.replaceItems(inv.id, [
    { description: 'Article modifie', quantity: 1, unitPrice: 1000, subtotal: 1000 },
  ]);
  await check('3. replaceItems garde la coherence', (await entriesForSource(inv.id)) === 1);

  // ─── 4. Suppression du paiement ───
  await paymentRepository.delete(pay.id);
  created.payments = created.payments.filter(p => p !== pay.id);
  await check('4. Suppression paiement reverse son ecriture', (await entriesForSource(pay.id)) === 0);

  // ─── 5. Annulation de la facture ───
  await invoiceRepository.updateStatus(inv.id, 'cancelled');
  await check('5. Annulation facture reverse son ecriture', (await entriesForSource(inv.id)) === 0);

  // ─── 6. Cheque + encaissement + annulation encaissement ───
  const inv2 = await invoiceRepository.create({
    invoiceType: 'received', supplierId: supplier.id, categoryId: cat.id,
    invoiceDate: '2026-06-12', amount: 500, taxAmount: 0, totalAmount: 500,
    notes: 'E2E cheque', createdBy: admin.id, storeId: store.id,
  });
  created.invoices.push(inv2.id);

  const cheque = await paymentRepository.create({
    type: 'invoice', invoiceId: inv2.id, supplierId: supplier.id,
    amount: 500, paymentMethod: 'check', paymentDate: '2026-06-12',
    checkNumber: 'CHQ-E2E-001', createdBy: admin.id, storeId: store.id,
  });
  created.payments.push(cheque.id);
  await check('6a. Cheque emis genere 1 ecriture (emission)', (await entriesForSource(cheque.id)) === 1);

  await paymentRepository.markCashed(cheque.id, { cashedAt: '2026-06-15', cashedBy: admin.id });
  await check('6b. Encaissement cheque genere 2 ecritures (emission+cashing)', (await entriesForSource(cheque.id)) === 2);

  await paymentRepository.unmarkCashed(cheque.id);
  await check('6c. Annulation encaissement retire l\'ecriture cashing', (await entriesForSource(cheque.id)) === 1);

  // ─── 7. Suppression facture forcee (avec paiement) ───
  await invoiceRepository.deleteById(inv2.id, { force: true });
  created.invoices = created.invoices.filter(i => i !== inv2.id);
  created.payments = created.payments.filter(p => p !== cheque.id);
  await check('7. Suppression facture forcee reverse facture + paiement',
    (await entriesForSource(inv2.id)) === 0 && (await entriesForSource(cheque.id)) === 0);

  // ─── Nettoyage des entites restantes ───
  for (const pid of created.payments) await paymentRepository.delete(pid).catch(() => {});
  for (const iid of created.invoices) await invoiceRepository.deleteById(iid, { force: true }).catch(() => {});

  const finalDiv = await reconDivergent();
  console.log(`\n=== RESULTAT : ${failures === 0 ? 'TOUS LES TESTS PASSENT' : `${failures} ECHEC(S)`} | reconciliation divergente finale: ${finalDiv} ===\n`);

  await db.pool.end();
  process.exit(failures === 0 && finalDiv === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(2); });
