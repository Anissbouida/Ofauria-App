import { PRODUCTION_STATUS_LABELS, BON_SORTIE_STATUS_LABELS } from '@ofauria/shared';

/**
 * UNE seule table statut -> couleur pour le module Production (plan + bon de
 * sortie). Les libelles viennent du paquet partage. Avant : trois chaines de
 * ternaires pour le plan et trois tables pour le bon, avec des couleurs
 * differentes selon l'ecran (« Livre » gris ici, vert la).
 */
export const PLAN_STATUS_TAG: Record<string, string> = {
  draft: 'odoo-tag-grey',
  confirmed: 'odoo-tag-blue',
  awaiting_ingredients: 'odoo-tag-orange',
  ready_to_produce: 'odoo-tag-blue',
  in_progress: 'odoo-tag-yellow',
  completed: 'odoo-tag-green',
  cancelled: 'odoo-tag-red',
};

export const BON_STATUS_TAG: Record<string, string> = {
  genere: 'odoo-tag-blue',
  preparation: 'odoo-tag-yellow',
  preparation_partielle: 'odoo-tag-orange',
  pret: 'odoo-tag-green',
  prelevement: 'odoo-tag-purple',
  verifie: 'odoo-tag-purple',
  cloture: 'odoo-tag-green',
  annule: 'odoo-tag-red',
};

/** Ordre du cycle de vie, pour les tris. */
export const PLAN_STATUS_ORDER: Record<string, number> = {
  draft: 0, confirmed: 1, awaiting_ingredients: 2, ready_to_produce: 3, in_progress: 4, completed: 5, cancelled: 6,
};

export function planStatusTag(status: string | null | undefined): { cls: string; label: string } {
  const s = status || '';
  return {
    cls: PLAN_STATUS_TAG[s] || 'odoo-tag-grey',
    label: (PRODUCTION_STATUS_LABELS as Record<string, string>)[s] || s,
  };
}

export function bonStatusTag(status: string | null | undefined): { cls: string; label: string } {
  const s = status || '';
  return {
    cls: BON_STATUS_TAG[s] || 'odoo-tag-grey',
    label: (BON_SORTIE_STATUS_LABELS as Record<string, string>)[s] || s,
  };
}
