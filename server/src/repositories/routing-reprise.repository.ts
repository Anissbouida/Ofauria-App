import { db, withTransaction } from '../config/database.js';

/**
 * Reprise des étapes JSON des fiches (recipes.etapes) en gammes (M5-03).
 * Chaque étape devient une opération : libellé (français et arabe), durée, bloquante,
 * température, type (contrôle si l'étape a un contrôle qualité), consignes = liste de
 * vérification. Une fiche qui a déjà une gamme active est laissée telle quelle.
 *
 * `report()` ne fait que lire : étapes sans durée, sans poste (le JSON n'en porte pas),
 * fiches déjà dotées d'une gamme. `apply()` crée les gammes, en une transaction.
 * Les étapes JSON restent en base ; l'atelier ne lit la gamme qu'une fois la politique
 * production.steps_source passée à « gamme » pour lui.
 */
type JsonStep = {
  nom?: string; nom_ar?: string | null; ordre?: number; duree_estimee_min?: number | null; est_bloquante?: boolean;
  controle_qualite?: boolean; temperature_c?: number | null; checklist_items?: string[]; checklist_items_ar?: string[];
};
export type RepriseLine = {
  recipe_id: string; recipe_name: string; steps: number; steps_without_duration: number; steps_without_work_center: number;
  existing_routing_id: string | null; action: 'creer' | 'deja_une_gamme';
};

async function candidates(recipeIds?: string[]) {
  return (await db.query(
    `SELECT r.id, r.name, r.yield_quantity, r.etapes,
            (SELECT ro.id FROM routings ro WHERE ro.recipe_id = r.id AND ro.is_active LIMIT 1) AS existing_routing_id
       FROM recipes r
      WHERE r.archived_at IS NULL AND jsonb_typeof(r.etapes) = 'array' AND jsonb_array_length(r.etapes) > 0
        AND ($1::uuid[] IS NULL OR r.id = ANY($1::uuid[]))
      ORDER BY r.name`, [recipeIds ?? null])).rows as { id: string; name: string; yield_quantity: string | null; etapes: JsonStep[]; existing_routing_id: string | null }[];
}

const instructionsOf = (s: JsonStep) => {
  const fr = (s.checklist_items ?? []).filter(Boolean).join('\n');
  const ar = (s.checklist_items_ar ?? []).filter(Boolean).join('\n');
  return [fr, ar].filter(Boolean).join('\n—\n') || null;
};

export const routingRepriseRepository = {
  /**
   * M5-03 (reste) — les étapes JSON d'une fiche sont-elles figées ? Oui quand la fiche a une
   * gamme active avec opérations ET que tous les ateliers qui l'ont produite ces 90 derniers
   * jours lisent la gamme (production.steps_source = « gamme ») ; sans production récente, le
   * réglage de la société décide. Un atelier encore sur les étapes de la fiche les garde modifiables.
   */
  async jsonStepsStatus(recipeId: string): Promise<{ frozen: boolean; reason: string | null; workshops: string[] }> {
    const head = (await db.query(
      `SELECT fn_recipe_routing($1) AS routing_id,
              ARRAY(SELECT DISTINCT COALESCE(pp.target_role, '') FROM production_plan_items ppi
                      JOIN production_plans pp ON pp.id = ppi.plan_id
                     WHERE pp.plan_date >= CURRENT_DATE - 90 AND ppi.status <> 'cancelled'
                       AND (ppi.alt_recipe_id = $1 OR ppi.base_recipe_id = $1
                            OR (ppi.alt_recipe_id IS NULL AND ppi.base_recipe_id IS NULL
                                AND ppi.product_id = (SELECT r.product_id FROM recipes r WHERE r.id = $1)))) AS workshops`,
      [recipeId])).rows[0] as { routing_id: string | null; workshops: string[] } | undefined;
    if (!head?.routing_id) return { frozen: false, reason: null, workshops: [] };
    const { resolvePolicy } = await import('../services/policies.js');
    const sources = head.workshops.length ? head.workshops : [''];
    for (const w of sources) {
      const p = await resolvePolicy('production.steps_source', { workshop: w || null });
      if ((p.value as { source?: string }).source !== 'gamme') return { frozen: false, reason: null, workshops: head.workshops };
    }
    return {
      frozen: true, workshops: head.workshops,
      reason: 'Les ateliers exécutent la gamme de cette fiche : modifiez les opérations de la gamme (les étapes ci-dessous ne sont plus lues).',
    };
  },

  async report(recipeIds?: string[]): Promise<RepriseLine[]> {
    return (await candidates(recipeIds)).map(r => ({
      recipe_id: r.id, recipe_name: r.name, steps: r.etapes.length,
      steps_without_duration: r.etapes.filter(s => !(Number(s.duree_estimee_min) > 0)).length,
      steps_without_work_center: r.etapes.length,
      existing_routing_id: r.existing_routing_id,
      action: r.existing_routing_id ? 'deja_une_gamme' : 'creer',
    }));
  },

  async apply(userId: string | null, recipeIds?: string[]) {
    return withTransaction(async () => {
      const created: { recipe_id: string; routing_id: string; operations: number }[] = [];
      for (const r of await candidates(recipeIds)) {
        if (r.existing_routing_id) continue;
        const routingId = (await db.query(
          `INSERT INTO routings (name, recipe_id, batch_size, notes, created_by)
           VALUES ($1, $2, $3::numeric, 'Reprise des étapes de la fiche (M5-03)', $4) RETURNING id`,
          [`Gamme ${r.name}`.slice(0, 160), r.id, Number(r.yield_quantity) > 0 ? Number(r.yield_quantity) : 1, userId])).rows[0].id as string;
        const steps = [...r.etapes].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
        let seq = 0;
        for (const s of steps) {
          if (!s.nom?.trim()) continue;
          seq += 1;
          await db.query(
            `INSERT INTO routing_operations (routing_id, sequence, operation_name, operation_name_ar, duration_min, op_type,
                is_blocking, temperature_c, instructions)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::numeric, $9)`,
            [routingId, seq, s.nom.trim().slice(0, 160), s.nom_ar?.slice(0, 160) || null,
             Math.max(0, Math.round(Number(s.duree_estimee_min) || 0)), s.controle_qualite ? 'controle' : 'execution',
             !!s.est_bloquante, s.temperature_c ?? null, instructionsOf(s)]);
        }
        created.push({ recipe_id: r.id, routing_id: routingId, operations: seq });
      }
      return created;
    });
  },
};
