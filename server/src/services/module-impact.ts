import { db } from '../config/database.js';
import { MODULE_LABELS, resolveModuleKeys, type AppModule } from '@ofauria/shared';

/**
 * Aperçu d'impact d'un changement de modules / options (plan Production générique,
 * lot P0b). Avant d'enregistrer, l'écran montre ce qui apparaît, ce qui disparaît,
 * les rôles touchés et le volume de données masquées (jamais supprimées).
 *
 * Les comptages viennent d'un registre FIGÉ dans le code (module → requête) : pas de
 * SQL dynamique, sur le modèle du registre de sources des rapports configurables
 * (mig 394). Une table absente (base partielle) est simplement ignorée.
 */

type Counter = { label: string; sql: string };

const DATA_COUNTERS: Partial<Record<AppModule, Counter[]>> = {
  production: [{ label: 'plan(s) de production', sql: 'SELECT count(*)::int AS n FROM production_plans' }],
  recipes: [{ label: 'fiche(s) technique(s)', sql: 'SELECT count(*)::int AS n FROM recipes WHERE archived_at IS NULL' }],
  replenishment: [{ label: 'demande(s) boutique', sql: 'SELECT count(*)::int AS n FROM replenishment_requests' }],
  unsold: [{ label: "décision(s) d'invendus", sql: 'SELECT count(*)::int AS n FROM unsold_decisions' }],
  reconciliation: [{ label: 'service(s) contrôlé(s)', sql: 'SELECT count(*)::int AS n FROM recon_shifts' }],
  sales: [{ label: 'vente(s)', sql: 'SELECT count(*)::int AS n FROM sales' }],
  orders: [{ label: 'commande(s)', sql: 'SELECT count(*)::int AS n FROM orders' }, { label: 'devis', sql: 'SELECT count(*)::int AS n FROM quotes' }],
  customers: [{ label: 'client(s)', sql: 'SELECT count(*)::int AS n FROM customers' }],
  crm: [{ label: 'opportunité(s)', sql: 'SELECT count(*)::int AS n FROM opportunities' }],
  products: [{ label: 'article(s) du catalogue', sql: 'SELECT count(*)::int AS n FROM products' }],
  stock: [{ label: 'article(s) de stock', sql: 'SELECT count(*)::int AS n FROM ingredients' }],
  purchasing: [{ label: 'bon(s) de commande', sql: 'SELECT count(*)::int AS n FROM purchase_orders' }],
  employees: [{ label: 'fiche(s) personnel', sql: 'SELECT count(*)::int AS n FROM employees' }],
  accounting: [{ label: 'écriture(s) comptable(s)', sql: 'SELECT count(*)::int AS n FROM journal_entries' }],
  controle: [{ label: 'perte(s) enregistrée(s)', sql: 'SELECT count(*)::int AS n FROM product_losses' }],
  projects: [{ label: 'projet(s)', sql: 'SELECT count(*)::int AS n FROM projects' }],
  maintenance: [{ label: 'intervention(s)', sql: 'SELECT count(*)::int AS n FROM maintenance_interventions' }],
};

const FEATURE_COUNTERS: Record<string, Counter[]> = {
  haccp: [{ label: 'relevé(s) de température', sql: 'SELECT count(*)::int AS n FROM haccp_temperature_readings' }],
  // Capacités du socle (mig 632).
  series: [{ label: 'numéro(s) de série', sql: 'SELECT count(*)::int AS n FROM product_serials' }],
  controle_qualite: [{ label: 'contrôle(s) qualité', sql: 'SELECT count(*)::int AS n FROM quality_inspections' }],
  sous_traitance: [{ label: 'envoi(s) en sous-traitance', sql: 'SELECT count(*)::int AS n FROM subcontract_shipments' }],
  releves_temperature: [{ label: 'relevé(s) de procédé', sql: 'SELECT count(*)::int AS n FROM production_step_readings' }],
  coproduits: [{ label: 'sortie(s) de co-produits paramétrée(s)', sql: 'SELECT count(*)::int AS n FROM recipe_outputs' }],
};

export type ActivationState = { modules: Set<AppModule>; features: Set<string> };

export type ImpactDiff = {
  modulesOn: AppModule[];
  modulesOff: AppModule[];
  featuresOn: string[];
  featuresOff: string[];
};

export function diffActivation(before: ActivationState, after: ActivationState): ImpactDiff {
  return {
    modulesOn: [...after.modules].filter(m => !before.modules.has(m)),
    modulesOff: [...before.modules].filter(m => !after.modules.has(m)),
    featuresOn: [...after.features].filter(f => !before.features.has(f)),
    featuresOff: [...before.features].filter(f => !after.features.has(f)),
  };
}

export const NO_VISIBLE_CHANGE = 'Aucun changement visible';

/** Libellé court d'une version : « Production activé · HACCP désactivée ». */
export function describeDiff(diff: ImpactDiff, featureLabel: (key: string) => string): string {
  const parts = [
    ...diff.modulesOn.map(m => `${MODULE_LABELS[m]} activé`),
    ...diff.modulesOff.map(m => `${MODULE_LABELS[m]} désactivé`),
    ...diff.featuresOn.map(f => `${featureLabel(f)} activée`),
    ...diff.featuresOff.map(f => `${featureLabel(f)} désactivée`),
  ];
  if (!parts.length) return NO_VISIBLE_CHANGE;
  return parts.length > 4 ? `${parts.slice(0, 4).join(' · ')} · +${parts.length - 4}` : parts.join(' · ');
}

async function count(counter: Counter): Promise<number | null> {
  try {
    const { rows } = await db.query(counter.sql);
    return rows[0]?.n ?? 0;
  } catch {
    return null; // table absente : ignorée
  }
}

export type ImpactPreview = ImpactDiff & {
  /** Rôles dont l'accès change (droits du rôle ∩ modules effectifs, avant / après). */
  roles: { code: string; label: string; gained: AppModule[]; lost: AppModule[] }[];
  /** Données masquées (modules ou options éteints) — jamais supprimées. */
  hidden: { scope: string; label: string; count: number }[];
};

export async function impactPreview(diff: ImpactDiff, featureLabel: (key: string) => string): Promise<ImpactPreview> {
  const hidden: ImpactPreview['hidden'] = [];
  for (const m of diff.modulesOff) {
    for (const c of DATA_COUNTERS[m] ?? []) {
      const n = await count(c);
      if (n) hidden.push({ scope: MODULE_LABELS[m], label: c.label, count: n });
    }
  }
  for (const f of diff.featuresOff) {
    for (const c of FEATURE_COUNTERS[f] ?? []) {
      const n = await count(c);
      if (n) hidden.push({ scope: featureLabel(f), label: c.label, count: n });
    }
  }

  const roles: ImpactPreview['roles'] = [];
  const touched = [...diff.modulesOn, ...diff.modulesOff];
  if (touched.length) {
    const keys = [...new Set(touched.flatMap(m => resolveModuleKeys(m)))];
    const { rows } = await db.query(
      `SELECT r.code, r.label, array_agg(DISTINCT rp.module) AS modules
         FROM roles r
         JOIN role_permissions rp ON rp.role_code = r.code AND rp.can_view
        WHERE r.is_active AND rp.module = ANY($1::text[])
        GROUP BY r.code, r.label
        ORDER BY r.label`, [keys]).catch(() => ({ rows: [] as { code: string; label: string; modules: string[] }[] }));
    for (const r of rows as { code: string; label: string; modules: string[] }[]) {
      const has = (m: AppModule) => resolveModuleKeys(m).some(k => r.modules.includes(k));
      const gained = diff.modulesOn.filter(has);
      const lost = diff.modulesOff.filter(has);
      if (gained.length || lost.length) roles.push({ code: r.code, label: r.label, gained, lost });
    }
  }
  return { ...diff, roles, hidden };
}
