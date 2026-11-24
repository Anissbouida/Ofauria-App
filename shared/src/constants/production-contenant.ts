/**
 * Mode de calcul pour les contenants de production.
 * Derive de unite_lancement — pas de colonne en base.
 *
 * - poids : quantite_theorique et pertes_fixes en kg (ex. pate, appareil)
 * - pieces : quantite_theorique et pertes_fixes en nombre de pieces (ex. cadre, moule, cercle, fournee)
 */
export type ModeCalcul = 'poids' | 'pieces';

/**
 * Mode de calcul d'une unité de lancement. Il vient du référentiel « Unités de lancement »
 * (metadata.mode, mig 634) quand l'appelant le fournit ; sinon de la liste de repli ci-dessous.
 * Une unité inconnue des deux se calcule en pièces.
 */
export function getModeCalcul(uniteLancement: string, modes?: Record<string, ModeCalcul | undefined>): ModeCalcul {
  const fromRef = modes?.[uniteLancement];
  if (fromRef === 'poids' || fromRef === 'pieces') return fromRef;
  return UNITE_LANCEMENT_OPTIONS.find(o => o.value === uniteLancement)?.mode ?? 'pieces';
}

/** Labels adaptes selon le mode */
export const MODE_LABELS: Record<ModeCalcul, {
  quantiteTheorique: string;
  pertesFixes: string;
  netCible: string;
  coutUnitaire: string;
  uniteRendement: string;
}> = {
  poids: {
    quantiteTheorique: 'Poids brut (kg)',
    pertesFixes: 'Pertes poids (kg)',
    netCible: 'Poids net (kg)',
    coutUnitaire: 'DH/kg',
    uniteRendement: 'kg',
  },
  pieces: {
    quantiteTheorique: 'Nb pièces théorique',
    pertesFixes: 'Pièces perdues',
    netCible: 'Pièces nettes',
    coutUnitaire: 'DH/pièce',
    uniteRendement: 'pièces',
  },
};

// Listes de REPLI : la source est le référentiel éditable (Paramètres › Référentiels,
// « Types de production » et « Unités de lancement », mig 634). Elles ne servent que tant
// que le référentiel n'est pas chargé, et reprennent ses valeurs d'origine.
export const TYPE_PRODUCTION_LABELS: Record<number, string> = {
  1: 'Moule / Découpe',
  2: 'Entremets monté',
  3: 'Pièces individuelles',
  4: 'Pétrissage / Cuisson',
  5: 'Laminage / Cuisson',
  6: 'Lot de fabrication',
};

export const UNITE_LANCEMENT_OPTIONS = [
  { value: 'cadre', label: 'Cadre', mode: 'pieces' as ModeCalcul },
  { value: 'moule', label: 'Moule', mode: 'pieces' as ModeCalcul },
  { value: 'cercle', label: 'Cercle', mode: 'pieces' as ModeCalcul },
  { value: 'fournee', label: 'Fournée', mode: 'pieces' as ModeCalcul },
  { value: 'kg_pate', label: 'Kg de pâte', mode: 'poids' as ModeCalcul },
  { value: 'lot', label: 'Lot', mode: 'pieces' as ModeCalcul },
  { value: 'kg', label: 'Kilogramme', mode: 'poids' as ModeCalcul },
];
