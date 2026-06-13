import { db } from '../config/database.js';
import { receptionVoucherRepository } from './reception-voucher.repository.js';
import { getLocalYear } from '../utils/timezone.js';

export const purchaseOrderRepository = {
  async findAll(params: { supplierId?: string; status?: string; dateFrom?: string; dateTo?: string; storeId?: string }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.storeId) { conditions.push(`po.store_id = $${i++}`); values.push(params.storeId); }
    if (params.supplierId) { conditions.push(`po.supplier_id = $${i++}`); values.push(params.supplierId); }
    if (params.status) { conditions.push(`po.status = $${i++}`); values.push(params.status); }
    if (params.dateFrom) { conditions.push(`po.order_date >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`po.order_date <= $${i++}`); values.push(params.dateTo); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await db.query(
      `SELECT po.*, s.name as supplier_name,
              u.first_name || ' ' || u.last_name as created_by_name,
              (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = po.id) as item_count,
              (SELECT COALESCE(SUM(quantity_ordered * COALESCE(unit_price, 0)), 0) FROM purchase_order_items WHERE purchase_order_id = po.id) as total_amount,
              (SELECT COALESCE(SUM(quantity_delivered * COALESCE(unit_price, 0)), 0) FROM purchase_order_items WHERE purchase_order_id = po.id) as delivered_amount,
              (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = po.id AND unit_price IS NULL) as items_without_price
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN users u ON u.id = po.created_by
       ${where}
       ORDER BY po.order_date DESC, po.created_at DESC`,
      values
    );
    return result.rows;
  },

  async findEligibleForExpense(storeId?: string) {
    const storeFilter = storeId ? 'AND po.store_id = $1' : '';
    const params = storeId ? [storeId] : [];
    const result = await db.query(
      `SELECT po.id, po.order_number, po.order_date, po.status, po.supplier_id,
              s.name as supplier_name,
              (SELECT COALESCE(SUM(quantity_delivered * COALESCE(unit_price, 0)), 0) FROM purchase_order_items WHERE purchase_order_id = po.id) as total_amount
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.status IN ('livre_complet', 'livre_partiel', 'envoye', 'en_attente', 'en_attente_facturation')
       ${storeFilter}
       ORDER BY po.order_date DESC`,
      params
    );
    return result.rows;
  },

  async findById(id: string) {
    const poResult = await db.query(
      `SELECT po.*, s.name as supplier_name, s.phone as supplier_phone, s.contact_name as supplier_contact,
              u.first_name || ' ' || u.last_name as created_by_name
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN users u ON u.id = po.created_by
       WHERE po.id = $1`,
      [id]
    );
    if (!poResult.rows[0]) return null;

    const itemsResult = await db.query(
      `SELECT poi.*, ing.name as ingredient_name, ing.unit as ingredient_unit
       FROM purchase_order_items poi
       JOIN ingredients ing ON ing.id = poi.ingredient_id
       WHERE poi.purchase_order_id = $1
       ORDER BY ing.name`,
      [id]
    );

    return { ...poResult.rows[0], items: itemsResult.rows };
  },

  async generateOrderNumber(client?: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, string>[] }> }): Promise<string> {
    const runner = client ?? db;
    // Advisory lock prevents concurrent POs from generating the same number
    await runner.query(`SELECT pg_advisory_xact_lock(hashtext('po_number'))`);
    const year = getLocalYear();
    const result = await runner.query(
      `SELECT COUNT(*) FROM purchase_orders WHERE EXTRACT(YEAR FROM order_date) = $1`,
      [year]
    );
    const seq = parseInt((result.rows[0] as Record<string, string>).count) + 1;
    return `BC-${year}-${String(seq).padStart(4, '0')}`;
  },

  async create(data: {
    supplierId: string; expectedDeliveryDate?: string; notes?: string;
    createdBy: string; storeId?: string;
    items: { ingredientId: string; quantityOrdered: number; unitPrice?: number | null }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // generateOrderNumber DOIT recevoir le client transactionnel : sans ca,
      // il emprunte une 2e connexion au pool pendant qu'on en detient deja une
      // en BEGIN. Sur retry/concurrence, le pool sature et toutes les requetes
      // hangent indefiniment (deadlock de pool).
      const orderNumber = await this.generateOrderNumber(client);
      const poResult = await client.query(
        `INSERT INTO purchase_orders (order_number, supplier_id, expected_delivery_date, notes, created_by, store_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [orderNumber, data.supplierId, data.expectedDeliveryDate || null,
         data.notes || null, data.createdBy, data.storeId || null]
      );

      for (const item of data.items) {
        await client.query(
          `INSERT INTO purchase_order_items (purchase_order_id, ingredient_id, quantity_ordered, unit_price)
           VALUES ($1, $2, $3, $4)`,
          [poResult.rows[0].id, item.ingredientId, item.quantityOrdered, item.unitPrice ?? null]
        );
      }

      await client.query('COMMIT');
      return poResult.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async updateStatus(id: string, status: string) {
    const result = await db.query(
      `UPDATE purchase_orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, id]
    );
    return result.rows[0];
  },

  async confirmDelivery(
    id: string,
    items: { itemId: string; quantityDelivered: number; unitPrice?: number | null; supplierLotNumber?: string; expirationDate?: string; manufacturedDate?: string }[],
    performedBy: string,
    storeId?: string,
    supplierInvoiceNumber?: string,
    supplierInvoiceDate?: string,
  ) {
    // Get PO items to map ingredientId
    const po = await this.findById(id);
    if (!po) throw new Error('Bon de commande non trouve');

    const rvItems = items
      .filter(it => it.quantityDelivered > 0)
      .map(it => {
        const poItem = po.items.find((pi: Record<string, unknown>) => pi.id === it.itemId);
        return {
          poItemId: it.itemId,
          ingredientId: poItem?.ingredient_id as string,
          quantityReceived: it.quantityDelivered,
          unitPrice: it.unitPrice ?? (poItem?.unit_price ? parseFloat(poItem.unit_price as string) : null),
          supplierLotNumber: it.supplierLotNumber,
          expirationDate: it.expirationDate,
          manufacturedDate: it.manufacturedDate,
        };
      });

    const result = await receptionVoucherRepository.create({
      purchaseOrderId: id,
      notes: `Reception depuis confirmation de livraison BC ${po.order_number}`,
      receivedBy: performedBy,
      storeId,
      supplierInvoiceNumber,
      supplierInvoiceDate,
      items: rvItems,
    });

    return { status: result.status, voucherId: result.id, voucherNumber: result.voucher_number };
  },

  async updateItemPrices(id: string, items: { itemId: string; unitPrice: number }[]) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      for (const item of items) {
        await client.query(
          `UPDATE purchase_order_items SET unit_price = $1 WHERE id = $2 AND purchase_order_id = $3`,
          [item.unitPrice, item.itemId, id]
        );
      }

      // Check if all items now have prices
      const remaining = await client.query(
        `SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = $1 AND unit_price IS NULL`,
        [id]
      );
      const stillMissing = parseInt(remaining.rows[0].count);

      // If was en_attente_facturation and all prices now set, move to livre_complet
      if (stillMissing === 0) {
        const poCheck = await client.query(
          `SELECT status FROM purchase_orders WHERE id = $1`, [id]
        );
        if (poCheck.rows[0]?.status === 'en_attente_facturation') {
          // Check if actually all delivered
          const allItems = await client.query(
            `SELECT quantity_ordered, quantity_delivered FROM purchase_order_items WHERE purchase_order_id = $1`,
            [id]
          );
          const allDelivered = allItems.rows.every(
            (it: Record<string, unknown>) => parseFloat(it.quantity_delivered as string) >= parseFloat(it.quantity_ordered as string)
          );
          if (allDelivered) {
            await client.query(
              `UPDATE purchase_orders SET status = 'livre_complet', updated_at = NOW() WHERE id = $1`, [id]
            );
          }
        }
      }

      // Update ingredient unit_costs
      for (const item of items) {
        const poItem = await client.query(
          `SELECT ingredient_id FROM purchase_order_items WHERE id = $1`, [item.itemId]
        );
        if (poItem.rows[0]) {
          await client.query(
            `UPDATE ingredients SET unit_cost = $1 WHERE id = $2`,
            [item.unitPrice, poItem.rows[0].ingredient_id]
          );
        }
      }

      await client.query('COMMIT');
      return { itemsUpdated: items.length, stillMissingPrices: stillMissing };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Mise a jour de l'en-tete d'un BC (admin/gerant) : notes, date prevue,
   * fournisseur. Pas de status ici — utiliser updateStatus pour ca.
   */
  async updateHeader(id: string, data: {
    supplierId?: string;
    expectedDeliveryDate?: string | null;
    notes?: string | null;
  }) {
    const sets: string[] = []; const values: unknown[] = []; let i = 1;
    if (data.supplierId !== undefined) { sets.push(`supplier_id = $${i++}`); values.push(data.supplierId); }
    if (data.expectedDeliveryDate !== undefined) {
      sets.push(`expected_delivery_date = $${i++}`); values.push(data.expectedDeliveryDate || null);
    }
    if (data.notes !== undefined) { sets.push(`notes = $${i++}`); values.push(data.notes || null); }
    if (sets.length === 0) return this.findById(id);
    sets.push(`updated_at = NOW()`);
    values.push(id);
    const result = await db.query(
      `UPDATE purchase_orders SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return result.rows[0];
  },

  /**
   * Remplace les lignes d'un BC (admin/gerant). Bulk save piloté par l'UI.
   *
   * Diff logique :
   *   - Lignes presentes dans le nouveau payload avec un `id` -> UPDATE en place.
   *     Si quantity_delivered bouge, on repercute le delta sur inventory +
   *     trace inventory_transactions type='adjustment'.
   *   - Lignes absentes du nouveau payload -> DELETE. Refuse si reference par
   *     un reception_voucher_items (FK : suppression impossible sans casser
   *     l'historique de reception).
   *   - Lignes sans `id` dans le nouveau payload -> INSERT. quantity_delivered
   *     defaut a 0 (admin n'est pas cense ajouter du stock sans reception).
   *   - ingredients.unit_cost suit le dernier prix saisi.
   *   - Status BC resynchronise a la fin (livre_complet/partiel/non_livre/en_attente_facturation).
   */
  async replaceItems(
    id: string,
    items: { id?: string; ingredientId: string; quantityOrdered: number; quantityDelivered?: number; unitPrice?: number | null }[],
    performedBy: string,
    storeId?: string,
  ) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const po = await client.query<{ id: string; order_number: string }>(
        `SELECT id, order_number FROM purchase_orders WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!po.rows[0]) { await client.query('ROLLBACK'); return null; }
      const orderNumber = po.rows[0].order_number;

      const current = await client.query<{
        id: string; ingredient_id: string; quantity_ordered: string;
        quantity_delivered: string; unit_price: string | null;
      }>(
        `SELECT id, ingredient_id, quantity_ordered::text, quantity_delivered::text, unit_price::text
         FROM purchase_order_items WHERE purchase_order_id = $1 FOR UPDATE`,
        [id]
      );
      const currentById = new Map(current.rows.map(r => [r.id, r]));
      const incomingIds = new Set(items.filter(it => it.id).map(it => it.id as string));

      // 1. DELETE lignes retirees
      for (const old of current.rows) {
        if (incomingIds.has(old.id)) continue;
        const refs = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM reception_voucher_items WHERE purchase_order_item_id = $1`,
          [old.id]
        );
        if (parseInt(refs.rows[0].count) > 0) {
          throw new Error(
            `Impossible de supprimer la ligne : ${refs.rows[0].count} bon(s) de reception y font reference. ` +
            `Annule les receptions liees d'abord.`
          );
        }
        const oldDel = parseFloat(old.quantity_delivered);
        if (oldDel > 0) {
          // Stock a deja ete impacte par cette ligne — on retire ce qui avait
          // ete ajoute pour garder l'invariant SUM(transactions) = inventory.
          await this._adjustInventory(client, old.ingredient_id, -oldDel, performedBy, storeId,
            `Admin edit BC ${orderNumber} : suppression ligne (annule +${oldDel})`);
        }
        await client.query(`DELETE FROM purchase_order_items WHERE id = $1`, [old.id]);
      }

      // 2. UPDATE lignes existantes / INSERT nouvelles
      for (const it of items) {
        const qord = Number.isFinite(it.quantityOrdered) ? it.quantityOrdered : 0;
        const qdelRaw = it.quantityDelivered;
        const price = it.unitPrice != null && Number.isFinite(it.unitPrice) ? it.unitPrice : null;

        if (it.id && currentById.has(it.id)) {
          const old = currentById.get(it.id)!;
          const oldDel = parseFloat(old.quantity_delivered);
          const newDel = qdelRaw !== undefined ? qdelRaw : oldDel;
          const delta = newDel - oldDel;

          await client.query(
            `UPDATE purchase_order_items
             SET quantity_ordered = $1, quantity_delivered = $2, unit_price = $3
             WHERE id = $4`,
            [qord, newDel, price, it.id]
          );

          if (Math.abs(delta) > 0.0001) {
            await this._adjustInventory(client, old.ingredient_id, delta, performedBy, storeId,
              `Admin edit BC ${orderNumber} : ajustement qty livree (${oldDel} -> ${newDel})`);
          }
        } else {
          // Nouvelle ligne — qty_delivered = 0 par defaut (admin ne touche pas le stock via add).
          const newDel = qdelRaw ?? 0;
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO purchase_order_items (purchase_order_id, ingredient_id, quantity_ordered, quantity_delivered, unit_price)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [id, it.ingredientId, qord, newDel, price]
          );
          if (newDel > 0.0001) {
            // Cas atypique : admin ajoute une ligne avec qty deja livree
            // (typiquement pour rattraper un stock arrive sans BC). On ajuste.
            await this._adjustInventory(client, it.ingredientId, newDel, performedBy, storeId,
              `Admin edit BC ${orderNumber} : ajout ligne avec qty livree ${newDel} (id ${inserted.rows[0].id})`);
          }
        }

        if (price !== null && price > 0) {
          await client.query(`UPDATE ingredients SET unit_cost = $1 WHERE id = $2`, [price, it.ingredientId]);
        }
      }

      // 3. Resync statut du BC
      const allItems = await client.query<{ quantity_ordered: string; quantity_delivered: string; unit_price: string | null }>(
        `SELECT quantity_ordered::text, quantity_delivered::text, unit_price::text
         FROM purchase_order_items WHERE purchase_order_id = $1`,
        [id]
      );
      const rows = allItems.rows;
      const someDelivered = rows.some(r => parseFloat(r.quantity_delivered) > 0);
      const allDelivered = rows.length > 0 && rows.every(
        r => parseFloat(r.quantity_delivered) >= parseFloat(r.quantity_ordered)
      );
      const missingPrices = rows.some(r => r.unit_price == null);

      let newStatus: string;
      if (allDelivered && missingPrices) newStatus = 'en_attente_facturation';
      else if (allDelivered) newStatus = 'livre_complet';
      else if (someDelivered) newStatus = 'livre_partiel';
      else newStatus = 'non_livre';

      await client.query(
        `UPDATE purchase_orders SET status = $1, updated_at = NOW() WHERE id = $2`,
        [newStatus, id]
      );

      await client.query('COMMIT');
      return await this.findById(id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Helper interne : ajuste inventory + trace inventory_transactions.
   * Utilise par replaceItems quand admin modifie qty_delivered ou supprime
   * une ligne deja livree.
   */
  async _adjustInventory(
    client: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> },
    ingredientId: string,
    quantityChange: number,
    performedBy: string,
    storeId: string | undefined,
    note: string,
  ) {
    const storeFilter = storeId ? ' AND store_id = $3' : '';
    const params: unknown[] = [quantityChange, ingredientId];
    if (storeId) params.push(storeId);
    await client.query(
      `UPDATE inventory SET current_quantity = current_quantity + $1, updated_at = NOW()
       WHERE ingredient_id = $2${storeFilter}`,
      params
    );
    await client.query(
      `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, store_id)
       VALUES ($1, 'adjustment', $2, $3, $4, $5)`,
      [ingredientId, quantityChange, note, performedBy, storeId || null]
    );
  },

  async findOverdue(days: number = 3) {
    const result = await db.query(
      `SELECT po.*, s.name as supplier_name,
              (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = po.id) as item_count,
              (SELECT COALESCE(SUM(quantity_ordered * COALESCE(unit_price, 0)), 0) FROM purchase_order_items WHERE purchase_order_id = po.id) as total_amount
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.status IN ('en_attente', 'envoye', 'livre_partiel')
         AND po.expected_delivery_date IS NOT NULL
         AND po.expected_delivery_date < CURRENT_DATE - $1::int * INTERVAL '1 day'
       ORDER BY po.expected_delivery_date ASC`,
      [days]
    );
    return result.rows;
  },

  async delete(id: string) {
    await db.query(
      `DELETE FROM purchase_orders WHERE id = $1 AND status IN ('en_attente', 'annule')`,
      [id]
    );
  },
};
