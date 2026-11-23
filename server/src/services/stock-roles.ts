/**
 * Désignation des zones de stock matière dans le code (plan d'exécution multi-industries,
 * étape 8, tâche 3).
 *
 * Les emplacements sont trouvés par RÔLE (mig 642, fn_store_location) ; les valeurs ci-dessous
 * ne sont plus des codes d'emplacement mais les valeurs ENREGISTRÉES qui disent d'où une ligne
 * de bon de sortie est servie et entre quelles zones un contenant a été déplacé. Elles restent
 * identiques pour la compatibilité des données (bons et transferts existants) ; le code ne les
 * écrit plus en dur.
 *
 *   ZONE.reserve  : réserve (rôle « reserve » ; Économat chez Ofauria)
 *   ZONE.opened   : en-cours ouvert (rôle « en_cours_ouvert » ; zone de Pesage chez Ofauria)
 *   BSI_SOURCE.opened : ligne servie directement (en-cours ouvert, ou réserve sans pesage)
 *   BSI_SOURCE.toOpen : ligne qui attend l'ouverture d'un contenant de la réserve
 */
export const ZONE = { reserve: 'ECONOMAT', opened: 'PESAGE' } as const;

export const BSI_SOURCE = { opened: ZONE.opened, toOpen: 'ECONOMAT_REQUIRES_TRANSFER' } as const;
export type BsiSource = typeof BSI_SOURCE[keyof typeof BSI_SOURCE];

/** Rôle d'emplacement correspondant à une zone (mig 642). */
export const ROLE_OF_ZONE: Record<typeof ZONE[keyof typeof ZONE], 'reserve' | 'en_cours_ouvert'> = {
  ECONOMAT: 'reserve',
  PESAGE: 'en_cours_ouvert',
};
