/**
 * Déclaration de production (G0-24) : la production des articles, les pertes constatées
 * à la déclaration et les saisies de la fenêtre de lancement (observations, bases
 * partagées) passent dans UNE transaction. Avant, les pertes étaient créées par des
 * appels séparés après la déclaration : une perte refusée laissait une production
 * enregistrée sans sa perte, et les observations n'étaient envoyées nulle part.
 */
import { db, withTransaction } from '../config/database.js';
import { productionRepository } from '../repositories/production.repository.js';
import { declareProductLoss } from './product-loss.service.js';

type ProduceItem = Parameters<typeof productionRepository.produceItems>[1][number];

export interface ProductionDeclaration {
  items: ProduceItem[];
  producedAt?: string;
  observations?: string;
  bases?: { subRecipeId: string; actualQuantity: number; alreadyProduced?: boolean }[];
  losses?: { planItemId: string; quantity: number; reason: string; reasonNote?: string }[];
}

export async function declareProduction(planId: string, input: ProductionDeclaration, actor: { userId: string; storeId?: string }) {
  return withTransaction(async () => {
    const result = await productionRepository.produceItems(planId, input.items, actor.userId, actor.storeId, input.producedAt);

    for (const loss of input.losses ?? []) {
      const item = (await db.query(
        `SELECT product_id FROM production_plan_items WHERE id = $1 AND plan_id = $2`, [loss.planItemId, planId])).rows[0];
      if (!item) throw Object.assign(new Error('Perte : article du plan introuvable'), { statusCode: 404 });
      // Une base (sans produit du catalogue) n'a pas de fiche de perte produit : signalée, non bloquante.
      if (!item.product_id) { result.warnings.push('Perte non enregistrée : cet article est une base, sans produit du catalogue'); continue; }
      await declareProductLoss({
        productId: item.product_id, quantity: loss.quantity, lossType: 'production', reason: loss.reason,
        reasonNote: loss.reasonNote ?? null, productionPlanId: planId, planItemId: loss.planItemId, atDeclaration: true,
      }, actor);
    }

    const note = input.observations?.trim() || null;
    const bases = input.bases ?? [];
    if (note || bases.length > 0) {
      await db.query(
        `INSERT INTO production_plan_observations (plan_id, note, bases, created_by) VALUES ($1, $2, $3::jsonb, $4)`,
        [planId, note, JSON.stringify(bases), actor.userId]);
    }
    return result;
  });
}

/** Observations et bases saisies aux déclarations d'un plan, de la plus récente à la plus ancienne. */
export async function listPlanObservations(planId: string) {
  const r = await db.query(
    `SELECT o.id, o.note, o.bases, o.created_at, NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS created_by_name
       FROM production_plan_observations o LEFT JOIN users u ON u.id = o.created_by
      WHERE o.plan_id = $1 ORDER BY o.created_at DESC`, [planId]);
  return r.rows;
}
