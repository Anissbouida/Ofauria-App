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

  /** Stock actuellement au Pesage (sacs ouverts en cours d'utilisation).
   *  Retourne agrege par ingredient avec details des lots ouverts.
   *  Sert pour la vue magasinier "Stock pesage". */
  async findPesageStock(storeId?: string) {
    const conditions = [`il.status = 'active'`, `il.pesage_quantity > 0`];
    const values: unknown[] = [];
    if (storeId) { conditions.push(`il.store_id = $1`); values.push(storeId); }

    const result = await db.query(
      `SELECT
         ing.id as ingredient_id,
         ing.name as ingredient_name,
         ing.unit as ingredient_unit,
         ing.category as ingredient_category,
         SUM(il.pesage_quantity) as total_pesage,
         COUNT(*) as lots_count,
         MIN(COALESCE(il.effective_expiry_after_opening, il.expiration_date)) as nearest_dlc_effective,
         json_agg(
           json_build_object(
             'lot_id', il.id,
             'lot_number', il.lot_number,
             'supplier_lot_number', il.supplier_lot_number,
             'pesage_quantity', il.pesage_quantity,
             'economat_quantity', il.economat_quantity,
             'first_opened_at', il.first_opened_at,
             'expiration_date', il.expiration_date,
             'effective_expiry_after_opening', il.effective_expiry_after_opening,
             'supplier_name', s.name
           ) ORDER BY COALESCE(il.effective_expiry_after_opening, il.expiration_date) ASC NULLS LAST
         ) as lots
       FROM ingredient_lots il
       JOIN ingredients ing ON ing.id = il.ingredient_id
       LEFT JOIN suppliers s ON s.id = il.supplier_id
       WHERE ${conditions.join(' AND ')}
       GROUP BY ing.id, ing.name, ing.unit, ing.category
       ORDER BY ing.name`,
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

  /**
   * Phase Économat/Pesage : ouvre N contenants pour transferer du stock scelle
   * (economat_quantity) vers le stock en cours d'utilisation (pesage_quantity).
   *
   * @param qtyToOpen quantite a transferer
   * @returns total qty effectivement ouverte (clamp si economat insuffisant)
   *
   * Effets :
   *   - economat_quantity -= qtyToOpen
   *   - pesage_quantity += qtyToOpen
   *   - first_opened_at fixe a NOW si premiere ouverture du lot
   *   - effective_expiry_after_opening calcule (MIN DLC originale et opening + shelf_life_after_opening_days)
   *   - opening_history append
   *   - inventory_transactions type='open_container'
   */
  async openContainer(
    client: PoolClient,
    lotId: string,
    qtyToOpen: number,
    userId?: string,
    note?: string
  ): Promise<number> {
    if (qtyToOpen <= 0) return 0;

    const lockResult = await client.query(
      `SELECT il.id, il.economat_quantity, il.pesage_quantity, il.first_opened_at,
              il.expiration_date, il.ingredient_id, il.store_id,
              ing.name AS ingredient_name
         FROM ingredient_lots il
         JOIN ingredients ing ON ing.id = il.ingredient_id
        WHERE il.id = $1
        FOR UPDATE`,
      [lotId]
    );
    if (lockResult.rowCount === 0) {
      throw new Error(`Lot ${lotId} introuvable`);
    }
    const lot = lockResult.rows[0];

    const economatAvailable = parseFloat(lot.economat_quantity);
    const actualToOpen = Math.min(qtyToOpen, economatAvailable);
    if (actualToOpen <= 0) return 0;

    const now = new Date();

    // Append entry à opening_history (audit ouverture, mais la DLC ingredient
    // reste celle imprimee sur le paquet — pas de DLV apres ouverture pour
    // les ingredients, contrairement aux produits finis).
    const newHistoryEntry = {
      qty: actualToOpen,
      opened_at: now.toISOString(),
      opened_by: userId ?? null,
      note: note ?? null,
    };

    await client.query(
      `UPDATE ingredient_lots
         SET economat_quantity = economat_quantity - $1,
             pesage_quantity = pesage_quantity + $1,
             first_opened_at = COALESCE(first_opened_at, $2::timestamptz),
             opening_history = opening_history || $3::jsonb
       WHERE id = $4`,
      [actualToOpen, now.toISOString(), JSON.stringify(newHistoryEntry), lotId]
    );

    // Trace mouvement
    await client.query(
      `INSERT INTO inventory_transactions
         (ingredient_id, type, quantity_change, note, performed_by, store_id, ingredient_lot_id)
       VALUES ($1, 'open_container', $2, $3, $4, $5, $6)`,
      [lot.ingredient_id, actualToOpen,
       note ?? `Ouverture contenant: ${lot.ingredient_name} x${actualToOpen}`,
       userId ?? null, lot.store_id, lotId]
    );

    return actualToOpen;
  },

  /**
   * FEFO consumption : consume ingredient depuis le stock Pesage uniquement.
   * Si Pesage insuffisant, ouvre automatiquement N contenants depuis Économat
   * (selon container_size de l'ingredient) pour combler le déficit.
   */
  async consumeFEFO(
    client: PoolClient,
    ingredientId: string,
    quantityNeeded: number,
    productionPlanId: string,
    storeId?: string
  ): Promise<{ lotId: string; quantityUsed: number }[]> {
    if (quantityNeeded <= 0) return [];

    // 1. Vérifier le stock Pesage disponible
    const pesageStockResult = await client.query(
      `SELECT COALESCE(SUM(pesage_quantity), 0) as pesage_total
         FROM ingredient_lots
        WHERE ingredient_id = $1 AND status = 'active' AND pesage_quantity > 0
          ${storeId ? 'AND store_id = $2' : ''}`,
      storeId ? [ingredientId, storeId] : [ingredientId]
    );
    const pesageAvailable = parseFloat(pesageStockResult.rows[0].pesage_total);

    // 2. Si Pesage insuffisant : auto-ouverture depuis Économat
    if (pesageAvailable < quantityNeeded) {
      const deficit = quantityNeeded - pesageAvailable;

      // Récupère container_size pour calculer le nombre de contenants à ouvrir
      const ingResult = await client.query(
        `SELECT container_size, name FROM ingredients WHERE id = $1`,
        [ingredientId]
      );
      const containerSize = parseFloat(ingResult.rows[0]?.container_size) || 0;
      const ingredientName = ingResult.rows[0]?.name || 'inconnu';

      // Lots Économat dispo (FEFO)
      const economatLotsResult = await client.query(
        `SELECT id, economat_quantity FROM ingredient_lots
          WHERE ingredient_id = $1 AND status = 'active' AND economat_quantity > 0
            ${storeId ? 'AND store_id = $2' : ''}
          ORDER BY expiration_date ASC NULLS LAST, received_at ASC
          FOR UPDATE`,
        storeId ? [ingredientId, storeId] : [ingredientId]
      );

      let stillNeedToOpen = deficit;
      for (const ecoLot of economatLotsResult.rows) {
        if (stillNeedToOpen <= 0) break;

        const ecoQty = parseFloat(ecoLot.economat_quantity);
        // On ouvre au moins l'equivalent du déficit, arrondi au container superieur si possible
        let openQty: number;
        if (containerSize > 0) {
          const containersNeeded = Math.ceil(stillNeedToOpen / containerSize);
          openQty = Math.min(containersNeeded * containerSize, ecoQty);
        } else {
          openQty = Math.min(stillNeedToOpen, ecoQty);
        }

        await this.openContainer(
          client, ecoLot.id, openQty,
          undefined,
          `Auto-ouverture pour production: ${ingredientName} (besoin ${deficit.toFixed(2)})`
        );
        stillNeedToOpen -= openQty;
      }

      if (stillNeedToOpen > 0) {
        // Pesage + Economat reunis insuffisants — on continue quand meme,
        // le warning sera traite cote production.repository.
        console.warn(`[consumeFEFO] Stock total insuffisant pour ${ingredientName}: manque ${stillNeedToOpen.toFixed(2)}`);
      }
    }

    // 3. Maintenant on consomme depuis Pesage en FEFO sur la DLC
    const lotsResult = await client.query(
      `SELECT id, pesage_quantity, expiration_date, status
         FROM ingredient_lots
        WHERE ingredient_id = $1 AND status = 'active' AND pesage_quantity > 0
          ${storeId ? 'AND store_id = $2' : ''}
        ORDER BY expiration_date ASC NULLS LAST,
                 first_opened_at ASC NULLS FIRST,
                 received_at ASC
        FOR UPDATE`,
      storeId ? [ingredientId, storeId] : [ingredientId]
    );

    const consumed: { lotId: string; quantityUsed: number }[] = [];
    let remaining = quantityNeeded;

    for (const lot of lotsResult.rows) {
      if (remaining <= 0) break;

      const available = parseFloat(lot.pesage_quantity);
      const take = Math.min(available, remaining);

      await client.query(
        `UPDATE ingredient_lots
            SET pesage_quantity = pesage_quantity - $1,
                status = CASE
                  WHEN economat_quantity = 0 AND pesage_quantity - $1 <= 0 THEN 'depleted'
                  ELSE status
                END
          WHERE id = $2`,
        [take, lot.id]
      );

      await client.query(
        `INSERT INTO production_lot_usage (production_plan_id, ingredient_lot_id, ingredient_id, quantity_used)
         VALUES ($1, $2, $3, $4)`,
        [productionPlanId, lot.id, ingredientId, take]
      );

      consumed.push({ lotId: lot.id, quantityUsed: take });
      remaining -= take;
    }

    return consumed;
  },

  /** Preview FEFO lot allocation for a production plan (read-only, no consumption) */
  async previewFEFO(planId: string, storeId?: string) {
    // 1. Get ingredient needs for this plan
    const needsResult = await db.query(
      `SELECT pin.ingredient_id, ing.name AS ingredient_name, ing.unit AS ingredient_unit,
              SUM(pin.needed_quantity) AS needed_quantity
       FROM production_ingredient_needs pin
       JOIN ingredients ing ON ing.id = pin.ingredient_id
       WHERE pin.plan_id = $1
       GROUP BY pin.ingredient_id, ing.name, ing.unit
       ORDER BY ing.name`,
      [planId]
    );

    const preview = [];

    for (const need of needsResult.rows) {
      const neededQty = parseFloat(need.needed_quantity);

      // 2. Get lots with remaining quantity, FEFO order — active first, expired as fallback
      const conditions = [`il.ingredient_id = $1`, `il.status IN ('active', 'expired')`, `il.quantity_remaining > 0`];
      const values: unknown[] = [need.ingredient_id];
      if (storeId) { conditions.push(`il.store_id = $2`); values.push(storeId); }

      const lotsResult = await db.query(
        `SELECT il.id AS lot_id, il.lot_number, il.supplier_lot_number, il.quantity_remaining,
                il.expiration_date, il.received_at, il.status AS lot_status,
                s.name AS supplier_name,
                CASE WHEN il.expiration_date IS NOT NULL
                     THEN il.expiration_date - CURRENT_DATE
                     ELSE NULL END AS days_until_expiry
         FROM ingredient_lots il
         LEFT JOIN suppliers s ON s.id = il.supplier_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY CASE WHEN il.status = 'active' THEN 0 ELSE 1 END,
                  il.expiration_date ASC NULLS LAST, il.received_at ASC`,
        values
      );

      // 3. Simulate FEFO allocation (read-only)
      const lots = [];
      let remaining = neededQty;
      let totalAvailable = 0;

      for (const lot of lotsResult.rows) {
        const available = parseFloat(lot.quantity_remaining);
        totalAvailable += available;

        if (remaining <= 0) continue; // still count totalAvailable but don't allocate

        const take = Math.min(available, remaining);
        const daysUntilExpiry = lot.days_until_expiry !== null ? parseInt(lot.days_until_expiry) : null;

        lots.push({
          lotId: lot.lot_id,
          lotNumber: lot.lot_number || '',
          supplierLotNumber: lot.supplier_lot_number || '',
          quantityAvailable: available,
          quantityToUse: take,
          expirationDate: lot.expiration_date ? lot.expiration_date.toISOString().split('T')[0] : null,
          daysUntilExpiry,
          isExpiringSoon: daysUntilExpiry !== null && daysUntilExpiry < 3,
          supplierName: lot.supplier_name || null,
        });

        remaining -= take;
      }

      preview.push({
        ingredientId: need.ingredient_id,
        ingredientName: need.ingredient_name,
        ingredientUnit: need.ingredient_unit,
        neededQuantity: neededQty,
        lots,
        totalAvailableFromLots: totalAvailable,
        shortfall: Math.max(0, neededQty - totalAvailable),
      });
    }

    return preview;
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

  /**
   * Envoie un lot aux pertes : retire l'integralite du stock (Economat + Pesage),
   * trace dans inventory_transactions type='waste' avec motif explicite,
   * passe le lot en status='waste'.
   *
   * @param reason 'dlc_expired' | 'dlv_expired' | 'damaged' | 'quarantine_failed' | 'other'
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
        `SELECT il.id, il.economat_quantity, il.pesage_quantity, il.unit_cost,
                il.expiration_date, il.lot_number,
                il.ingredient_id, il.store_id, il.status,
                ing.name AS ingredient_name, ing.unit AS ingredient_unit
           FROM ingredient_lots il
           JOIN ingredients ing ON ing.id = il.ingredient_id
          WHERE il.id = $1
          FOR UPDATE`,
        [lotId]
      );
      if (lockResult.rowCount === 0) {
        throw new Error(`Lot ${lotId} introuvable`);
      }
      const lot = lockResult.rows[0];

      if (lot.status === 'waste' || lot.status === 'depleted') {
        throw new Error(`Lot deja traite (statut: ${lot.status})`);
      }

      const economatQty = parseFloat(lot.economat_quantity) || 0;
      const pesageQty = parseFloat(lot.pesage_quantity) || 0;
      const totalLost = economatQty + pesageQty;
      const unitCost = parseFloat(lot.unit_cost) || 0;
      const lostValue = totalLost * unitCost;

      // Mapping des motifs pour libelle UI (DLV non applicable aux ingredients)
      const reasonLabels: Record<string, string> = {
        dlc_expired: 'DLC expiree',
        damaged: 'Lot endommage',
        quarantine_failed: 'Echec controle qualite',
        other: 'Autre',
      };
      const reasonLabel = reasonLabels[reason] || reasonLabels.other;

      // Trace mouvement de waste
      if (totalLost > 0) {
        await client.query(
          `INSERT INTO inventory_transactions
             (ingredient_id, type, quantity_change, note, performed_by, store_id, ingredient_lot_id)
           VALUES ($1, 'waste', $2, $3, $4, $5, $6)`,
          [
            lot.ingredient_id,
            -totalLost,
            `${reasonLabel} — Lot ${lot.lot_number} : ${totalLost.toFixed(3)} ${lot.ingredient_unit} (${lostValue.toFixed(2)} DH)${note ? ' — ' + note : ''}`,
            userId,
            lot.store_id,
            lotId,
          ]
        );
      }

      // Marque le lot comme rebut
      const updatedLot = await client.query(
        `UPDATE ingredient_lots
            SET status = 'waste',
                economat_quantity = 0,
                pesage_quantity = 0,
                notes = COALESCE(notes, '') || E'\\n[' || NOW()::date::text || '] Envoyé aux pertes : ' || $2
          WHERE id = $1
          RETURNING *`,
        [lotId, reasonLabel + (note ? ' — ' + note : '')]
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

  /**
   * Liste des lots avec DLC ou DLV depassee qui sont encore actifs (a traiter).
   * Utilise par l'UI pour afficher la bande alerte + dialog de gestion en bloc.
   */
  async findExpiredActiveLots(storeId?: string) {
    const conditions: string[] = [
      `il.status = 'active'`,
      `(il.economat_quantity + il.pesage_quantity) > 0`,
      `il.expiration_date IS NOT NULL AND il.expiration_date < CURRENT_DATE`,
    ];
    const values: unknown[] = [];
    if (storeId) { conditions.push(`il.store_id = $1`); values.push(storeId); }

    const result = await db.query(
      `SELECT il.id, il.lot_number, il.supplier_lot_number,
              il.economat_quantity, il.pesage_quantity,
              (il.economat_quantity + il.pesage_quantity) as total_qty,
              il.expiration_date, il.first_opened_at, il.unit_cost,
              ing.id as ingredient_id, ing.name as ingredient_name, ing.unit as ingredient_unit, ing.category,
              'dlc_expired' as expiry_reason,
              (CURRENT_DATE - il.expiration_date) as days_expired
         FROM ingredient_lots il
         JOIN ingredients ing ON ing.id = il.ingredient_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY (CURRENT_DATE - il.expiration_date) DESC, ing.name`,
      values
    );
    return result.rows;
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
