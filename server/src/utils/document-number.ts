import { getLocalISODate } from './timezone.js';

/** Séries de numéros paramétrables (table document_sequences, mig 329). */
export type DocumentType =
  | 'purchase_order' | 'reception_voucher' | 'invoice_received' | 'invoice_emitted'
  | 'customer_order' | 'sale' | 'sale_return' | 'cash_closure' | 'bon_sortie' | 'delivery_note' | 'complaint' | 'project' | 'maintenance' | 'rfq' | 'landed_cost' | 'quote' | 'proforma' | 'dunning' | 'stock_count' | 'opportunity' | 'credit_note_emitted' | 'prepayment_emitted' | 'product_transfer' | 'pro_return' | 'sales_contract' | 'subcontract_shipment' | 'disassembly';

type Runner = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/**
 * Prochain numéro de la série, alloué par next_document_number() (mig 329).
 * Passer le client de la transaction qui crée la pièce : le compteur reste
 * verrouillé jusqu'au COMMIT et un ROLLBACK rend le numéro (pas de trou).
 * `date` = date de la pièce (AAAA-MM-JJ), par défaut aujourd'hui dans le
 * fuseau de l'utilisateur.
 */
export async function nextDocumentNumber(
  runner: Runner, docType: DocumentType, date?: string, opts: { legalEntityId?: string | null } = {},
): Promise<string> {
  // G6-03 (mig 609) : portée entité facultative. Sans entité (cas actuel de tous les
  // appelants) : série globale, appel inchangé. Avec entité : variante de la série pour
  // cette entité si elle existe, sinon la série globale (next_document_number_v2 délègue).
  if (opts.legalEntityId) {
    const r = await runner.query(`SELECT next_document_number_v2($1, $2::date, $3::uuid) AS n`,
      [docType, date ?? getLocalISODate(), opts.legalEntityId]);
    return String(r.rows[0].n);
  }
  const r = await runner.query(`SELECT next_document_number($1, $2::date) AS n`, [docType, date ?? getLocalISODate()]);
  return String(r.rows[0].n);
}
