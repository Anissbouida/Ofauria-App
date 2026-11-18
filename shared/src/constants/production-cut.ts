/**
 * Coupe d'un cadre (mig 302, M4-06) : quantité produite de l'article, en pièces, à partir
 * des sorties saisies. Une seule formule (M8-05) pour le serveur, qui fait foi à la
 * déclaration, et pour l'aperçu en direct de la fenêtre de lancement.
 *  - principal / co-produit : quantité × équivalence en pièces ;
 *  - sous-produit / déchet valorisé : hors quantité produite ;
 *  - arrondi au millième (quantités décimales, mig 512).
 */
export type CutOutputKind = 'principal' | 'co_produit' | 'sous_produit' | 'dechet_valorise';

export function cutProducedQuantity(lines: { quantity: number; equiv: number; outputType?: CutOutputKind | null }[]): number {
  const total = lines
    .filter(l => !l.outputType || l.outputType === 'principal' || l.outputType === 'co_produit')
    .reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.equiv) || 0), 0);
  return Math.round(total * 1000) / 1000;
}
