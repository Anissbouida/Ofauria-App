import { db } from '../config/database.js';
import { adjustProductStock, adjustVitrineStock } from './product-stock.helper.js';
import { productLotRepository } from './product-lot.repository.js';
import { getUserTimezone, getLocalDateString } from '../utils/timezone.js';

export const saleRepository = {
  async findAll(params: {
    dateFrom?: string; dateTo?: string; customerId?: string;
    paymentMethod?: string; userId?: string; search?: string;
    categoryId?: string; productId?: string; storeId?: string;
    paymentStatus?: 'paid' | 'unpaid';
    saleType?: string;
    limit: number; offset: number;
  }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    let needItemJoin = false;

    // Une vente "a plus tard" (payment_status='unpaid') ne compte dans les
    // ventes du jour que lorsqu'elle est encaissee : la liste normale est
    // datee au jour d'encaissement (paid_at) et exclut les impayees ; la vue
    // Impayes liste ces dernieres, datees a leur jour de vente (created_at).
    const isUnpaidView = params.paymentStatus === 'unpaid';
    const dateCol = isUnpaidView ? 's.created_at' : 'COALESCE(s.paid_at, s.created_at)';

    if (params.storeId) { conditions.push(`s.store_id = $${i++}`); values.push(params.storeId); }
    // Filtrer les dates dans le fuseau de l'utilisateur (sinon une vente Montreal le 22 avril a 21h46
    // = 01h46 UTC le 23 avril tombe a tort dans le filtre "23 avril").
    const tzFind = getUserTimezone();
    if (params.dateFrom) { conditions.push(`(${dateCol} AT TIME ZONE '${tzFind}')::date >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`(${dateCol} AT TIME ZONE '${tzFind}')::date <= $${i++}`); values.push(params.dateTo); }
    if (params.customerId) { conditions.push(`s.customer_id = $${i++}`); values.push(params.customerId); }
    if (params.paymentMethod) { conditions.push(`s.payment_method = $${i++}`); values.push(params.paymentMethod); }
    if (isUnpaidView) {
      conditions.push(`s.payment_status = 'unpaid'`);
    } else {
      conditions.push(`s.payment_status IS DISTINCT FROM 'unpaid'`);
    }
    if (params.userId) { conditions.push(`s.user_id = $${i++}`); values.push(params.userId); }
    if (params.saleType) { conditions.push(`s.sale_type = $${i++}`); values.push(params.saleType); }
    if (params.search) { conditions.push(`s.sale_number ILIKE $${i++}`); values.push(`%${params.search}%`); }
    if (params.productId) {
      conditions.push(`s.id IN (SELECT si2.sale_id FROM sale_items si2 WHERE si2.product_id = $${i++})`);
      values.push(params.productId);
      needItemJoin = true;
    }
    if (params.categoryId) {
      conditions.push(`s.id IN (SELECT si3.sale_id FROM sale_items si3 JOIN products p3 ON p3.id = si3.product_id WHERE p3.category_id = $${i++})`);
      values.push(params.categoryId);
      needItemJoin = true;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(DISTINCT s.id) FROM sales s ${where}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    values.push(params.limit, params.offset);
    const result = await db.query(
      `SELECT DISTINCT s.*, c.first_name as customer_first_name, c.last_name as customer_last_name,
              u.first_name as cashier_first_name, u.last_name as cashier_last_name,
              COALESCE(s.paid_at, s.created_at) AS effective_sort_date
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       JOIN users u ON u.id = s.user_id
       ${where}
       ORDER BY effective_sort_date DESC
       LIMIT $${i++} OFFSET $${i}`,
      values
    );

    return { rows: result.rows, total };
  },

  async findById(id: string) {
    const saleResult = await db.query(
      `SELECT s.*, c.first_name as customer_first_name, c.last_name as customer_last_name,
              u.first_name as cashier_first_name, u.last_name as cashier_last_name
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1`,
      [id]
    );
    if (!saleResult.rows[0]) return null;

    const sale = saleResult.rows[0];

    // For advance/delivery sales linked to an order, fetch order items (with real quantities)
    if (sale.order_id && (sale.sale_type === 'advance' || sale.sale_type === 'delivery')) {
      const orderResult = await db.query(
        `SELECT o.subtotal as order_subtotal, o.total as order_total, o.discount_amount as order_discount,
                o.advance_amount as order_advance, o.order_number
         FROM orders o WHERE o.id = $1`,
        [sale.order_id]
      );
      const orderItemsResult = await db.query(
        `SELECT oi.*, p.name as product_name, p.image_url as product_image
         FROM order_items oi JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = $1`,
        [sale.order_id]
      );
      const orderData = orderResult.rows[0] || {};
      return {
        ...sale,
        items: orderItemsResult.rows,
        order_subtotal: orderData.order_subtotal,
        order_total: orderData.order_total,
        order_discount: orderData.order_discount,
        order_advance: orderData.order_advance,
        order_number: orderData.order_number,
      };
    }

    const itemsResult = await db.query(
      `SELECT si.*, p.name as product_name, p.image_url as product_image
       FROM sale_items si JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = $1`,
      [id]
    );

    return { ...sale, items: itemsResult.rows };
  },

  async findBySaleNumber(saleNumber: string) {
    const saleResult = await db.query(
      `SELECT s.*, c.first_name as customer_first_name, c.last_name as customer_last_name,
              u.first_name as cashier_first_name, u.last_name as cashier_last_name
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       JOIN users u ON u.id = s.user_id
       WHERE s.sale_number = $1`,
      [saleNumber]
    );
    if (!saleResult.rows[0]) return null;

    const itemsResult = await db.query(
      `SELECT si.*, p.name as product_name, p.image_url as product_image
       FROM sale_items si JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = $1`,
      [saleResult.rows[0].id]
    );

    return { ...saleResult.rows[0], items: itemsResult.rows };
  },

  async create(data: {
    customerId?: string; userId: string;
    subtotal: number; taxAmount: number; discountAmount: number; total: number;
    paymentMethod: string; notes?: string; sessionId?: string; storeId?: string;
    advanceAmount?: number; advanceDate?: string | null; orderId?: string;
    skipStockDeduction?: boolean;
    saleType?: 'standard' | 'advance' | 'delivery' | 'special';
    createdAt?: string; // override (vente saisie a posteriori, ex: special B2B)
    paymentStatus?: 'paid' | 'unpaid';
    unpaidCustomerName?: string;
    employeeId?: string;
    sachetsGiven?: number;
    sachetsSuggested?: number;
    sachetReason?: string;
    channelId?: string | null; // mig 172
    items: { productId: string; quantity: number; unitPrice: number; subtotal: number; unit?: 'unit' | 'g'; displayUnit?: 'g' | 'kg' | null }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const saleNumber = await generateSaleNumber(client);

      const paymentStatus = data.paymentStatus || 'paid';
      // paid_at est NULL pour une vente impayee : sera renseigne lors de l'encaissement differe.
      // Pour une vente saisie a posteriori (special B2B), on prend la date fournie.
      // channel_id (mig 172) est en $22 ; createdAt eventuel passe en $23.
      const createdAtExpr = data.createdAt ? `$23` : 'NOW()';
      const paidAtExpr = paymentStatus === 'paid' ? (data.createdAt ? '$23' : 'NOW()') : 'NULL';
      const insertValues: unknown[] = [
        saleNumber, data.customerId || null, data.userId, data.subtotal,
        data.taxAmount, data.discountAmount, data.total, data.paymentMethod, data.notes || null, data.sessionId || null, data.storeId || null,
        data.advanceAmount || 0, data.advanceDate || null, data.orderId || null, data.saleType || 'standard',
        paymentStatus, data.unpaidCustomerName || null, data.employeeId || null,
        data.sachetsGiven ?? null, data.sachetsSuggested ?? null, data.sachetReason || null,
        data.channelId || null,
      ];
      if (data.createdAt) insertValues.push(data.createdAt);

      const saleResult = await client.query(
        `INSERT INTO sales (sale_number, customer_id, user_id, subtotal, tax_amount, discount_amount, total, payment_method, notes, session_id, store_id, advance_amount, advance_date, order_id, sale_type, payment_status, paid_at, unpaid_customer_name, employee_id, sachets_given, sachets_suggested, sachet_reason, channel_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, ${paidAtExpr}, $17, $18, $19, $20, $21, $22, ${createdAtExpr}) RETURNING *`,
        insertValues
      );

      for (const item of data.items) {
        await client.query(
          `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal, unit, display_unit)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [saleResult.rows[0].id, item.productId, item.quantity, item.unitPrice, item.subtotal, item.unit || 'unit', item.displayUnit || null]
        );

        // Decrement vitrine (display) stock for regular POS sales only.
        // - 'standard'  (vente directe POS) : decremente la vitrine.
        // - 'advance'   (avance sur commande client) : produit pas encore
        //               fabrique, pas de stock a decrementer.
        // - 'delivery'  (livraison commande client deja payee partiellement) :
        //               le produit a ete fabrique specifiquement pour la
        //               commande via un plan de production + BSI, il n'a
        //               jamais transite par la vitrine commune — on ne touche
        //               pas au stock vitrine.
        const shouldSkipStock =
          data.saleType === 'advance' ||
          data.saleType === 'delivery' ||
          data.skipStockDeduction === true;
        if (!shouldSkipStock) {
          if (!data.storeId) {
            throw new Error('storeId requis pour une vente POS (vitrine strictement par magasin)');
          }
          // Phase A — Securite alimentaire : rejet si DLV ou DDE atteinte sur tous
          // les lots disponibles. Le check est defensif (en plus du masquage UI).
          const saleabilityIssue = await productLotRepository.checkSaleability(item.productId, data.storeId);
          if (saleabilityIssue) {
            const reasonLabel = saleabilityIssue.reason === 'DDE_EXPIREE'
              ? 'duree d\'exposition vitrine (DDE)'
              : 'date limite de vente (DLV)';
            const err = new Error(
              `Vente refusee : ${reasonLabel} atteinte pour le produit ${item.productId}`
            ) as Error & { code?: string; statusCode?: number };
            err.code = saleabilityIssue.reason;
            err.statusCode = 409;
            throw err;
          }

          const stockAfter = await adjustVitrineStock(client, item.productId, data.storeId, -item.quantity);
          await client.query(
            `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, reference_id, performed_by, store_id)
             VALUES ($1, 'sale', $2, $3, $4, $5, $6, $7)`,
            [item.productId, -item.quantity, stockAfter,
             `Vente ${saleNumber}`, saleResult.rows[0].id, data.userId, data.storeId]
          );

          // Phase 1 — Mirror sur product_lots FEFO : decremente vitrine_qty
          // des lots les plus proches de leur DLC. Le decompte par lot est
          // ce qui rendra la tracabilite sortie possible (audit HACCP).
          // FEFO exclut deja les lots expires par defaut (Phase A).
          const fefoPlan = await productLotRepository.planFefoVitrineConsumption(
            client, item.productId, data.storeId, item.quantity
          );
          for (const step of fefoPlan) {
            await productLotRepository.consumeVitrineSold(client, step.lotId, step.qty);
          }
        }
      }

      // Update customer loyalty — seulement pour les ventes effectivement payees.
      // Les ventes impayees attribuent les points lors de l'encaissement differe.
      if (data.customerId && paymentStatus === 'paid') {
        const loyaltyPoints = Math.floor(data.total);
        await client.query(
          `UPDATE customers SET total_spent = total_spent + $1, loyalty_points = loyalty_points + $2 WHERE id = $3`,
          [data.total, loyaltyPoints, data.customerId]
        );
      }

      await client.query('COMMIT');
      return saleResult.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // Modification d'une vente speciale B2B : reservee a l'admin, restreinte
  // aux ventes sale_type='special' (les ventes POS standard ne sont pas
  // editables retroactivement pour preserver l'integrite comptable).
  // On remplace tous les sale_items (delete + reinsert) pour simplifier
  // la gestion des ajouts/suppressions de lignes.
  async updateSpecial(saleId: string, data: {
    customerId: string;
    subtotal: number; discountAmount: number; total: number;
    paymentMethod: string;
    paymentStatus: 'paid' | 'unpaid';
    notes?: string;
    createdAt?: string;
    items: { productId: string; quantity: number; unitPrice: number; subtotal: number }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const existing = await client.query(
        `SELECT id, sale_type, customer_id, total, payment_status FROM sales WHERE id = $1 FOR UPDATE`,
        [saleId]
      );
      if (!existing.rows[0]) {
        await client.query('ROLLBACK');
        return { ok: false as const, reason: 'not_found' as const };
      }
      if (existing.rows[0].sale_type !== 'special') {
        await client.query('ROLLBACK');
        return { ok: false as const, reason: 'not_special' as const };
      }

      const prev = existing.rows[0];
      // Rollback loyalty effet de la vente precedente (si elle etait payee).
      if (prev.customer_id && prev.payment_status === 'paid') {
        const prevPoints = Math.floor(parseFloat(prev.total as string) || 0);
        await client.query(
          `UPDATE customers SET total_spent = GREATEST(0, total_spent - $1), loyalty_points = GREATEST(0, loyalty_points - $2) WHERE id = $3`,
          [parseFloat(prev.total as string) || 0, prevPoints, prev.customer_id]
        );
      }

      const paidAtExpr = data.paymentStatus === 'paid'
        ? (data.createdAt ? `$8::timestamptz` : 'NOW()')
        : 'NULL';
      const createdAtExpr = data.createdAt ? `$8::timestamptz` : 'created_at';
      // Quand impaye : payment_method = 'credit' (cf. controller createSpecial).
      const effectiveMethod = data.paymentStatus === 'unpaid' ? 'credit' : data.paymentMethod;

      const updateValues: unknown[] = [
        data.customerId,
        data.subtotal, data.discountAmount, data.total,
        effectiveMethod, data.notes || null, data.paymentStatus,
      ];
      if (data.createdAt) updateValues.push(data.createdAt);
      updateValues.push(saleId);
      const saleIdParam = `$${updateValues.length}`;

      const updateResult = await client.query(
        `UPDATE sales SET
           customer_id = $1,
           subtotal = $2,
           discount_amount = $3,
           total = $4,
           payment_method = $5,
           notes = $6,
           payment_status = $7,
           paid_at = ${paidAtExpr},
           created_at = ${createdAtExpr}
         WHERE id = ${saleIdParam}
         RETURNING *`,
        updateValues
      );

      // Remplace les lignes : delete + reinsert. Pas de stock vitrine a gerer
      // car les ventes speciales sont skipStockDeduction par construction.
      await client.query(`DELETE FROM sale_items WHERE sale_id = $1`, [saleId]);
      for (const item of data.items) {
        await client.query(
          `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal, unit)
           VALUES ($1, $2, $3, $4, $5, 'unit')`,
          [saleId, item.productId, item.quantity, item.unitPrice, item.subtotal]
        );
      }

      // Reapplique loyalty avec le nouveau montant (si paye).
      if (data.paymentStatus === 'paid') {
        const newPoints = Math.floor(data.total);
        await client.query(
          `UPDATE customers SET total_spent = total_spent + $1, loyalty_points = loyalty_points + $2 WHERE id = $3`,
          [data.total, newPoints, data.customerId]
        );
      }

      await client.query('COMMIT');
      return { ok: true as const, sale: updateResult.rows[0] };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // Suppression d'une vente speciale : hard delete. Reservee a l'admin.
  // Restreinte aux ventes sale_type='special' pour proteger l'integrite des
  // ventes POS (qui ont decremente du stock et generent l'audit caisse).
  // FK ON DELETE CASCADE sur sale_items.
  async deleteSpecial(saleId: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const existing = await client.query(
        `SELECT id, sale_type, customer_id, total, payment_status FROM sales WHERE id = $1 FOR UPDATE`,
        [saleId]
      );
      if (!existing.rows[0]) {
        await client.query('ROLLBACK');
        return { ok: false as const, reason: 'not_found' as const };
      }
      if (existing.rows[0].sale_type !== 'special') {
        await client.query('ROLLBACK');
        return { ok: false as const, reason: 'not_special' as const };
      }

      const prev = existing.rows[0];
      // Rollback loyalty si la vente etait payee.
      if (prev.customer_id && prev.payment_status === 'paid') {
        const prevPoints = Math.floor(parseFloat(prev.total as string) || 0);
        await client.query(
          `UPDATE customers SET total_spent = GREATEST(0, total_spent - $1), loyalty_points = GREATEST(0, loyalty_points - $2) WHERE id = $3`,
          [parseFloat(prev.total as string) || 0, prevPoints, prev.customer_id]
        );
      }

      await client.query(`DELETE FROM sales WHERE id = $1`, [saleId]);
      await client.query('COMMIT');
      return { ok: true as const };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // sessionId : session de caisse encaissante (null si reglement hors caisse,
  // p.ex. un admin qui solde un impaye depuis l'onglet Impayes).
  // paidAt : date d'encaissement choisie (defaut : maintenant). C'est cette
  // date qui rattache la vente au CA d'une journee.
  async markPaid(saleId: string, params: { paymentMethod: string; sessionId: string | null; paidAt?: string | null }) {
    const dbClient = await db.getClient();
    try {
      await dbClient.query('BEGIN');

      // Verrou pessimiste pour empecher un double encaissement concurrent.
      const lockResult = await dbClient.query(
        `SELECT id, customer_id, total, payment_status FROM sales WHERE id = $1 FOR UPDATE`,
        [saleId]
      );
      const existing = lockResult.rows[0];
      if (!existing) {
        await dbClient.query('ROLLBACK');
        return { ok: false as const, reason: 'not_found' as const };
      }
      if (existing.payment_status !== 'unpaid') {
        await dbClient.query('ROLLBACK');
        return { ok: false as const, reason: 'already_paid' as const };
      }

      const result = await dbClient.query(
        `UPDATE sales
           SET payment_status = 'paid',
               paid_at = COALESCE($4::timestamptz, NOW()),
               payment_method = $2,
               session_id = $3
         WHERE id = $1
         RETURNING *`,
        [saleId, params.paymentMethod, params.sessionId, params.paidAt || null]
      );

      // Attribution des points de fidelite au moment de l'encaissement effectif.
      if (existing.customer_id) {
        const total = parseFloat(existing.total);
        const loyaltyPoints = Math.floor(total);
        await dbClient.query(
          `UPDATE customers SET total_spent = total_spent + $1, loyalty_points = loyalty_points + $2 WHERE id = $3`,
          [total, loyaltyPoints, existing.customer_id]
        );
      }

      await dbClient.query('COMMIT');
      return { ok: true as const, sale: result.rows[0] };
    } catch (err) {
      await dbClient.query('ROLLBACK');
      throw err;
    } finally {
      dbClient.release();
    }
  },

  // Ventes "a plus tard" : impayees en attente + celles deja reglees.
  // Une vente reglee est reconnaissable a paid_at > created_at (un encaissement
  // immediat a paid_at = created_at, pose dans le meme INSERT).
  async findDeferred(storeId?: string) {
    const conditions = [
      `(s.payment_status = 'unpaid'
        OR (s.payment_status = 'paid' AND s.paid_at IS NOT NULL AND s.paid_at > s.created_at))`,
    ];
    const values: unknown[] = [];
    if (storeId) { conditions.push(`s.store_id = $1`); values.push(storeId); }

    const result = await db.query(
      `SELECT s.id, s.sale_number, s.total, s.created_at, s.paid_at,
              s.payment_status, s.payment_method, s.unpaid_customer_name,
              c.first_name as customer_first_name, c.last_name as customer_last_name,
              u.first_name as cashier_first_name, u.last_name as cashier_last_name
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       JOIN users u ON u.id = s.user_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY (s.payment_status = 'unpaid') DESC, COALESCE(s.paid_at, s.created_at) DESC`,
      values
    );
    return result.rows;
  },

  async todayStats(storeId?: string) {
    const storeFilter = storeId ? ' AND store_id = $1' : '';
    const storeValues = storeId ? [storeId] : [];
    const tz = getUserTimezone();

    // Une vente a plus tard ne compte qu'au jour de son encaissement (paid_at) ;
    // tant qu'elle est impayee elle est exclue. COALESCE(paid_at, created_at)
    // protege les ventes historiques / imports sans paid_at.
    const result = await db.query(`
      SELECT
        COUNT(*) as total_sales,
        COALESCE(SUM(total), 0) as total_revenue,
        COALESCE(AVG(total), 0) as avg_sale_value
      FROM sales
      WHERE payment_status IS DISTINCT FROM 'unpaid'
        AND (COALESCE(paid_at, created_at) AT TIME ZONE '${tz}')::date = (NOW() AT TIME ZONE '${tz}')::date${storeFilter}
    `, storeValues);

    const itemsResult = await db.query(`
      SELECT COALESCE(SUM(si.quantity), 0) as total_items
      FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE s.payment_status IS DISTINCT FROM 'unpaid'
        AND (COALESCE(s.paid_at, s.created_at) AT TIME ZONE '${tz}')::date = (NOW() AT TIME ZONE '${tz}')::date${storeFilter}
    `, storeValues);

    // Subtract today's refunds from revenue
    const returnsResult = await db.query(`
      SELECT COALESCE(SUM(refund_amount), 0) as total_refunds,
             COUNT(*) as total_returns
      FROM sale_returns
      WHERE type = 'return' AND (created_at AT TIME ZONE '${tz}')::date = (NOW() AT TIME ZONE '${tz}')::date${storeFilter}
    `, storeValues);

    const totalRefunds = parseFloat(returnsResult.rows[0].total_refunds);
    const grossRevenue = parseFloat(result.rows[0].total_revenue);

    return {
      totalSales: parseInt(result.rows[0].total_sales),
      totalRevenue: grossRevenue - totalRefunds,
      avgSaleValue: parseFloat(result.rows[0].avg_sale_value),
      totalItems: parseInt(itemsResult.rows[0].total_items),
      totalRefunds,
      totalReturns: parseInt(returnsResult.rows[0].total_returns),
    };
  },

  async summary(params: { dateFrom?: string; dateTo?: string; groupBy: string; storeId?: string }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    // Les ventes a plus tard non encaissees sont exclues du CA ; une vente
    // encaissee compte au jour de son reglement (paid_at).
    conditions.push(`s.payment_status IS DISTINCT FROM 'unpaid'`);
    if (params.storeId) { conditions.push(`s.store_id = $${i++}`); values.push(params.storeId); }
    // Meme remise en fuseau utilisateur que findAll (evite les decalages de date aux heures limites).
    const tzSum = getUserTimezone();
    if (params.dateFrom) { conditions.push(`(COALESCE(s.paid_at, s.created_at) AT TIME ZONE '${tzSum}')::date >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`(COALESCE(s.paid_at, s.created_at) AT TIME ZONE '${tzSum}')::date <= $${i++}`); values.push(params.dateTo); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Build return conditions for the same date range
    const retConditions: string[] = [];
    const retValues: unknown[] = [];
    let ri = 1;
    if (params.dateFrom) { retConditions.push(`(sr.created_at AT TIME ZONE '${tzSum}')::date >= $${ri++}`); retValues.push(params.dateFrom); }
    if (params.dateTo) { retConditions.push(`(sr.created_at AT TIME ZONE '${tzSum}')::date <= $${ri++}`); retValues.push(params.dateTo); }
    const retWhere = retConditions.length ? `WHERE sr.type = 'return' AND ${retConditions.join(' AND ')}` : `WHERE sr.type = 'return'`;

    if (params.groupBy === 'category') {
      const result = await db.query(
        `SELECT cat.id, cat.name as label,
                COUNT(DISTINCT s.id) as sale_count,
                SUM(si.quantity) as total_quantity,
                SUM(si.subtotal) as total_revenue
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         JOIN products p ON p.id = si.product_id
         JOIN categories cat ON cat.id = p.category_id
         ${where}
         GROUP BY cat.id, cat.name
         ORDER BY total_revenue DESC`,
        values
      );
      // Subtract returned quantities and amounts per category
      const retResult = await db.query(
        `SELECT cat.id,
                COALESCE(SUM(sri.quantity), 0) as returned_qty,
                COALESCE(SUM(sri.subtotal), 0) as returned_amount
         FROM sale_return_items sri
         JOIN sale_returns sr ON sr.id = sri.return_id
         JOIN products p ON p.id = sri.product_id
         JOIN categories cat ON cat.id = p.category_id
         ${retWhere}
         GROUP BY cat.id`,
        retValues
      );
      const retMap: Record<string, { qty: number; amount: number }> = {};
      for (const r of retResult.rows) {
        retMap[r.id] = { qty: parseFloat(r.returned_qty), amount: parseFloat(r.returned_amount) };
      }
      return result.rows.map((row: Record<string, unknown>) => ({
        ...row,
        total_quantity: parseInt(row.total_quantity as string) - (retMap[row.id as string]?.qty || 0),
        total_revenue: parseFloat(row.total_revenue as string) - (retMap[row.id as string]?.amount || 0),
      }));
    }

    if (params.groupBy === 'product') {
      const result = await db.query(
        `SELECT p.id, p.name as label, cat.name as category_name,
                SUM(si.quantity) as total_quantity,
                SUM(si.subtotal) as total_revenue,
                COUNT(DISTINCT s.id) as sale_count
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         JOIN products p ON p.id = si.product_id
         LEFT JOIN categories cat ON cat.id = p.category_id
         ${where}
         GROUP BY p.id, p.name, cat.name
         ORDER BY total_quantity DESC`,
        values
      );
      // Subtract returned quantities and amounts per product
      const retResult = await db.query(
        `SELECT sri.product_id as id,
                COALESCE(SUM(sri.quantity), 0) as returned_qty,
                COALESCE(SUM(sri.subtotal), 0) as returned_amount
         FROM sale_return_items sri
         JOIN sale_returns sr ON sr.id = sri.return_id
         ${retWhere}
         GROUP BY sri.product_id`,
        retValues
      );
      const retMap: Record<string, { qty: number; amount: number }> = {};
      for (const r of retResult.rows) {
        retMap[r.id] = { qty: parseFloat(r.returned_qty), amount: parseFloat(r.returned_amount) };
      }
      return result.rows.map((row: Record<string, unknown>) => ({
        ...row,
        total_quantity: parseInt(row.total_quantity as string) - (retMap[row.id as string]?.qty || 0),
        total_revenue: parseFloat(row.total_revenue as string) - (retMap[row.id as string]?.amount || 0),
      }));
    }

    if (params.groupBy === 'cashier') {
      const result = await db.query(
        `SELECT u.id, u.first_name || ' ' || u.last_name as label, u.role,
                COUNT(s.id) as sale_count,
                SUM(s.total) as total_revenue
         FROM sales s
         JOIN users u ON u.id = s.user_id
         ${where}
         GROUP BY u.id, u.first_name, u.last_name, u.role
         ORDER BY total_revenue DESC`,
        values
      );
      return result.rows;
    }

    if (params.groupBy === 'payment') {
      // On UNION ALL les saisies manuelles (matin+soir, montants `_reel`) — le temps
      // que le POS soit adopte. Voir migration 149.
      const manualConditions: string[] = [];
      const manualValues: unknown[] = [];
      let mi = 1;
      if (params.storeId) { manualConditions.push(`store_id = $${mi++}`); manualValues.push(params.storeId); }
      if (params.dateFrom) { manualConditions.push(`entry_date >= $${mi++}`); manualValues.push(params.dateFrom); }
      if (params.dateTo) { manualConditions.push(`entry_date <= $${mi++}`); manualValues.push(params.dateTo); }
      const manualWhere = manualConditions.length ? `WHERE ${manualConditions.join(' AND ')}` : '';

      const [salesAgg, manualAgg] = await Promise.all([
        db.query(
          `SELECT s.payment_method as label,
                  COUNT(s.id) as sale_count,
                  SUM(s.total) as total_revenue
           FROM sales s
           ${where}
           GROUP BY s.payment_method`,
          values
        ),
        db.query(
          `SELECT
             COALESCE(SUM(COALESCE(matin_cash_reel,0)+COALESCE(soir_cash_reel,0)), 0) as cash_total,
             COALESCE(SUM(COALESCE(matin_carte_reel,0)+COALESCE(soir_carte_reel,0)), 0) as card_total
           FROM manual_shift_entries
           ${manualWhere}`,
          manualValues
        ),
      ]);

      const byMethod = new Map<string, { sale_count: number; total_revenue: number }>();
      for (const r of salesAgg.rows) {
        byMethod.set(r.label as string, {
          sale_count: parseInt(r.sale_count as string) || 0,
          total_revenue: parseFloat(r.total_revenue as string) || 0,
        });
      }
      const manualCash = parseFloat(manualAgg.rows[0]?.cash_total as string) || 0;
      const manualCard = parseFloat(manualAgg.rows[0]?.card_total as string) || 0;
      if (manualCash > 0) {
        const cur = byMethod.get('cash') || { sale_count: 0, total_revenue: 0 };
        byMethod.set('cash', { sale_count: cur.sale_count, total_revenue: cur.total_revenue + manualCash });
      }
      if (manualCard > 0) {
        const cur = byMethod.get('card') || { sale_count: 0, total_revenue: 0 };
        byMethod.set('card', { sale_count: cur.sale_count, total_revenue: cur.total_revenue + manualCard });
      }

      return Array.from(byMethod.entries())
        .map(([label, v]) => ({ label, sale_count: v.sale_count, total_revenue: v.total_revenue }))
        .sort((a, b) => b.total_revenue - a.total_revenue);
    }

    return [];
  },

  async importDailySales(data: {
    date: string;
    userId: string;
    storeId?: string;
    items: { sku: string; productName: string; quantity: number; unitPrice: number; netSales: number; costOfGoods: number }[];
  }) {
    // Validate CSV items before any DB work
    const invalidItems: string[] = [];
    for (const item of data.items) {
      if (!item.quantity || item.quantity <= 0) {
        invalidItems.push(`${item.productName}: quantité invalide (${item.quantity})`);
      }
      if (item.unitPrice < 0) {
        invalidItems.push(`${item.productName}: prix unitaire négatif (${item.unitPrice})`);
      }
      if (item.netSales < 0) {
        invalidItems.push(`${item.productName}: ventes nettes négatives (${item.netSales})`);
      }
    }
    if (invalidItems.length > 0) {
      return { created: false, unmatchedItems: [], invalidItems, saleNumber: null };
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Match products by SKU or name
      const matchedItems: { productId: string; quantity: number; unitPrice: number; subtotal: number; costOfGoods: number }[] = [];
      const unmatchedItems: string[] = [];

      for (const item of data.items) {
        // Try matching by SKU first, then by name
        let productResult = await client.query(
          `SELECT id, price FROM products WHERE sku = $1 LIMIT 1`,
          [item.sku]
        );
        if (!productResult.rows[0]) {
          productResult = await client.query(
            `SELECT id, price FROM products WHERE UPPER(name) = UPPER($1) LIMIT 1`,
            [item.productName]
          );
        }
        if (productResult.rows[0]) {
          matchedItems.push({
            productId: productResult.rows[0].id,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            subtotal: item.netSales,
            costOfGoods: item.costOfGoods || 0,
          });
          // Update SKU if not set
          if (item.sku) {
            await client.query(
              `UPDATE products SET sku = $1 WHERE id = $2 AND sku IS NULL`,
              [item.sku, productResult.rows[0].id]
            );
          }
        } else {
          unmatchedItems.push(`${item.productName} (UGS: ${item.sku})`);
        }
      }

      if (matchedItems.length === 0) {
        await client.query('ROLLBACK');
        return { created: false, unmatchedItems, invalidItems: [], saleNumber: null };
      }

      const subtotal = matchedItems.reduce((sum, i) => sum + i.subtotal, 0);
      const total = subtotal;

      // Generate sale number for the import date (advisory lock prevents race)
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('sale_number'))`);
      const prefix = `IMP-${data.date}-`;
      const seqResult = await client.query(
        `SELECT sale_number FROM sales WHERE sale_number LIKE $1 ORDER BY sale_number DESC LIMIT 1`,
        [prefix + '%']
      );
      let seq = 1;
      if (seqResult.rows.length > 0) {
        const lastSeq = parseInt(seqResult.rows[0].sale_number.split('-').pop() || '0', 10);
        seq = lastSeq + 1;
      }
      const saleNumber = `${prefix}${String(seq).padStart(4, '0')}`;

      const saleResult = await client.query(
        `INSERT INTO sales (sale_number, customer_id, user_id, subtotal, tax_amount, discount_amount, total, payment_method, notes, store_id, created_at)
         VALUES ($1, NULL, $2, $3, 0, 0, $4, 'cash', $5, $6, $7::date + TIME '23:59:00') RETURNING *`,
        [saleNumber, data.userId, subtotal, total, `Import CSV du ${data.date}`, data.storeId || null, data.date]
      );

      for (const item of matchedItems) {
        await client.query(
          `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal)
           VALUES ($1, $2, $3, $4, $5)`,
          [saleResult.rows[0].id, item.productId, item.quantity, item.unitPrice, item.subtotal]
        );
      }

      await client.query('COMMIT');
      return {
        created: true,
        saleNumber,
        saleId: saleResult.rows[0].id,
        matchedCount: matchedItems.length,
        unmatchedItems,
        total,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};

async function generateSaleNumber(client: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, string>[] }> }) {
  // Advisory lock prevents concurrent transactions from reading the same max sequence
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('sale_number'))`);
  const today = getLocalDateString();
  const prefix = `VNT-${today}-`;
  const result = await client.query(
    `SELECT sale_number FROM sales WHERE sale_number LIKE $1 ORDER BY sale_number DESC LIMIT 1`,
    [prefix + '%']
  );
  let seq = 1;
  if (result.rows.length > 0) {
    const lastNum = result.rows[0].sale_number;
    const lastSeq = parseInt(lastNum.split('-').pop() || '0', 10);
    seq = lastSeq + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}
