import { PRODUCTION_STATUS_LABELS, BON_SORTIE_STATUS_LABELS } from '@ofauria/shared';
import { ChefHat, Scale, PackageCheck, Handshake, Truck, type LucideIcon } from 'lucide-react';
import type { StatusTone } from '../../components/ui/StatusTag';

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

/**
 * Ton de l'étiquette de statut commune (StatusTag, lisibilité 2026-11-15) : choisi par le
 * sens (à traiter / en cours / terminé…), pas par l'ancienne couleur odoo-tag.
 */
export const PLAN_STATUS_TONE: Record<string, { tone: StatusTone; icon?: LucideIcon }> = {
  draft: { tone: 'draft' },
  confirmed: { tone: 'progress' },
  awaiting_ingredients: { tone: 'todo' },
  ready_to_produce: { tone: 'todo' },
  in_progress: { tone: 'progress', icon: ChefHat },
  completed: { tone: 'done' },
  cancelled: { tone: 'cancelled' },
};

export const BON_STATUS_TONE: Record<string, { tone: StatusTone; icon?: LucideIcon }> = {
  genere: { tone: 'todo' },
  preparation: { tone: 'progress', icon: Scale },
  preparation_partielle: { tone: 'progress' },
  pret: { tone: 'todo', icon: PackageCheck },
  prelevement: { tone: 'progress', icon: Handshake },
  verifie: { tone: 'done' },
  cloture: { tone: 'done', icon: Truck },
  annule: { tone: 'cancelled' },
};

/** Ordre du cycle de vie, pour les tris. */
export const PLAN_STATUS_ORDER: Record<string, number> = {
  draft: 0, confirmed: 1, awaiting_ingredients: 2, ready_to_produce: 3, in_progress: 4, completed: 5, cancelled: 6,
};

export type StatusTagInfo = { cls: string; label: string; tone: StatusTone; icon?: LucideIcon };

export function planStatusTag(status: string | null | undefined): StatusTagInfo {
  const s = status || '';
  const t = PLAN_STATUS_TONE[s] ?? { tone: 'draft' as StatusTone };
  return {
    cls: PLAN_STATUS_TAG[s] || 'odoo-tag-grey',
    tone: t.tone,
    icon: t.icon,
    label: (PRODUCTION_STATUS_LABELS as Record<string, string>)[s] || s,
  };
}

export function bonStatusTag(status: string | null | undefined): StatusTagInfo {
  const s = status || '';
  const t = BON_STATUS_TONE[s] ?? { tone: 'draft' as StatusTone };
  return {
    cls: BON_STATUS_TAG[s] || 'odoo-tag-grey',
    tone: t.tone,
    icon: t.icon,
    label: (BON_SORTIE_STATUS_LABELS as Record<string, string>)[s] || s,
  };
}
