import type { PoolClient } from 'pg';
import { db } from '../config/database.js';

/**
 * Product lots — fournees de production avec dual-clock DLV/DLC.
 *
 * Une fournee = un lot. Tracking par fournee (pas par unite).
 * Backroom_qty + vitrine_qty + sold + wasted + recycled = quantity_total (invariant).
 *
 * FEFO :
 *   - Backroom : ORDER BY expires_at (DLC plus proche en premier)
 *   - Vitrine : ORDER BY expires_at, display_expires_at (DLV cumulee)
 */

export interface ProductLot {
  id: string;
  product_id: string;
  production_plan_id: string | null;
  store_id: string;
  lot_number: string;
  produced_at: string;
  expires_at: string | null;
  first_displayed_at: string | null;
  display_expires_at: string | null;
  quantity_total: number;
  backroom_qty: number;
  vitrine_qty: number;
  sold_qty: number;
  wasted_qty: number;
  recycled_qty: number;
  status: 'active' | 'depleted' | 'expired' | 'disposed';
}

export const productLotRepository = {
  /** Cree un lot a la validation d'une fournee de production.
   *  Calcule la DLC depuis shelf_life_days du produit. */
  async createFromProduction(
    client: PoolClient,
    data: {
      productId: string;
      storeId: string;
      productionPlanId?: string | null;
      quantityProduced: number;
      producedAt?: Date;
      shelfLifeDays?: number | null;
      notes?: string;
    }
  ): Promise<ProductLot> {
    const producedAt = data.producedAt ?? new Date();
    const shelfDays = data.shelfLifeDays && data.shelfLifeDays > 0 ? data.shelfLifeDays : null;
    const expiresAt = shelfDays
      ? new Date(producedAt.getTime() + shelfDays * 86400000)
      : null;

    // Numero de lot incrementiel via sequence (zero collision)
    const seqResult = await client.query(
      `SELECT nextval('product_lot_number_seq') as n`
    );
    const seq = parseInt(seqResult.rows[0].n);
    const ymd = producedAt.toISOString().slice(0, 10).replace(/-/g, '');
    const lotNumber = `LOT-${ymd}-${String(seq).padStart(5, '0')}`;

    const result = await client.query(
      `INSERT INTO product_lots
         (product_id, production_plan_id, store_id, lot_number,
          produced_at, expires_at, quantity_total, backroom_qty,
          status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, 'active', $8)
       RETURNING *`,
      [
        data.productId,
        data.productionPlanId ?? null,
        data.storeId,
        lotNumber,
        producedAt.toISOString(),
        expiresAt ? expiresAt.toISOString().slice(0, 10) : null,
        data.quantityProduced,
        data.notes ?? null,
      ]
    );
    return result.rows[0];
  },

  /** FEFO : selectionne les lots backroom dans l'ordre de DLC croissant
   *  pour pouvoir ponctionner une qty totale donnee. Retourne les
   *  consommations a appliquer (lot_id, qty) sans modifier la base.
   *  L'appelant applique ensuite via consumeBackroom. */
  async planFefoBackroomConsumption(
    client: PoolClient,
    productId: string,
    storeId: string,
    qtyNeeded: number
  ): Promise<{ lotId: string; qty: number; lot: ProductLot }[]> {
    if (qtyNeeded <= 0) return [];
    const result = await client.query(
      `SELECT * FROM product_lots
       WHERE product_id = $1 AND store_id = $2
         AND status = 'active' AND backroom_qty > 0
       ORDER BY expires_at ASC NULLS LAST, produced_at ASC, id
       FOR UPDATE`,
      [productId, storeId]
    );
    const plan: { lotId: string; qty: number; lot: ProductLot }[] = [];
    let remaining = qtyNeeded;
    for (const lot of result.rows as ProductLot[]) {
      if (remaining <= 0) break;
      const take = Math.min(parseFloat(String(lot.backroom_qty)), remaining);
      if (take > 0) {
        plan.push({ lotId: lot.id, qty: take, lot });
        remaining -= take;
      }
    }
    return plan;
  },

  /** FEFO vitrine : pareil mais sur vitrine_qty (utile pour ventes POS).
   *  Par defaut exclut les lots expires (DLV ou DDE atteinte) — securite alimentaire.
   *  Passer { includeExpired: true } pour usage destruction/recyclage seulement. */
  async planFefoVitrineConsumption(
    client: PoolClient,
    productId: string,
    storeId: string,
    qtyNeeded: number,
    opts: { includeExpired?: boolean } = {}
  ): Promise<{ lotId: string; qty: number; lot: ProductLot }[]> {
    if (qtyNeeded <= 0) return [];
    const expiryFilter = opts.includeExpired
      ? ''
      : `AND (expires_at IS NULL OR expires_at > CURRENT_DATE)
         AND (display_expires_at IS NULL OR display_expires_at > NOW())`;
    const result = await client.query(
      `SELECT * FROM product_lots
       WHERE product_id = $1 AND store_id = $2
         AND status = 'active' AND vitrine_qty > 0
         ${expiryFilter}
       ORDER BY expires_at ASC NULLS LAST, display_expires_at ASC NULLS LAST,
                produced_at ASC, id
       FOR UPDATE`,
      [productId, storeId]
    );
    const plan: { lotId: string; qty: number; lot: ProductLot }[] = [];
    let remaining = qtyNeeded;
    for (const lot of result.rows as ProductLot[]) {
      if (remaining <= 0) break;
      const take = Math.min(parseFloat(String(lot.vitrine_qty)), remaining);
      if (take > 0) {
        plan.push({ lotId: lot.id, qty: take, lot });
        remaining -= take;
      }
    }
    return plan;
  },

  /** Verifie si un produit est vendable (au moins 1 lot vitrine non expire).
   *  Retourne null si OK, sinon { reason, deadline } pour rejet. */
  async checkSaleability(productId: string, storeId: string): Promise<{ reason: string; deadline: string } | null> {
    // Cherche le pire deadline parmi les lots vitrine actifs avec stock
    const result = await db.query(
      `SELECT
         BOOL_OR(expires_at IS NOT NULL AND expires_at <= CURRENT_DATE) AS dlv_expired,
         BOOL_OR(display_expires_at IS NOT NULL AND display_expires_at <= NOW()) AS dde_expired,
         BOOL_OR(
           (expires_at IS NULL OR expires_at > CURRENT_DATE)
           AND (display_expires_at IS NULL OR display_expires_at > NOW())
         ) AS has_valid_lot,
         MIN(LEAST(
           COALESCE(expires_at::timestamptz, 'infinity'::timestamptz),
           COALESCE(display_expires_at, 'infinity'::timestamptz)
         )) AS effective_deadline
       FROM product_lots
       WHERE product_id = $1 AND store_id = $2 AND status = 'active' AND vitrine_qty > 0`,
      [productId, storeId]
    );
    const r = result.rows[0];
    if (!r) return null;
    if (r.has_valid_lot) return null;  // Au moins un lot vendable
    if (r.dde_expired) return { reason: 'DDE_EXPIREE', deadline: r.effective_deadline };
    if (r.dlv_expired) return { reason: 'DLV_EXPIREE', deadline: r.effective_deadline };
    return null;
  },

  /** Transferer du backroom vers vitrine pour un lot precis.
   *  Fixe first_displayed_at + display_expires_at si premiere exposition. */
  async transferBackroomToVitrine(
    client: PoolClient,
    lotId: string,
    qty: number,
    displayLifeHours?: number | null
  ): Promise<void> {
    if (qty <= 0) return;

    // Lock + lecture pour calculer DLV si premiere exposition
    const cur = await client.query(
      `SELECT first_displayed_at FROM product_lots WHERE id = $1 FOR UPDATE`,
      [lotId]
    );
    if (cur.rowCount === 0) {
      throw new Error(`product_lot ${lotId} introuvable`);
    }
    const isFirstDisplay = cur.rows[0].first_displayed_at == null;

    if (isFirstDisplay && displayLifeHours && displayLifeHours > 0) {
      const now = new Date();
      const displayExpiresAt = new Date(now.getTime() + displayLifeHours * 3600000);
      await client.query(
        `UPDATE product_lots
         SET backroom_qty = backroom_qty - $2,
             vitrine_qty  = vitrine_qty + $2,
             first_displayed_at = $3,
             display_expires_at = $4
         WHERE id = $1`,
        [lotId, qty, now.toISOString(), displayExpiresAt.toISOString()]
      );
    } else {
      // Re-exposition : DLV reste figee (modele Cumule)
      await client.query(
        `UPDATE product_lots
         SET backroom_qty = backroom_qty - $2,
             vitrine_qty  = vitrine_qty + $2
         WHERE id = $1`,
        [lotId, qty]
      );
    }
  },

  /** Retour reserve (vitrine -> backroom) sans toucher a la DLV. */
  async returnVitrineToBackroom(
    client: PoolClient,
    lotId: string,
    qty: number
  ): Promise<void> {
    if (qty <= 0) return;
    await client.query(
      `UPDATE product_lots
       SET vitrine_qty  = vitrine_qty - $2,
           backroom_qty = backroom_qty + $2
       WHERE id = $1`,
      [lotId, qty]
    );
  },

  /** Marquer une vente : decremente vitrine_qty et incremente sold_qty. */
  async consumeVitrineSold(
    client: PoolClient,
    lotId: string,
    qty: number
  ): Promise<void> {
    if (qty <= 0) return;
    await client.query(
      `UPDATE product_lots
       SET vitrine_qty = vitrine_qty - $2,
           sold_qty    = sold_qty + $2
       WHERE id = $1`,
      [lotId, qty]
    );
  },

  /** Marquer une perte (waste / DLV expiree / casse) sur la vitrine. */
  async consumeVitrineWaste(
    client: PoolClient,
    lotId: string,
    qty: number
  ): Promise<void> {
    if (qty <= 0) return;
    await client.query(
      `UPDATE product_lots
       SET vitrine_qty = vitrine_qty - $2,
           wasted_qty  = wasted_qty + $2
       WHERE id = $1`,
      [lotId, qty]
    );
  },

  /** Marquer un recyclage (vitrine -> ingredient) sur la vitrine. */
  async consumeVitrineRecycle(
    client: PoolClient,
    lotId: string,
    qty: number
  ): Promise<void> {
    if (qty <= 0) return;
    await client.query(
      `UPDATE product_lots
       SET vitrine_qty   = vitrine_qty - $2,
           recycled_qty  = recycled_qty + $2
       WHERE id = $1`,
      [lotId, qty]
    );
  },

  /** Recuperer un lot par id. */
  async findById(id: string): Promise<ProductLot | null> {
    const result = await db.query(
      `SELECT * FROM product_lots WHERE id = $1`,
      [id]
    );
    return (result.rows[0] as ProductLot) ?? null;
  },

  /** Lots actifs d'un produit dans un store, tries FEFO. */
  async findActiveByProduct(
    productId: string,
    storeId: string
  ): Promise<ProductLot[]> {
    const result = await db.query(
      `SELECT * FROM product_lots
       WHERE product_id = $1 AND store_id = $2 AND status = 'active'
       ORDER BY expires_at ASC NULLS LAST, produced_at ASC`,
      [productId, storeId]
    );
    return result.rows;
  },

  /**
   * Liste des product_lots avec DLC ou DLV depassee qui ont encore du stock
   * (vitrine_qty > 0 OU backroom_qty > 0). Sert a la banniere d'alerte sur
   * la page Produits + dialog d'envoi aux pertes.
   */
  async findExpiredActiveLots(storeId?: string) {
    const conditions: string[] = [
      `pl.status = 'active'`,
      `(pl.vitrine_qty + pl.backroom_qty) > 0`,
      `(
        (pl.expires_at IS NOT NULL AND pl.expires_at < CURRENT_DATE)
        OR (pl.display_expires_at IS NOT NULL AND pl.display_expires_at < NOW())
      )`,
    ];
    const values: unknown[] = [];
    if (storeId) { conditions.push(`pl.store_id = $1`); values.push(storeId); }

    const result = await db.query(
      `SELECT pl.id, pl.lot_number,
              pl.vitrine_qty, pl.backroom_qty,
              (pl.vitrine_qty + pl.backroom_qty) as total_qty,
              pl.expires_at, pl.display_expires_at, pl.first_displayed_at,
              pl.produced_at,
              p.id as product_id, p.name as product_name, p.cost_price,
              p.image_url as product_image,
              c.name as category_name,
              CASE
                WHEN pl.display_expires_at IS NOT NULL AND pl.display_expires_at < NOW() THEN 'dlv_expired'
                WHEN pl.expires_at IS NOT NULL AND pl.expires_at < CURRENT_DATE THEN 'dlc_expired'
                ELSE 'other'
              END as expiry_reason,
              GREATEST(
                CURRENT_DATE - pl.expires_at,
                EXTRACT(DAY FROM (NOW() - pl.display_expires_at))::int,
                0
              ) as days_expired
         FROM product_lots pl
         JOIN products p ON p.id = pl.product_id
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY days_expired DESC, p.name`,
      values
    );
    return result.rows;
  },

  /**
   * Stock "orphelin" : produits qui ont du stock dans product_store_stock
   * mais aucun lot actif pour le justifier (heritage pre-migration 105 ou
   * desync). Le banner les affiche pour permettre regularisation manuelle.
   */
  async findOrphanStockProducts(storeId?: string) {
    const conditions: string[] = [
      `(pss.stock_quantity + pss.vitrine_quantity) > 0`,
      `NOT EXISTS (
         SELECT 1 FROM product_lots pl
         WHERE pl.product_id = pss.product_id
           AND pl.store_id   = pss.store_id
           AND pl.status     = 'active'
           AND (pl.vitrine_qty + pl.backroom_qty) > 0
       )`,
    ];
    const values: unknown[] = [];
    if (storeId) { conditions.push(`pss.store_id = $1`); values.push(storeId); }

    const result = await db.query(
      `SELECT pss.product_id           AS id,
              pss.product_id,
              pss.store_id,
              pss.stock_quantity       AS backroom_qty,
              pss.vitrine_quantity     AS vitrine_qty,
              (pss.stock_quantity + pss.vitrine_quantity) AS total_qty,
              p.name                   AS product_name,
              p.cost_price,
              p.image_url              AS product_image,
              p.shelf_life_days,
              c.name                   AS category_name,
              (SELECT MAX(produced_at)::date FROM product_lots pl2
                 WHERE pl2.product_id = pss.product_id
                   AND pl2.store_id   = pss.store_id) AS last_lot_produced_at
         FROM product_store_stock pss
         JOIN products p ON p.id = pss.product_id
    LEFT JOIN categories c ON c.id = p.category_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY p.name`,
      values
    );
    return result.rows;
  },

  /**
   * Envoie le stock orphelin (sans lot actif) d'un produit aux pertes.
   * Refuse si un lot actif avec stock existe (utiliser sendToLosses).
   */
  async sendOrphanStockToLosses(
    productId: string,
    storeId: string,
    reason: string,
    userId: string,
    note?: string
  ): Promise<{ lostQuantity: number; lostValue: number; reasonLabel: string }> {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const lockResult = await client.query(
        `SELECT pss.stock_quantity, pss.vitrine_quantity,
                p.name AS product_name, p.cost_price
           FROM product_store_stock pss
           JOIN products p ON p.id = pss.product_id
          WHERE pss.product_id = $1 AND pss.store_id = $2
          FOR UPDATE`,
        [productId, storeId]
      );
      if (lockResult.rowCount === 0) {
        throw new Error(`Stock introuvable pour ce produit dans ce magasin`);
      }
      const row = lockResult.rows[0];
      const backroom = parseFloat(row.stock_quantity) || 0;
      const vitrine = parseFloat(row.vitrine_quantity) || 0;
      const total = backroom + vitrine;
      if (total <= 0) {
        throw new Error(`Aucun stock a envoyer aux pertes`);
      }

      // Garde-fou : si un lot actif a encore du stock, on refuse pour eviter
      // un double comptage. L'utilisateur doit passer par sendToLosses(lotId).
      const activeLot = await client.query(
        `SELECT 1 FROM product_lots
          WHERE product_id = $1 AND store_id = $2 AND status = 'active'
            AND (vitrine_qty + backroom_qty) > 0
          LIMIT 1`,
        [productId, storeId]
      );
      if ((activeLot.rowCount ?? 0) > 0) {
        throw new Error(`Ce produit a encore des lots actifs — utilisez l'envoi par lot`);
      }

      const unitCost = parseFloat(row.cost_price) || 0;
      const lostValue = total * unitCost;

      const reasonLabels: Record<string, string> = {
        dlc_expired: 'DLC expiree',
        dlv_expired: 'DLV (duree de vie en vitrine) depassee',
        damaged: 'Stock endommage',
        quarantine_failed: 'Echec controle qualite',
        other: 'Autre',
      };
      const reasonLabel = reasonLabels[reason] || reasonLabels.other;
      const lossDbReason = reason === 'dlv_expired' ? 'dlv_expiree' :
                            reason === 'dlc_expired' ? 'dlc_expiree' : 'perime';

      await client.query(
        `UPDATE product_store_stock
            SET vitrine_quantity = 0,
                stock_quantity   = 0,
                updated_at = NOW()
          WHERE product_id = $1 AND store_id = $2`,
        [productId, storeId]
      );

      await client.query(
        `INSERT INTO product_stock_transactions
           (product_id, type, quantity_change, stock_after, note, performed_by, store_id)
         VALUES ($1, 'waste', $2, 0, $3, $4, $5)`,
        [productId, -total,
         `${reasonLabel} — Stock orphelin (sans lot) : ${total.toFixed(2)} u (${lostValue.toFixed(2)} DH)${note ? ' — ' + note : ''}`,
         userId, storeId]
      );

      await client.query(
        `INSERT INTO product_losses
           (product_id, quantity, loss_type, reason, reason_note,
            unit_cost, total_cost, ingredients_consumed,
            declared_by, store_id, source_product_lot_id)
         VALUES ($1, $2, 'perime', $3, $4, $5, $6, false, $7, $8, NULL)`,
        [productId, total, lossDbReason,
         `${reasonLabel} — Stock orphelin (sans lot)${note ? ' — ' + note : ''}`,
         unitCost, lostValue, userId, storeId]
      );

      await client.query('COMMIT');
      return { lostQuantity: total, lostValue, reasonLabel };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Envoie un product_lot aux pertes : retire toutes les unites
   * (vitrine + backroom), trace dans product_losses + product_stock_transactions,
   * passe le lot en status='expired'.
   */
  async sendToLosses(
    lotId: string,
    reason: string,
    userId: string,
    note?: string
  ): Promise<{ lot: Record<string, unknown>; lostQuantity: number; lostValue: number; reasonLabel: string }> {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const lockResult = await client.query(
        `SELECT pl.id, pl.vitrine_qty, pl.backroom_qty, pl.lot_number,
                pl.product_id, pl.store_id, pl.status, pl.expires_at, pl.display_expires_at,
                pl.produced_at,
                p.name AS product_name, p.cost_price
           FROM product_lots pl
           JOIN products p ON p.id = pl.product_id
          WHERE pl.id = $1
          FOR UPDATE`,
        [lotId]
      );
      if (lockResult.rowCount === 0) {
        throw new Error(`Lot produit ${lotId} introuvable`);
      }
      const lot = lockResult.rows[0];

      if (lot.status === 'disposed' || lot.status === 'expired') {
        throw new Error(`Lot deja traite (statut: ${lot.status})`);
      }

      const vitrineQty = parseFloat(lot.vitrine_qty) || 0;
      const backroomQty = parseFloat(lot.backroom_qty) || 0;
      const totalLost = vitrineQty + backroomQty;
      const unitCost = parseFloat(lot.cost_price) || 0;
      const lostValue = totalLost * unitCost;

      const reasonLabels: Record<string, string> = {
        dlc_expired: 'DLC expiree',
        dlv_expired: 'DLV (duree de vie en vitrine) depassee',
        damaged: 'Lot endommage',
        quarantine_failed: 'Echec controle qualite',
        other: 'Autre',
      };
      const reasonLabel = reasonLabels[reason] || reasonLabels.other;
      const lossDbReason = reason === 'dlv_expired' ? 'dlv_expiree' :
                            reason === 'dlc_expired' ? 'dlc_expiree' : 'perime';

      // Mise a jour product_store_stock (sync vitrine + backroom)
      if (totalLost > 0) {
        await client.query(
          `UPDATE product_store_stock
              SET vitrine_quantity = GREATEST(0, vitrine_quantity - $1),
                  stock_quantity   = GREATEST(0, stock_quantity - $2),
                  updated_at = NOW()
            WHERE product_id = $3 AND store_id = $4`,
          [vitrineQty, backroomQty, lot.product_id, lot.store_id]
        );

        // Trace transaction stock
        await client.query(
          `INSERT INTO product_stock_transactions
             (product_id, type, quantity_change, stock_after, note, performed_by, store_id)
           VALUES ($1, 'waste', $2, 0, $3, $4, $5)`,
          [lot.product_id, -totalLost,
           `${reasonLabel} — Lot ${lot.lot_number} : ${totalLost.toFixed(2)} u (${lostValue.toFixed(2)} DH)${note ? ' — ' + note : ''}`,
           userId, lot.store_id]
        );

        // Trace perte
        await client.query(
          `INSERT INTO product_losses
             (product_id, quantity, loss_type, reason, reason_note,
              unit_cost, total_cost, ingredients_consumed,
              declared_by, store_id, source_product_lot_id)
           VALUES ($1, $2, 'perime', $3, $4, $5, $6, true, $7, $8, $9)`,
          [lot.product_id, totalLost, lossDbReason,
           `${reasonLabel} — Lot ${lot.lot_number}${note ? ' — ' + note : ''}`,
           unitCost, lostValue, userId, lot.store_id, lotId]
        );
      }

      // Marque le lot comme rebut (transfert vitrine+backroom -> wasted_qty)
      const updatedLot = await client.query(
        `UPDATE product_lots
            SET wasted_qty = wasted_qty + vitrine_qty + backroom_qty,
                vitrine_qty = 0, backroom_qty = 0,
                status = 'expired',
                notes = COALESCE(notes, '') || E'\\n[' || NOW()::date::text || '] Envoyé aux pertes : ' || $2,
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [lotId, reasonLabel + (note ? ' — ' + note : '')]
      );

      // Sync product_display_tracking : marque la ligne correspondante 'wasted'
      // pour eviter les orphelins (faux positifs sur l'ecran "Produits expires").
      await client.query(
        `UPDATE product_display_tracking
         SET status = 'wasted', updated_at = NOW()
         WHERE product_id = $1 AND store_id = $2 AND status = 'active'
           AND ($3::timestamptz IS NULL OR ABS(EXTRACT(EPOCH FROM (produced_at - $3::timestamptz))) < 60)`,
        [lot.product_id, lot.store_id, lot.produced_at || null]
      );

      await client.query('COMMIT');
      return {
        lot: updatedLot.rows[0],
        lostQuantity: totalLost,
        lostValue,
        reasonLabel,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /** Job nightly : marque les lots expires (DLC depassee) en statut 'expired'.
   *  Ne touche PAS aux quantites (gere par le flux destruction expired). */
  async markExpiredLots(): Promise<number> {
    const result = await db.query(
      `UPDATE product_lots
       SET status = 'expired', updated_at = NOW()
       WHERE status = 'active'
         AND (
           (expires_at IS NOT NULL AND expires_at < CURRENT_DATE)
           OR (display_expires_at IS NOT NULL AND display_expires_at < NOW())
         )
         AND (backroom_qty + vitrine_qty) > 0
       RETURNING id`
    );
    return result.rowCount ?? 0;
  },

  /** Phase B — Auto-expire idempotent : pour chaque lot avec DLV ou DDE
   *  atteinte, transfere le residu vitrine_qty + backroom_qty en wasted_qty,
   *  cree une perte automatique, et marque le lot 'expired'.
   *  Idempotent : ne touche QUE les lots 'active'. Si rien ne change, retourne 0.
   *  Appele en lazy trigger : a chaque login user / load POS / load fermeture caisse.
   */
  async autoExpireDueLots(): Promise<{ count: number; productIds: string[] }> {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Lots dont la DLV (date) ou la DDE (timestamp) est passee
      const dueLotsResult = await client.query(
        `SELECT pl.id, pl.product_id, pl.store_id, pl.lot_number,
                pl.vitrine_qty, pl.backroom_qty, pl.expires_at, pl.display_expires_at,
                p.name as product_name, p.cost_price
         FROM product_lots pl
         JOIN products p ON p.id = pl.product_id
         WHERE pl.status = 'active'
           AND (
             (pl.expires_at IS NOT NULL AND pl.expires_at < CURRENT_DATE)
             OR (pl.display_expires_at IS NOT NULL AND pl.display_expires_at < NOW())
           )
           AND (pl.backroom_qty + pl.vitrine_qty) > 0
         FOR UPDATE`
      );

      const productIdsAffected = new Set<string>();
      for (const lot of dueLotsResult.rows) {
        const totalLost = parseFloat(lot.vitrine_qty) + parseFloat(lot.backroom_qty);
        if (totalLost <= 0) continue;
        const unitCost = parseFloat(lot.cost_price) || 0;
        const totalCost = unitCost * totalLost;
        const reason = lot.expires_at && new Date(lot.expires_at) < new Date()
          ? 'dlc_expiree'
          : 'dlv_expiree';

        // Synchroniser product_store_stock (decrement vitrine + backroom)
        await client.query(
          `UPDATE product_store_stock
           SET vitrine_quantity = GREATEST(0, vitrine_quantity - $1),
               stock_quantity   = GREATEST(0, stock_quantity - $2),
               updated_at = NOW()
           WHERE product_id = $3 AND store_id = $4`,
          [parseFloat(lot.vitrine_qty), parseFloat(lot.backroom_qty), lot.product_id, lot.store_id]
        );

        // Lot : transferer tout en wasted + status expired
        await client.query(
          `UPDATE product_lots
           SET wasted_qty = wasted_qty + vitrine_qty + backroom_qty,
               vitrine_qty = 0, backroom_qty = 0,
               status = 'expired', updated_at = NOW()
           WHERE id = $1`,
          [lot.id]
        );

        // Sync product_display_tracking : marque la ligne correspondante comme 'wasted'
        // pour eviter les orphelins qui faussent les requetes de detection d'expiration.
        // Match heuristique : meme produit/store + produced_at proche (tolerance 1 minute).
        await client.query(
          `UPDATE product_display_tracking
           SET status = 'wasted', updated_at = NOW()
           WHERE product_id = $1 AND store_id = $2 AND status = 'active'
             AND ($3::timestamptz IS NULL OR ABS(EXTRACT(EPOCH FROM (produced_at - $3::timestamptz))) < 60)`,
          [lot.product_id, lot.store_id, lot.produced_at || null]
        );

        // Trace transaction
        await client.query(
          `INSERT INTO product_stock_transactions
             (product_id, type, quantity_change, stock_after, note, performed_by, store_id)
           VALUES ($1, 'waste', $2, 0, $3, NULL, $4)`,
          [lot.product_id, -totalLost,
           `Auto-expire (${reason}): ${lot.product_name} lot ${lot.lot_number} x${totalLost}`,
           lot.store_id]
        );

        // Trace perte
        await client.query(
          `INSERT INTO product_losses
             (product_id, quantity, loss_type, reason, reason_note,
              unit_cost, total_cost, ingredients_consumed,
              declared_by, store_id, source_product_lot_id)
           VALUES ($1, $2, 'perime', $3, $4, $5, $6, true, NULL, $7, $8)`,
          [lot.product_id, totalLost, reason,
           `Auto-expire ${reason} sur lot ${lot.lot_number}`,
           unitCost, totalCost, lot.store_id, lot.id]
        );

        productIdsAffected.add(lot.product_id);
      }

      await client.query('COMMIT');
      return {
        count: dueLotsResult.rowCount ?? 0,
        productIds: Array.from(productIdsAffected),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
