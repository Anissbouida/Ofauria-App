import { db } from '../config/database.js';

/**
 * Phase 11 (D5-59) — dossiers de litige sur facture.
 *
 * Un litige ouvert porte un montant contesté, exclu du reste à recouvrer (donc
 * des relances, via receivables.openDocuments) tant qu'il n'est pas résolu.
 * L'ouverture passe la facture en `disputed` ; la résolution/rejet la ramène en
 * `pending` s'il ne reste aucun litige ouvert.
 */

export interface DisputeInput {
  invoiceId: string;
  reason: string;
  disputedAmount: number;
  responsibleUserId?: string | null;
  targetDate?: string | null;
  createdBy?: string | null;
}

async function syncInvoiceStatus(invoiceId: string): Promise<void> {
  // S'il reste un litige ouvert → disputed ; sinon, si la facture était en
  // litige, on la ramène en 'pending' (sans toucher paid/cancelled).
  const open = (await db.query(`SELECT 1 FROM invoice_disputes WHERE invoice_id = $1 AND status = 'open' LIMIT 1`, [invoiceId])).rows[0];
  if (open) {
    await db.query(`UPDATE invoices SET status = 'disputed' WHERE id = $1 AND status NOT IN ('paid', 'cancelled')`, [invoiceId]);
  } else {
    await db.query(`UPDATE invoices SET status = 'pending' WHERE id = $1 AND status = 'disputed'`, [invoiceId]);
  }
}

export const invoiceDisputeRepository = {
  async listForInvoice(invoiceId: string) {
    return (await db.query(
      `SELECT d.*, u.first_name || ' ' || u.last_name AS responsible_name
         FROM invoice_disputes d
         LEFT JOIN users u ON u.id = d.responsible_user_id
        WHERE d.invoice_id = $1 ORDER BY d.created_at DESC`, [invoiceId])).rows;
  },

  /** Litiges ouverts, tous clients (écran de suivi). */
  async listOpen() {
    return (await db.query(
      `SELECT d.*, i.invoice_number, i.customer_id,
              i.total_amount - COALESCE(i.paid_amount, 0) AS invoice_remaining
         FROM invoice_disputes d
         JOIN invoices i ON i.id = d.invoice_id
        WHERE d.status = 'open' ORDER BY d.target_date NULLS LAST, d.created_at`)).rows;
  },

  async open(input: DisputeInput) {
    const inv = (await db.query(
      `SELECT total_amount - COALESCE(paid_amount, 0) AS remaining, status FROM invoices WHERE id = $1`, [input.invoiceId])).rows[0];
    if (!inv) return { error: 'Facture introuvable' };
    if (['paid', 'cancelled'].includes(inv.status)) return { error: 'Facture soldée ou annulée' };
    const remaining = Number(inv.remaining);
    const amount = Math.min(Math.max(Number(input.disputedAmount) || 0, 0), remaining);
    if (!(amount > 0)) return { error: 'Montant contesté invalide' };
    try {
      const row = (await db.query(
        `INSERT INTO invoice_disputes (invoice_id, reason, disputed_amount, responsible_user_id, target_date, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [input.invoiceId, input.reason, amount, input.responsibleUserId ?? null, input.targetDate ?? null, input.createdBy ?? null])).rows[0];
      await syncInvoiceStatus(input.invoiceId);
      return { data: row };
    } catch (err) {
      // Index unique partiel : un seul litige ouvert par facture.
      if ((err as { code?: string }).code === '23505') return { error: 'Un litige est déjà ouvert sur cette facture' };
      throw err;
    }
  },

  async resolve(id: string, resolution: string, creditNoteId?: string | null) {
    const row = (await db.query(
      `UPDATE invoice_disputes SET status = 'resolved', resolution = $2, credit_note_id = $3, resolved_at = now()
        WHERE id = $1 AND status = 'open' RETURNING *`, [id, resolution ?? null, creditNoteId ?? null])).rows[0];
    if (!row) return { error: 'Litige introuvable ou déjà clos' };
    await syncInvoiceStatus(row.invoice_id);
    return { data: row };
  },

  async reject(id: string, resolution: string) {
    const row = (await db.query(
      `UPDATE invoice_disputes SET status = 'rejected', resolution = $2, resolved_at = now()
        WHERE id = $1 AND status = 'open' RETURNING *`, [id, resolution ?? null])).rows[0];
    if (!row) return { error: 'Litige introuvable ou déjà clos' };
    await syncInvoiceStatus(row.invoice_id);
    return { data: row };
  },
};
