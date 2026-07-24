import { db } from '../config/database.js';
import { receptionVoucherRepository, createInvoiceFromPo } from './reception-voucher.repository.js';
import { packagingItemRepository } from './packaging-item.repository.js';
import { getLocalYear } from '../utils/timezone.js';
import type { PoolClient } from 'pg';

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
              (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = po.id AND unit_price IS NULL) as items_without_price,
              -- has_invoice : facture liee via la colonne historique
              -- (purchase_order_id) OU via la table de jonction (mig 178)
              -- pour les BCs fusionnes dans une facture unique.
              EXISTS (
                SELECT 1 FROM invoices inv
                LEFT JOIN invoice_purchase_orders ipo ON ipo.invoice_id = inv.id
                WHERE inv.status != 'cancelled'
                  AND (inv.purchase_order_id = po.id OR ipo.purchase_order_id = po.id)
              ) as has_invoice
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

    // Une ligne porte un ingredient OU un consommable (packaging_items). LEFT JOIN
    // sur les deux + COALESCE pour exposer un nom/unite uniformes (les anciens
    // alias ingredient_name/ingredient_unit sont conserves pour le client).
    const itemsResult = await db.query(
      `SELECT poi.*,
              COALESCE(ing.name, pkg.name) as ingredient_name,
              COALESCE(ing.unit, pkg.unit) as ingredient_unit,
              COALESCE(ing.category_id, pkg.category_id) as item_category_id,
              ing.container_size,
              ctc.label as container_type_label,
              CASE WHEN poi.packaging_id IS NOT NULL THEN 'consumable' ELSE 'ingredient' END as kind
       FROM purchase_order_items poi
       LEFT JOIN ingredients ing ON ing.id = poi.ingredient_id
       LEFT JOIN ref_entries ctc ON ctc.id = ing.container_type_id
       LEFT JOIN packaging_items pkg ON pkg.id = poi.packaging_id
       WHERE poi.purchase_order_id = $1
       ORDER BY COALESCE(ing.name, pkg.name)`,
      [id]
    );

    return { ...poResult.rows[0], items: itemsResult.rows };
  },

  async generateOrderNumber(client?: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, string>[] }> }): Promise<string> {
    const runner = client ?? db;
    // Advisory lock prevents concurrent POs from generating the same number
    await runner.query(`SELECT pg_advisory_xact_lock(hashtext('po_number'))`);
    const year = getLocalYear();
    // MAX(seq) + 1 plutot que COUNT(*) + 1 : COUNT decroit quand un BC est
    // supprime au milieu de la sequence (ex: BC-2026-0005), ce qui faisait
    // entrer en collision le prochain numero genere avec un BC existant
    // (-> duplicate key violation sur order_number_key).
    // On extrait les 4 derniers chiffres du format `BC-YYYY-NNNN` et on prend
    // le max ; les numeros hors format sont ignores (COALESCE -> 0).
    const result = await runner.query(
      `SELECT COALESCE(MAX(
         CASE WHEN order_number ~ '^BC-[0-9]{4}-[0-9]+$'
              THEN CAST(SUBSTRING(order_number FROM 9) AS INTEGER)
              ELSE 0 END
       ), 0) AS max_seq
       FROM purchase_orders
       WHERE EXTRACT(YEAR FROM order_date) = $1`,
      [year]
    );
    const seq = parseInt((result.rows[0] as Record<string, string>).max_seq) + 1;
    return `BC-${year}-${String(seq).padStart(4, '0')}`;
  },

  async create(data: {
    supplierId: string; expectedDeliveryDate?: string; notes?: string;
    createdBy: string; storeId?: string;
    // Une ligne porte SOIT un ingredient (matiere premiere) SOIT un consommable
    // (packaging_items). Le routage est decide en amont par la categorie choisie
    // a la creation a la volee (cf. fn_purchasable_kind / CONSUMABLE_ROOT_IDS).
    items: { ingredientId?: string | null; packagingId?: string | null; quantityOrdered: number; unitPrice?: number | null }[];
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
          `INSERT INTO purchase_order_items (purchase_order_id, ingredient_id, packaging_id, quantity_ordered, unit_price)
           VALUES ($1, $2, $3, $4, $5)`,
          [poResult.rows[0].id, item.ingredientId ?? null, item.packagingId ?? null, item.quantityOrdered, item.unitPrice ?? null]
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
    forceComplete?: boolean,
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
          ingredientId: (poItem?.ingredient_id as string | null) ?? null,
          packagingId: (poItem?.packaging_id as string | null) ?? null,
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
      forceComplete,
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
    items: { id?: string; ingredientId?: string | null; packagingId?: string | null; quantityOrdered: number; quantityDelivered?: number; unitPrice?: number | null }[],
    performedBy: string,
    storeId?: string,
  ) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const po = await client.query<{ id: string; order_number: string; status: string }>(
        `SELECT id, order_number, status FROM purchase_orders WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!po.rows[0]) { await client.query('ROLLBACK'); return null; }
      const orderNumber = po.rows[0].order_number;
      const currentStatus = po.rows[0].status;

      const current = await client.query<{
        id: string; ingredient_id: string | null; packaging_id: string | null; quantity_ordered: string;
        quantity_delivered: string; unit_price: string | null;
      }>(
        `SELECT id, ingredient_id, packaging_id, quantity_ordered::text, quantity_delivered::text, unit_price::text
         FROM purchase_order_items WHERE purchase_order_id = $1 FOR UPDATE`,
        [id]
      );
      const currentById = new Map(current.rows.map(r => [r.id, r]));
      const incomingIds = new Set(items.filter(it => it.id).map(it => it.id as string));

      // Store de credit pour les mouvements de stock consommable (store_id NOT NULL).
      const needsConsumableStore = items.some(it => it.packagingId) || current.rows.some(r => r.packaging_id);
      let consumableStoreId: string | null = storeId || null;
      if (!consumableStoreId && needsConsumableStore) {
        const s = await client.query(`SELECT id FROM stores ORDER BY created_at LIMIT 1`);
        consumableStoreId = (s.rows[0]?.id as string | undefined) ?? null;
      }
      // Ajuste le stock d'une ligne selon son type (ingredient -> inventory, consommable -> packaging).
      const adjustLineStock = async (
        line: { ingredient_id?: string | null; packaging_id?: string | null },
        change: number, note: string,
      ) => {
        if (Math.abs(change) <= 0.0001) return;
        if (line.packaging_id) {
          if (!consumableStoreId) return;
          await packagingItemRepository.adjustStock(client as PoolClient, {
            packagingId: line.packaging_id, storeId: consumableStoreId, change,
            type: 'adjustment', referenceId: id, referenceType: 'purchase_order', note, performedBy,
          });
        } else if (line.ingredient_id) {
          await this._adjustInventory(client, line.ingredient_id, change, performedBy, storeId, note);
        }
      };

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
          await adjustLineStock(old, -oldDel,
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
            await adjustLineStock(old, delta,
              `Admin edit BC ${orderNumber} : ajustement qty livree (${oldDel} -> ${newDel})`);
          }
        } else {
          // Nouvelle ligne — qty_delivered = 0 par defaut (admin ne touche pas le stock via add).
          const newDel = qdelRaw ?? 0;
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO purchase_order_items (purchase_order_id, ingredient_id, packaging_id, quantity_ordered, quantity_delivered, unit_price)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [id, it.ingredientId ?? null, it.packagingId ?? null, qord, newDel, price]
          );
          if (newDel > 0.0001) {
            // Cas atypique : admin ajoute une ligne avec qty deja livree
            // (typiquement pour rattraper un stock arrive sans BC). On ajuste.
            await adjustLineStock(
              { ingredient_id: it.ingredientId ?? null, packaging_id: it.packagingId ?? null }, newDel,
              `Admin edit BC ${orderNumber} : ajout ligne avec qty livree ${newDel} (id ${inserted.rows[0].id})`);
          }
        }

        // Le dernier prix saisi fait foi -> repercute sur le cout catalogue.
        if (price !== null && price > 0) {
          if (it.packagingId) {
            await client.query(`UPDATE packaging_items SET unit_cost = $1, updated_at = NOW() WHERE id = $2`, [price, it.packagingId]);
          } else if (it.ingredientId) {
            await client.query(`UPDATE ingredients SET unit_cost = $1 WHERE id = $2`, [price, it.ingredientId]);
          }
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
      // Aucune ligne livree : on NE retombe PAS sur 'non_livre'. Un BC simplement
      // edite alors qu'il n'a encore rien recu doit garder son statut amont
      // (en_attente / envoye / annule). 'non_livre' reste une declaration manuelle
      // (bouton dedie), jamais une consequence d'une edition.
      else if (currentStatus === 'en_attente' || currentStatus === 'envoye' || currentStatus === 'annule') {
        newStatus = currentStatus;
      }
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

  /**
   * Generation manuelle de la facture pour un BC livre.
   *
   * Cas d'usage : la facture auto-generee n'a pas ete creee (typiquement parce
   * que les prix etaient manquants au moment de la reception -> statut
   * en_attente_facturation -> prix saisis a posteriori via updateItemPrices /
   * replaceItems, qui ne re-declenchent pas la creation de facture).
   *
   * Pre-requis : BC livre_complet, toutes les lignes avec prix, pas de facture
   * non-annulee deja liee. Les erreurs sont remontees telles quelles (le
   * controller mappe sur 409/400).
   */
  async generateInvoice(id: string, createdBy: string, storeId: string | null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Verrouille le BC pour serialiser avec une reception concurrente.
      const poRes = await client.query(
        `SELECT id, status FROM purchase_orders WHERE id = $1 FOR UPDATE`,
        [id]
      );
      const po = poRes.rows[0];
      if (!po) { await client.query('ROLLBACK'); return { ok: false, code: 'not_found' as const }; }

      if (po.status !== 'livre_complet') {
        await client.query('ROLLBACK');
        return { ok: false, code: 'wrong_status' as const, status: po.status as string };
      }

      // Garde-fou symetrique a la creation auto : tous les items doivent avoir
      // un prix. Defense en profondeur — le statut livre_complet le garantit
      // deja, mais on prefere une erreur explicite si un invariant a derive.
      const missing = await client.query(
        `SELECT COUNT(*)::text AS count FROM purchase_order_items
         WHERE purchase_order_id = $1 AND unit_price IS NULL`,
        [id]
      );
      if (parseInt(missing.rows[0].count as string) > 0) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'missing_prices' as const };
      }

      const invoice = await createInvoiceFromPo(client, id, null, createdBy, storeId);
      if (invoice === null) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'invoice_exists' as const };
      }

      await client.query('COMMIT');
      return { ok: true as const, invoice };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
