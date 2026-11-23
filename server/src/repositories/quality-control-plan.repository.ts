import { db } from '../config/database.js';

/**
 * Plan de contrôle par article (M7-02). Les lignes décrivent quoi contrôler (caractéristique,
 * bornes), quand (réception, en cours, final) et à quelle fréquence. Les fonctions generate*
 * créent les inspections « à faire » (quality_inspections.status = 'a_faire') avec leurs
 * points dans pending_items ; elles s'exécutent dans la transaction de l'appelant.
 */
type Q = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };
export type Stage = 'reception' | 'en_cours' | 'final' | 'avant_transfert' | 'avant_livraison';
export type PlanLineInput = {
  productId?: string | null; productCategoryId?: number | null; ingredientId?: string | null; ingredientCategoryId?: string | null;
  stage: Stage; characteristic: string; charType: 'mesure' | 'oui_non' | 'visuel';
  minValue?: number | null; maxValue?: number | null; unit?: string | null;
  frequency: 'chaque_lot' | 'un_sur_n' | 'par_quantite'; frequencyN?: number | null; sampleSize?: number; isBlocking?: boolean;
};
type Line = { id: string; characteristic: string; char_type: string; min_value: string | null; max_value: string | null; unit: string | null;
  frequency: string; frequency_n: number | null; sample_size: number; is_blocking: boolean };

/** Lignes actives pour un article (ou sa famille) / une matière (ou sa famille), à une étape. */
async function linesFor(q: Q, stage: Stage, target: { productId?: string | null; ingredientId?: string | null }): Promise<Line[]> {
  if (target.productId) {
    return (await q.query(
      `SELECT l.* FROM quality_control_plan_lines l, products p
        WHERE p.id = $1 AND l.is_active AND l.stage = $2
          AND (l.product_id = p.id OR (l.product_id IS NULL AND l.product_category_id = p.category_id))
        ORDER BY l.created_at`, [target.productId, stage])).rows;
  }
  if (target.ingredientId) {
    return (await q.query(
      `SELECT l.* FROM quality_control_plan_lines l, ingredients i
        WHERE i.id = $1 AND l.is_active AND l.stage = $2
          AND (l.ingredient_id = i.id OR (l.ingredient_id IS NULL AND l.ingredient_category_id = i.category_id))
        ORDER BY l.created_at`, [target.ingredientId, stage])).rows;
  }
  return [];
}

/** Lignes dues pour cette occurrence (fréquence) ; incrémente les compteurs « 1 sur N ». */
async function dueLines(q: Q, lines: Line[]): Promise<Line[]> {
  const due: Line[] = [];
  for (const l of lines) {
    if (l.frequency !== 'un_sur_n') { due.push(l); continue; }
    const seen = (await q.query(
      `INSERT INTO quality_control_counters (line_id, seen) VALUES ($1, 1)
       ON CONFLICT (line_id) DO UPDATE SET seen = quality_control_counters.seen + 1 RETURNING seen`, [l.id])).rows[0].seen as number;
    if ((seen - 1) % (l.frequency_n ?? 1) === 0) due.push(l);
  }
  return due;
}

const toItems = (lines: Line[], qty?: number | null) => lines.map(l => {
  const sample = l.frequency === 'par_quantite' && qty ? Math.ceil(qty / (l.frequency_n ?? 1)) * l.sample_size : l.sample_size;
  return {
    label: `${l.characteristic}${sample > 1 ? ` (échantillon ${sample})` : ''}${l.is_blocking ? ' — bloquant' : ''}`,
    kind: l.char_type === 'mesure' ? 'measure' : 'ok',
    unit: l.unit ?? undefined, min: l.min_value != null ? Number(l.min_value) : null, max: l.max_value != null ? Number(l.max_value) : null,
    blocking: l.is_blocking,
  };
});

async function createPending(q: Q, stage: Stage, title: string, items: ReturnType<typeof toItems>, links: Record<string, string | null>, storeId: string | null) {
  const cols = Object.keys(links);
  const r = await q.query(
    `INSERT INTO quality_inspections (template_name, title, results, conformity, store_id, status, control_stage, pending_items, ${cols.join(', ')})
     VALUES ('Plan de contrôle', $1, '[]'::jsonb, false, $2, 'a_faire', $3, $4::jsonb, ${cols.map((_, i) => `$${5 + i}`).join(', ')}) RETURNING id`,
    [title.slice(0, 200), storeId, stage, JSON.stringify(items), ...cols.map(c => links[c])]);
  return r.rows[0].id as string;
}

export const qualityControlPlanRepository = {
  async list(filter: { productId?: string | null; ingredientId?: string | null } = {}) {
    return (await db.query(
      `SELECT l.*, p.name AS product_name, i.name AS ingredient_name, c.name AS category_name
         FROM quality_control_plan_lines l
         LEFT JOIN products p ON p.id = l.product_id LEFT JOIN ingredients i ON i.id = l.ingredient_id
         LEFT JOIN categories c ON c.id = l.product_category_id
        WHERE l.is_active AND ($1::uuid IS NULL OR l.product_id = $1) AND ($2::uuid IS NULL OR l.ingredient_id = $2)
        ORDER BY l.stage, l.created_at`, [filter.productId ?? null, filter.ingredientId ?? null])).rows;
  },
  async create(d: PlanLineInput, userId: string | null) {
    return (await db.query(
      `INSERT INTO quality_control_plan_lines (product_id, product_category_id, ingredient_id, ingredient_category_id, stage, characteristic,
          char_type, min_value, max_value, unit, frequency, frequency_n, sample_size, is_blocking, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::numeric, $9::numeric, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [d.productId ?? null, d.productCategoryId ?? null, d.ingredientId ?? null, d.ingredientCategoryId ?? null, d.stage, d.characteristic.trim(),
       d.charType, d.minValue ?? null, d.maxValue ?? null, d.unit ?? null, d.frequency, d.frequencyN ?? null, d.sampleSize ?? 1, d.isBlocking ?? false, userId])).rows[0];
  },
  async deactivate(id: string) {
    return (await db.query(`UPDATE quality_control_plan_lines SET is_active = false WHERE id = $1`, [id])).rowCount! > 0;
  },

  /** Contrôle final : un lot de produit fini par sortie déclarée → une inspection à faire. */
  async generateFinal(q: Q, planId: string, planItemIds: string[]) {
    if (!planItemIds.length) return [];
    const lots = (await q.query(
      `SELECT pl.id, pl.lot_number, pl.product_id, pl.store_id, pl.plan_item_id, pl.quantity_total::float8 AS qty, p.name
         FROM product_lots pl JOIN products p ON p.id = pl.product_id
        WHERE pl.production_plan_id = $1 AND pl.plan_item_id = ANY($2::uuid[])
          AND NOT EXISTS (SELECT 1 FROM quality_inspections qi WHERE qi.product_lot_id = pl.id AND qi.control_stage = 'final')`,
      [planId, planItemIds])).rows;
    const created: string[] = [];
    for (const lot of lots) {
      const due = await dueLines(q, await linesFor(q, 'final', { productId: lot.product_id }));
      if (!due.length) continue;
      created.push(await createPending(q, 'final', `Contrôle final — ${lot.name} (lot ${lot.lot_number ?? '—'})`, toItems(due, lot.qty),
        { plan_id: planId, plan_item_id: lot.plan_item_id, product_lot_id: lot.id }, lot.store_id));
      // M7-04 : lot retenu jusqu'à libération (ni vendable, ni livrable, ni transférable).
      await q.query(`UPDATE product_lots SET status = 'pending_release' WHERE id = $1 AND status = 'active'`, [lot.id]);
    }
    return created;
  },

  /**
   * Avant transfert (étape 7) : un contrôle par article produit à transférer, s'il a des lignes
   * « avant_transfert » et pas encore de contrôle à cette étape. S'exécute HORS de la
   * transaction du transfert : un transfert refusé garde le contrôle à faire.
   */
  async generateBeforeTransfer(q: Q, planId: string, planItemIds: string[]) {
    if (!planItemIds.length) return [];
    const items = (await q.query(
      `SELECT ppi.id, ppi.product_id, ppi.actual_quantity::float8 AS qty, p.name, pp.store_id
         FROM production_plan_items ppi JOIN products p ON p.id = ppi.product_id JOIN production_plans pp ON pp.id = ppi.plan_id
        WHERE ppi.plan_id = $1 AND ppi.id = ANY($2::uuid[])
          AND NOT EXISTS (SELECT 1 FROM quality_inspections qi WHERE qi.plan_item_id = ppi.id AND qi.control_stage = 'avant_transfert')`,
      [planId, planItemIds])).rows;
    const created: string[] = [];
    for (const it of items) {
      const due = await dueLines(q, await linesFor(q, 'avant_transfert', { productId: it.product_id }));
      if (!due.length) continue;
      created.push(await createPending(q, 'avant_transfert', `Contrôle avant transfert — ${it.name}`, toItems(due, it.qty),
        { plan_id: planId, plan_item_id: it.id }, it.store_id));
    }
    return created;
  },

  /** Avant livraison (étape 7) : un contrôle par article du bon de livraison ayant des lignes « avant_livraison ». */
  async generateBeforeDelivery(q: Q, deliveryNoteId: string) {
    const items = (await q.query(
      `SELECT di.product_id, sum(di.quantity)::float8 AS qty, p.name, dn.store_id, dn.number
         FROM delivery_note_items di JOIN delivery_notes dn ON dn.id = di.delivery_note_id JOIN products p ON p.id = di.product_id
        WHERE di.delivery_note_id = $1
          -- Générés une seule fois par bon : tous ses articles ensemble.
          AND NOT EXISTS (SELECT 1 FROM quality_inspections qi WHERE qi.delivery_note_id = dn.id AND qi.control_stage = 'avant_livraison')
        GROUP BY di.product_id, p.name, dn.store_id, dn.number`, [deliveryNoteId])).rows;
    const created: string[] = [];
    for (const it of items) {
      const due = await dueLines(q, await linesFor(q, 'avant_livraison', { productId: it.product_id }));
      if (!due.length) continue;
      created.push(await createPending(q, 'avant_livraison', `Contrôle avant livraison — ${it.name} (BL ${it.number})`, toItems(due, it.qty),
        { delivery_note_id: deliveryNoteId }, it.store_id));
    }
    return created;
  },

  /**
   * Contrôles bloquants non soldés à une étape (à faire, ou faits non conformes) — garde du
   * transfert et de l'expédition. Un contrôle sans point bloquant n'arrête rien.
   */
  async blockingOpen(q: Q, stage: 'avant_transfert' | 'avant_livraison', link: { planId?: string; planItemIds?: string[]; deliveryNoteId?: string }) {
    const r = (await q.query(
      `SELECT count(*)::int AS n FROM quality_inspections qi
        WHERE qi.control_stage = $1
          AND (($2::uuid IS NOT NULL AND qi.plan_id = $2 AND ($3::uuid[] IS NULL OR qi.plan_item_id = ANY($3::uuid[])))
               OR ($4::uuid IS NOT NULL AND qi.delivery_note_id = $4))
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(qi.pending_items, '[]'::jsonb)) e WHERE (e->>'blocking')::boolean)
          AND (qi.status = 'a_faire' OR (qi.status = 'faite' AND qi.conformity IS FALSE))`,
      [stage, link.planId ?? null, link.planItemIds ?? null, link.deliveryNoteId ?? null])).rows[0];
    return r.n as number;
  },

  /** Réception : chaque lot de matière créé par le bon de réception → inspection à faire. */
  async generateForReception(q: Q, receptionVoucherId: string) {
    const lots = (await q.query(
      `SELECT il.id, il.ingredient_id, il.store_id, il.quantity_remaining::float8 AS qty, il.supplier_lot_number, i.name
         FROM ingredient_lots il
         JOIN reception_voucher_items rvi ON rvi.id = il.reception_voucher_item_id
         JOIN ingredients i ON i.id = il.ingredient_id
        WHERE rvi.reception_voucher_id = $1`, [receptionVoucherId])).rows;
    const created: string[] = [];
    for (const lot of lots) {
      const due = await dueLines(q, await linesFor(q, 'reception', { ingredientId: lot.ingredient_id }));
      if (!due.length) continue;
      created.push(await createPending(q, 'reception', `Contrôle réception — ${lot.name}${lot.supplier_lot_number ? ` (lot ${lot.supplier_lot_number})` : ''}`,
        toItems(due, lot.qty), { ingredient_lot_id: lot.id, reception_voucher_id: receptionVoucherId }, lot.store_id));
    }
    return created;
  },

  /** Opération de contrôle d'un ordre (M5-02) : inspection à faire rattachée à l'opération. */
  async generateForOperation(q: Q, etapeId: string) {
    const e = (await q.query(
      `SELECT pie.id, pie.nom, pie.plan_item_id, ppi.plan_id, ppi.product_id, ppi.planned_quantity::float8 AS qty, pp.store_id
         FROM production_item_etapes pie JOIN production_plan_items ppi ON ppi.id = pie.plan_item_id
         JOIN production_plans pp ON pp.id = ppi.plan_id WHERE pie.id = $1`, [etapeId])).rows[0];
    if (!e?.product_id) return null;
    const due = await dueLines(q, await linesFor(q, 'en_cours', { productId: e.product_id }));
    if (!due.length) return null;
    return createPending(q, 'en_cours', `Contrôle en cours — ${e.nom}`, toItems(due, e.qty),
      { plan_id: e.plan_id, plan_item_id: e.plan_item_id, etape_id: e.id }, e.store_id);
  },
};
