import { db } from '../config/database.js';
import { resolvePolicy } from '../services/policies.js';

/**
 * Libération des lots (M7-04). Un lot de produit fini « en attente de libération »
 * (pending_release) n'est ni vendable, ni livrable, ni transférable ; une matière en
 * quarantaine (mig 461) n'est pas consommable. Libération manuelle par un rôle qualité,
 * ou automatique quand toutes les inspections du lot sont réalisées et conformes
 * (politique quality.auto_release).
 */
type Q = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export const lotReleaseRepository = {
  /** Quantité d'un produit retenue en attente de libération dans un magasin. */
  async pendingQty(q: Q, productId: string, storeId: string): Promise<number> {
    const r = await q.query(
      `SELECT COALESCE(SUM(backroom_qty + vitrine_qty), 0)::float8 AS q FROM product_lots
        WHERE product_id = $1 AND store_id = $2 AND status = 'pending_release'`, [productId, storeId]);
    return Number(r.rows[0]?.q ?? 0);
  },

  /** Libération manuelle d'un lot de produit fini (rôle qualité), motif tracé. */
  async releaseProductLot(lotId: string, userId: string, note: string | null) {
    const r = await db.query(
      `UPDATE product_lots SET status = 'active', released_by = $2, released_at = NOW(), release_note = $3, updated_at = NOW()
        WHERE id = $1 AND status = 'pending_release' RETURNING id, lot_number, status`, [lotId, userId, note]);
    if (!r.rows[0]) throw Object.assign(new Error('Lot introuvable ou déjà libéré'), { statusCode: 409 });
    return r.rows[0];
  },

  /** Lots en attente de libération (écran qualité). */
  async listPending(storeId: string | null) {
    return (await db.query(
      `SELECT pl.id, pl.lot_number, pl.produced_at, (pl.backroom_qty + pl.vitrine_qty)::float8 AS quantity, p.name AS product_name,
              (SELECT COUNT(*)::int FROM quality_inspections qi WHERE qi.product_lot_id = pl.id AND qi.status = 'a_faire') AS pending_inspections,
              (SELECT COUNT(*)::int FROM quality_inspections qi WHERE qi.product_lot_id = pl.id AND qi.status = 'faite' AND NOT qi.conformity) AS failed_inspections
         FROM product_lots pl JOIN products p ON p.id = pl.product_id
        WHERE pl.status = 'pending_release' AND ($1::uuid IS NULL OR pl.store_id = $1)
        ORDER BY pl.produced_at`, [storeId])).rows;
  },

  /**
   * Après une inspection : libère automatiquement le lot (produit fini ou matière en
   * quarantaine) si plus aucune inspection n'est à faire et que toutes sont conformes ;
   * une matière non conforme est bloquée (comme le contrôle de réception, mig 428).
   */
  async afterInspection(inspectionId: string) {
    const i = (await db.query(
      `SELECT product_lot_id, ingredient_lot_id, store_id, conformity FROM quality_inspections WHERE id = $1`, [inspectionId])).rows[0];
    if (!i) return;
    const auto = (await resolvePolicy<{ enabled?: boolean }>('quality.auto_release', { storeId: i.store_id ?? null })).value.enabled !== false;
    const allClear = async (col: 'product_lot_id' | 'ingredient_lot_id', id: string) => (await db.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'a_faire')::int AS todo, COUNT(*) FILTER (WHERE status = 'faite' AND NOT conformity)::int AS ko
         FROM quality_inspections WHERE ${col} = $1`, [id])).rows[0];
    if (i.product_lot_id && auto) {
      const s = await allClear('product_lot_id', i.product_lot_id);
      if (s.todo === 0 && s.ko === 0) {
        await db.query(
          `UPDATE product_lots SET status = 'active', released_at = NOW(), release_note = 'Libération automatique : inspections conformes', updated_at = NOW()
            WHERE id = $1 AND status = 'pending_release'`, [i.product_lot_id]);
      }
    }
    if (i.ingredient_lot_id) {
      if (!i.conformity) {
        await db.query(`UPDATE ingredient_lots SET status = 'blocked' WHERE id = $1 AND status IN ('active', 'quarantine')`, [i.ingredient_lot_id]);
      } else if (auto) {
        const s = await allClear('ingredient_lot_id', i.ingredient_lot_id);
        if (s.todo === 0 && s.ko === 0) await db.query(`UPDATE ingredient_lots SET status = 'active' WHERE id = $1 AND status = 'quarantine'`, [i.ingredient_lot_id]);
      }
    }
  },
};
