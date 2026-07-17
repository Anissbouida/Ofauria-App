import { db } from '../config/database.js';

/**
 * Module Rapprochement journalier (ISOLE, TEMPORAIRE).
 *
 * Bilan produit par jour : vendu + invendu - recu = ecart (mig 247 ;
 * negatif = manque, repli sur l'appro quand le recu n'est pas saisi).
 *  - approvisionne : saisi manuellement (ce qui part au magasin) ;
 *  - recu : confirme par la caissiere a la reception ;
 *  - vendu : importe du CSV Loyverse (item-sales-summary) ;
 *  - invendu : compte en fin de journee.
 *
 * Etanche : ne lit ni n'ecrit aucune table du systeme reel. Tout est pilote
 * par le SKU/nom Loyverse. Les colonnes ecart_qty / ecart_value sont calculees
 * par la base (colonnes generees).
 */

export type ReconLineInput = {
  sku?: string | null;
  productName: string;
  category?: string | null;
  approQty?: number;
  recuQty?: number;
  venduQty?: number;
  invenduQty?: number;
  unitPrice?: number;
};

/** Cle de rapprochement : SKU s'il existe, sinon nom normalise. */
function productKey(sku?: string | null, name?: string | null): string {
  const s = (sku || '').trim();
  if (s) return s.toUpperCase();
  return (name || '').trim().toUpperCase();
}

/** Upsert d'un produit dans le catalogue (utilisable dans une transaction). */
async function registerProduct(
  q: { query: (text: string, vals?: unknown[]) => Promise<any> },
  p: { sku?: string | null; productName: string; category?: string | null; unitPrice?: number }
) {
  const key = productKey(p.sku, p.productName);
  if (!key) return;
  await q.query(
    `INSERT INTO recon_products (product_key, sku, product_name, category, unit_price)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (product_key) DO UPDATE SET
       sku          = COALESCE(NULLIF(EXCLUDED.sku, ''), recon_products.sku),
       product_name = EXCLUDED.product_name,
       category     = COALESCE(EXCLUDED.category, recon_products.category),
       unit_price   = CASE WHEN EXCLUDED.unit_price > 0 THEN EXCLUDED.unit_price ELSE recon_products.unit_price END,
       updated_at   = NOW()`,
    [key, p.sku ?? null, p.productName.trim(), p.category ?? null, p.unitPrice ?? 0]
  );
}

export const reconciliationRepository = {
  // ─── Journees ──────────────────────────────────────────────────────────

  async listDays(params: { from?: string; to?: string; storeId?: string | null }) {
    const conds: string[] = [];
    const vals: unknown[] = [];
    if (params.from) { vals.push(params.from); conds.push(`d.business_date >= $${vals.length}`); }
    if (params.to) { vals.push(params.to); conds.push(`d.business_date <= $${vals.length}`); }
    if (params.storeId) { vals.push(params.storeId); conds.push(`d.store_id = $${vals.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const result = await db.query(`
      SELECT d.*,
             COALESCE(l.line_count, 0)      AS line_count,
             COALESCE(l.total_ecart_value, 0) AS total_ecart_value
      FROM recon_days d
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS line_count, SUM(ecart_value) AS total_ecart_value
        FROM recon_lines WHERE recon_day_id = d.id
      ) l ON true
      ${where}
      ORDER BY d.business_date DESC
    `, vals);
    return result.rows;
  },

  async getDayById(id: string) {
    const d = await db.query(`SELECT * FROM recon_days WHERE id = $1`, [id]);
    if (!d.rows[0]) return null;
    const lines = await db.query(
      `SELECT * FROM recon_lines WHERE recon_day_id = $1 ORDER BY category NULLS LAST, product_name`,
      [id]
    );
    return { ...d.rows[0], lines: lines.rows };
  },

  /** Trouve la journee (date + magasin) ou la cree si absente. Idempotent. */
  async openDay(params: { date: string; storeId?: string | null; userId?: string | null }) {
    const existing = await db.query(
      `SELECT * FROM recon_days
       WHERE business_date = $1 AND store_id IS NOT DISTINCT FROM $2`,
      [params.date, params.storeId ?? null]
    );
    if (existing.rows[0]) return this.getDayById(existing.rows[0].id);

    const inserted = await db.query(
      `INSERT INTO recon_days (business_date, store_id, created_by)
       VALUES ($1, $2, $3) RETURNING *`,
      [params.date, params.storeId ?? null, params.userId ?? null]
    );
    return this.getDayById(inserted.rows[0].id);
  },

  async setStatus(id: string, status: 'open' | 'closed') {
    const r = await db.query(
      `UPDATE recon_days SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, status]
    );
    return r.rows[0] || null;
  },

  async assertOpen(dayId: string): Promise<void> {
    const r = await db.query(`SELECT status FROM recon_days WHERE id = $1`, [dayId]);
    if (!r.rows[0]) throw Object.assign(new Error('Journee introuvable'), { statusCode: 404 });
    if (r.rows[0].status === 'closed') {
      throw Object.assign(new Error('Journee cloturee : saisie verrouillee'), { statusCode: 409 });
    }
  },

  // ─── Lignes ────────────────────────────────────────────────────────────

  /** Cree ou met a jour une ligne (saisie manuelle appro/invendu/prix). */
  async upsertLine(dayId: string, input: ReconLineInput) {
    await this.assertOpen(dayId);
    const key = productKey(input.sku, input.productName);
    const r = await db.query(
      `INSERT INTO recon_lines
         (recon_day_id, product_key, sku, product_name, category, appro_qty, recu_qty, vendu_qty, invendu_qty, unit_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (recon_day_id, product_key) DO UPDATE SET
         sku         = COALESCE(NULLIF(EXCLUDED.sku, ''), recon_lines.sku),
         product_name = EXCLUDED.product_name,
         category    = COALESCE(EXCLUDED.category, recon_lines.category),
         appro_qty   = EXCLUDED.appro_qty,
         recu_qty    = EXCLUDED.recu_qty,
         invendu_qty = EXCLUDED.invendu_qty,
         unit_price  = EXCLUDED.unit_price,
         updated_at  = NOW()
       RETURNING *`,
      [
        dayId, key, input.sku ?? null, input.productName, input.category ?? null,
        input.approQty ?? 0, input.recuQty ?? 0, input.venduQty ?? 0, input.invenduQty ?? 0, input.unitPrice ?? 0,
      ]
    );
    await registerProduct(db, input);
    return r.rows[0];
  },

  /** Mise a jour partielle d'une ligne existante (edition inline). */
  async updateLine(lineId: string, patch: { approQty?: number; recuQty?: number; venduQty?: number; invenduQty?: number; unitPrice?: number }) {
    const line = await db.query(`SELECT recon_day_id FROM recon_lines WHERE id = $1`, [lineId]);
    if (!line.rows[0]) throw Object.assign(new Error('Ligne introuvable'), { statusCode: 404 });
    await this.assertOpen(line.rows[0].recon_day_id);

    const sets: string[] = [];
    const vals: unknown[] = [];
    const add = (col: string, v: number | undefined) => {
      if (v !== undefined) { vals.push(v); sets.push(`${col} = $${vals.length}`); }
    };
    add('appro_qty', patch.approQty);
    add('recu_qty', patch.recuQty);
    add('vendu_qty', patch.venduQty);
    add('invendu_qty', patch.invenduQty);
    add('unit_price', patch.unitPrice);
    if (!sets.length) {
      const cur = await db.query(`SELECT * FROM recon_lines WHERE id = $1`, [lineId]);
      return cur.rows[0];
    }
    vals.push(lineId);
    const r = await db.query(
      `UPDATE recon_lines SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    return r.rows[0];
  },

  async deleteLine(lineId: string) {
    const line = await db.query(`SELECT recon_day_id FROM recon_lines WHERE id = $1`, [lineId]);
    if (!line.rows[0]) return;
    await this.assertOpen(line.rows[0].recon_day_id);
    await db.query(`DELETE FROM recon_lines WHERE id = $1`, [lineId]);
  },

  /**
   * Saisie en masse de l'approvisionne (collage Excel / import CSV).
   * Ne touche QUE appro_qty (et unit_price si fourni) : vendu_qty / invendu_qty
   * deja saisis sont preserves. Upsert par product_key, atomique.
   */
  async bulkUpsertAppro(
    dayId: string,
    rows: { sku?: string | null; productName: string; category?: string | null; approQty: number; unitPrice?: number }[]
  ) {
    await this.assertOpen(dayId);
    const client = await db.getClient();
    let upserted = 0;
    try {
      await client.query('BEGIN');
      for (const r of rows) {
        if (!r.productName?.trim()) continue;
        const key = productKey(r.sku, r.productName);
        await client.query(
          `INSERT INTO recon_lines
             (recon_day_id, product_key, sku, product_name, category, appro_qty, unit_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (recon_day_id, product_key) DO UPDATE SET
             sku          = COALESCE(NULLIF(EXCLUDED.sku, ''), recon_lines.sku),
             product_name = EXCLUDED.product_name,
             category     = COALESCE(EXCLUDED.category, recon_lines.category),
             appro_qty    = EXCLUDED.appro_qty,
             unit_price   = CASE WHEN EXCLUDED.unit_price > 0 THEN EXCLUDED.unit_price ELSE recon_lines.unit_price END,
             updated_at   = NOW()`,
          [dayId, key, r.sku ?? null, r.productName.trim(), r.category ?? null, r.approQty ?? 0, r.unitPrice ?? 0]
        );
        await registerProduct(client, r);
        upserted++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return { upserted };
  },

  /** Nombre de lignes du jour ayant une vente (import Loyverse ou saisie). */
  async countSales(dayId: string): Promise<number> {
    const r = await db.query(
      `SELECT COUNT(*)::int AS n FROM recon_lines
       WHERE recon_day_id = $1 AND (source_vendu = 'loyverse_import' OR vendu_qty > 0)`,
      [dayId]
    );
    return r.rows[0]?.n ?? 0;
  },

  // ─── Import Loyverse (ventes) ──────────────────────────────────────────

  /**
   * Injecte les ventes du CSV Loyverse dans les lignes du jour.
   * Reimport idempotent : vendu_qty et unit_price sont ECRASES (set, pas
   * cumul). appro_qty / invendu_qty deja saisis sont preserves. Les produits
   * absents de la grille sont crees (rien n'est perdu).
   */
  async importSales(
    dayId: string,
    items: { sku?: string | null; productName: string; category?: string | null; quantity: number; unitPrice: number; netSales?: number }[]
  ) {
    await this.assertOpen(dayId);
    const client = await db.getClient();
    let upserted = 0;
    try {
      await client.query('BEGIN');
      for (const it of items) {
        if (!it.productName || !(it.quantity > 0)) continue;
        const key = productKey(it.sku, it.productName);
        await client.query(
          `INSERT INTO recon_lines
             (recon_day_id, product_key, sku, product_name, category, vendu_qty, vendu_amount, unit_price, source_vendu)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'loyverse_import')
           ON CONFLICT (recon_day_id, product_key) DO UPDATE SET
             sku          = COALESCE(NULLIF(EXCLUDED.sku, ''), recon_lines.sku),
             product_name = EXCLUDED.product_name,
             category     = COALESCE(recon_lines.category, EXCLUDED.category),
             vendu_qty    = EXCLUDED.vendu_qty,
             vendu_amount = EXCLUDED.vendu_amount,
             unit_price   = CASE WHEN EXCLUDED.unit_price > 0 THEN EXCLUDED.unit_price ELSE recon_lines.unit_price END,
             source_vendu = 'loyverse_import',
             updated_at   = NOW()`,
          [dayId, key, it.sku ?? null, it.productName, it.category ?? null, it.quantity, it.netSales ?? 0, it.unitPrice ?? 0]
        );
        await registerProduct(client, it);
        upserted++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return { upserted };
  },

  // ─── Rapport de periode ────────────────────────────────────────────────

  /**
   * Suggestion fiche de besoin : catalogue complet + vendu du meme jour de semaine
   * J-7 (fallback J-14). Permet de pre-remplir l'appro du jour.
   */
  async suggest({ date, storeId }: { date: string; storeId: string | null }) {
    const { rows: refRows } = await db.query(`
      SELECT id, business_date::text AS business_date
      FROM recon_days
      WHERE business_date IN ($1::date - 7, $1::date - 14)
        AND store_id IS NOT DISTINCT FROM $2
      ORDER BY business_date DESC
      LIMIT 1
    `, [date, storeId]);

    const refDayId = refRows[0]?.id ?? null;
    const referenceDate = refRows[0]?.business_date ?? null;

    // Catalogue = recon_products (editable dans l'onglet Catalogue). Les imports
    // y enregistrent automatiquement les nouveaux produits : un produit supprime
    // ne revient que s'il reapparait dans un import Loyverse.
    const { rows } = await db.query(`
      SELECT
        p.product_key, p.product_name, p.sku, p.category, p.unit_price,
        COALESCE(ref.vendu_qty, 0)   AS suggested_qty,
        ref.appro_qty                AS ref_appro,
        ref.vendu_qty                AS ref_vendu,
        ref.invendu_qty              AS ref_invendu
      FROM recon_products p
      LEFT JOIN recon_lines ref
        ON ref.product_key = p.product_key AND ref.recon_day_id = $1
      ORDER BY p.category NULLS LAST, p.product_name
    `, [refDayId]);

    return { referenceDate, products: rows };
  },

  // ─── Créneaux d'approvisionnement ────────────────────────────────────

  async listSlots() {
    const { rows } = await db.query(
      `SELECT * FROM recon_supply_slots ORDER BY category, sort_order, slot_number`
    );
    return rows;
  },

  async upsertSlot(data: {
    id?: string; category: string; slotNumber: number;
    label: string; targetTime?: string | null; defaultPct?: number; sortOrder?: number;
  }) {
    if (data.id) {
      const { rows } = await db.query(
        `UPDATE recon_supply_slots
         SET category = $2, slot_number = $3, label = $4, target_time = $5,
             default_pct = $6, sort_order = $7, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [data.id, data.category, data.slotNumber, data.label,
         data.targetTime ?? null, data.defaultPct ?? 0, data.sortOrder ?? 0]
      );
      return rows[0] || null;
    }
    const { rows } = await db.query(
      `INSERT INTO recon_supply_slots (category, slot_number, label, target_time, default_pct, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (category, slot_number) DO UPDATE SET
         label = EXCLUDED.label, target_time = EXCLUDED.target_time,
         default_pct = EXCLUDED.default_pct, sort_order = EXCLUDED.sort_order, updated_at = NOW()
       RETURNING *`,
      [data.category, data.slotNumber, data.label,
       data.targetTime ?? null, data.defaultPct ?? 0, data.sortOrder ?? 0]
    );
    return rows[0];
  },

  async deleteSlot(id: string) {
    await db.query(`DELETE FROM recon_supply_slots WHERE id = $1`, [id]);
  },

  // ─── Catalogue produits ────────────────────────────────────────────────

  async listProducts() {
    const { rows } = await db.query(
      `SELECT * FROM recon_products ORDER BY category NULLS LAST, product_name`
    );
    return rows;
  },

  /** Cree ou modifie un produit du catalogue. La cle est recalculee (SKU sinon nom). */
  async upsertProduct(data: { id?: string; sku?: string | null; productName: string; category?: string | null; unitPrice?: number }) {
    const key = productKey(data.sku, data.productName);
    if (data.id) {
      const { rows } = await db.query(
        `UPDATE recon_products
         SET product_key = $2, sku = $3, product_name = $4, category = $5, unit_price = $6, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [data.id, key, data.sku ?? null, data.productName.trim(), data.category ?? null, data.unitPrice ?? 0]
      );
      return rows[0] || null;
    }
    const { rows } = await db.query(
      `INSERT INTO recon_products (product_key, sku, product_name, category, unit_price)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (product_key) DO UPDATE SET
         sku = EXCLUDED.sku, product_name = EXCLUDED.product_name,
         category = EXCLUDED.category, unit_price = EXCLUDED.unit_price, updated_at = NOW()
       RETURNING *`,
      [key, data.sku ?? null, data.productName.trim(), data.category ?? null, data.unitPrice ?? 0]
    );
    return rows[0];
  },

  async deleteProduct(id: string) {
    await db.query(`DELETE FROM recon_products WHERE id = $1`, [id]);
  },

  /** Import en masse dans le catalogue (CSV Loyverse « Importer le catalogue »). */
  async bulkUpsertProducts(rows: { sku?: string | null; productName: string; category?: string | null; unitPrice?: number }[]) {
    const client = await db.getClient();
    let upserted = 0;
    try {
      await client.query('BEGIN');
      for (const r of rows) {
        if (!r.productName?.trim()) continue;
        await registerProduct(client, r);
        upserted++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return { upserted };
  },

  // ─── Traductions darija ────────────────────────────────────────────────

  async listDarija() {
    const { rows } = await db.query(`SELECT * FROM recon_darija ORDER BY product_key`);
    return rows;
  },

  /** Upsert par cle produit normalisee. Une traduction vide supprime l'entree. */
  async upsertDarija(productKey: string, darija: string) {
    if (!darija.trim()) {
      await db.query(`DELETE FROM recon_darija WHERE product_key = $1`, [productKey]);
      return null;
    }
    const { rows } = await db.query(
      `INSERT INTO recon_darija (product_key, darija)
       VALUES ($1, $2)
       ON CONFLICT (product_key) DO UPDATE SET darija = EXCLUDED.darija, updated_at = NOW()
       RETURNING *`,
      [productKey, darija.trim()]
    );
    return rows[0];
  },

  async report(params: { from: string; to: string; storeId?: string | null }) {
    const vals: unknown[] = [params.from, params.to];
    let storeCond = '';
    if (params.storeId) { vals.push(params.storeId); storeCond = `AND d.store_id = $${vals.length}`; }
    const result = await db.query(`
      SELECT
        l.product_key,
        MAX(l.product_name)                AS product_name,
        MAX(l.category)                    AS category,
        SUM(l.appro_qty)                   AS appro_qty,
        SUM(l.vendu_qty)                   AS vendu_qty,
        SUM(l.invendu_qty)                 AS invendu_qty,
        SUM(l.ecart_qty)                   AS ecart_qty,
        SUM(l.ecart_value)                 AS ecart_value,
        COUNT(DISTINCT d.id)               AS days_count
      FROM recon_lines l
      JOIN recon_days d ON d.id = l.recon_day_id
      WHERE d.business_date BETWEEN $1 AND $2 ${storeCond}
      GROUP BY l.product_key
      ORDER BY SUM(ABS(l.ecart_value)) DESC
    `, vals);
    return result.rows;
  },
};
