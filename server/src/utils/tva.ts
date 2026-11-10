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

/**
 * Conversions de base de prix (phase 5.1, mig 479). `tvaRate` en pourcentage ;
 * un taux nul, négatif ou non fini se comporte comme 0 (HT == TTC).
 */

/** HT à partir d'un prix TTC : TTC / (1 + taux). */
export function netFromGross(gross: number, tvaRate: number | null | undefined): number {
  const r = Number(tvaRate);
  if (!Number.isFinite(r) || r <= 0) return round2(gross);
  return round2(gross / (1 + r / 100));
}

/** TTC à partir d'un prix HT : HT * (1 + taux). */
export function grossFromNet(net: number, tvaRate: number | null | undefined): number {
  const r = Number(tvaRate);
  if (!Number.isFinite(r) || r <= 0) return round2(net);
  return round2(net * (1 + r / 100));
}

/**
 * Prix HT d'un article selon sa base déclarée. Si le prix est stocké TTC
 * (price_includes_tax), on en déduit le HT au taux donné ; sinon il est déjà HT.
 */
export function netPriceOf(price: number, priceIncludesTax: boolean, tvaRate: number | null | undefined): number {
  return priceIncludesTax ? netFromGross(price, tvaRate) : round2(price);
}

/**
 * Prix TTC d'un article selon sa base déclarée. Si le prix est stocké HT, on en
 * déduit le TTC au taux donné ; sinon il est déjà TTC.
 */
export function grossPriceOf(price: number, priceIncludesTax: boolean, tvaRate: number | null | undefined): number {
  return priceIncludesTax ? round2(price) : grossFromNet(price, tvaRate);
}

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
