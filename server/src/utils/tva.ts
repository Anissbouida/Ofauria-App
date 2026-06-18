/**
 * Helpers de calcul de la TVA au niveau ligne de facture (invoice_items).
 *
 * Le taux (tva_rate) est exprime en pourcentage. NULL/undefined signifie
 * "ligne sans TVA explicite" : la facture retombe alors sur la TVA globale
 * d'en-tete (cf. migration 189 et accounting.repository).
 *
 * Module pur (aucune dependance DB) -> testable en isolation.
 */

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Montant TVA d'une ligne. NULL si pas de taux explicite. */
export function lineTvaAmount(subtotal: number, tvaRate: number | null | undefined): number | null {
  if (tvaRate === null || tvaRate === undefined || !Number.isFinite(tvaRate)) return null;
  return round2(subtotal * (tvaRate / 100));
}

/**
 * Recalcule les totaux d'en-tete a partir des lignes.
 *   - amount        = somme des sous-totaux HT
 *   - hasPerLineTva = au moins une ligne porte un taux explicite
 *   - taxAmount     = somme des TVA lignes (si hasPerLineTva), sinon null
 *                     (l'appelant conserve alors la TVA d'en-tete existante)
 */
export function headerTotalsFromLines(
  items: { subtotal: number; tvaRate?: number | null }[]
): { amount: number; hasPerLineTva: boolean; taxAmount: number | null } {
  const amount = round2(items.reduce((s, it) => s + (Number.isFinite(it.subtotal) ? it.subtotal : 0), 0));
  const hasPerLineTva = items.some(it => it.tvaRate !== null && it.tvaRate !== undefined && Number.isFinite(it.tvaRate));
  const taxAmount = hasPerLineTva
    ? round2(items.reduce((s, it) => s + (lineTvaAmount(it.subtotal, it.tvaRate) ?? 0), 0))
    : null;
  return { amount, hasPerLineTva, taxAmount };
}
