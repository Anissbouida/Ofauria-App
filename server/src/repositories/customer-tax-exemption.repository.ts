import { db } from '../config/database.js';
import type { PoolClient } from 'pg';

// Attestations d'exonération de TVA du client (phase 5.7, mig 485). Datées
// (validité), elles préparent l'exonération d'une facture émise dans leur fenêtre.
// L'application à la TVA reste différée (réponses de l'expert-comptable) : ce
// référentiel stocke, liste et expose la validité, sans rien forcer sur les écritures.

export interface CustomerTaxExemptionInput {
  certificateNumber: string;
  reason?: string | null;
  validFrom: string;
  validTo?: string | null;
  notes?: string | null;
}

type Runner = Pick<PoolClient, 'query'>;

export const customerTaxExemptionRepository = {
  async list(customerId: string) {
    return (await db.query(
      `SELECT * FROM customer_tax_exemptions WHERE customer_id = $1 AND is_active = true
        ORDER BY valid_from DESC, created_at DESC`,
      [customerId]
    )).rows;
  },

  /**
   * Attestation active du client à une date (défaut aujourd'hui) : valid_from <= date
   * et (valid_to IS NULL OR valid_to >= date). Renvoie la pièce ou null.
   */
  async activeAt(client: Runner, customerId: string | null, date?: string) {
    if (!customerId) return null;
    const d = date ?? new Date().toISOString().slice(0, 10);
    return (await client.query(
      `SELECT * FROM customer_tax_exemptions
        WHERE customer_id = $1 AND is_active = true
          AND valid_from <= $2::date AND (valid_to IS NULL OR valid_to >= $2::date)
        ORDER BY valid_from DESC LIMIT 1`,
      [customerId, d]
    )).rows[0] ?? null;
  },

  async create(customerId: string, data: CustomerTaxExemptionInput, userId?: string) {
    return (await db.query(
      `INSERT INTO customer_tax_exemptions
         (customer_id, certificate_number, reason, valid_from, valid_to, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [customerId, data.certificateNumber, data.reason ?? null, data.validFrom,
       data.validTo ?? null, data.notes ?? null, userId ?? null]
    )).rows[0];
  },

  /** Désactivation (soft-delete) : l'historique reste intact. */
  async remove(id: string, customerId: string) {
    return (await db.query(
      `UPDATE customer_tax_exemptions SET is_active = false WHERE id = $1 AND customer_id = $2 RETURNING id`,
      [id, customerId]
    )).rows[0] ?? null;
  },
};
