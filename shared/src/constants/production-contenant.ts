/**
 * Mode de calcul pour les contenants de production.
 * Derive de unite_lancement — pas de colonne en base.
 *
 * - poids : quantite_theorique et pertes_fixes en kg (ex. pate, appareil)
 * - pieces : quantite_theorique et pertes_fixes en nombre de pieces (ex. cadre, moule, cercle, fournee)
 */
export type ModeCalcul = 'poids' | 'pieces';

/** Derive le mode de calcul a partir de l'unite de lancement */
export function getModeCalcul(uniteLancement: string): ModeCalcul {
  return uniteLancement === 'kg_pate' ? 'poids' : 'pieces';
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
    quantiteTheorique: 'Nb pieces theorique',
    pertesFixes: 'Pieces perdues',
    netCible: 'Pieces nettes',
    coutUnitaire: 'DH/piece',
    uniteRendement: 'pieces',
  },
};

export const TYPE_PRODUCTION_LABELS: Record<number, string> = {
  1: 'Moule / Decoupe',
  2: 'Entremets monte',
  3: 'Pieces individuelles',
  4: 'Petrissage / Cuisson',
  5: 'Laminage / Cuisson',
};

export const UNITE_LANCEMENT_OPTIONS = [
  { value: 'cadre', label: 'Cadre', mode: 'pieces' as ModeCalcul },
  { value: 'moule', label: 'Moule', mode: 'pieces' as ModeCalcul },
  { value: 'cercle', label: 'Cercle', mode: 'pieces' as ModeCalcul },
  { value: 'fournee', label: 'Fournee', mode: 'pieces' as ModeCalcul },
  { value: 'kg_pate', label: 'Kg pate', mode: 'poids' as ModeCalcul },
];
