/**
 * Catalogue de capacités (plan d'exécution multi-industries, étape 1, mig 632).
 *
 * Une capacité est une fonction métier activable à l'intérieur d'un module (lots, dates
 * limites, allergènes, sous-traitance…). Le catalogue est en base (app_features) ; ces
 * fonctions ne portent que les règles, communes au serveur et à l'écran :
 *   - une capacité n'est effective que si son module l'est ;
 *   - activer une capacité active celles dont elle dépend ;
 *   - désactiver une capacité suppose de désactiver celles qui en dépendent ;
 *   - une capacité « réglementaire » ne se désactive pas tant que des données l'exigent
 *     (contrôlé côté serveur, qui seul peut compter ces données).
 */

import { dependencyClosure, dependencyDependents, type DependencyRelation } from './dependency-engine.js';

export type CapabilityKind = 'fonction' | 'reglementaire';

export type CapabilityDef = {
  key: string;
  module_key: string;
  label: string;
  description?: string | null;
  sort_order?: number;
  kind?: CapabilityKind;
  requires?: string[];
  default_on?: boolean;
};

export const CAPABILITY_KIND_LABELS: Record<CapabilityKind, string> = {
  fonction: 'Fonction',
  reglementaire: 'Réglementaire',
};

/** Capacités demandées + toutes celles dont elles dépendent (fermeture transitive). */
export function withRequirements(keys: Iterable<string>, catalog: readonly CapabilityDef[]): Set<string> {
  return dependencyClosure(keys, capabilityRelations(catalog));
}

/** Capacités qui dépendent (directement ou non) de `key`. */
export function dependentsOf(key: string, catalog: readonly CapabilityDef[]): Set<string> {
  return dependencyDependents(key, capabilityRelations(catalog));
}

function capabilityRelations(catalog: readonly CapabilityDef[]): DependencyRelation[] {
  return catalog.flatMap(c => (c.requires ?? []).map(related => ({ module: c.key, related, kind: 'requires' })));
}

/** Capacités actives dont une dépendance est éteinte. */
export function missingCapabilityDependencies(
  active: ReadonlySet<string>, catalog: readonly CapabilityDef[],
): { key: string; missing: string[] }[] {
  const out: { key: string; missing: string[] }[] = [];
  for (const c of catalog) {
    if (!active.has(c.key)) continue;
    const missing = (c.requires ?? []).filter(r => !active.has(r));
    if (missing.length) out.push({ key: c.key, missing });
  }
  return out;
}

/** Valeur d'une capacité quand la société ne l'a pas ajustée : préréglage du secteur ou socle. */
export function capabilityDefault(def: CapabilityDef | undefined, packFeatures: readonly string[], key: string): boolean {
  return packFeatures.includes(key) || def?.default_on === true;
}
