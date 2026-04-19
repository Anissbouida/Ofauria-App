import { db } from '../config/database.js';

export const bonSortieRepository = {

  // ─── Generate a bon de sortie from plan ingredient needs + FEFO preview ───
  async generate(planId: string, storeId: string, userId: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 1. Get ingredient needs for this plan
      const needsResult = await client.query(
        `SELECT pin.ingredient_id, ing.name AS ingredient_name, ing.unit AS ingredient_unit,
                SUM(pin.needed_quantity) AS needed_quantity
         FROM production_ingredient_needs pin
         JOIN ingredients ing ON ing.id = pin.ingredient_id
         WHERE pin.plan_id = $1
         GROUP BY pin.ingredient_id, ing.name, ing.unit
         ORDER BY ing.name`,
        [planId]
      );

      if (needsResult.rows.length === 0) {
        throw new Error('Aucun besoin en ingredients pour ce plan');
      }

      // 2. Generate BSI number: BSI-YYMMDD-NNN
      const now = new Date();
      const yy = String(now.getFullYear()).slice(2);
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const dateStr = `${yy}${mm}${dd}`;

      const countResult = await client.query(
        `SELECT COUNT(*) FROM production_bons_sortie
         WHERE numero LIKE $1`,
        [`BSI-${dateStr}-%`]
      );
      const seq = (parseInt(countResult.rows[0].count) + 1).toString().padStart(3, '0');
      const numero = `BSI-${dateStr}-${seq}`;

      // 3. Create the bon de sortie
      const bonResult = await client.query(
        `INSERT INTO production_bons_sortie (plan_id, store_id, numero, status, generated_by, generated_at)
         VALUES ($1, $2, $3, 'genere', $4, NOW())
         RETURNING *`,
        [planId, storeId, numero, userId]
      );
      const bon = bonResult.rows[0];

      // 4. For each ingredient need, allocate lots via FEFO and create lines
      //    Priority: active lots first, then expired lots as fallback (avoids false ruptures)
      const lines = [];
      for (const need of needsResult.rows) {
        const neededQty = parseFloat(need.needed_quantity);

        // Get lots in FEFO order — active first, then expired as fallback
        const lotsResult = await client.query(
          `SELECT id, lot_number, supplier_lot_number, quantity_remaining, expiration_date, received_at, status
           FROM ingredient_lots
           WHERE ingredient_id = $1 AND store_id = $2
             AND status IN ('active', 'expired') AND quantity_remaining > 0
           ORDER BY
             CASE WHEN status = 'active' THEN 0 ELSE 1 END,
             expiration_date ASC NULLS LAST,
             received_at ASC`,
          [need.ingredient_id, storeId]
        );

        let remaining = neededQty;

        for (const lot of lotsResult.rows) {
          if (remaining <= 0) break;

          const available = parseFloat(lot.quantity_remaining);
          const take = Math.min(available, remaining);
          const isExpired = lot.status === 'expired';

          const lineResult = await client.query(
            `INSERT INTO production_bons_sortie_lignes
               (bon_id, ingredient_id, ingredient_lot_id, needed_quantity, allocated_quantity, unit, status, notes)
             VALUES ($1, $2, $3, $4, $5, $6, 'en_attente', $7)
             RETURNING *`,
            [bon.id, need.ingredient_id, lot.id, neededQty, take, need.ingredient_unit || 'kg',
             isExpired ? `⚠ Lot expire (DLC: ${lot.expiration_date ? new Date(lot.expiration_date).toLocaleDateString('fr-FR') : 'N/A'})` : null]
          );

          lines.push({
            ...lineResult.rows[0],
            ingredient_name: need.ingredient_name,
            ingredient_unit: need.ingredient_unit,
            lot_number: lot.lot_number,
            supplier_lot_number: lot.supplier_lot_number,
            expiration_date: lot.expiration_date,
            lot_expired: isExpired,
          });

          remaining -= take;
        }

        // If remaining > 0, create a line without lot (true shortfall / rupture)
        if (remaining > 0) {
          const lineResult = await client.query(
            `INSERT INTO production_bons_sortie_lignes
               (bon_id, ingredient_id, ingredient_lot_id, needed_quantity, allocated_quantity, unit, status)
             VALUES ($1, $2, NULL, $3, $4, $5, 'rupture')
             RETURNING *`,
            [bon.id, need.ingredient_id, neededQty, remaining, need.ingredient_unit || 'kg']
          );

          lines.push({
            ...lineResult.rows[0],
            ingredient_name: need.ingredient_name,
            ingredient_unit: need.ingredient_unit,
            lot_number: null,
            supplier_lot_number: null,
            expiration_date: null,
          });
        }
      }

      // 5. Link bon to plan
      await client.query(
        `UPDATE production_plans SET bon_sortie_id = $1 WHERE id = $2`,
        [bon.id, planId]
      );

      await client.query('COMMIT');
      return { ...bon, lines };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ─── Get bon(s) for a plan with all lines ───
  async findByPlan(planId: string) {
    const result = await db.query(
      `SELECT bs.*,
              ug.first_name || ' ' || ug.last_name AS generated_by_name,
              up.first_name || ' ' || up.last_name AS prelevement_by_name,
              uv.first_name || ' ' || uv.last_name AS verified_by_name,
              uc.first_name || ' ' || uc.last_name AS closed_by_name
       FROM production_bons_sortie bs
       LEFT JOIN users ug ON ug.id = bs.generated_by
       LEFT JOIN users up ON up.id = bs.prelevement_by
       LEFT JOIN users uv ON uv.id = bs.verified_by
       LEFT JOIN users uc ON uc.id = bs.closed_by
       WHERE bs.plan_id = $1
       ORDER BY bs.created_at DESC`,
      [planId]
    );

    const bons = [];
    for (const bon of result.rows) {
      const linesResult = await db.query(
        `SELECT bsl.*,
                ing.name AS ingredient_name, ing.unit AS ingredient_unit,
                il.lot_number, il.supplier_lot_number, il.expiration_date,
                il.quantity_remaining AS lot_remaining,
                il.status AS lot_status,
                CASE WHEN il.status = 'expired' THEN true ELSE false END AS lot_expired
         FROM production_bons_sortie_lignes bsl
         JOIN ingredients ing ON ing.id = bsl.ingredient_id
         LEFT JOIN ingredient_lots il ON il.id = bsl.ingredient_lot_id
         WHERE bsl.bon_id = $1
         ORDER BY ing.name, il.expiration_date ASC NULLS LAST`,
        [bon.id]
      );
      bons.push({ ...bon, lines: linesResult.rows });
    }

    return bons;
  },

  // ─── Get a single bon with all lines and details ───
  async findById(bonId: string) {
    const result = await db.query(
      `SELECT bs.*,
              pp.plan_date, pp.type AS plan_type, pp.status AS plan_status,
              ug.first_name || ' ' || ug.last_name AS generated_by_name,
              up.first_name || ' ' || up.last_name AS prelevement_by_name,
              uv.first_name || ' ' || uv.last_name AS verified_by_name,
              uc.first_name || ' ' || uc.last_name AS closed_by_name
       FROM production_bons_sortie bs
       LEFT JOIN production_plans pp ON pp.id = bs.plan_id
       LEFT JOIN users ug ON ug.id = bs.generated_by
       LEFT JOIN users up ON up.id = bs.prelevement_by
       LEFT JOIN users uv ON uv.id = bs.verified_by
       LEFT JOIN users uc ON uc.id = bs.closed_by
       WHERE bs.id = $1`,
      [bonId]
    );

    if (result.rows.length === 0) return null;

    const bon = result.rows[0];

    const linesResult = await db.query(
      `SELECT bsl.*,
              ing.name AS ingredient_name, ing.unit AS ingredient_unit,
              il.lot_number, il.supplier_lot_number, il.expiration_date, il.quantity_remaining AS lot_remaining,
              il.status AS lot_status
       FROM production_bons_sortie_lignes bsl
       JOIN ingredients ing ON ing.id = bsl.ingredient_id
       LEFT JOIN ingredient_lots il ON il.id = bsl.ingredient_lot_id
       WHERE bsl.bon_id = $1
       ORDER BY ing.name, il.expiration_date ASC NULLS LAST`,
      [bonId]
    );

    return { ...bon, lines: linesResult.rows };
  },

  // ─── Start prelevement: update status ───
  async startPrelevement(bonId: string, userId: string) {
    const result = await db.query(
      `UPDATE production_bons_sortie
       SET status = 'prelevement', prelevement_by = $1, prelevement_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND status = 'genere'
       RETURNING *`,
      [userId, bonId]
    );
    if (result.rows.length === 0) {
      throw new Error('Bon de sortie introuvable ou statut invalide pour demarrer le prelevement');
    }
    return result.rows[0];
  },

  // ─── Update a line's actual quantity ───
  async updateLigne(ligneId: string, actualQuantity: number, notes?: string) {
    // Get the line + lot status to compute ecart and block expired lots
    const lineResult = await db.query(
      `SELECT bsl.allocated_quantity, il.status AS lot_status
       FROM production_bons_sortie_lignes bsl
       LEFT JOIN ingredient_lots il ON il.id = bsl.ingredient_lot_id
       WHERE bsl.id = $1`,
      [ligneId]
    );
    if (lineResult.rows.length === 0) {
      throw new Error('Ligne de bon de sortie introuvable');
    }

    // Block picking from an expired lot — user must substitute to another lot first
    if (lineResult.rows[0].lot_status === 'expired') {
      throw new Error('Lot expire — prelevement interdit. Utilisez la substitution pour remplacer le lot.');
    }

    const allocated = parseFloat(lineResult.rows[0].allocated_quantity);
    const ecart = actualQuantity - allocated;
    const status = Math.abs(ecart) < 0.001 ? 'preleve' : 'ecart';

    const result = await db.query(
      `UPDATE production_bons_sortie_lignes
       SET actual_quantity = $1, ecart_quantity = $2, status = $3, notes = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [actualQuantity, ecart, status, notes || null, ligneId]
    );
    return result.rows[0];
  },

  // ─── Verify the bon: check all lines are processed ───
  async verify(bonId: string, userId: string) {
    // Check all lines are processed (not en_attente)
    const pendingResult = await db.query(
      `SELECT COUNT(*) FROM production_bons_sortie_lignes
       WHERE bon_id = $1 AND status IN ('en_attente')`,
      [bonId]
    );
    if (parseInt(pendingResult.rows[0].count) > 0) {
      throw new Error('Toutes les lignes doivent etre prelevees avant verification');
    }

    const result = await db.query(
      `UPDATE production_bons_sortie
       SET status = 'verifie', verified_by = $1, verified_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND status = 'prelevement'
       RETURNING *`,
      [userId, bonId]
    );
    if (result.rows.length === 0) {
      throw new Error('Bon de sortie introuvable ou statut invalide pour verification');
    }
    return result.rows[0];
  },

  // ─── Close the bon ───
  async close(bonId: string, userId: string) {
    const result = await db.query(
      `UPDATE production_bons_sortie
       SET status = 'cloture', closed_by = $1, closed_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND status = 'verifie'
       RETURNING *`,
      [userId, bonId]
    );
    if (result.rows.length === 0) {
      throw new Error('Bon de sortie introuvable ou statut invalide pour cloture');
    }
    return result.rows[0];
  },

  // ─── Cancel the bon ───
  async cancel(bonId: string, userId: string) {
    const result = await db.query(
      `UPDATE production_bons_sortie
       SET status = 'annule', updated_at = NOW()
       WHERE id = $1 AND status NOT IN ('cloture', 'annule')
       RETURNING *`,
      [bonId]
    );
    if (result.rows.length === 0) {
      throw new Error('Bon de sortie introuvable ou deja cloture/annule');
    }
    return result.rows[0];
  },

  // ─── Handle ecart: substitute lot or adjust quantity ───
  async handleEcart(bonId: string, ligneId: string, substituteLotId?: string, newQuantity?: number) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Verify the line belongs to the bon
      const lineResult = await client.query(
        `SELECT bsl.*, bs.store_id
         FROM production_bons_sortie_lignes bsl
         JOIN production_bons_sortie bs ON bs.id = bsl.bon_id
         WHERE bsl.id = $1 AND bsl.bon_id = $2`,
        [ligneId, bonId]
      );
      if (lineResult.rows.length === 0) {
        throw new Error('Ligne introuvable pour ce bon de sortie');
      }

      const line = lineResult.rows[0];

      if (substituteLotId) {
        // Substitute with a different lot
        const quantity = newQuantity ?? parseFloat(line.allocated_quantity);
        const ecart = quantity - parseFloat(line.allocated_quantity);

        await client.query(
          `UPDATE production_bons_sortie_lignes
           SET substitute_lot_id = $1, actual_quantity = $2, ecart_quantity = $3, status = 'substitue', updated_at = NOW()
           WHERE id = $4`,
          [substituteLotId, quantity, ecart, ligneId]
        );
      } else if (newQuantity !== undefined) {
        // Just adjust the quantity
        const ecart = newQuantity - parseFloat(line.allocated_quantity);
        const status = Math.abs(ecart) < 0.001 ? 'preleve' : 'ecart';

        await client.query(
          `UPDATE production_bons_sortie_lignes
           SET actual_quantity = $1, ecart_quantity = $2, status = $3, updated_at = NOW()
           WHERE id = $4`,
          [newQuantity, ecart, status, ligneId]
        );
      }

      const updatedResult = await client.query(
        `SELECT bsl.*,
                ing.name AS ingredient_name, ing.unit AS ingredient_unit,
                il.lot_number, il.supplier_lot_number, il.expiration_date
         FROM production_bons_sortie_lignes bsl
         JOIN ingredients ing ON ing.id = bsl.ingredient_id
         LEFT JOIN ingredient_lots il ON il.id = bsl.ingredient_lot_id
         WHERE bsl.id = $1`,
        [ligneId]
      );

      await client.query('COMMIT');
      return updatedResult.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ─── Regenerate: cancel existing bon(s) and create a new one ───
  async regenerate(planId: string, storeId: string, userId: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Cancel existing bons for this plan
      await client.query(
        `UPDATE production_bons_sortie
         SET status = 'annule', updated_at = NOW()
         WHERE plan_id = $1 AND status NOT IN ('cloture', 'annule')`,
        [planId]
      );

      // Clear the link on the plan
      await client.query(
        `UPDATE production_plans SET bon_sortie_id = NULL WHERE id = $1`,
        [planId]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Now generate a fresh bon (this handles its own transaction)
    return this.generate(planId, storeId, userId);
  },
};
