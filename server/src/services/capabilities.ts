import { db } from '../config/database.js';

/**
 * Catalogue de capacités (plan d'exécution multi-industries, étape 1, mig 632).
 *
 * Le calcul des capacités effectives est dans sector.repository (avec les modules) ;
 * ce service porte ce qui touche aux DONNÉES :
 *   - capabilityUsage : ce qui empêche de désactiver une capacité réglementaire ;
 *   - effectiveCapabilities : vue complète pour l'instantané de configuration et l'écran.
 *
 * Registre FIGÉ (capacité → requêtes de comptage), comme celui de l'aperçu d'impact :
 * aucun SQL construit à partir d'une saisie. Une table absente est ignorée.
 */

type Counter = { label: string; sql: string };

const USAGE: Record<string, Counter[]> = {
  lots: [
    { label: 'lot(s) de matière actif(s)', sql: `SELECT count(*)::int AS n FROM ingredient_lots WHERE status = 'active'` },
    { label: 'lot(s) de produit fini actif(s)', sql: `SELECT count(*)::int AS n FROM product_lots WHERE status = 'active'` },
  ],
  dlc_ddm: [
    { label: 'article(s) avec durée de vie', sql: `SELECT count(*)::int AS n FROM products WHERE shelf_life_days IS NOT NULL` },
    { label: 'lot(s) de matière datés', sql: `SELECT count(*)::int AS n FROM ingredient_lots WHERE status = 'active' AND expiration_date IS NOT NULL` },
  ],
  allergenes: [
    { label: 'matière(s) avec allergènes déclarés', sql: `SELECT count(*)::int AS n FROM ingredients WHERE cardinality(allergens) > 0` },
  ],
};

async function count(c: Counter): Promise<number> {
  try {
    const { rows } = await db.query(c.sql);
    return rows[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

/** Données qui exigent une capacité réglementaire (vide = désactivable). */
export async function capabilityUsage(key: string): Promise<{ label: string; count: number }[]> {
  const out: { label: string; count: number }[] = [];
  for (const c of USAGE[key] ?? []) {
    const n = await count(c);
    if (n > 0) out.push({ label: c.label, count: n });
  }
  return out;
}

export type CapabilityView = {
  key: string; module_key: string; label: string; kind: string; requires: string[];
  default_on: boolean; in_pack: boolean; override: boolean | null; effective: boolean;
};

/** Toutes les capacités avec leur origine et leur état effectif. */
export async function effectiveCapabilities(): Promise<CapabilityView[]> {
  const { sectorRepository } = await import('../repositories/sector.repository.js');
  const act = await sectorRepository.activation();
  return act.catalog.map(f => ({
    key: f.key, module_key: f.module_key, label: f.label, kind: f.kind, requires: f.requires ?? [],
    default_on: f.default_on, in_pack: act.packFeatures.includes(f.key),
    override: act.featureOverrides[f.key] ?? null, effective: act.features.has(f.key),
  }));
}
