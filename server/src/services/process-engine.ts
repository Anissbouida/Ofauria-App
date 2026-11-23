import { db } from '../config/database.js';
import { resolvePolicy } from './policies.js';
import { CONDITIONS, TECH_STATUSES, evaluateGuards } from './process-catalog.js';

/**
 * Moteur de processus (plan d'exécution multi-industries, étape 5, pas 5c).
 *
 * Lit le modèle PUBLIÉ du type d'ordre (mig 639) et évalue les gardes de l'étape visée.
 * Trois modes, par la politique production.process_engine (type d'ordre, atelier, société) :
 *   eteint — le moteur ne fait rien (défaut, comportement historique) ;
 *   ombre  — il calcule sa décision à côté de celle du code actuel et journalise tout écart
 *            (process_shadow_log) ; il ne bloque jamais ;
 *   actif  — ses gardes décident ; la machine à états SQL reste le filet de sécurité.
 *
 * Règle des étapes déclarées : les gardes « all_weighed » et « quality_passed » ne
 * s'appliquent que si la politique production.enforce_declared_steps figée sur l'ordre
 * est active — exactement comme le code actuel.
 */
type Runner = { query: (q: string, p?: unknown[]) => Promise<{ rows: any[] }> };
export type EngineMode = 'eteint' | 'ombre' | 'actif';
const DECLARED = new Set(['all_weighed', 'quality_passed']);

async function planContext(planId: string, runner: Runner) {
  return (await runner.query(
    `SELECT pp.store_id, pp.target_role, pp.exec_snapshot, pp.is_semi_finished_plan,
            COALESCE(pp.exec_snapshot->'order_type'->>'code', t.code) AS order_type
       FROM production_plans pp
       LEFT JOIN production_order_types t ON t.id = COALESCE(pp.order_type_id, (SELECT id FROM production_order_types WHERE is_default LIMIT 1))
      WHERE pp.id = $1`, [planId])).rows[0];
}

export async function engineMode(planId: string, runner: Runner = db): Promise<EngineMode> {
  const p = await planContext(planId, runner);
  if (!p) return 'eteint';
  const pol = await resolvePolicy<{ mode?: EngineMode }>('production.process_engine',
    { orderType: p.order_type, workshop: p.target_role ?? null, storeId: p.store_id ?? null });
  return pol.value?.mode ?? 'eteint';
}

/** Gardes de l'étape `stageCode` du modèle publié, filtrées par la règle des étapes déclarées. */
export async function stageGuards(planId: string, stageCode: string, runner: Runner = db): Promise<string[] | null> {
  const p = await planContext(planId, runner);
  if (!p) return null;
  const st = (await runner.query(
    `SELECT s.guards, s.condition_key FROM process_models m JOIN process_stages s ON s.model_id = m.id
      WHERE m.order_type_code = $1 AND m.status = 'publie' AND s.code = $2`, [p.order_type, stageCode])).rows[0];
  if (!st) return null;
  // Étape conditionnelle (pas 5e) : condition fausse = étape sautée, aucune garde.
  if (st.condition_key && CONDITIONS[st.condition_key] && !(await CONDITIONS[st.condition_key].check({ planId, runner }))) return [];
  const enforced = p.exec_snapshot?.policies?.['production.enforce_declared_steps']?.enabled === true
    || (!p.exec_snapshot && (await resolvePolicy<{ enabled?: boolean }>('production.enforce_declared_steps',
      { orderType: p.order_type, workshop: p.target_role ?? null, storeId: p.store_id ?? null })).value?.enabled === true);
  // Un plan de semi-fini n'a pas son propre bon de sortie (comportement historique).
  const noBsi = p.is_semi_finished_plan === true;
  return (st.guards as string[])
    .filter(g => !DECLARED.has(g) || enforced)
    .filter(g => !(noBsi && (g === 'bon_sortie_closed' || g === 'all_weighed')));
}

/**
 * Évalue l'étape et applique le mode. `legacyAllows` : décision du code actuel.
 * Renvoie les motifs de refus que l'appelant doit appliquer (non vide seulement en mode actif).
 */
export async function checkStage(planId: string, stageCode: string, legacyAllows: boolean, runner: Runner = db): Promise<string[]> {
  const mode = await engineMode(planId, runner);
  if (mode === 'eteint') return [];
  const guards = await stageGuards(planId, stageCode, runner);
  if (!guards) return [];
  const reasons = await evaluateGuards(guards, { planId, runner });
  const engineAllows = reasons.length === 0;
  if (mode === 'ombre') {
    if (engineAllows !== legacyAllows) {
      await runner.query(
        `INSERT INTO process_shadow_log (plan_id, transition, engine_allows, legacy_allows, engine_reasons) VALUES ($1, $2, $3, $4, $5)`,
        [planId, stageCode, engineAllows, legacyAllows, reasons]);
    }
    return [];
  }
  return reasons;
}

/**
 * Avancement d'un ordre sur son parcours publié (pas 5e) : étape faite, courante (toutes les
 * étapes d'un groupe parallèle sont courantes ensemble), à venir ou sautée (condition fausse).
 */
export async function planProgress(planId: string, runner: Runner = db) {
  const p = await planContext(planId, runner);
  if (!p) return null;
  const plan = (await runner.query(`SELECT status FROM production_plans WHERE id = $1`, [planId])).rows[0];
  const model = (await runner.query(
    `SELECT id, label, version_no FROM process_models WHERE order_type_code = $1 AND status = 'publie'`, [p.order_type])).rows[0];
  if (!model) return { orderType: p.order_type, model: null, stages: [] };
  const stages = (await runner.query(`SELECT * FROM process_stages WHERE model_id = $1 ORDER BY sequence`, [model.id])).rows;
  const rank = (s: string) => (TECH_STATUSES as readonly string[]).indexOf(s);
  const cur = plan.status === 'cancelled' ? -1 : rank(plan.status);
  // Étape courante = dernière étape dont l'état technique est atteint ; son groupe parallèle suit.
  let currentIdx = -1;
  stages.forEach((s, i) => { if (rank(s.tech_status) <= cur) currentIdx = i; });
  const currentGroup = currentIdx >= 0 ? stages[currentIdx].parallel_group : null;
  const out = [];
  for (const [i, s] of stages.entries()) {
    let state: 'fait' | 'courant' | 'a_venir' | 'saute';
    if (s.condition_key && CONDITIONS[s.condition_key] && !(await CONDITIONS[s.condition_key].check({ planId, runner }))) state = 'saute';
    else if (i === currentIdx || (currentGroup && s.parallel_group === currentGroup)) state = plan.status === 'completed' && i === stages.length - 1 ? 'fait' : 'courant';
    else if (i < currentIdx) state = 'fait';
    else state = 'a_venir';
    out.push({ code: s.code, label: s.label, techStatus: s.tech_status, parallelGroup: s.parallel_group, documentKey: s.document_key, state });
  }
  return { orderType: p.order_type, model: { id: model.id, label: model.label, versionNo: model.version_no }, stages: out };
}
