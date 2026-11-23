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
  const byKey = new Map(catalog.map(c => [c.key, c]));
  const out = new Set<string>();
  const stack = [...keys];
  while (stack.length) {
    const k = stack.pop()!;
    if (out.has(k)) continue;
    out.add(k);
    for (const r of byKey.get(k)?.requires ?? []) if (!out.has(r)) stack.push(r);
  }
  return out;
}

/** Capacités qui dépendent (directement ou non) de `key`. */
export function dependentsOf(key: string, catalog: readonly CapabilityDef[]): Set<string> {
  const out = new Set<string>();
  let frontier = [key];
  while (frontier.length) {
    const next: string[] = [];
    for (const c of catalog) {
      if (out.has(c.key) || c.key === key) continue;
      if ((c.requires ?? []).some(r => frontier.includes(r))) { out.add(c.key); next.push(c.key); }
    }
    frontier = next;
  }
  return out;
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
