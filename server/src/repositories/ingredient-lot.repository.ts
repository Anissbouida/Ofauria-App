import { db } from '../config/database.js';
import type { PoolClient } from 'pg';

export const ingredientLotRepository = {
  /** List lots with filters */
  async findAll(params: {
    ingredientId?: string;
    status?: string;
    storeId?: string;
    expiringWithinDays?: number;
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.storeId) { conditions.push(`il.store_id = $${i++}`); values.push(params.storeId); }
    if (params.ingredientId) { conditions.push(`il.ingredient_id = $${i++}`); values.push(params.ingredientId); }
    if (params.status) { conditions.push(`il.status = $${i++}`); values.push(params.status); }
    if (params.search) {
      conditions.push(`(il.supplier_lot_number ILIKE $${i} OR ing.name ILIKE $${i} OR s.name ILIKE $${i})`);
      values.push(`%${params.search}%`);
      i++;
    }
    if (params.expiringWithinDays) {
      conditions.push(`il.expiration_date <= CURRENT_DATE + $${i++}::integer AND il.expiration_date >= CURRENT_DATE AND il.status = 'active'`);
      values.push(params.expiringWithinDays);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = params.limit || 100;
    const offset = params.offset || 0;

    const countResult = await db.query(
      `SELECT COUNT(*) FROM ingredient_lots il JOIN ingredients ing ON ing.id = il.ingredient_id ${where}`,
      values
    );
    const total = parseInt(countResult.rows[0].count);

    values.push(limit, offset);
    const result = await db.query(
      `SELECT il.*, ing.name as ingredient_name, ing.unit as ingredient_unit, ing.category as ingredient_category,
              s.name as supplier_name, s.phone as supplier_phone,
              rv.voucher_number as reception_voucher_number,
              po.order_number as purchase_order_number,
              CASE
                WHEN il.expiration_date IS NULL THEN 'no_date'
                WHEN il.expiration_date < CURRENT_DATE THEN 'expired'
                WHEN il.expiration_date <= CURRENT_DATE + 7 THEN 'expiring_soon'
                WHEN il.expiration_date <= CURRENT_DATE + 30 THEN 'expiring_month'
                ELSE 'ok'
              END as expiration_status
       FROM ingredient_lots il
       JOIN ingredients ing ON ing.id = il.ingredient_id
       LEFT JOIN suppliers s ON s.id = il.supplier_id
       LEFT JOIN reception_voucher_items rvi ON rvi.id = il.reception_voucher_item_id
       LEFT JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id
       LEFT JOIN purchase_orders po ON po.id = rv.purchase_order_id
       ${where}
       ORDER BY il.expiration_date ASC NULLS LAST, il.received_at DESC
       LIMIT $${i++} OFFSET $${i}`,
      values
    );

    return { rows: result.rows, total };
  },

  /** Get single lot with full details */
  async findById(id: string) {
    const result = await db.query(
      `SELECT il.*, ing.name as ingredient_name, ing.unit as ingredient_unit, ing.category as ingredient_category,
              s.name as supplier_name, s.phone as supplier_phone,
              rv.voucher_number as reception_voucher_number,
              po.order_number as purchase_order_number
       FROM ingredient_lots il
       JOIN ingredients ing ON ing.id = il.ingredient_id
       LEFT JOIN suppliers s ON s.id = il.supplier_id
       LEFT JOIN reception_voucher_items rvi ON rvi.id = il.reception_voucher_item_id
       LEFT JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id
       LEFT JOIN purchase_orders po ON po.id = rv.purchase_order_id
       WHERE il.id = $1`,
      [id]
    );
    return result.rows[0] || null;
  },

  /** Lots expiring within N days */
  async findExpiring(days: number = 7, storeId?: string) {
    const conditions = [`il.expiration_date <= CURRENT_DATE + $1::integer`, `il.expiration_date >= CURRENT_DATE`, `il.status = 'active'`, `il.quantity_remaining > 0`];
    const values: unknown[] = [days];
    if (storeId) { conditions.push(`il.store_id = $2`); values.push(storeId); }

    const result = await db.query(
      `SELECT il.*, ing.name as ingredient_name, ing.unit as ingredient_unit, s.name as supplier_name,
              il.expiration_date - CURRENT_DATE as days_until_expiry
       FROM ingredient_lots il
       JOIN ingredients ing ON ing.id = il.ingredient_id
       LEFT JOIN suppliers s ON s.id = il.supplier_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY il.expiration_date ASC`,
      values
    );
    return result.rows;
  },

  /** Expired lots still active */
  async findExpired(storeId?: string) {
    const conditions = [`il.expiration_date < CURRENT_DATE`, `il.status = 'active'`, `il.quantity_remaining > 0`];
    const values: unknown[] = [];
    if (storeId) { conditions.push(`il.store_id = $1`); values.push(storeId); }

    const result = await db.query(
      `SELECT il.*, ing.name as ingredient_name, ing.unit as ingredient_unit, s.name as supplier_name,
              CURRENT_DATE - il.expiration_date as days_expired
       FROM ingredient_lots il
       JOIN ingredients ing ON ing.id = il.ingredient_id
       LEFT JOIN suppliers s ON s.id = il.supplier_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY il.expiration_date ASC`,
      values
    );
    return result.rows;
  },

  /** Forward traceability: which production plans used this lot */
  async findProductionsByLot(lotId: string) {
    const result = await db.query(
      `SELECT plu.*, pp.plan_date, pp.status as plan_status, pp.type as plan_type,
              ing.name as ingredient_name,
              u.first_name || ' ' || u.last_name as created_by_name
       FROM production_lot_usage plu
       JOIN production_plans pp ON pp.id = plu.production_plan_id
       JOIN ingredients ing ON ing.id = plu.ingredient_id
       LEFT JOIN users u ON u.id = pp.created_by
       WHERE plu.ingredient_lot_id = $1
       ORDER BY pp.plan_date DESC`,
      [lotId]
    );
    return result.rows;
  },

  /** Reverse traceability: which lots were used in a production plan */
  async findLotsByProduction(productionPlanId: string) {
    const result = await db.query(
      `SELECT plu.*, il.lot_number, il.supplier_lot_number, il.expiration_date, il.received_at,
              ing.name as ingredient_name, ing.unit as ingredient_unit,
              s.name as supplier_name
       FROM production_lot_usage plu
       JOIN ingredient_lots il ON il.id = plu.ingredient_lot_id
       JOIN ingredients ing ON ing.id = plu.ingredient_id
       LEFT JOIN suppliers s ON s.id = il.supplier_id
       WHERE plu.production_plan_id = $1
       ORDER BY ing.name`,
      [productionPlanId]
    );
    return result.rows;
  },

  /** FEFO consumption: consume ingredient from lots ordered by expiration date (First Expired, First Out) */
  async consumeFEFO(
    client: PoolClient,
    ingredientId: string,
    quantityNeeded: number,
    productionPlanId: string,
    storeId?: string
  ): Promise<{ lotId: string; quantityUsed: number }[]> {
    const conditions = [`ingredient_id = $1`, `status = 'active'`, `quantity_remaining > 0`];
    const values: unknown[] = [ingredientId];
    if (storeId) { conditions.push(`store_id = $2`); values.push(storeId); }

    // Lock rows for concurrent safety
    const lotsResult = await client.query(
      `SELECT id, quantity_remaining, expiration_date FROM ingredient_lots
       WHERE ${conditions.join(' AND ')}
       ORDER BY expiration_date ASC NULLS LAST, received_at ASC
       FOR UPDATE`,
      values
    );

    const consumed: { lotId: string; quantityUsed: number }[] = [];
    let remaining = quantityNeeded;

    for (const lot of lotsResult.rows) {
      if (remaining <= 0) break;

      const available = parseFloat(lot.quantity_remaining);
      const take = Math.min(available, remaining);

      await client.query(
        `UPDATE ingredient_lots SET quantity_remaining = quantity_remaining - $1,
         status = CASE WHEN quantity_remaining - $1 <= 0 THEN 'depleted' ELSE status END
         WHERE id = $2`,
        [take, lot.id]
      );

      // Record production lot usage (forward traceability)
      await client.query(
        `INSERT INTO production_lot_usage (production_plan_id, ingredient_lot_id, ingredient_id, quantity_used)
         VALUES ($1, $2, $3, $4)`,
        [productionPlanId, lot.id, ingredientId, take]
      );

      consumed.push({ lotId: lot.id, quantityUsed: take });
      remaining -= take;
    }

    // If remaining > 0, not enough tracked lots exist (old inventory without lots)
    // The aggregate inventory deduction will still happen — this is graceful degradation

    return consumed;
  },

  /** Quarantine a lot */
  async quarantine(id: string) {
    const result = await db.query(
      `UPDATE ingredient_lots SET status = 'quarantine' WHERE id = $1 RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  },

  /** Mark lot as waste */
  async markAsWaste(id: string) {
    const result = await db.query(
      `UPDATE ingredient_lots SET status = 'waste', quantity_remaining = 0 WHERE id = $1 RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  },

  /** Dashboard stats: summary of lot status */
  async stats(storeId?: string) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (storeId) { conditions.push(`store_id = $1`); values.push(storeId); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active') as active_lots,
         COUNT(*) FILTER (WHERE status = 'active' AND expiration_date < CURRENT_DATE) as expired_active,
         COUNT(*) FILTER (WHERE status = 'active' AND expiration_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7) as expiring_7_days,
         COUNT(*) FILTER (WHERE status = 'active' AND expiration_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30) as expiring_30_days,
         COUNT(*) FILTER (WHERE status = 'quarantine') as quarantined,
         COUNT(*) FILTER (WHERE status = 'depleted') as depleted,
         COUNT(*) FILTER (WHERE status = 'waste') as wasted
       FROM ingredient_lots ${where}`,
      values
    );
    return result.rows[0];
  },

  /** Save quality check for a reception voucher */
  async saveQualityCheck(data: {
    receptionVoucherId: string;
    temperatureOk?: boolean;
    temperatureValue?: number;
    visualOk?: boolean;
    packagingOk?: boolean;
    labelsOk?: boolean;
    overallConformity: boolean;
    notes?: string;
    checkedBy: string;
  }) {
    const result = await db.query(
      `INSERT INTO reception_quality_checks
        (reception_voucher_id, temperature_ok, temperature_value, visual_ok, packaging_ok, labels_ok, overall_conformity, notes, checked_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (reception_voucher_id) DO UPDATE SET
        temperature_ok = EXCLUDED.temperature_ok, temperature_value = EXCLUDED.temperature_value,
        visual_ok = EXCLUDED.visual_ok, packaging_ok = EXCLUDED.packaging_ok,
        labels_ok = EXCLUDED.labels_ok, overall_conformity = EXCLUDED.overall_conformity,
        notes = EXCLUDED.notes, checked_by = EXCLUDED.checked_by, checked_at = NOW()
       RETURNING *`,
      [data.receptionVoucherId, data.temperatureOk ?? null, data.temperatureValue ?? null,
       data.visualOk ?? null, data.packagingOk ?? null, data.labelsOk ?? null,
       data.overallConformity, data.notes || null, data.checkedBy]
    );
    return result.rows[0];
  },

  /** Get quality check for a reception */
  async findQualityCheck(receptionVoucherId: string) {
    const result = await db.query(
      `SELECT qc.*, u.first_name || ' ' || u.last_name as checked_by_name
       FROM reception_quality_checks qc
       LEFT JOIN users u ON u.id = qc.checked_by
       WHERE qc.reception_voucher_id = $1`,
      [receptionVoucherId]
    );
    return result.rows[0] || null;
  },
};
