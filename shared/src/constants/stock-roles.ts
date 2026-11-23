/**
 * Rôles des emplacements de stock (plan d'exécution multi-industries, étape 8, mig 642).
 *
 * Le code ne désigne plus un emplacement par un code figé (ECONOMAT, PESAGE, MAGASIN, FRIGO)
 * mais par son RÔLE ; chaque établissement a un emplacement par défaut pour chaque rôle
 * (stock_locations.role_default, fonction SQL fn_store_location).
 */
export const STOCK_LOCATION_ROLES = {
  reserve: { label: 'Réserve', help: 'Stock fermé : réception, rangement.' },
  en_cours_ouvert: { label: 'En-cours ouvert', help: 'Contenants ouverts, prêts à être pesés ou consommés (zone de pesage).' },
  atelier: { label: 'Atelier', help: 'Matière livrée à l\'atelier, en cours de fabrication.' },
  froid_positif: { label: 'Froid positif', help: 'Chambre ou armoire froide (0 à 8 °C).' },
  froid_negatif: { label: 'Froid négatif', help: 'Congélateur, surgélation.' },
  vente: { label: 'Vente', help: 'Vitrine, magasin, surface de vente.' },
  quarantaine: { label: 'Quarantaine', help: 'Lots retenus en attente de contrôle.' },
  expedition: { label: 'Expédition', help: 'Préparé pour un client, en attente d\'enlèvement.' },
} as const;

export type StockLocationRole = keyof typeof STOCK_LOCATION_ROLES;
export const STOCK_LOCATION_ROLE_KEYS = Object.keys(STOCK_LOCATION_ROLES) as StockLocationRole[];

/** Rôle déduit du type technique d'un emplacement (même règle que fn_location_role_of, mig 642). */
export function roleOfLocationType(type: string): StockLocationRole {
  switch (type) {
    case 'pesage': return 'en_cours_ouvert';
    case 'labo': return 'atelier';
    case 'positif': return 'froid_positif';
    case 'negatif': return 'froid_negatif';
    case 'vitrine': return 'vente';
    default: return 'reserve';
  }
}
