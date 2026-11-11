import { db } from '../config/database.js';

/**
 * Phase 11 (D5-45) — créances douteuses et irrécouvrables.
 *
 * Une facture se classe « douteuse » (signalée, toujours suivie au recouvrement)
 * ou « irrécouvrable » (write-off : le reste à recouvrer sort des relances, via
 * receivables.openDocuments). L'écriture comptable (reclassement, dotation,
 * perte, TVA) reste l'OD manuelle, rattachée ici a posteriori.
 */

export interface ClassifyInput {
  invoiceId: string;
  status: 'doubtful' | 'written_off';
  reason?: string | null;
  amount?: number | null;
  createdBy?: string | null;
}

export const badDebtRepository = {
  async forInvoice(invoiceId: string) {
    return (await db.query(
      `SELECT * FROM bad_debts WHERE invoice_id = $1 ORDER BY classified_at DESC`, [invoiceId])).rows;
  },

  /** Classifications actives, tous clients (écran de suivi). */
  async listOpen() {
    return (await db.query(
      `SELECT b.*, i.invoice_number, i.customer_id,
              i.total_amount - COALESCE(i.paid_amount, 0) AS invoice_remaining
         FROM bad_debts b
         JOIN invoices i ON i.id = b.invoice_id
        WHERE b.reverted_at IS NULL ORDER BY b.classified_at DESC`)).rows;
  },

  async classify(input: ClassifyInput) {
    const inv = (await db.query(
      `SELECT total_amount - COALESCE(paid_amount, 0) AS remaining, status FROM invoices WHERE id = $1`, [input.invoiceId])).rows[0];
    if (!inv) return { error: 'Facture introuvable' };
    if (['paid', 'cancelled'].includes(inv.status)) return { error: 'Facture soldée ou annulée' };
    const remaining = Number(inv.remaining);
    // Montant concerné : le reste à recouvrer par défaut, borné à ce reste.
    const amount = Math.min(input.amount != null ? Math.max(Number(input.amount), 0) : remaining, remaining);
    if (!(amount > 0)) return { error: 'Montant invalide' };
    try {
      const row = (await db.query(
        `INSERT INTO bad_debts (invoice_id, status, amount, reason, classified_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [input.invoiceId, input.status, amount, input.reason ?? null, input.createdBy ?? null])).rows[0];
      return { data: row };
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return { error: 'Cette facture est déjà classée (douteuse ou irrécouvrable)' };
      throw err;
    }
  },

  /** Annule la classification (la créance redevient normale / relançable). */
  async revert(id: string) {
    const row = (await db.query(
      `UPDATE bad_debts SET reverted_at = now() WHERE id = $1 AND reverted_at IS NULL RETURNING *`, [id])).rows[0];
    if (!row) return { error: 'Classification introuvable ou déjà annulée' };
    return { data: row };
  },

  /** Rattache a posteriori l'OD comptable passée à la main. */
  async attachJournalEntry(id: string, journalEntryId: string) {
    await db.query(`UPDATE bad_debts SET journal_entry_id = $2 WHERE id = $1`, [id, journalEntryId]);
  },
};
