import { getLocalISODate } from './timezone.js';

/** Séries de numéros paramétrables (table document_sequences, mig 329). */
export type DocumentType =
  | 'purchase_order' | 'reception_voucher' | 'invoice_received' | 'invoice_emitted'
  | 'customer_order' | 'sale' | 'sale_return' | 'cash_closure' | 'bon_sortie' | 'delivery_note' | 'complaint' | 'project' | 'maintenance';

type Runner = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/**
 * Prochain numéro de la série, alloué par next_document_number() (mig 329).
 * Passer le client de la transaction qui crée la pièce : le compteur reste
 * verrouillé jusqu'au COMMIT et un ROLLBACK rend le numéro (pas de trou).
 * `date` = date de la pièce (AAAA-MM-JJ), par défaut aujourd'hui dans le
 * fuseau de l'utilisateur.
 */
export async function nextDocumentNumber(runner: Runner, docType: DocumentType, date?: string): Promise<string> {
  const r = await runner.query(`SELECT next_document_number($1, $2::date) AS n`, [docType, date ?? getLocalISODate()]);
  return String(r.rows[0].n);
}
