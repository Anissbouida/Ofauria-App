import { resolvePolicy } from '../services/policies.js';
import { db, withTransaction } from '../config/database.js';
import { readingParamMeta } from '../services/process-referentials.js';
import { placeBackward, type Window } from '../services/retro-calendar.js';

// Relevés de procédé (mig 422) agrégés par étape : évite un appel par étape sur
// l'écran d'atelier. Fragment SQL corrélé réutilisé par findByPlan/findByPlanItem.
const READINGS_AGG = `COALESCE((
  SELECT jsonb_agg(jsonb_build_object(
    'id', sr.id, 'parametre', sr.parametre, 'consigne', sr.consigne,
    'tolerance', sr.tolerance, 'mesure', sr.mesure, 'conforme', sr.conforme,
    'est_ccp', sr.est_ccp, 'note', sr.note, 'mesure_a', sr.mesure_a,
    'mesure_par_name', (SELECT first_name FROM users WHERE id = sr.mesure_par))
    ORDER BY sr.mesure_a)
  FROM production_step_readings sr WHERE sr.etape_id = pie.id), '[]'::jsonb)`;

type ReadingInput = {
  parametre: string;
  consigne?: number | null;
  tolerance?: number | null;
  mesure: number;
  est_ccp?: boolean;
  note?: string | null;
};

// Types d'étape « CCP » et libellés / unités des paramètres mesurés : référentiels
// éditables (mig 513, services/process-referentials) — plus de listes en dur ici.

export const productionEtapesRepository = {

  // ─── Relevé de procédé mesuré sur une étape (mig 422) ───
  // Conforme = |mesure - consigne| <= tolerance, seulement si les deux seuils
  // sont fournis ; sinon NULL (relevé libre, pas de verdict).
  async addReading(etapeId: string, data: ReadingInput, userId: string | null) {
    // Plan pilote, étape 3 : écritures sur plusieurs tables en une seule transaction.
    return withTransaction(async () => {
      const consigne = data.consigne ?? null;
      const tolerance = data.tolerance ?? null;
      const conforme = (consigne !== null && tolerance !== null)
        ? Math.abs(Number(data.mesure) - Number(consigne)) <= Number(tolerance)
        : null;
      const r = await db.query(
        `INSERT INTO production_step_readings
           (etape_id, parametre, consigne, tolerance, mesure, conforme, est_ccp, note, mesure_par)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [etapeId, data.parametre, consigne, tolerance, data.mesure, conforme,
         data.est_ccp ?? false, data.note ?? null, userId]
      );
      // Relevé hors tolérance → action corrective HACCP (source 'process', mig 423),
      // qui bloquera la mise en lot produit tant qu'elle n'est pas validée.
      if (conforme === false) {
        const ctx = await db.query(
          `SELECT pp.store_id, pie.nom AS etape_nom
             FROM production_item_etapes pie
             JOIN production_plan_items ppi ON ppi.id = pie.plan_item_id
             JOIN production_plans pp ON pp.id = ppi.plan_id
            WHERE pie.id = $1`,
          [etapeId]
        );
        const meta = await readingParamMeta(data.parametre);
        const problem = `Relevé de procédé hors tolérance — étape « ${ctx.rows[0]?.etape_nom ?? '?'} » : `
          + `${meta.label} mesuré ${data.mesure} ${meta.unit}, cible ${consigne} ± ${tolerance} ${meta.unit}.`;
        await db.query(
          `INSERT INTO haccp_corrective_actions (store_id, source_kind, source_id, problem, created_by)
           VALUES ($1, 'process', $2, $3, $4)`,
          [ctx.rows[0]?.store_id ?? null, etapeId, problem, userId]
        );
      }
      return r.rows[0];
    });
  },

  // Une étape de type CCP (cuisson / refroidissement) exige au moins un relevé
  // avant d'être clôturée (mig 422). Renvoie { type_etape, readings } pour la garde.
  async ccpGate(etapeId: string) {
    // Étape 7 multi-industries : la règle de clôture est paramétrable (quality.ccp_rule) ;
    // la garde lit aussi les relevés non conformes et la conformité du dernier relevé.
    const r = await db.query(
      `SELECT pie.type_etape, pp.target_role AS workshop, pp.store_id,
              (SELECT COUNT(*)::int FROM production_step_readings sr WHERE sr.etape_id = pie.id) AS readings,
              (SELECT COUNT(*)::int FROM production_step_readings sr WHERE sr.etape_id = pie.id AND sr.conforme IS FALSE) AS non_conformes,
              (SELECT sr.conforme FROM production_step_readings sr WHERE sr.etape_id = pie.id ORDER BY sr.mesure_a DESC NULLS LAST, sr.id DESC LIMIT 1) AS dernier_conforme
         FROM production_item_etapes pie
         LEFT JOIN production_plan_items ppi ON ppi.id = pie.plan_item_id
         LEFT JOIN production_plans pp ON pp.id = ppi.plan_id
        WHERE pie.id = $1`,
      [etapeId]
    );
    return r.rows[0] ?? null;
  },

  async deleteReading(readingId: string) {
    const r = await db.query(`DELETE FROM production_step_readings WHERE id = $1 RETURNING id`, [readingId]);
    return r.rows[0] ?? null;
  },

  // ─── Initialize étapes for a plan item (called at startItems time) ───
  // Copies steps from recipe.etapes or produit_profil_production.etapes_surcharges
  async initializeForItem(planItemId: string, client?: import('pg').PoolClient) {
    const q = client || db;
    // Get the item's product + contenant + profile
    const itemResult = await q.query(
      `SELECT ppi.id, ppi.product_id, ppi.base_recipe_id, ppi.contenant_id,
              r.etapes AS recipe_etapes,
              ppp.etapes_surcharges
       FROM production_plan_items ppi
       -- Recette de l'article : celle du semi-fini (base_recipe_id) ou celle du
       -- PRODUIT (lien direct ou par format). Avant, seule la 1re branche existait :
       -- les etapes de la fiche d'un produit fini n'etaient jamais initialisees.
       LEFT JOIN LATERAL (
         SELECT r0.etapes
           FROM recipes r0
          WHERE r0.id = COALESCE(ppi.alt_recipe_id, ppi.base_recipe_id)
             OR (ppi.alt_recipe_id IS NULL AND ppi.base_recipe_id IS NULL AND ppi.product_id IS NOT NULL
                 AND (r0.product_id = ppi.product_id
                      OR r0.id IN (SELECT rf.recipe_id FROM recipe_formats rf WHERE rf.product_id = ppi.product_id AND rf.is_active)))
          ORDER BY (r0.id = COALESCE(ppi.alt_recipe_id, ppi.base_recipe_id)) DESC NULLS LAST, (r0.product_id = ppi.product_id) DESC NULLS LAST
          LIMIT 1
       ) r ON true
       LEFT JOIN produit_profil_production ppp ON ppp.produit_id = ppi.product_id
       WHERE ppi.id = $1`,
      [planItemId]
    );
    if (!itemResult.rows[0]) return [];

    const item = itemResult.rows[0];

    // M5-02/M5-03 : opérations de la gamme quand l'atelier lit la gamme.
    const fromRouting = await initializeFromRouting(q, planItemId);
    if (fromRouting) return fromRouting;
    // Priority: product profile overrides > recipe steps
    const etapes = (item.etapes_surcharges && item.etapes_surcharges.length > 0)
      ? item.etapes_surcharges
      : (item.recipe_etapes || []);

    if (!etapes || etapes.length === 0) return [];

    // Check if already initialized
    const existing = await q.query(
      `SELECT COUNT(*) as cnt FROM production_item_etapes WHERE plan_item_id = $1`,
      [planItemId]
    );
    if (parseInt(existing.rows[0].cnt) > 0) return [];

    const inserted = [];
    for (const etape of etapes) {
      const result = await q.query(
        `INSERT INTO production_item_etapes
         (plan_item_id, ordre, nom, duree_estimee_min, est_bloquante, timer_auto,
          controle_qualite, checklist_items, est_repetable, nb_repetitions_cible,
          responsable_role, type_etape, temperature_c, humidite_pct,
          nom_ar, checklist_items_ar, ingredient_refs)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING *`,
        [planItemId, etape.ordre, etape.nom, etape.duree_estimee_min || null,
         etape.est_bloquante ?? true, etape.timer_auto ?? false,
         etape.controle_qualite ?? false, JSON.stringify(etape.checklist_items || []),
         etape.est_repetable ?? false, etape.nb_repetitions || 1,
         etape.responsable_role || null,
         // Parametres structures (mig 342) : copies tels quels pour l'ecran de fabrication.
         etape.type || null, etape.temperature_c ?? null, etape.humidite_pct ?? null,
         // Darija (mig 294/295) et ingredients peses par etape (mig 297) : copies
         // tels quels pour que l'ecran d'atelier montre la consigne en darija et
         // les ingredients de l'etape, comme l'assistant de lancement (mig 419).
         etape.nom_ar || null, JSON.stringify(etape.checklist_items_ar || []),
         JSON.stringify(etape.ingredient_refs || [])]
      );
      inserted.push(result.rows[0]);
    }
    return inserted;
  },

  // ─── Get all étapes for a plan item ───
  async findByPlanItem(planItemId: string) {
    const result = await db.query(
      `SELECT pie.*, u1.first_name as started_by_name, u2.first_name as completed_by_name,
              wc.name as work_center_name,
              emp.first_name || ' ' || emp.last_name as assigned_employee_name,
              (SELECT array_agg(DISTINCT i.name ORDER BY i.name)
                 FROM jsonb_array_elements_text(pie.ingredient_refs) ref
                 JOIN ingredients i ON i.id = split_part(ref, '#', 1)::uuid) as step_ingredient_names,
              ${READINGS_AGG} as readings
       FROM production_item_etapes pie
       LEFT JOIN users u1 ON u1.id = pie.started_by
       LEFT JOIN users u2 ON u2.id = pie.completed_by
       LEFT JOIN work_centers wc ON wc.id = pie.work_center_id
       LEFT JOIN employees emp ON emp.id = pie.assigned_employee_id
       WHERE pie.plan_item_id = $1
       ORDER BY pie.ordre ASC`,
      [planItemId]
    );
    return result.rows;
  },

  // ─── Get all étapes for all items in a plan ───
  async findByPlan(planId: string) {
    const result = await db.query(
      `SELECT pie.*, ppi.product_id, ppi.heure_vitrine_cible, COALESCE(p.name, r.name) as product_name,
              u1.first_name as started_by_name, u2.first_name as completed_by_name,
              wc.name as work_center_name,
              emp.first_name || ' ' || emp.last_name as assigned_employee_name,
              (SELECT array_agg(DISTINCT i.name ORDER BY i.name)
                 FROM jsonb_array_elements_text(pie.ingredient_refs) ref
                 JOIN ingredients i ON i.id = split_part(ref, '#', 1)::uuid) as step_ingredient_names,
              ${READINGS_AGG} as readings
       FROM production_item_etapes pie
       JOIN production_plan_items ppi ON ppi.id = pie.plan_item_id
       LEFT JOIN products p ON p.id = ppi.product_id
       LEFT JOIN recipes r ON r.id = ppi.base_recipe_id
       LEFT JOIN users u1 ON u1.id = pie.started_by
       LEFT JOIN users u2 ON u2.id = pie.completed_by
       LEFT JOIN work_centers wc ON wc.id = pie.work_center_id
       LEFT JOIN employees emp ON emp.id = pie.assigned_employee_id
       WHERE ppi.plan_id = $1
       ORDER BY ppi.id, pie.ordre ASC`,
      [planId]
    );
    return result.rows;
  },

  // ─── Update étape status ───
  async updateStatus(
    etapeId: string,
    status: 'in_progress' | 'completed' | 'skipped',
    userId: string,
    data?: { checklist_resultats?: unknown[]; notes?: string; duree_reelle_min?: number; good_qty?: number; scrap_qty?: number }
  ) {
    const now = new Date().toISOString();
    const sets: string[] = ['status = $1', 'updated_at = NOW()'];
    const params: unknown[] = [status];
    let idx = 2;

    if (status === 'in_progress') {
      sets.push(`started_at = $${idx}`, `started_by = $${idx + 1}`);
      params.push(now, userId);
      idx += 2;
    }
    if (status === 'completed' || status === 'skipped') {
      sets.push(`completed_at = $${idx}`, `completed_by = $${idx + 1}`);
      params.push(now, userId);
      idx += 2;

      // Une pause encore ouverte est close ici : son temps rejoint la pause cumulée,
      // puis paused_at est remis à NULL (toutes les RHS lisent l'ancienne ligne).
      sets.push(`pause_accumulee_min = pause_accumulee_min + COALESCE(CEIL(EXTRACT(EPOCH FROM (NOW() - paused_at)) / 60), 0)`);
      sets.push(`paused_at = NULL`);

      // Durée réelle = temps écoulé − pauses (cumulées + pause ouverte), plancher à 0.
      if (status === 'completed') {
        sets.push(`duree_reelle_min = COALESCE($${idx}, GREATEST(EXTRACT(EPOCH FROM (NOW() - started_at)) / 60 - (pause_accumulee_min + COALESCE(CEIL(EXTRACT(EPOCH FROM (NOW() - paused_at)) / 60), 0)), 0))`);
        params.push(data?.duree_reelle_min ?? null);
        idx++;
      }
    }
    if (data?.checklist_resultats) {
      sets.push(`checklist_resultats = $${idx}`);
      params.push(JSON.stringify(data.checklist_resultats));
      idx++;
    }
    if (data?.notes !== undefined) {
      sets.push(`notes = $${idx}`);
      params.push(data.notes);
      idx++;
    }

    if (data?.good_qty !== undefined) { sets.push(`good_qty = $${idx}::numeric`); params.push(data.good_qty); idx++; }
    if (data?.scrap_qty !== undefined) { sets.push(`scrap_qty = $${idx}::numeric`); params.push(data.scrap_qty); idx++; }

    params.push(etapeId);
    const result = await db.query(
      `UPDATE production_item_etapes SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    const row = result.rows[0];
    // M5-02 : opération de gamme terminée par un opérateur affecté → temps de travail
    // (production_temps_travail, coût réel de main-d'œuvre), une seule fois.
    if (row && status === 'completed' && row.routing_operation_id && row.assigned_employee_id && !row.labor_logged && row.started_at) {
      const planId = (await db.query(`SELECT plan_id FROM production_plan_items WHERE id = $1`, [row.plan_item_id])).rows[0]?.plan_id;
      if (planId) {
        const { productionCoutRepository } = await import('./production-cout.repository.js');
        await productionCoutRepository.recordTempsTravail({
          planId, planItemId: row.plan_item_id, employeeId: row.assigned_employee_id,
          debut: new Date(row.started_at).toISOString(), fin: new Date(row.completed_at).toISOString(),
          dureeMinutes: Math.round(Number(row.duree_reelle_min ?? 0)), notes: `Opération ${row.nom}`,
        });
        await db.query(`UPDATE production_item_etapes SET labor_logged = true WHERE id = $1`, [row.id]);
        row.labor_logged = true;
      }
    }
    return row;
  },

  // ─── Increment repetition counter for repeatable steps ───
  async completeRepetition(etapeId: string, userId: string, notes?: string) {
    const result = await db.query(
      `UPDATE production_item_etapes
       SET nb_repetitions_actuelle = nb_repetitions_actuelle + 1,
           status = CASE
             WHEN nb_repetitions_actuelle + 1 >= nb_repetitions_cible THEN 'completed'
             ELSE 'in_progress'
           END,
           completed_at = CASE
             WHEN nb_repetitions_actuelle + 1 >= nb_repetitions_cible THEN NOW()
             ELSE completed_at
           END,
           completed_by = CASE
             WHEN nb_repetitions_actuelle + 1 >= nb_repetitions_cible THEN $2
             ELSE completed_by
           END,
           notes = COALESCE($3, notes),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [etapeId, userId, notes || null]
    );
    return result.rows[0];
  },

  // ─── Check if all blocking steps are completed (guard for produceItems) ───
  async areBlockingStepsComplete(planItemId: string): Promise<boolean> {
    const result = await db.query(
      `SELECT COUNT(*) as cnt
       FROM production_item_etapes
       WHERE plan_item_id = $1
         AND est_bloquante = true
         AND status NOT IN ('completed', 'skipped')`,
      [planItemId]
    );
    return parseInt(result.rows[0].cnt) === 0;
  },

  /** M5-02 : opérations de gamme bloquantes toutes terminées (indépendant de production.steps_blocking). */
  async areBlockingOperationsComplete(planItemId: string): Promise<boolean> {
    const r = await db.query(
      `SELECT COUNT(*)::int AS n FROM production_item_etapes
        WHERE plan_item_id = $1 AND routing_operation_id IS NOT NULL AND est_bloquante AND status NOT IN ('completed', 'skipped')`, [planItemId]);
    return r.rows[0].n === 0;
  },

  // ─── Get progress summary for a plan ───
  async getPlanProgress(planId: string) {
    const result = await db.query(
      `SELECT ppi.id as plan_item_id,
              COALESCE(p.name, r.name) as product_name,
              COUNT(pie.id) as total_etapes,
              COUNT(pie.id) FILTER (WHERE pie.status = 'completed') as completed_etapes,
              COUNT(pie.id) FILTER (WHERE pie.status = 'in_progress') as in_progress_etapes,
              COUNT(pie.id) FILTER (WHERE pie.status = 'pending') as pending_etapes,
              BOOL_AND(CASE WHEN pie.est_bloquante THEN pie.status IN ('completed', 'skipped') ELSE true END) as all_blocking_done
       FROM production_plan_items ppi
       LEFT JOIN production_item_etapes pie ON pie.plan_item_id = ppi.id
       LEFT JOIN products p ON p.id = ppi.product_id
       LEFT JOIN recipes r ON r.id = ppi.base_recipe_id
       WHERE ppi.plan_id = $1 AND ppi.status IN ('pending', 'in_progress')
       GROUP BY ppi.id, p.name, r.name`,
      [planId]
    );
    return result.rows;
  },

  // ─── Set timer_fire_at for auto-timer steps ───
  async setTimer(etapeId: string) {
    const result = await db.query(
      `UPDATE production_item_etapes
       SET timer_fire_at = NOW() + (duree_estimee_min || ' minutes')::interval,
           status = 'in_progress', started_at = COALESCE(started_at, NOW()),
           updated_at = NOW()
       WHERE id = $1 AND timer_auto = true AND duree_estimee_min IS NOT NULL
       RETURNING *`,
      [etapeId]
    );
    return result.rows[0];
  },

  // ─── Exécution d'atelier (mig 399) : poste, opérateur, pause, tableau live ───

  // Affecte le poste et/ou l'opérateur d'une étape (undefined = inchangé).
  async assign(etapeId: string, input: { workCenterId?: string | null; assignedEmployeeId?: string | null }) {
    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    let idx = 1;
    if (input.workCenterId !== undefined) { sets.push(`work_center_id = $${idx}`); params.push(input.workCenterId || null); idx++; }
    if (input.assignedEmployeeId !== undefined) { sets.push(`assigned_employee_id = $${idx}`); params.push(input.assignedEmployeeId || null); idx++; }
    params.push(etapeId);
    const r = await db.query(`UPDATE production_item_etapes SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    return r.rows[0] ?? null;
  },

  // Met en pause une étape en cours (sans pause ouverte).
  async pause(etapeId: string) {
    const r = await db.query(
      `UPDATE production_item_etapes SET paused_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'in_progress' AND paused_at IS NULL RETURNING *`,
      [etapeId]
    );
    return r.rows[0] ?? null;
  },

  // Reprend une étape en pause : la durée de pause rejoint la pause cumulée.
  async resume(etapeId: string) {
    const r = await db.query(
      `UPDATE production_item_etapes
       SET pause_accumulee_min = pause_accumulee_min + COALESCE(CEIL(EXTRACT(EPOCH FROM (NOW() - paused_at)) / 60), 0),
           paused_at = NULL, updated_at = NOW()
       WHERE id = $1 AND paused_at IS NOT NULL RETURNING *`,
      [etapeId]
    );
    return r.rows[0] ?? null;
  },

  // Tableau de bord atelier : étapes en cours sur les plans en cours, par poste.
  async getAtelierLive(storeId?: string | null) {
    const params: unknown[] = [];
    let storeFilter = '';
    if (storeId) { params.push(storeId); storeFilter = ` AND pp.store_id = $1`; }
    const r = await db.query(
      `SELECT pie.id as etape_id, pie.nom, pie.ordre, pie.started_at, pie.paused_at,
              pie.pause_accumulee_min, pie.duree_estimee_min, pie.est_bloquante,
              pie.work_center_id, wc.name as work_center_name,
              pie.assigned_employee_id, emp.first_name || ' ' || emp.last_name as assigned_employee_name,
              u1.first_name as started_by_name,
              ppi.id as plan_item_id, pp.id as plan_id, pp.plan_date,
              COALESCE(p.name, r.name) as product_name
       FROM production_item_etapes pie
       JOIN production_plan_items ppi ON ppi.id = pie.plan_item_id
       JOIN production_plans pp ON pp.id = ppi.plan_id
       LEFT JOIN products p ON p.id = ppi.product_id
       LEFT JOIN recipes r ON r.id = ppi.base_recipe_id
       LEFT JOIN work_centers wc ON wc.id = pie.work_center_id
       LEFT JOIN employees emp ON emp.id = pie.assigned_employee_id
       LEFT JOIN users u1 ON u1.id = pie.started_by
       WHERE pie.status = 'in_progress' AND pp.status = 'in_progress'${storeFilter}
       ORDER BY wc.name NULLS LAST, pie.started_at`,
      params
    );
    return r.rows;
  },

  // ─── Rétro-planning par temps de procédé (mig 432) — épic labo L6 ───
  // À partir de l'heure de mise en vitrine, on remonte étape par étape : la
  // dernière étape finit à l'heure de vitrine, chaque étape commence
  // duree_estimee_min (× répétitions) avant sa fin, et cette heure de début
  // devient la fin de l'étape précédente. Datage absolu en JS (ms) pour éviter
  // toute dérive de fuseau ; l'heure de vitrine est résolue en timestamptz côté
  // SQL (plan_date + heure, fuseau serveur). Détecte les conflits de capacité :
  // deux étapes qui se chevauchent sur le même poste (le four est le goulet).
  async computeRetroPlanning(planId: string, heureVitrineDefaut: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const plan = await client.query(
        'SELECT id, plan_date FROM production_plans WHERE id = $1',
        [planId]
      );
      if (plan.rows.length === 0) {
        const e = new Error('Plan introuvable') as Error & { statusCode?: number };
        e.statusCode = 404;
        throw e;
      }

      // Articles non annulés, avec leur heure de vitrine résolue en timestamptz.
      const items = await client.query(
        `SELECT ppi.id,
                (pp.plan_date + COALESCE(ppi.heure_vitrine_cible, $2::time))::timestamptz AS vitrine_ts
           FROM production_plan_items ppi
           JOIN production_plans pp ON pp.id = ppi.plan_id
          WHERE ppi.plan_id = $1 AND ppi.cancelled_at IS NULL
          ORDER BY ppi.id`,
        [planId, heureVitrineDefaut]
      );

      const scheduled: Array<{
        id: string; plan_item_id: string; ordre: number; nom: string;
        type_etape: string | null; work_center_id: string | null;
        planned_start: string; planned_end: string; duree_min: number;
      }> = [];

      // M5-04 : plages ouvertes des postes dotés d'un calendrier (7 jours avant le plan → lendemain),
      // jours fermés retirés ; même convention de fuseau que l'heure de vitrine (date + heure).
      const windowRows = (await client.query(
        `SELECT c.work_center_id, (d::date + c.start_time)::timestamptz AS s, (d::date + c.end_time)::timestamptz AS e
           FROM work_center_calendar c
          CROSS JOIN generate_series($2::date - 7, $2::date + 1, interval '1 day') d
          WHERE c.work_center_id IN (SELECT DISTINCT pie.work_center_id FROM production_item_etapes pie
                                       JOIN production_plan_items ppi ON ppi.id = pie.plan_item_id
                                      WHERE ppi.plan_id = $1 AND pie.work_center_id IS NOT NULL)
            AND c.iso_weekday = EXTRACT(ISODOW FROM d)
            AND NOT EXISTS (SELECT 1 FROM work_center_closures x
                             WHERE x.closed_on = d::date AND (x.work_center_id = c.work_center_id OR x.work_center_id IS NULL))`,
        [planId, plan.rows[0].plan_date])).rows as { work_center_id: string; s: Date; e: Date }[];
      // Un poste qui a un calendrier mais aucune plage ouverte sur l'horizon (jours fermés) n'a
      // AUCUNE plage : il ne retombe pas dans le cas « sans calendrier ».
      const windowsByCenter = new Map<string, Window[]>((await client.query(
        `SELECT DISTINCT work_center_id FROM work_center_calendar WHERE work_center_id IN
           (SELECT pie.work_center_id FROM production_item_etapes pie JOIN production_plan_items ppi ON ppi.id = pie.plan_item_id
             WHERE ppi.plan_id = $1 AND pie.work_center_id IS NOT NULL)`, [planId])).rows.map(r => [r.work_center_id as string, [] as Window[]]));
      for (const w of windowRows) {
        const arr = windowsByCenter.get(w.work_center_id) ?? [];
        arr.push({ s: new Date(w.s).getTime(), e: new Date(w.e).getTime() });
        windowsByCenter.set(w.work_center_id, arr);
      }
      const outsideCalendar: string[] = [];

      for (const item of items.rows) {
        const steps = await client.query(
          `SELECT id, ordre, nom, type_etape, duree_estimee_min,
                  est_repetable, nb_repetitions_cible, work_center_id
             FROM production_item_etapes
            WHERE plan_item_id = $1
            ORDER BY ordre ASC`,
          [item.id]
        );
        if (steps.rows.length === 0) continue;

        let cursor = new Date(item.vitrine_ts).getTime();
        // On remonte depuis la dernière étape.
        for (let i = steps.rows.length - 1; i >= 0; i--) {
          const s = steps.rows[i];
          const reps = s.est_repetable ? Math.max(1, s.nb_repetitions_cible || 1) : 1;
          const dureeMin = (s.duree_estimee_min || 0) * reps;
          // Poste avec calendrier : l'étape tient dans ses plages ouvertes (M5-04) ; sinon, continu.
          const windows = s.work_center_id ? windowsByCenter.get(s.work_center_id) ?? null : null;
          const placed = placeBackward(cursor, dureeMin, windows);
          if (!placed) outsideCalendar.push(s.nom);
          const endMs = placed?.endMs ?? cursor;
          const startMs = placed?.startMs ?? endMs - dureeMin * 60_000;
          const planned_start = new Date(startMs).toISOString();
          const planned_end = new Date(endMs).toISOString();
          await client.query(
            `UPDATE production_item_etapes
                SET planned_start = $1, planned_end = $2, updated_at = NOW()
              WHERE id = $3`,
            [planned_start, planned_end, s.id]
          );
          scheduled.push({
            id: s.id, plan_item_id: item.id, ordre: s.ordre, nom: s.nom,
            type_etape: s.type_etape, work_center_id: s.work_center_id,
            planned_start, planned_end, duree_min: dureeMin,
          });
          cursor = startMs;
        }
      }

      await client.query('COMMIT');

      // Détection des conflits de capacité : chevauchement sur un même poste.
      const byCenter = new Map<string, typeof scheduled>();
      for (const s of scheduled) {
        if (!s.work_center_id) continue;
        const arr = byCenter.get(s.work_center_id) ?? [];
        arr.push(s);
        byCenter.set(s.work_center_id, arr);
      }
      const conflicts: Array<{
        work_center_id: string; work_center_name: string;
        a: string; b: string; overlap_start: string; overlap_end: string;
      }> = [];
      const centerIds = [...byCenter.keys()];
      const centerNames = new Map<string, string>();
      if (centerIds.length > 0) {
        const nameRes = await db.query(
          'SELECT id, name FROM work_centers WHERE id = ANY($1)', [centerIds]
        );
        for (const row of nameRes.rows) centerNames.set(row.id, row.name);
      }
      for (const [cid, arr] of byCenter) {
        arr.sort((x, y) => x.planned_start.localeCompare(y.planned_start));
        for (let i = 1; i < arr.length; i++) {
          const prev = arr[i - 1];
          const cur = arr[i];
          if (cur.planned_start < prev.planned_end) {
            conflicts.push({
              work_center_id: cid,
              work_center_name: centerNames.get(cid) ?? '—',
              a: prev.nom, b: cur.nom,
              overlap_start: cur.planned_start,
              overlap_end: prev.planned_end < cur.planned_end ? prev.planned_end : cur.planned_end,
            });
          }
        }
      }

      const earliest = scheduled.reduce<string | null>(
        (min, s) => (min === null || s.planned_start < min ? s.planned_start : min), null
      );

      return { scheduled_count: scheduled.length, earliest_start: earliest, conflicts, outside_calendar: outsideCalendar };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

};


/**
 * Opérations de la gamme de la ligne (production_plan_items.routing_id) copiées en étapes
 * d'exécution, avec temps prévus pour la quantité planifiée (fn_routing_op_minutes).
 * Rend null (étapes JSON) si la politique production.steps_source ne vaut pas « gamme »
 * pour le contexte de l'ordre, si la ligne n'a pas de gamme, ou si ses étapes existent déjà.
 */
async function initializeFromRouting(q: { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> }, planItemId: string) {
  const ctx = (await q.query(
    `SELECT ppi.routing_id, ppi.product_id, ppi.planned_quantity, pp.store_id, pp.target_role,
            (SELECT t.code FROM production_order_types t WHERE t.id = pp.order_type_id) AS order_type
       FROM production_plan_items ppi JOIN production_plans pp ON pp.id = ppi.plan_id WHERE ppi.id = $1`, [planItemId])).rows[0];
  if (!ctx?.routing_id) return null;
  const policy = await resolvePolicy('production.steps_source',
    { productId: ctx.product_id, orderType: ctx.order_type, workshop: ctx.target_role, storeId: ctx.store_id });
  if (policy.value.source !== 'gamme') return null;
  const existing = await q.query(`SELECT COUNT(*)::int AS n FROM production_item_etapes WHERE plan_item_id = $1`, [planItemId]);
  if (existing.rows[0].n > 0) return [];
  // M5-01 : gamme figée avec la version de nomenclature de la ligne (opérations de l'instantané,
  // mêmes formules de temps que fn_routing_op_minutes), sinon la gamme vivante.
  const frozen = (await q.query(
    `SELECT b.routing_snapshot FROM production_plan_items ppi JOIN bom_versions b ON b.id = ppi.bom_version_id
      WHERE ppi.id = $1 AND b.routing_id = $2 AND b.routing_snapshot IS NOT NULL`, [planItemId, ctx.routing_id])).rows[0];
  const r = frozen ? await q.query(
    `INSERT INTO production_item_etapes
       (plan_item_id, ordre, nom, nom_ar, duree_estimee_min, est_bloquante, timer_auto, controle_qualite,
        checklist_items, est_repetable, nb_repetitions_cible, temperature_c, work_center_id,
        routing_operation_id, op_type, planned_setup_min, planned_labor_min, planned_machine_min, control_point)
     SELECT $1, (o->>'sequence')::int, o->>'operation_name', o->>'operation_name_ar', CEIL(m.labor_min)::int, (o->>'is_blocking')::boolean, false,
            (o->>'op_type' = 'controle' OR o->>'control_point' IS NOT NULL), '[]'::jsonb, false, 1, (o->>'temperature_c')::numeric,
            (SELECT wc.id FROM work_centers wc WHERE wc.id = (o->>'work_center_id')::uuid),
            (SELECT ro.id FROM routing_operations ro WHERE ro.id = (o->>'operation_id')::uuid),
            o->>'op_type', (o->>'setup_min')::numeric, m.labor_min, m.machine_min, o->>'control_point'
       FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY x(o, ord)
       JOIN LATERAL (SELECT
              ROUND((o->>'setup_min')::numeric + COALESCE((o->>'duration_min')::numeric, 0) + $3::numeric / (o->>'base_quantity')::numeric * (o->>'labor_min_per_unit')::numeric, 2) AS labor_min,
              ROUND((o->>'setup_min')::numeric + $3::numeric / (o->>'base_quantity')::numeric * (o->>'machine_min_per_unit')::numeric, 2) AS machine_min) m ON true
      ORDER BY ord
     RETURNING *`, [planItemId, JSON.stringify(frozen.routing_snapshot), ctx.planned_quantity]) : await q.query(
    `INSERT INTO production_item_etapes
       (plan_item_id, ordre, nom, nom_ar, duree_estimee_min, est_bloquante, timer_auto, controle_qualite,
        checklist_items, est_repetable, nb_repetitions_cible, temperature_c, work_center_id,
        routing_operation_id, op_type, planned_setup_min, planned_labor_min, planned_machine_min, control_point)
     SELECT $1, o.sequence, o.operation_name, o.operation_name_ar, CEIL(m.labor_min)::int, o.is_blocking, false,
            (o.op_type = 'controle' OR o.control_point IS NOT NULL), '[]'::jsonb, false, 1, o.temperature_c, o.work_center_id,
            o.id, o.op_type, o.setup_min, m.labor_min, m.machine_min, o.control_point
       FROM routing_operations o
       JOIN LATERAL fn_routing_op_minutes(o.id, $3::numeric) m ON true
      WHERE o.routing_id = $2
      ORDER BY o.sequence
     RETURNING *`, [planItemId, ctx.routing_id, ctx.planned_quantity]);
  // M7-02 : opération de contrôle → inspection à faire du plan de contrôle (étape « en cours »).
  const { qualityControlPlanRepository } = await import('./quality-control-plan.repository.js');
  for (const row of r.rows) if (row.op_type === 'controle') await qualityControlPlanRepository.generateForOperation(q, row.id);
  return r.rows;
}
