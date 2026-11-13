import { MODULE_LABELS, type AppModule } from '@ofauria/shared';
import { db } from '../config/database.js';
import { sectorRepository } from '../repositories/sector.repository.js';
import { sectorStarterDemoSlug } from './sector-starter.service.js';

/**
 * Mise en route guidée par module (plan Production générique, lot P9).
 *
 * Pour chaque module actif, une courte liste de tâches cochées AUTOMATIQUEMENT quand
 * la donnée existe (une requête de comptage par tâche) : rien à cocher à la main, et
 * une tâche faite ailleurs (import, saisie par un collègue) se coche toute seule. Une
 * liste terminée disparaît ; l'administrateur peut aussi la masquer (table
 * config_health_dismissals de la mig 516, clé `onboarding.<module>`, sans échéance).
 */

export type OnboardingTask = {
  key: string;
  label: string;
  done: boolean;
  /** Écran où faire la tâche, ou 'starter' : bouton « Charger les données de départ ». */
  to: string;
};

export type ModuleOnboarding = { module: string; label: string; tasks: OnboardingTask[]; done: number; total: number };

type TaskDef = { key: string; label: string; to: string; sql: string; params?: (ctx: { sector: string }) => unknown[]; when?: (ctx: { sector: string }) => boolean };

/** Les modules socle (« settings ») portent l'identité de la société. */
const TASKS: Partial<Record<AppModule, TaskDef[]>> = {
  settings: [
    { key: 'identity', label: 'Renseigner la raison sociale et l\'ICE', to: '/settings?page=company',
      sql: `SELECT count(*) FROM company_settings WHERE NULLIF(trim(legal_name), '') IS NOT NULL AND NULLIF(trim(legal_ice), '') IS NOT NULL` },
  ],
  products: [
    { key: 'first_product', label: 'Créer un premier article', to: '/products', sql: `SELECT count(*) FROM products` },
  ],
  customers: [
    { key: 'first_customer', label: 'Créer un premier client', to: '/customers', sql: `SELECT count(*) FROM customers` },
  ],
  orders: [
    { key: 'first_order', label: 'Saisir une première commande ou un devis', to: '/orders',
      sql: `SELECT (SELECT count(*) FROM orders) + (SELECT count(*) FROM quotes) AS count` },
  ],
  pos: [
    { key: 'priced_product', label: 'Avoir au moins un article avec un prix', to: '/products', sql: `SELECT count(*) FROM products WHERE price > 0` },
    { key: 'first_session', label: 'Ouvrir la caisse une première fois', to: '/pos', sql: `SELECT count(*) FROM cash_register_sessions` },
  ],
  stock: [
    { key: 'first_material', label: 'Créer une première matière', to: '/stock', sql: `SELECT count(*) FROM ingredients` },
    { key: 'first_lot', label: 'Faire entrer du stock (réception ou inventaire)', to: '/stock', sql: `SELECT count(*) FROM ingredient_lots` },
  ],
  purchasing: [
    { key: 'first_supplier', label: 'Créer un premier fournisseur', to: '/purchasing', sql: `SELECT count(*) FROM suppliers` },
    { key: 'first_po', label: 'Émettre un premier bon de commande', to: '/purchasing', sql: `SELECT count(*) FROM purchase_orders` },
  ],
  production: [
    { key: 'starter', label: 'Charger les données de départ (atelier, étapes, nomenclature de démonstration)', to: 'starter',
      // Faite si la démo est chargée, ou si la société a déjà ses propres fiches.
      sql: `SELECT (SELECT count(*) FROM products WHERE slug = $1) + (SELECT count(*) FROM recipes WHERE archived_at IS NULL) AS count`,
      params: ({ sector }) => [sectorStarterDemoSlug(sector)], when: ({ sector }) => sectorStarterDemoSlug(sector) !== null },
    { key: 'workshop', label: 'Définir au moins un atelier', to: '/settings?page=production',
      sql: `SELECT count(*) FROM production_workshops WHERE is_active` },
    { key: 'first_recipe', label: 'Créer une première fiche technique (nomenclature)', to: '/recipes',
      sql: `SELECT count(*) FROM recipes WHERE archived_at IS NULL` },
    { key: 'first_plan', label: 'Lancer un premier plan de production', to: '/production', sql: `SELECT count(*) FROM production_plans` },
  ],
  employees: [
    { key: 'first_employee', label: 'Créer une première fiche employé', to: '/employees', sql: `SELECT count(*) FROM employees` },
  ],
  accounting: [
    { key: 'bank_account', label: 'Renseigner le compte bancaire de la société', to: '/settings?page=company', sql: `SELECT count(*) FROM company_bank_accounts` },
    { key: 'fiscal_year', label: 'Ouvrir un exercice comptable', to: '/accounting', sql: `SELECT count(*) FROM fiscal_years` },
  ],
  crm: [
    { key: 'first_opportunity', label: 'Créer une première opportunité', to: '/crm', sql: `SELECT count(*) FROM opportunities` },
  ],
  projects: [
    { key: 'first_project', label: 'Créer un premier projet', to: '/projects', sql: `SELECT count(*) FROM projects` },
  ],
  maintenance: [
    { key: 'first_plan', label: 'Créer un premier plan d\'entretien', to: '/maintenance', sql: `SELECT count(*) FROM maintenance_plans` },
  ],
};

export const ONBOARDING_MODULES = Object.keys(TASKS);
const dismissKey = (m: string) => `onboarding.${m}`;

/** Listes en cours (modules actifs, non terminées, non masquées) et nombre de listes masquées. */
export async function onboardingReport(): Promise<{ modules: ModuleOnboarding[]; hidden: number }> {
  const act = await sectorRepository.activation();
  const sector = act.sector.code;
  const { rows } = await db.query(
    `SELECT check_key FROM config_health_dismissals WHERE check_key LIKE 'onboarding.%' AND dismissed_until > now()`);
  const hiddenKeys = new Set(rows.map(r => r.check_key as string));
  // Les modules activés à la main le plus récemment passent en tête.
  const recent = await db.query(`SELECT module_key FROM company_module_settings WHERE enabled ORDER BY updated_at DESC`);
  const order = recent.rows.map(r => r.module_key as string);
  const rank = (m: string) => (order.includes(m) ? order.indexOf(m) : order.length + ONBOARDING_MODULES.indexOf(m));

  const active = ONBOARDING_MODULES.filter(m => m === 'settings' || act.modules.has(m as AppModule));
  const lists = await Promise.all(active.map(async (m): Promise<ModuleOnboarding | null> => {
    const defs = (TASKS[m as AppModule] ?? []).filter(t => !t.when || t.when({ sector }));
    const tasks = await Promise.all(defs.map(async (t): Promise<OnboardingTask | null> => {
      try {
        const r = await db.query(t.sql, t.params ? t.params({ sector }) : []);
        return { key: `${m}.${t.key}`, label: t.label, to: t.to, done: Number(r.rows[0].count) > 0 };
      } catch (err) {
        console.warn(`[onboarding] tâche ${m}.${t.key} ignorée :`, (err as Error).message);
        return null;
      }
    }));
    const ok = tasks.filter((t): t is OnboardingTask => t !== null);
    if (!ok.length) return null;
    return { module: m, label: m === 'settings' ? 'Société' : MODULE_LABELS[m as AppModule] ?? m, tasks: ok, done: ok.filter(t => t.done).length, total: ok.length };
  }));
  const all = lists.filter((l): l is ModuleOnboarding => l !== null && l.done < l.total);
  const modules = all.filter(l => !hiddenKeys.has(dismissKey(l.module))).sort((a, b) => rank(a.module) - rank(b.module));
  return { modules, hidden: all.length - modules.length };
}

/** Masquer la liste d'un module (jusqu'à « Réafficher »). */
export async function hideOnboarding(module: string, userId?: string | null): Promise<boolean> {
  if (!ONBOARDING_MODULES.includes(module)) return false;
  await db.query(
    `INSERT INTO config_health_dismissals (check_key, dismissed_until, dismissed_by) VALUES ($1, 'infinity', $2)
     ON CONFLICT (check_key) DO UPDATE SET dismissed_until = 'infinity', dismissed_by = EXCLUDED.dismissed_by, dismissed_at = now()`,
    [dismissKey(module), userId ?? null]);
  return true;
}

/** Réafficher toutes les listes masquées. */
export async function showAllOnboarding(): Promise<void> {
  await db.query(`UPDATE config_health_dismissals SET dismissed_until = now() WHERE check_key LIKE 'onboarding.%' AND dismissed_until > now()`);
}
