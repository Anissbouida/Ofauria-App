import { db, withTransaction } from '../config/database.js';
import { sectorRepository } from '../repositories/sector.repository.js';
import { healthReport } from './config-health.js';
import { BSI_SOURCE } from './stock-roles.js';

/**
 * Assistant de configuration de la production et simulation (plan d'exécution
 * multi-industries, étape 11).
 *
 * Huit étapes, chacune renvoyant vers l'écran de paramétrage qui la règle : secteur,
 * spécialisations, modes de production (types d'ordre), capacités, processus, écrans,
 * simulation, publication. La publication est refusée tant qu'un point bloquant subsiste ou
 * que la dernière simulation a échoué.
 *
 * Simulation : un ordre fictif déroulé de bout en bout dans une transaction ANNULÉE (aucune
 * trace ne reste) : matière et article créés pour l'occasion, confirmation, bon de sortie,
 * pesée, démarrage, déclaration ; le rapport dit, étape par étape, ce que le système a fait,
 * les mouvements de stock et le résultat.
 */
export type SetupStep = { key: string; label: string; status: 'fait' | 'a_faire' | 'facultatif' | 'bloquant'; detail: string; to: string };
export type SimulationStep = { step: string; ok: boolean; detail: string; stock?: string };
export type SimulationReport = { ok: boolean; orderType: string | null; steps: SimulationStep[]; at: string };

const LAST_SIM_KEY = 'production.setup_last_simulation';

class Rollback extends Error { constructor(public report: SimulationReport) { super('simulation'); } }

async function lastSimulation(): Promise<SimulationReport | null> {
  const r = (await db.query(`SELECT value FROM module_parameters WHERE key = $1`, [LAST_SIM_KEY])).rows[0];
  return (r?.value as SimulationReport) ?? null;
}

export async function setupSteps(): Promise<{ steps: SetupStep[]; blocking: string[]; lastSimulation: SimulationReport | null }> {
  const act = await sectorRepository.activation();
  const [types, models, screens, specs, health, sim] = await Promise.all([
    db.query(`SELECT code, label FROM production_order_types WHERE is_active IS NOT FALSE`),
    db.query(`SELECT DISTINCT order_type_code FROM process_models WHERE status = 'publie'`),
    db.query(`SELECT count(*)::int AS n FROM screen_definitions WHERE status = 'publie'`),
    db.query(`SELECT count(*)::int AS n FROM company_specializations`),
    healthReport(),
    lastSimulation(),
  ]);
  const withModel = new Set(models.rows.map(r => r.order_type_code as string));
  const missingModel = types.rows.filter(t => !withModel.has(t.code));
  const blockingHealth = health.recommendations.filter(r => (r as { severity?: string }).severity === 'blocking').map(r => r.title);
  const blocking = [...blockingHealth];
  if (!types.rows.length) blocking.push('Aucun type d\'ordre actif.');
  if (missingModel.length) blocking.push(`Sans parcours publié : ${missingModel.map(t => t.label).join(', ')}.`);
  if (sim && !sim.ok) blocking.push('La dernière simulation a échoué.');
  const steps: SetupStep[] = [
    { key: 'secteur', label: 'Secteur', status: 'fait', detail: act.sector.label, to: '/settings?page=sector' },
    { key: 'specialisations', label: 'Spécialisations', status: specs.rows[0].n > 0 ? 'fait' : 'facultatif', detail: `${specs.rows[0].n} active(s)`, to: '/settings?page=sector' },
    { key: 'modes', label: 'Modes de production', status: types.rows.length ? 'fait' : 'bloquant', detail: `${types.rows.length} type(s) d'ordre`, to: '/production/settings' },
    { key: 'capacites', label: 'Capacités', status: blockingHealth.length ? 'bloquant' : 'fait', detail: `${act.features.size} capacité(s) active(s)${blockingHealth.length ? ` · ${blockingHealth.length} point(s) bloquant(s)` : ''}`, to: '/settings?page=sector' },
    { key: 'processus', label: 'Processus', status: missingModel.length ? 'bloquant' : 'fait', detail: missingModel.length ? `${missingModel.length} type(s) sans parcours publié` : 'Un parcours publié par type d\'ordre', to: '/settings?page=production' },
    { key: 'ecrans', label: 'Écrans', status: screens.rows[0].n > 0 ? 'fait' : 'facultatif', detail: `${screens.rows[0].n} écran(s) adapté(s)`, to: '/settings?page=production' },
    { key: 'simulation', label: 'Simulation', status: !sim ? 'a_faire' : sim.ok ? 'fait' : 'bloquant', detail: sim ? `${sim.ok ? 'Réussie' : 'Échouée'} le ${new Date(sim.at).toLocaleString('fr-FR')}` : 'Pas encore lancée', to: '' },
    { key: 'publication', label: 'Publication', status: blocking.length ? 'bloquant' : 'a_faire', detail: blocking.length ? `${blocking.length} point(s) à lever avant de publier` : 'Prête', to: '' },
  ];
  return { steps, blocking, lastSimulation: sim };
}

/** Ordre fictif déroulé dans une transaction annulée. */
export async function simulateOrder(userId: string, orderTypeCode?: string | null): Promise<SimulationReport> {
  const steps: SimulationStep[] = [];
  const at = new Date().toISOString();
  let orderType: string | null = null;
  const stockOf = async (lotId: string) => {
    const r = (await db.query(`SELECT economat_quantity::float8 AS r, pesage_quantity::float8 AS o, quantity_remaining::float8 AS t FROM ingredient_lots WHERE id = $1`, [lotId])).rows[0];
    return r ? `réserve ${r.r} · en-cours ${r.o} · reste ${r.t}` : '—';
  };
  try {
    await withTransaction(async () => {
      const { productionRepository } = await import('../repositories/production.repository.js');
      const { bonSortieRepository } = await import('../repositories/bon-sortie.repository.js');
      const run = async (step: string, fn: () => Promise<string>, stockLot?: string) => {
        try {
          const detail = await fn();
          steps.push({ step, ok: true, detail, ...(stockLot ? { stock: await stockOf(stockLot) } : {}) });
        } catch (e) {
          steps.push({ step, ok: false, detail: e instanceof Error ? e.message : String(e) });
          throw new Rollback({ ok: false, orderType, steps, at });
        }
      };
      const store = (await db.query(`SELECT id FROM stores WHERE is_active IS NOT FALSE ORDER BY created_at LIMIT 1`)).rows[0];
      if (!store) { steps.push({ step: 'Établissement', ok: false, detail: 'Aucun établissement actif.' }); throw new Rollback({ ok: false, orderType, steps, at }); }
      const ot = (await db.query(
        `SELECT id, code, label FROM production_order_types WHERE is_active IS NOT FALSE AND ($1::text IS NULL OR code = $1::text)
          ORDER BY (code = $1::text) DESC NULLS LAST, is_default DESC LIMIT 1`, [orderTypeCode ?? null])).rows[0];
      orderType = ot?.code ?? null;
      let ingId = ''; let lotId = ''; let productId = ''; let planId = '';
      await run('Données de simulation', async () => {
        ingId = (await db.query(`INSERT INTO ingredients (name, unit, unit_cost, category) VALUES ('Matière de simulation', 'kg', 2, 'autre') RETURNING id`)).rows[0].id;
        lotId = (await db.query(
          `INSERT INTO ingredient_lots (ingredient_id, lot_number, quantity_received, quantity_remaining, unit_cost, expiration_date, store_id, status, economat_quantity, pesage_quantity)
           VALUES ($1, 'SIMULATION', 50, 50, 2, CURRENT_DATE + 30, $2, 'active', 50, 0) RETURNING id`, [ingId, store.id])).rows[0].id;
        productId = (await db.query(`INSERT INTO products (name, slug, price, sale_type) VALUES ('Article de simulation', 'simulation-' || gen_random_uuid(), 10, 'jour') RETURNING id`)).rows[0].id;
        const recipeId = (await db.query(`INSERT INTO recipes (product_id, name, yield_quantity, yield_unit, mode_cout) VALUES ($1, 'Fiche de simulation', 1, 'unit', 'ratio_poids') RETURNING id`, [productId])).rows[0].id;
        await db.query(`INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ($1, $2, 0.5, 'kg')`, [recipeId, ingId]);
        return `Matière (50 kg), article et fiche (0,5 kg par article) créés pour la simulation${ot ? ` — type d'ordre « ${ot.label} »` : ''}.`;
      }, undefined);
      steps[steps.length - 1].stock = await stockOf(lotId);
      await run('Création de l\'ordre', async () => {
        const plan = await productionRepository.create({ planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: userId, storeId: store.id, items: [{ productId, plannedQuantity: 10 }] } as never);
        planId = plan.id;
        if (ot) await db.query(`UPDATE production_plans SET order_type_id = $2 WHERE id = $1`, [planId, ot.id]);
        return '10 articles planifiés (besoin : 5 kg).';
      });
      await run('Confirmation', async () => {
        const r = await productionRepository.confirm(planId, userId);
        const st = (await db.query(`SELECT status FROM production_plans WHERE id = $1`, [planId])).rows[0].status;
        return `Ordre confirmé (état ${st})${r.warnings?.length ? ` — ${r.warnings.join(' ; ')}` : ''}.`;
      });
      const bon = (await bonSortieRepository.findByPlan(planId))[0] as { id: string; numero: string; lines?: { id: string; allocated_quantity: string | number }[] } | undefined;
      if (bon) {
        await run('Bon de sortie et pesée', async () => {
          await bonSortieRepository.markAsPreparation(bon.id, userId);
          type L = { id: string; allocated_quantity: string | number; needed_quantity: string | number; source_location: string | null; suggested_economat_lot_id: string | null };
          const fresh = (await bonSortieRepository.findByPlan(planId))[0] as { lines: L[] };
          // Ligne servie : son allocation ; ligne « à ouvrir » : son besoin, sur le lot proposé
          // (la pesée ouvre le contenant, comme au poste de pesée).
          const lines = fresh.lines.filter(l => Number(l.allocated_quantity) > 0 || (l.source_location === BSI_SOURCE.toOpen && Number(l.needed_quantity) > 0));
          await bonSortieRepository.weighLignes(bon.id, userId, lines.map(l => (Number(l.allocated_quantity) > 0
            ? { ligneId: l.id, actualQuantity: Number(l.allocated_quantity), source: 'manual' }
            : { ligneId: l.id, actualQuantity: Number(l.needed_quantity), source: 'manual', lotId: l.suggested_economat_lot_id ?? undefined })) as never);
          await bonSortieRepository.markAsReady(bon.id, userId);
          await bonSortieRepository.acceptReception(bon.id, userId);
          return `Bon ${bon.numero} : ${lines.length} ligne(s) pesée(s), remis et accepté.`;
        }, lotId);
      } else {
        steps.push({ step: 'Bon de sortie', ok: true, detail: 'Ce type d\'ordre ne prévoit pas de bon de sortie.' });
      }
      await run('Démarrage', async () => { await productionRepository.start(planId, userId); return 'Fabrication démarrée (gardes du parcours respectées).'; });
      await run('Déclaration', async () => {
        const item = (await db.query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [planId])).rows[0];
        await productionRepository.produceItems(planId, [{ planItemId: item.id, actualQuantity: 10 }], userId, store.id);
        const lot = (await db.query(`SELECT lot_number, (backroom_qty + vitrine_qty)::float8 AS q FROM product_lots WHERE production_plan_id = $1 LIMIT 1`, [planId])).rows[0];
        return `10 articles déclarés${lot ? ` — lot ${lot.lot_number ?? ''} (${lot.q})` : ''}.`;
      }, lotId);
      throw new Rollback({ ok: true, orderType, steps, at });
    });
  } catch (e) {
    if (!(e instanceof Rollback)) {
      steps.push({ step: 'Simulation', ok: false, detail: e instanceof Error ? e.message : String(e) });
      const report: SimulationReport = { ok: false, orderType, steps, at };
      await saveLast(report);
      return report;
    }
    await saveLast(e.report);
    return e.report;
  }
  // withTransaction n'a pas levé : impossible (la simulation lève toujours pour annuler).
  return { ok: false, orderType, steps, at };
}

async function saveLast(report: SimulationReport) {
  await db.query(
    `INSERT INTO module_parameters (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [LAST_SIM_KEY, JSON.stringify(report)]);
}

/** Publication : version de configuration enregistrée, refusée s'il reste un point bloquant. */
export async function publishSetup(userId: string, label?: string | null): Promise<{ error: string; blocking?: string[] } | { published: true }> {
  const s = await setupSteps();
  if (s.blocking.length) return { error: 'Publication impossible : des points bloquants subsistent.', blocking: s.blocking };
  if (!s.lastSimulation) return { error: 'Lancez d\'abord une simulation.' };
  await sectorRepository.recordVersion(label?.trim() || 'Configuration de la production publiée (assistant)', userId);
  return { published: true };
}
