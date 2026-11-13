import { MODULE_LABELS, dependentModules, type AppModule } from '@ofauria/shared';
import { db } from '../config/database.js';
import { sectorRepository, type Activation, type AdjustmentChanges } from '../repositories/sector.repository.js';

/**
 * Bilan de santé de la configuration (plan Production générique, lot P8).
 *
 * Des requêtes sur les données, SANS IA, qui PROPOSENT sans jamais imposer : chaque
 * recommandation porte soit un ajustement (modules / options), que l'écran verse dans
 * le brouillon — il passe donc par l'aperçu d'impact, la barre « Enregistrer » et
 * l'historique des versions —, soit un lien vers l'écran à compléter. Rien n'est
 * appliqué ici. L'administrateur peut écarter une proposition (90 jours, mig 516).
 *
 * Ajouter un contrôle = ajouter une entrée au registre CHECKS. Un contrôle qui échoue
 * (table absente d'une ancienne base…) est ignoré : le bilan ne casse jamais l'écran.
 */

export type HealthAction =
  | { kind: 'adjust'; label: string; changes: AdjustmentChanges }
  | { kind: 'link'; label: string; to: string };

export type Recommendation = {
  key: string;
  tone: 'suggestion' | 'warning';
  module: string;
  title: string;
  detail: string;
  action: HealthAction;
};

type Ctx = { act: Activation; count: (sql: string, params?: unknown[]) => Promise<number> };
type Check = { key: string; run: (ctx: Ctx) => Promise<Omit<Recommendation, 'key'> | null> };

const UNUSED_DAYS = 90;
const RECENT_DAYS = 30;
const DISMISS_DAYS = 90;

const label = (m: string) => MODULE_LABELS[m as AppModule] ?? m;
const fmtDate = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Masquer un module et ceux qui en dépendent (et sont actifs). */
function hideModule(act: Activation, m: AppModule): AdjustmentChanges {
  const modules: Record<string, boolean> = { [m]: false };
  for (const d of dependentModules(m)) if (act.modules.has(d)) modules[d] = false;
  return { modules };
}

const featureOn = (act: Activation, key: string) => act.features.has(key);

/**
 * Modules dont l'usage se lit dans une table : masquer s'ils n'ont jamais servi, ou plus
 * depuis 90 jours. Un module activé à la main il y a moins de 30 jours est laissé tranquille.
 */
const USAGE: { module: AppModule; table: string; column: string }[] = [
  { module: 'crm',            table: 'opportunities',             column: 'created_at' },
  { module: 'projects',       table: 'projects',                  column: 'created_at' },
  { module: 'maintenance',    table: 'maintenance_interventions', column: 'created_at' },
  { module: 'replenishment',  table: 'replenishment_requests',    column: 'created_at' },
  { module: 'unsold',         table: 'unsold_decisions',          column: 'created_at' },
  { module: 'reconciliation', table: 'recon_shifts',              column: 'created_at' },
];

const usageChecks: Check[] = USAGE.map(u => ({
  key: `module.${u.module}.unused`,
  run: async ({ act }) => {
    if (!act.modules.has(u.module)) return null;
    const { rows } = await db.query(
      `SELECT max(${u.column}) AS last,
              (SELECT updated_at FROM company_module_settings WHERE module_key = $1 AND enabled) AS enabled_at
         FROM ${u.table}`, [u.module]);
    const last: Date | null = rows[0].last;
    const enabledAt: Date | null = rows[0].enabled_at;
    const since = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86_400_000);
    if (enabledAt && since(enabledAt) < RECENT_DAYS) return null;
    if (last && since(last) < UNUSED_DAYS) return null;
    return {
      tone: 'suggestion', module: u.module,
      title: last
        ? `« ${label(u.module)} » n'a pas servi depuis ${since(last)} jours`
        : `« ${label(u.module)} » n'a jamais servi`,
      detail: last
        ? `Dernière saisie le ${fmtDate(last)}. Le masquer allège les menus ; aucune donnée n'est supprimée.`
        : 'Aucune saisie dans ce module. Le masquer allège les menus ; vous pourrez le réactiver à tout moment.',
      action: { kind: 'adjust', label: 'Masquer le module', changes: hideModule(act, u.module) },
    };
  },
}));

const CHECKS: Check[] = [
  {
    key: 'production.no_workshop',
    run: async ({ act, count }) => {
      if (!act.modules.has('production')) return null;
      if (await count(`SELECT count(*) FROM production_workshops WHERE is_active`) > 0) return null;
      return {
        tone: 'warning', module: 'production',
        title: 'Production est actif mais aucun atelier n\'est défini',
        detail: 'Sans atelier, les plans ne sont adressés à personne et les notifications ne partent pas.',
        action: { kind: 'link', label: 'Configurer les ateliers', to: '/settings?page=production' },
      };
    },
  },
  {
    key: 'production.unused',
    run: async ({ act, count }) => {
      if (!act.modules.has('production')) return null;
      const products = await count(`SELECT count(*) FROM products`);
      if (products === 0) return null; // société neuve : rien à conclure
      const recipes = await count(`SELECT count(*) FROM recipes WHERE archived_at IS NULL`);
      const plans = await count(`SELECT count(*) FROM production_plans WHERE created_at > now() - make_interval(days => $1)`, [UNUSED_DAYS]);
      if (recipes > 0 || plans > 0) return null;
      return {
        tone: 'suggestion', module: 'production',
        title: 'Vous vendez sans aucune fiche technique ni production',
        detail: `${products} article(s) au catalogue, aucune fiche technique et aucun plan depuis ${UNUSED_DAYS} jours : vous revendez probablement des articles achetés. Masquer la production et ses modules liés ?`,
        action: { kind: 'adjust', label: 'Masquer la production', changes: hideModule(act, 'production') },
      };
    },
  },
  {
    key: 'feature.dlc_jour.enable',
    run: async ({ act, count }) => {
      if (!act.modules.has('production') || featureOn(act, 'dlc_jour')) return null;
      const made = await count(`SELECT count(*) FROM products WHERE item_kind = 'manufactured'`);
      const withShelf = await count(`SELECT count(*) FROM products WHERE item_kind = 'manufactured' AND shelf_life_days IS NOT NULL`);
      if (made < 5 || withShelf / made < 0.8) return null;
      return {
        tone: 'suggestion', module: 'production',
        title: 'Vos articles ont une durée de conservation : activer la DLC ?',
        detail: `${Math.round((withShelf / made) * 100)} % des articles fabriqués ont une durée de conservation saisie, mais l'option « DLC du jour » est éteinte : les lots produits n'ont pas de date limite.`,
        action: { kind: 'adjust', label: 'Activer la DLC', changes: { features: { dlc_jour: true } } },
      };
    },
  },
  {
    key: 'feature.vitrine.disable',
    run: async ({ act, count }) => {
      if (!featureOn(act, 'vitrine')) return null;
      const produced = await count(`SELECT count(*) FROM production_plans WHERE completed_at > now() - make_interval(days => $1)`, [UNUSED_DAYS]);
      const tracked = await count(`SELECT count(*) FROM product_display_tracking WHERE updated_at > now() - make_interval(days => $1)`, [UNUSED_DAYS]);
      if (produced === 0 || tracked > 0) return null;
      return {
        tone: 'suggestion', module: 'production',
        title: 'Le suivi vitrine ne sert pas',
        detail: `${produced} plan(s) terminé(s) depuis ${UNUSED_DAYS} jours, mais aucun article suivi en vitrine. Éteindre l'option ?`,
        action: { kind: 'adjust', label: 'Éteindre le suivi vitrine', changes: { features: { vitrine: false } } },
      };
    },
  },
  {
    key: 'feature.lot_thermal.disable',
    run: async ({ act, count }) => {
      if (!featureOn(act, 'lot_thermal')) return null;
      const lots = await count(`SELECT count(*) FROM product_lots WHERE created_at > now() - make_interval(days => $1)`, [UNUSED_DAYS]);
      const frozen = await count(`SELECT count(*) FROM product_lots WHERE surgele_a > now() - make_interval(days => $1)`, [UNUSED_DAYS]);
      if (lots === 0 || frozen > 0) return null;
      return {
        tone: 'suggestion', module: 'production',
        title: 'Aucun lot congelé depuis 90 jours',
        detail: `${lots} lot(s) produit(s) sur la période, aucun passé au congélateur. Éteindre l'option « Congélation / décongélation » ?`,
        action: { kind: 'adjust', label: 'Éteindre l\'option', changes: { features: { lot_thermal: false } } },
      };
    },
  },
  {
    key: 'feature.haccp.idle',
    run: async ({ act, count }) => {
      if (!featureOn(act, 'haccp')) return null;
      if (await count(`SELECT count(*) FROM haccp_temperature_readings WHERE read_at > now() - make_interval(days => $1)`, [RECENT_DAYS]) > 0) return null;
      // Alerte, pas de proposition d'extinction : en alimentaire, le HACCP est une obligation.
      return {
        tone: 'warning', module: 'production',
        title: `Aucun relevé de température depuis ${RECENT_DAYS} jours`,
        detail: 'L\'option HACCP est active mais aucun relevé n\'a été saisi récemment. En cas de contrôle, le registre doit être tenu.',
        action: { kind: 'link', label: 'Ouvrir le HACCP', to: '/haccp' },
      };
    },
  },
  {
    key: 'feature.ccp_cuisson.missing',
    run: async ({ act, count }) => {
      if (!featureOn(act, 'ccp_cuisson')) return null;
      const done = await count(`SELECT count(*) FROM production_plans WHERE completed_at > now() - make_interval(days => $1)`, [RECENT_DAYS]);
      const readings = await count(`SELECT count(*) FROM production_step_readings WHERE created_at > now() - make_interval(days => $1)`, [RECENT_DAYS]);
      if (done === 0 || readings > 0) return null;
      return {
        tone: 'warning', module: 'production',
        title: 'Points critiques de cuisson non relevés',
        detail: `${done} plan(s) terminé(s) depuis ${RECENT_DAYS} jours sans aucun relevé de température saisi, alors que l'option « Points critiques de cuisson » est active.`,
        action: { kind: 'link', label: 'Voir la production', to: '/production' },
      };
    },
  },
  ...usageChecks,
];

export const CHECK_KEYS = CHECKS.map(c => c.key);

/** Recommandations en cours (hors propositions écartées) et nombre d'écartées. */
export async function healthReport(): Promise<{ recommendations: Recommendation[]; dismissed: number }> {
  const act = await sectorRepository.activation();
  const count = async (sql: string, params: unknown[] = []) => Number((await db.query(sql, params)).rows[0].count);
  const { rows } = await db.query(`SELECT check_key FROM config_health_dismissals WHERE dismissed_until > now()`);
  const dismissedKeys = new Set(rows.map(r => r.check_key as string));

  const found = await Promise.all(CHECKS.map(async c => {
    try {
      const r = await c.run({ act, count });
      return r ? { key: c.key, ...r } : null;
    } catch (err) {
      console.warn(`[config-health] contrôle ${c.key} ignoré :`, (err as Error).message);
      return null;
    }
  }));
  const all = found.filter((r): r is Recommendation => r !== null);
  const recommendations = all.filter(r => !dismissedKeys.has(r.key))
    .sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'warning' ? -1 : 1));
  return { recommendations, dismissed: all.length - recommendations.length };
}

/** Écarter une proposition pour 90 jours. */
export async function dismissRecommendation(key: string, userId?: string | null): Promise<boolean> {
  if (!CHECK_KEYS.includes(key)) return false;
  await db.query(
    `INSERT INTO config_health_dismissals (check_key, dismissed_until, dismissed_by)
     VALUES ($1, now() + make_interval(days => $2), $3)
     ON CONFLICT (check_key) DO UPDATE SET dismissed_until = EXCLUDED.dismissed_until,
       dismissed_by = EXCLUDED.dismissed_by, dismissed_at = now()`,
    [key, DISMISS_DAYS, userId ?? null]);
  return true;
}

/** Réafficher toutes les propositions écartées. */
export async function restoreDismissed(): Promise<void> {
  // Les listes de mise en route masquées (clés onboarding.*, P9) ne sont pas concernées.
  await db.query(`UPDATE config_health_dismissals SET dismissed_until = now() WHERE dismissed_until > now() AND check_key NOT LIKE 'onboarding.%'`);
}
