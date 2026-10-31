import { db } from '../config/database.js';

/**
 * Fiche article × fournisseur (mig 404) : la table pivot qui remplace la colonne
 * mono-valuée `ingredients.supplier_id` (mig 136). Un article a 1..N fournisseurs,
 * un seul « préféré » (garanti par un index unique partiel).
 */
const BASE_SELECT = `
  SELECT si.id, si.supplier_id, si.purchasable_kind, si.purchasable_id,
         si.supplier_reference, si.container_type_id, si.qty_per_container,
         si.lead_time_days, si.moq, si.is_preferred, si.is_blocked, si.notes,
         si.created_at, si.updated_at,
         s.name AS supplier_name, s.is_active AS supplier_active,
         ct.label AS container_label,
         COALESCE(i.name, p.name) AS purchasable_name,
         COALESCE(i.unit, p.unit) AS purchasable_unit,
         cp.price AS current_price, cp.price_unit AS current_price_unit,
         cp.valid_from AS current_price_from, cp.source AS current_price_source
  FROM supplier_items si
  JOIN suppliers s ON s.id = si.supplier_id
  LEFT JOIN ref_entries ct ON ct.id = si.container_type_id
  LEFT JOIN ingredients i ON si.purchasable_kind = 'ingredient' AND i.id = si.purchasable_id
  LEFT JOIN packaging_items p ON si.purchasable_kind = 'packaging' AND p.id = si.purchasable_id
  LEFT JOIN v_current_supplier_price cp ON cp.supplier_item_id = si.id`;

type CreateInput = {
  supplierId: string; kind: 'ingredient' | 'packaging'; purchasableId: string;
  supplierReference?: string | null; containerTypeId?: string | null;
  qtyPerContainer?: number | null; leadTimeDays?: number | null; moq?: number | null;
  isBlocked?: boolean; notes?: string | null;
};
type UpdateInput = Partial<Omit<CreateInput, 'supplierId' | 'kind' | 'purchasableId'>>;

export const supplierItemRepository = {
  async getById(id: string) {
    const r = await db.query(`${BASE_SELECT} WHERE si.id = $1`, [id]);
    return r.rows[0] ?? null;
  },

  // Fournisseurs d'un article (préféré d'abord, bloqués à la fin).
  async listByPurchasable(kind: string, purchasableId: string) {
    const r = await db.query(
      `${BASE_SELECT} WHERE si.purchasable_kind = $1 AND si.purchasable_id = $2 AND si.archived_at IS NULL
       ORDER BY si.is_blocked ASC, si.is_preferred DESC, s.name`, [kind, purchasableId]);
    return r.rows;
  },

  // Catalogue d'un fournisseur.
  async listBySupplier(supplierId: string) {
    const r = await db.query(
      `${BASE_SELECT} WHERE si.supplier_id = $1 AND si.archived_at IS NULL
       ORDER BY si.purchasable_kind, purchasable_name`, [supplierId]);
    return r.rows;
  },

  async create(data: CreateInput, userId: string | null, storeId: string | null) {
    const ins = await db.query(
      `INSERT INTO supplier_items
         (supplier_id, purchasable_kind, purchasable_id, supplier_reference, container_type_id,
          qty_per_container, lead_time_days, moq, is_blocked, notes, store_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [data.supplierId, data.kind, data.purchasableId, data.supplierReference ?? null,
       data.containerTypeId ?? null, data.qtyPerContainer ?? null, data.leadTimeDays ?? null,
       data.moq ?? null, data.isBlocked ?? false, data.notes ?? null, storeId, userId]);
    // Premier fournisseur (non bloqué) de l'article → préféré par défaut.
    const n = (await db.query(
      `SELECT count(*)::int n FROM supplier_items WHERE purchasable_kind=$1 AND purchasable_id=$2 AND archived_at IS NULL`,
      [data.kind, data.purchasableId])).rows[0].n;
    if (n === 1 && !data.isBlocked) await db.query(`UPDATE supplier_items SET is_preferred=true WHERE id=$1`, [ins.rows[0].id]);
    return this.getById(ins.rows[0].id);
  },

  async update(id: string, data: UpdateInput) {
    const cur = (await db.query(`SELECT * FROM supplier_items WHERE id=$1`, [id])).rows[0];
    if (!cur) return null;
    const keep = <T>(v: T | undefined, d: T): T => v !== undefined ? v : d;
    const isBlocked = keep(data.isBlocked, cur.is_blocked);
    await db.query(
      `UPDATE supplier_items SET supplier_reference=$2, container_type_id=$3, qty_per_container=$4,
         lead_time_days=$5, moq=$6, is_blocked=$7, notes=$8,
         is_preferred = CASE WHEN $7 THEN false ELSE is_preferred END,
         updated_at=NOW() WHERE id=$1`,
      [id, keep(data.supplierReference, cur.supplier_reference), keep(data.containerTypeId, cur.container_type_id),
       keep(data.qtyPerContainer, cur.qty_per_container), keep(data.leadTimeDays, cur.lead_time_days),
       keep(data.moq, cur.moq), isBlocked, keep(data.notes, cur.notes)]);
    return this.getById(id);
  },

  // Bascule atomique de préférence : démote l'ancien, promeut celui-ci.
  async setPreferred(id: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const cur = (await client.query(`SELECT purchasable_kind, purchasable_id, is_blocked FROM supplier_items WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!cur) { await client.query('ROLLBACK'); return null; }
      if (cur.is_blocked) { await client.query('ROLLBACK'); return { error: 'blocked' as const }; }
      await client.query(`UPDATE supplier_items SET is_preferred=false, updated_at=NOW() WHERE purchasable_kind=$1 AND purchasable_id=$2 AND is_preferred`, [cur.purchasable_kind, cur.purchasable_id]);
      await client.query(`UPDATE supplier_items SET is_preferred=true, updated_at=NOW() WHERE id=$1`, [id]);
      await client.query('COMMIT');
      return this.getById(id);
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  },

  // Archive ; si c'était le préféré, promeut le plus ancien non bloqué restant.
  async archive(id: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const cur = (await client.query(`SELECT purchasable_kind, purchasable_id, is_preferred FROM supplier_items WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!cur) { await client.query('ROLLBACK'); return null; }
      await client.query(`UPDATE supplier_items SET archived_at=NOW(), is_preferred=false, updated_at=NOW() WHERE id=$1`, [id]);
      if (cur.is_preferred) {
        await client.query(
          `UPDATE supplier_items SET is_preferred=true WHERE id = (
             SELECT id FROM supplier_items
             WHERE purchasable_kind=$1 AND purchasable_id=$2 AND archived_at IS NULL AND NOT is_blocked
             ORDER BY created_at LIMIT 1)`, [cur.purchasable_kind, cur.purchasable_id]);
      }
      await client.query('COMMIT');
      return { ok: true as const };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  },

  // ── Prix datés (mig 405) — Achats lot prix P2 ──
  // Ajoute un prix : ferme le précédent « en vigueur » puis ouvre le nouveau.
  async addPrice(supplierItemId: string, input: { price: number; currency?: string | null; priceUnit?: string | null; validFrom?: string | null }, userId: string | null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      if (!(await client.query(`SELECT 1 FROM supplier_items WHERE id=$1`, [supplierItemId])).rowCount) { await client.query('ROLLBACK'); return null; }
      await client.query(
        `UPDATE supplier_item_prices SET valid_to = GREATEST(valid_from, COALESCE($2::date, CURRENT_DATE))
         WHERE supplier_item_id=$1 AND valid_to IS NULL`, [supplierItemId, input.validFrom ?? null]);
      await client.query(
        `INSERT INTO supplier_item_prices (supplier_item_id, price, currency, price_unit, valid_from, source, created_by)
         VALUES ($1,$2,COALESCE($3,'MAD'),COALESCE($4,'base'),COALESCE($5::date,CURRENT_DATE),'manual',$6)`,
        [supplierItemId, input.price, input.currency ?? null, input.priceUnit ?? null, input.validFrom ?? null, userId]);
      await client.query('COMMIT');
      return this.getById(supplierItemId);
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  },

  async listPrices(supplierItemId: string) {
    return (await db.query(
      `SELECT sip.id, sip.price, sip.currency, sip.price_unit, sip.valid_from, sip.valid_to, sip.source, sip.created_at,
              u.first_name AS created_by_name
       FROM supplier_item_prices sip LEFT JOIN users u ON u.id = sip.created_by
       WHERE sip.supplier_item_id=$1 ORDER BY sip.valid_from DESC, sip.created_at DESC`, [supplierItemId])).rows;
  },
};

/**
 * Alimentation AUTOMATIQUE du prix fournisseur à la réception (mig 405).
 * Trouve (ou crée) la fiche article × fournisseur et ajoute un prix daté
 * `source='reception'` si le prix a changé. À appeler dans la transaction de
 * réception avec le `client` courant. Best-effort : ne fait rien si données
 * incomplètes ; n'empile pas de doublon si le prix est inchangé.
 */
export async function recordSupplierPriceAtReception(
  client: import('pg').PoolClient,
  args: { supplierId?: string | null; kind: 'ingredient' | 'packaging'; purchasableId?: string | null; priceBase?: number | null; sourceDocId?: string | null; userId?: string | null; storeId?: string | null }
) {
  const { supplierId, kind, purchasableId } = args;
  const priceBase = args.priceBase ?? 0;
  if (!supplierId || !purchasableId || !(priceBase > 0)) return;
  let si = (await client.query(
    `SELECT id FROM supplier_items WHERE supplier_id=$1 AND purchasable_kind=$2 AND purchasable_id=$3 AND archived_at IS NULL`,
    [supplierId, kind, purchasableId])).rows[0];
  if (!si) {
    const n = (await client.query(
      `SELECT count(*)::int n FROM supplier_items WHERE purchasable_kind=$1 AND purchasable_id=$2 AND archived_at IS NULL`,
      [kind, purchasableId])).rows[0].n;
    si = (await client.query(
      `INSERT INTO supplier_items (supplier_id, purchasable_kind, purchasable_id, is_preferred, store_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [supplierId, kind, purchasableId, n === 0, args.storeId ?? null, args.userId ?? null])).rows[0];
  }
  const rounded = Math.round(priceBase * 10000) / 10000;
  const cur = (await client.query(`SELECT price FROM supplier_item_prices WHERE supplier_item_id=$1 AND valid_to IS NULL`, [si.id])).rows[0];
  if (cur && Math.abs(Number(cur.price) - rounded) < 0.0001) return; // inchangé
  await client.query(`UPDATE supplier_item_prices SET valid_to = CURRENT_DATE WHERE supplier_item_id=$1 AND valid_to IS NULL`, [si.id]);
  await client.query(
    `INSERT INTO supplier_item_prices (supplier_item_id, price, price_unit, valid_from, source, source_doc_id, created_by)
     VALUES ($1,$2,'base',CURRENT_DATE,'reception',$3,$4)`,
    [si.id, rounded, args.sourceDocId ?? null, args.userId ?? null]);
}
