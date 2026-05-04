import { db } from '../config/database.js';

export const productionEtapesRepository = {

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
       LEFT JOIN recipes r ON r.id = ppi.base_recipe_id
       LEFT JOIN produit_profil_production ppp ON ppp.produit_id = ppi.product_id
       WHERE ppi.id = $1`,
      [planItemId]
    );
    if (!itemResult.rows[0]) return [];

    const item = itemResult.rows[0];
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
          responsable_role)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [planItemId, etape.ordre, etape.nom, etape.duree_estimee_min || null,
         etape.est_bloquante ?? true, etape.timer_auto ?? false,
         etape.controle_qualite ?? false, JSON.stringify(etape.checklist_items || []),
         etape.est_repetable ?? false, etape.nb_repetitions || 1,
         etape.responsable_role || null]
      );
      inserted.push(result.rows[0]);
    }
    return inserted;
  },

  // ─── Get all étapes for a plan item ───
  async findByPlanItem(planItemId: string) {
    const result = await db.query(
      `SELECT pie.*, u1.first_name as started_by_name, u2.first_name as completed_by_name
       FROM production_item_etapes pie
       LEFT JOIN users u1 ON u1.id = pie.started_by
       LEFT JOIN users u2 ON u2.id = pie.completed_by
       WHERE pie.plan_item_id = $1
       ORDER BY pie.ordre ASC`,
      [planItemId]
    );
    return result.rows;
  },

  // ─── Get all étapes for all items in a plan ───
  async findByPlan(planId: string) {
    const result = await db.query(
      `SELECT pie.*, ppi.product_id, COALESCE(p.name, r.name) as product_name,
              u1.first_name as started_by_name, u2.first_name as completed_by_name
       FROM production_item_etapes pie
       JOIN production_plan_items ppi ON ppi.id = pie.plan_item_id
       LEFT JOIN products p ON p.id = ppi.product_id
       LEFT JOIN recipes r ON r.id = ppi.base_recipe_id
       LEFT JOIN users u1 ON u1.id = pie.started_by
       LEFT JOIN users u2 ON u2.id = pie.completed_by
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
    data?: { checklist_resultats?: unknown[]; notes?: string; duree_reelle_min?: number }
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

      // Auto-calculate duration if started_at exists
      if (status === 'completed') {
        sets.push(`duree_reelle_min = COALESCE($${idx}, EXTRACT(EPOCH FROM (NOW() - started_at)) / 60)`);
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

    params.push(etapeId);
    const result = await db.query(
      `UPDATE production_item_etapes SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    return result.rows[0];
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

  // ─── Get pending timers (for node-cron polling) ───
  async getPendingTimers() {
    const result = await db.query(
      `SELECT pie.*, ppi.plan_id,
              COALESCE(p.name, r.name) as product_name
       FROM production_item_etapes pie
       JOIN production_plan_items ppi ON ppi.id = pie.plan_item_id
       LEFT JOIN products p ON p.id = ppi.product_id
       LEFT JOIN recipes r ON r.id = ppi.base_recipe_id
       WHERE pie.timer_fire_at IS NOT NULL
         AND pie.timer_fire_at <= NOW()
         AND pie.status = 'in_progress'
       ORDER BY pie.timer_fire_at ASC`
    );
    return result.rows;
  },
};
