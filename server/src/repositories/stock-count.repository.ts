import { db } from '../config/database.js';
import { nextDocumentNumber } from '../utils/document-number.js';
import { adjustIngredientStock, ingredientStock } from '../services/stock-adjust.js';
import { packagingItemRepository } from './packaging-item.repository.js';

/**
 * Inventaire physique (mig 367). Cycle : comptage → à valider → validé (ou annulé).
 * Voir l'en-tête de la migration pour la règle d'écart (théorique figé au comptage).
 */
type Runner = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, any>[]; rowCount: number | null }> };
const round2 = (n: number) => Math.round(n * 100) / 100;
// Quantités à 4 décimales, comme les lots (sinon un reliquat de 0,0001 subsiste après ajustement).
const round3 = (n: number) => Math.round(n * 10000) / 10000;
const NAME = (a: string) => `NULLIF(concat_ws(' ', ${a}.first_name, ${a}.last_name), '')`;

async function packagingStock(client: Runner, packagingId: string, storeId: string | null): Promise<number> {
  if (!storeId) return 0;
  const r = await client.query(`SELECT stock_quantity FROM packaging_store_stock WHERE packaging_id = $1 AND store_id = $2`, [packagingId, storeId]);
  return parseFloat(r.rows[0]?.stock_quantity ?? '0');
}
async function theoretical(client: Runner, line: { item_kind: string; ingredient_id: string | null; packaging_id: string | null }, storeId: string | null) {
  return line.item_kind === 'ingredient' ? ingredientStock(client, line.ingredient_id!, storeId) : packagingStock(client, line.packaging_id!, storeId);
}

export type CountInput = {
  title?: string | null; scope?: 'full' | 'partial'; itemKinds?: 'ingredient' | 'packaging' | 'both';
  categoryIds?: string[]; blind?: boolean; includeInactive?: boolean; notes?: string | null; countDate?: string;
};

export const stockCountRepository = {
  async list(p: { status?: string; storeId?: string | null; limit: number; offset: number }) {
    const v: unknown[] = []; const cond = ['true'];
    if (p.status) { v.push(p.status); cond.push(`c.status = $${v.length}`); }
    if (p.storeId) { v.push(p.storeId); cond.push(`(c.store_id IS NULL OR c.store_id = $${v.length}::uuid)`); }
    const where = cond.join(' AND ');
    const total = await db.query(`SELECT COUNT(*)::int AS n FROM stock_counts c WHERE ${where}`, v);
    v.push(p.limit, p.offset);
    const r = await db.query(
      `SELECT c.*, ${NAME('u')} AS created_by_name, ${NAME('vu')} AS validated_by_name
         FROM stock_counts c LEFT JOIN users u ON u.id = c.created_by LEFT JOIN users vu ON vu.id = c.validated_by
        WHERE ${where} ORDER BY (c.status IN ('counting', 'review')) DESC, c.created_at DESC LIMIT $${v.length - 1} OFFSET $${v.length}`, v);
    return { rows: r.rows, total: total.rows[0].n };
  },

  async findById(id: string) {
    const r = await db.query(
      `SELECT c.*, ${NAME('u')} AS created_by_name, ${NAME('su')} AS submitted_by_name, ${NAME('vu')} AS validated_by_name
         FROM stock_counts c LEFT JOIN users u ON u.id = c.created_by LEFT JOIN users su ON su.id = c.submitted_by LEFT JOIN users vu ON vu.id = c.validated_by
        WHERE c.id = $1`, [id]);
    if (!r.rows[0]) return null;
    const lines = await db.query(
      `SELECT l.*, ec.name AS category_name, ${NAME('cu')} AS counted_by_name,
              COALESCE(l.unit_cost, CASE WHEN l.item_kind = 'ingredient' THEN i.unit_cost ELSE p.unit_cost END) AS cost
         FROM stock_count_lines l
         LEFT JOIN ingredients i ON i.id = l.ingredient_id
         LEFT JOIN packaging_items p ON p.id = l.packaging_id
         LEFT JOIN expense_categories ec ON ec.id = l.category_id
         LEFT JOIN users cu ON cu.id = l.counted_by
        WHERE l.count_id = $1 ORDER BY l.item_kind, ec.name NULLS LAST, l.item_name`, [id]);
    return { ...r.rows[0], lines: lines.rows };
  },

  /**
   * Ouvre une campagne et liste les articles. Sans « inclure les inactifs » : articles
   * ayant du stock ou un mouvement depuis 180 jours (le référentiel compte des fiches
   * jamais utilisées). Catégories : la branche entière de chaque catégorie choisie.
   */
  async create(input: CountInput, ctx: { userId: string; storeId: string | null }) {
    const kinds = input.itemKinds ?? 'both';
    const cats = input.categoryIds ?? [];
    if (kinds !== 'ingredient' && !ctx.storeId) return { error: 'Les consommables se comptent par magasin : votre compte n\'est rattaché à aucun magasin' };
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const open = await client.query(
        `SELECT number FROM stock_counts WHERE status IN ('counting', 'review') AND store_id IS NOT DISTINCT FROM $1 LIMIT 1`, [ctx.storeId]);
      if (open.rows[0]) { await client.query('ROLLBACK'); return { error: `L'inventaire ${open.rows[0].number} est encore ouvert : validez-le ou annulez-le d'abord` }; }
      const number = await nextDocumentNumber(client, 'stock_count');
      const c = await client.query(
        `INSERT INTO stock_counts (number, store_id, title, scope, item_kinds, category_ids, blind, notes, count_date, created_by)
         VALUES ($1, $2, $3, $4, $5, $6::uuid[], $7, $8, COALESCE($9::date, CURRENT_DATE), $10) RETURNING id`,
        [number, ctx.storeId, input.title?.trim() || null, cats.length ? 'partial' : (input.scope ?? 'full'), kinds, cats,
         input.blind ?? true, input.notes?.trim() || null, input.countDate ?? null, ctx.userId]);
      const id = c.rows[0].id as string;
      // $2 (catégories) et $3 (magasin) toujours référencés : un paramètre inutilisé n'a pas de type pour PostgreSQL.
      const catFilter = (col: string) =>
        `AND (cardinality($2::uuid[]) = 0 OR ${col} IN (WITH RECURSIVE t AS (SELECT id FROM expense_categories WHERE id = ANY($2::uuid[])
                           UNION SELECT e.id FROM expense_categories e JOIN t ON e.parent_id = t.id) SELECT id FROM t))`;
      const storeLots = 'l.store_id IS NOT DISTINCT FROM $3::uuid';
      if (kinds !== 'packaging') {
        await client.query(
          `INSERT INTO stock_count_lines (count_id, item_kind, ingredient_id, item_name, unit, category_id, container_size, theoretical_at_start)
           SELECT $1, 'ingredient', i.id, i.name, i.unit, i.category_id, i.container_size,
                  COALESCE((SELECT SUM(l.economat_quantity + l.pesage_quantity) FROM ingredient_lots l
                             WHERE l.ingredient_id = i.id AND ${storeLots} AND l.status = 'active'), 0)
             FROM ingredients i
            WHERE COALESCE(i.non_stocke, false) = false ${catFilter('i.category_id')}
              AND ($4::boolean OR EXISTS (SELECT 1 FROM ingredient_lots l WHERE l.ingredient_id = i.id AND ${storeLots} AND l.status = 'active' AND l.economat_quantity + l.pesage_quantity <> 0)
                   OR EXISTS (SELECT 1 FROM inventory_transactions t WHERE t.ingredient_id = i.id AND t.created_at > now() - interval '180 days'))`,
          [id, cats, ctx.storeId, !!input.includeInactive]);
      }
      if (kinds !== 'ingredient') {
        await client.query(
          `INSERT INTO stock_count_lines (count_id, item_kind, packaging_id, item_name, unit, category_id, theoretical_at_start)
           SELECT $1, 'packaging', p.id, p.name || COALESCE(' · ' || NULLIF(p.format, ''), ''), p.unit, p.category_id, COALESCE(s.stock_quantity, 0)
             FROM packaging_items p
             LEFT JOIN packaging_store_stock s ON s.packaging_id = p.id AND s.store_id = $3::uuid
            WHERE p.is_active ${catFilter('p.category_id')}
              AND ($4::boolean OR COALESCE(s.stock_quantity, 0) <> 0
                   OR EXISTS (SELECT 1 FROM packaging_stock_transactions t WHERE t.packaging_id = p.id AND t.created_at > now() - interval '180 days'))`,
          [id, cats, ctx.storeId, !!input.includeInactive]);
      }
      const n = await client.query(`UPDATE stock_counts SET lines_total = (SELECT COUNT(*) FROM stock_count_lines WHERE count_id = $1) WHERE id = $1 RETURNING lines_total`, [id]);
      if (!n.rows[0].lines_total) { await client.query('ROLLBACK'); return { error: 'Aucun article à compter avec ces critères' }; }
      await client.query('COMMIT');
      return { data: await this.findById(id) };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  /** Saisie (ou correction) d'un comptage : fige le théorique à cet instant. null = efface le comptage. */
  async count(countId: string, lineId: string, p: { countedQty: number | null; note?: string | null; userId: string }) {
    const c = (await db.query(`SELECT status, store_id FROM stock_counts WHERE id = $1`, [countId])).rows[0];
    if (!c) return { error: 'not_found' as const };
    if (c.status !== 'counting') return { error: 'Le comptage est clos : rouvrez-le pour corriger' };
    const line = (await db.query(`SELECT * FROM stock_count_lines WHERE id = $1 AND count_id = $2`, [lineId, countId])).rows[0];
    if (!line) return { error: 'Ligne introuvable' };
    if (p.countedQty === null) {
      await db.query(`UPDATE stock_count_lines SET counted_qty = NULL, theoretical_at_count = NULL, counted_by = NULL, counted_at = NULL, note = $2 WHERE id = $1`, [lineId, p.note ?? line.note]);
    } else {
      const th = await theoretical(db as unknown as Runner, line, c.store_id);
      await db.query(
        `UPDATE stock_count_lines SET counted_qty = $2, theoretical_at_count = $3, counted_by = $4, counted_at = now(), note = COALESCE($5, note) WHERE id = $1`,
        [lineId, round3(p.countedQty), round3(th), p.userId, p.note ?? null]);
    }
    await db.query(`UPDATE stock_counts SET lines_counted = (SELECT COUNT(*) FROM stock_count_lines WHERE count_id = $1 AND counted_qty IS NOT NULL) WHERE id = $1`, [countId]);
    return { data: (await db.query(`SELECT * FROM stock_count_lines WHERE id = $1`, [lineId])).rows[0] };
  },

  /** Article trouvé hors liste (ou oublié par le filtre). */
  async addLine(countId: string, p: { ingredientId?: string | null; packagingId?: string | null }) {
    const c = (await db.query(`SELECT status, store_id FROM stock_counts WHERE id = $1`, [countId])).rows[0];
    if (!c) return { error: 'not_found' as const };
    if (c.status !== 'counting') return { error: 'Le comptage est clos' };
    const r = p.ingredientId
      ? await db.query(
          `INSERT INTO stock_count_lines (count_id, item_kind, ingredient_id, item_name, unit, category_id, container_size, theoretical_at_start)
           SELECT $1, 'ingredient', i.id, i.name, i.unit, i.category_id, i.container_size, $3 FROM ingredients i WHERE i.id = $2
           ON CONFLICT DO NOTHING RETURNING id`,
          [countId, p.ingredientId, await ingredientStock(db as unknown as Runner, p.ingredientId, c.store_id)])
      : await db.query(
          `INSERT INTO stock_count_lines (count_id, item_kind, packaging_id, item_name, unit, category_id, theoretical_at_start)
           SELECT $1, 'packaging', p.id, p.name || COALESCE(' · ' || NULLIF(p.format, ''), ''), p.unit, p.category_id, $3 FROM packaging_items p WHERE p.id = $2
           ON CONFLICT DO NOTHING RETURNING id`,
          [countId, p.packagingId, await packagingStock(db as unknown as Runner, p.packagingId!, c.store_id)]);
    if (!r.rows[0]) return { error: 'Article déjà dans l\'inventaire ou introuvable' };
    await db.query(`UPDATE stock_counts SET lines_total = (SELECT COUNT(*) FROM stock_count_lines WHERE count_id = $1) WHERE id = $1`, [countId]);
    return { data: r.rows[0] };
  },

  async setStatus(id: string, action: 'submit' | 'reopen' | 'cancel', userId: string) {
    const c = (await db.query(`SELECT * FROM stock_counts WHERE id = $1`, [id])).rows[0];
    if (!c) return { error: 'not_found' as const };
    const from: Record<typeof action, string[]> = { submit: ['counting'], reopen: ['review'], cancel: ['counting', 'review'] };
    if (!from[action].includes(c.status)) return { error: 'Action impossible dans cet état' };
    if (action === 'submit' && c.lines_counted === 0) return { error: 'Aucun article compté' };
    await db.query(
      `UPDATE stock_counts SET status = $2::text,
              submitted_by = CASE WHEN $2::text = 'review' THEN $3::uuid ELSE submitted_by END,
              submitted_at = CASE WHEN $2::text = 'review' THEN now() ELSE submitted_at END,
              cancelled_at = CASE WHEN $2::text = 'cancelled' THEN now() ELSE cancelled_at END
        WHERE id = $1`,
      [id, { submit: 'review', reopen: 'counting', cancel: 'cancelled' }[action], userId]);
    if (action === 'submit') {
      await db.query(
        `INSERT INTO notifications (target_role, store_id, type, title, message, reference_type, reference_id, created_by)
         VALUES ('manager', $1, 'stock_count_to_validate', $2, $3, 'stock_count', $4, $5)`,
        [c.store_id, `Inventaire à valider · ${c.number}`, `${c.lines_counted}/${c.lines_total} article(s) compté(s) : vérifier les écarts puis valider.`, id, userId]);
    }
    return { data: await this.findById(id) };
  },

  /**
   * Validation : applique les écarts (compté − théorique figé au comptage) en une seule
   * transaction. Une baisse qui dépasse le stock courant (sorti entre-temps) est plafonnée
   * au stock disponible ; la ligne garde la quantité réellement appliquée.
   */
  async validate(id: string, p: { zeroUncounted: boolean; userId: string }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const c = (await client.query(`SELECT * FROM stock_counts WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!c) { await client.query('ROLLBACK'); return { error: 'not_found' as const }; }
      if (!['review', 'counting'].includes(c.status)) { await client.query('ROLLBACK'); return { error: 'Inventaire déjà validé ou annulé' }; }
      const lines = (await client.query(
        `SELECT l.*, CASE WHEN l.item_kind = 'ingredient' THEN i.unit_cost ELSE p.unit_cost END AS cost
           FROM stock_count_lines l LEFT JOIN ingredients i ON i.id = l.ingredient_id LEFT JOIN packaging_items p ON p.id = l.packaging_id
          WHERE l.count_id = $1 FOR UPDATE OF l`, [id])).rows;
      let gain = 0; let loss = 0;
      for (const l of lines) {
        let counted = l.counted_qty != null ? Number(l.counted_qty) : null;
        let base = l.theoretical_at_count != null ? Number(l.theoretical_at_count) : null;
        if (counted == null) {
          if (!p.zeroUncounted) continue;
          counted = 0; base = await theoretical(client, l, c.store_id);
          await client.query(`UPDATE stock_count_lines SET counted_qty = 0, theoretical_at_count = $2, counted_by = $3, counted_at = now(), note = COALESCE(note, 'Non compté : mis à zéro') WHERE id = $1`,
            [l.id, round3(base), p.userId]);
        }
        let delta = round3(counted - base!);
        const cost = Number(l.cost ?? 0);
        if (Math.abs(delta) > 0.00005) {
          const note = `Inventaire ${c.number} : ${l.item_name} ${round3(base!)} → ${round3(counted)}${l.note ? ` (${l.note})` : ''}`;
          if (l.item_kind === 'ingredient') {
            const now = await ingredientStock(client, l.ingredient_id, c.store_id);
            if (delta < 0 && now + delta < 0) delta = round3(-now);
            if (Math.abs(delta) > 0.00005) {
              const r = await adjustIngredientStock(client, { ingredientId: l.ingredient_id, storeId: c.store_id, qty: delta, type: 'inventory', note, userId: p.userId,
                lotNote: `Inventaire ${c.number} : excédent constaté` });
              if (!r.ok) throw new Error(`Ajustement impossible pour ${l.item_name}`);
            }
          } else {
            const now = await packagingStock(client, l.packaging_id, c.store_id);
            if (delta < 0 && now + delta < 0) delta = round3(-now);
            if (Math.abs(delta) > 0.00005) {
              await packagingItemRepository.adjustStock(client as never, { packagingId: l.packaging_id, storeId: c.store_id, change: delta, type: 'adjustment',
                referenceId: id, referenceType: 'stock_count', unitCost: cost || null, note, performedBy: p.userId });
            }
          }
        }
        const value = round2(delta * cost);
        if (value > 0) gain += value; else loss += value;
        await client.query(`UPDATE stock_count_lines SET applied_qty = $2, applied_value = $3, unit_cost = $4 WHERE id = $1`, [l.id, delta, value, cost]);
      }
      await client.query(
        `UPDATE stock_counts SET status = 'validated', validated_by = $2, validated_at = now(), zero_uncounted = $3,
                gain_value = $4, loss_value = $5, gap_value = $6,
                lines_counted = (SELECT COUNT(*) FROM stock_count_lines WHERE count_id = $1 AND counted_qty IS NOT NULL)
          WHERE id = $1`,
        [id, p.userId, p.zeroUncounted, round2(gain), round2(loss), round2(gain + loss)]);
      await client.query('COMMIT');
      return { data: await this.findById(id) };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },
};
