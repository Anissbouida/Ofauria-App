import { db } from '../config/database.js';
import { nextDocumentNumber } from '../utils/document-number.js';
import { applyContainerRule } from '../services/container-rule.js';
import { receptionVoucherRepository, createInvoiceFromPo } from './reception-voucher.repository.js';
import { packagingItemRepository } from './packaging-item.repository.js';
import type { PoolClient } from 'pg';
import { closePurchaseRequestsForOrder } from './purchase-request.helper.js';

/** Ligne de BC en entrée : article (ingrédient / consommable) ou ligne libre (service / immobilisation). */
export type PoLineType = 'ingredient' | 'consumable' | 'service' | 'asset';
export interface PoLineInput {
  ingredientId?: string | null; packagingId?: string | null;
  lineType?: PoLineType | null; description?: string | null; categoryId?: string | null; unit?: string | null;
  quantityOrdered: number; unitPrice?: number | null;
  /** Prix dans la devise du BC (mig 363) ; unitPrice reste en DH. */
  foreignUnitPrice?: number | null;
}

export function lineTypeOf(it: PoLineInput): PoLineType {
  if (it.ingredientId) return 'ingredient';
  if (it.packagingId) return 'consumable';
  return it.lineType === 'asset' ? 'asset' : 'service';
}

/** Champs propres a une ligne sans article ; null pour un ingredient/consommable (le trigger copie la fiche). */
function freeLineFields(it: PoLineInput): { description: string | null; categoryId: string | null; unit: string | null } {
  if (it.ingredientId || it.packagingId) return { description: null, categoryId: null, unit: null };
  return { description: it.description?.trim() || null, categoryId: it.categoryId || null, unit: it.unit?.trim() || 'unit' };
}

export const purchaseOrderRepository = {
  async findAll(params: { supplierId?: string; status?: string; dateFrom?: string; dateTo?: string; storeId?: string; createdBy?: string }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.storeId) { conditions.push(`po.store_id = $${i++}`); values.push(params.storeId); }
    // Portée « own » (mig 335/336) : limiter aux bons créés par l'utilisateur.
    if (params.createdBy) { conditions.push(`po.created_by = $${i++}`); values.push(params.createdBy); }
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
              ) as has_invoice,
              -- Demande d'approbation en attente (lot 8, mig 350) : la table
              -- peut manquer sur une base non migrée, d'où le to_regclass.
              CASE WHEN to_regclass('public.approval_requests') IS NOT NULL THEN EXISTS (
                SELECT 1 FROM approval_requests ar
                WHERE ar.doc_type = 'purchase_order' AND ar.doc_id = po.id::text AND ar.status = 'pending'
              ) ELSE false END as approval_pending
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN users u ON u.id = po.created_by
       ${where}
       ORDER BY po.order_date DESC, po.created_at DESC`,
      values
    );
    return result.rows;
  },

  /**
   * Liste de travail par étape du processus (écran BC) : paginée, filtrée côté
   * serveur. view=open → BC non clôturés ; view=history → clôturés/annulés sur
   * une période. L'étape est dérivée du statut + présence de facture.
   */
  async findBoard(params: {
    storeId?: string; view: 'open' | 'history'; stage?: string; status?: string; supplierId?: string;
    search?: string; dateFrom?: string; dateTo?: string; limit: number; offset: number;
  }) {
    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const cond: string[] = [params.view === 'history' ? `stage IN ('closed', 'cancelled')` : `stage NOT IN ('closed', 'cancelled')`];
    if (params.stage) cond.push(`stage = ${add(params.stage)}`);
    if (params.status) cond.push(`status = ${add(params.status)}`);
    if (params.supplierId) cond.push(`supplier_id = ${add(params.supplierId)}`);
    if (params.search) {
      const p = add(`%${params.search}%`);
      cond.push(`(order_number ILIKE ${p} OR supplier_name ILIKE ${p})`);
    }
    if (params.dateFrom) cond.push(`order_date >= ${add(params.dateFrom)}::date`);
    if (params.dateTo) cond.push(`order_date <= ${add(params.dateTo)}::date`);
    const cte = this._stagedCte(params.storeId ? add(params.storeId) : null);
    const limit = add(params.limit);
    const offset = add(params.offset);
    // Ouverts : le plus urgent d'abord (retard, puis date prévue) ; historique : le plus récent.
    const orderBy = params.view === 'history'
      ? 'order_date DESC, created_at DESC'
      : 'is_late DESC, expected_delivery_date ASC NULLS LAST, order_date DESC';
    const result = await db.query(
      `${cte}
       SELECT *, COUNT(*) OVER() AS total_count FROM staged
       WHERE ${cond.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT ${limit} OFFSET ${offset}`,
      values
    );
    const total = result.rows[0] ? parseInt(result.rows[0].total_count, 10) : 0;
    return { rows: result.rows.map(({ total_count: _t, ...r }) => r), total };
  },

  /** Compteurs par étape (pipeline) + BC en retard de livraison. */
  async pipelineSummary(storeId?: string) {
    const values: unknown[] = storeId ? [storeId] : [];
    const cte = this._stagedCte(storeId ? '$1' : null);
    const [stages, late] = await Promise.all([
      db.query(
        `${cte}
         SELECT stage, COUNT(*)::int AS count, COALESCE(SUM(total_amount), 0) AS amount,
                COUNT(*) FILTER (WHERE is_late)::int AS late_count
         FROM staged GROUP BY stage`,
        values
      ),
      db.query(
        `${cte}
         SELECT id, order_number, supplier_name, expected_delivery_date, stage,
                (CURRENT_DATE - expected_delivery_date)::int AS days_late
         FROM staged WHERE is_late
         ORDER BY expected_delivery_date ASC LIMIT 5`,
        values
      ),
    ]);
    return { stages: stages.rows, late: late.rows };
  },

  /** CTE commune : BC + agrégats de lignes + étape du processus. */
  _stagedCte(storeParam: string | null) {
    return `WITH base AS (
        SELECT po.id, po.order_number, po.order_date, po.expected_delivery_date, po.status,
               po.supplier_id, po.on_hold, po.frozen, po.locked_at, po.created_at, po.currency_code, po.exchange_rate,
               s.name AS supplier_name,
               agg.item_count, agg.total_amount, agg.delivered_amount, agg.items_without_price, agg.lines_done,
               EXISTS (
                 SELECT 1 FROM invoices inv
                 LEFT JOIN invoice_purchase_orders ipo ON ipo.invoice_id = inv.id
                 WHERE inv.status != 'cancelled'
                   AND (inv.purchase_order_id = po.id OR ipo.purchase_order_id = po.id)
               ) AS has_invoice,
               -- Demande d'approbation en attente (lot 8, mig 350).
               EXISTS (
                 SELECT 1 FROM approval_requests ar
                 WHERE ar.doc_type = 'purchase_order' AND ar.doc_id = po.id::text AND ar.status = 'pending'
               ) AS approval_pending
        FROM purchase_orders po
        JOIN suppliers s ON s.id = po.supplier_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS item_count,
                 COALESCE(SUM(quantity_ordered * COALESCE(unit_price, 0)), 0) AS total_amount,
                 COALESCE(SUM(quantity_delivered * COALESCE(unit_price, 0)), 0) AS delivered_amount,
                 COUNT(*) FILTER (WHERE unit_price IS NULL)::int AS items_without_price,
                 COUNT(*) FILTER (WHERE qty_received_base + qty_cancelled_base >= quantity_ordered)::int AS lines_done
          FROM purchase_order_items WHERE purchase_order_id = po.id
        ) agg ON true
        ${storeParam ? `WHERE po.store_id = ${storeParam}` : ''}
      ), staged AS (
        SELECT base.*,
               CASE
                 WHEN status = 'en_attente' THEN 'draft'
                 WHEN status = 'envoye' THEN 'sent'
                 WHEN status = 'livre_partiel' THEN 'partial'
                 WHEN status = 'en_attente_facturation' THEN 'invoice'
                 WHEN status = 'livre_complet' AND NOT has_invoice THEN 'invoice'
                 WHEN status = 'livre_complet' THEN 'closed'
                 ELSE 'cancelled'
               END AS stage,
               (status IN ('en_attente', 'envoye', 'livre_partiel')
                 AND expected_delivery_date IS NOT NULL
                 AND expected_delivery_date < CURRENT_DATE) AS is_late
        FROM base
      )`;
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
       -- Engagements réels seulement (mig 306) : un brouillon n'engage rien, un BC bloqué non plus.
       WHERE po.status IN ('livre_complet', 'livre_partiel', 'envoye', 'en_attente_facturation')
         AND NOT po.on_hold
       ${storeFilter}
       ORDER BY po.order_date DESC`,
      params
    );
    return result.rows;
  },

  async findById(id: string) {
    const poResult = await db.query(
      `SELECT po.*, s.name as supplier_name, s.phone as supplier_phone, s.contact_name as supplier_contact,
              u.first_name || ' ' || u.last_name as created_by_name,
              -- Factures liées (colonne historique ou fusion, mig 178) : étape « Facture » de la fiche BC.
              COALESCE((
                SELECT json_agg(json_build_object(
                         'id', inv.id, 'invoice_number', inv.invoice_number,
                         'supplier_invoice_number', inv.supplier_invoice_number, 'invoice_date', inv.invoice_date,
                         'status', inv.status, 'total_amount', inv.total_amount, 'paid_amount', inv.paid_amount)
                       ORDER BY inv.invoice_date)
                  FROM invoices inv
                 WHERE inv.status != 'cancelled'
                   AND (inv.purchase_order_id = po.id
                        OR EXISTS (SELECT 1 FROM invoice_purchase_orders ipo WHERE ipo.invoice_id = inv.id AND ipo.purchase_order_id = po.id))
              ), '[]'::json) AS invoices
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN users u ON u.id = po.created_by
       WHERE po.id = $1`,
      [id]
    );
    if (!poResult.rows[0]) return null;

    // Une ligne porte un ingredient, un consommable (packaging_items) ou, sans
    // article, un service / une immobilisation (désignation libre, mig 349).
    // COALESCE pour exposer un nom/unite uniformes (les anciens alias
    // ingredient_name/ingredient_unit sont conserves pour le client).
    const itemsResult = await db.query(
      `SELECT poi.*,
              COALESCE(ing.name, pkg.name, poi.description) as ingredient_name,
              COALESCE(ing.unit, pkg.unit, poi.base_unit, 'unit') as ingredient_unit,
              COALESCE(ing.category_id, pkg.category_id, poi.category_id) as item_category_id,
              ing.container_size,
              ctc.label as container_type_label,
              -- Contenant figé sur la ligne à la commande (mig 307), distinct de la fiche actuelle.
              lct.label as line_container_label,
              GREATEST(poi.quantity_ordered - poi.qty_received_base - poi.qty_cancelled_base, 0) as qty_remaining_base,
              -- Exigences lot fournisseur / DLC de l'article (mig 308), pour la saisie de réception.
              COALESCE(lr.requires_lot, false) as requires_lot, COALESCE(lr.requires_dlc, false) as requires_dlc,
              lr.default_shelf_life_days,
              poi.line_type as kind
       FROM purchase_order_items poi
       LEFT JOIN ingredients ing ON ing.id = poi.ingredient_id
       LEFT JOIN ref_entries ctc ON ctc.id = ing.container_type_id
       LEFT JOIN ref_entries lct ON lct.id = poi.container_type_id
       LEFT JOIN LATERAL fn_lot_requirements(poi.ingredient_id) lr ON poi.ingredient_id IS NOT NULL
       LEFT JOIN packaging_items pkg ON pkg.id = poi.packaging_id
       WHERE poi.purchase_order_id = $1
       ORDER BY COALESCE(ing.name, pkg.name, poi.description)`,
      [id]
    );

    return { ...poResult.rows[0], items: itemsResult.rows };
  },

  async generateOrderNumber(client?: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, string>[] }> }): Promise<string> {
    // Serie « purchase_order » (Parametres > Numerotation, mig 329) : remplace le
    // MAX+1 sous verrou consultatif. Le client transactionnel garde le compteur
    // verrouille jusqu'au COMMIT.
    return nextDocumentNumber(client ?? db, 'purchase_order');
  },

  async create(data: {
    supplierId: string; expectedDeliveryDate?: string; notes?: string;
    createdBy: string; storeId?: string;
    /** Devise et taux figé (mig 363) ; DH par défaut. */
    currencyCode?: string; exchangeRate?: number;
    // Une ligne porte SOIT un ingredient (matiere premiere) SOIT un consommable
    // (packaging_items) — routage decide par la categorie (fn_purchasable_kind) —
    // SOIT, sans article, un service ou une immobilisation : designation libre +
    // categorie de depense (qui donne le compte comptable), mig 349.
    items: PoLineInput[];
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
        `INSERT INTO purchase_orders (order_number, supplier_id, expected_delivery_date, notes, created_by, store_id, currency_code, exchange_rate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [orderNumber, data.supplierId, data.expectedDeliveryDate || null,
         data.notes || null, data.createdBy, data.storeId || null,
         data.currencyCode && data.currencyCode !== 'MAD' ? data.currencyCode : 'MAD',
         data.currencyCode && data.currencyCode !== 'MAD' && data.exchangeRate ? data.exchangeRate : 1]
      );

      // F-012 — L'arrondi au contenant (210 kg -> 225 = 9 sacs) etait silencieux :
      // la reception de 210 laissait ensuite un reliquat « fantome » de 15 kg. On
      // collecte desormais les arrondis pour que l'appelant puisse les signaler a
      // la creation (la regle contenant reste appliquee).
      const roundings: Array<{ ingredientId: string; requested: number; ordered: number; containers: number | null; containerLabel: string | null }> = [];
      for (const item of data.items) {
        // Regle « contenant entier » : un ingredient defini par contenant se commande
        // par contenant complet, arrondi au superieur (8 kg en sacs de 2,5 -> 10 kg).
        let qty = item.quantityOrdered;
        if (item.ingredientId) {
          const rule = await applyContainerRule(client, item.ingredientId, item.quantityOrdered);
          qty = rule.qty;
          if (rule.def && qty > item.quantityOrdered + 1e-9) {
            roundings.push({
              ingredientId: item.ingredientId,
              requested: item.quantityOrdered,
              ordered: qty,
              containers: rule.count,
              containerLabel: rule.def.label,
            });
          }
        }
        const free = freeLineFields(item);
        await client.query(
          `INSERT INTO purchase_order_items (purchase_order_id, ingredient_id, packaging_id, quantity_ordered, unit_price,
                                             line_type, description, category_id, base_unit, foreign_unit_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [poResult.rows[0].id, item.ingredientId ?? null, item.packagingId ?? null, qty, item.unitPrice ?? null,
           lineTypeOf(item), free.description, free.categoryId, free.unit,
           data.currencyCode && data.currencyCode !== 'MAD' ? (item.foreignUnitPrice ?? null) : null]
        );
      }

      await client.query('COMMIT');
      return { ...poResult.rows[0], _roundings: roundings };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /** Montant HT du bon (lignes sans prix comptées à 0), pour les seuils d'approbation. */
  async totalAmount(id: string): Promise<number> {
    const r = await db.query(
      `SELECT COALESCE(SUM(quantity_ordered * COALESCE(unit_price, 0)), 0) AS total FROM purchase_order_items WHERE purchase_order_id = $1`, [id]);
    return Number(r.rows[0]?.total ?? 0);
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

    // Alertes lot/DLC et numéros de lot internes attribués (mig 308) remontés à l'écran.
    return { status: result.status, voucherId: result.id, voucherNumber: result.voucher_number,
             warnings: result.warnings, lotNumbers: result.lotNumbers };
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
            await closePurchaseRequestsForOrder(client, id, 'livre_complet');
          }
        }
      }

      // Le coût standard des ingrédients n'est plus répercuté à la commande : il
      // est piloté par le CMUP au moment de la réception (voir
      // reception-voucher.repository). Les prix de ligne du BC sont déjà à jour
      // ci-dessus (purchase_order_items.unit_price).

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
    items: (PoLineInput & { id?: string; quantityDelivered?: number })[],
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
        // Regle « contenant entier » (voir services/container-rule).
        const qordRaw = Number.isFinite(it.quantityOrdered) ? it.quantityOrdered : 0;
        const qord = it.ingredientId ? (await applyContainerRule(client, it.ingredientId, qordRaw)).qty : qordRaw;
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
          const free = freeLineFields(it);
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO purchase_order_items (purchase_order_id, ingredient_id, packaging_id, quantity_ordered, quantity_delivered, unit_price,
                                               line_type, description, category_id, base_unit)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [id, it.ingredientId ?? null, it.packagingId ?? null, qord, newDel, price,
             lineTypeOf(it), free.description, free.categoryId, free.unit]
          );
          if (newDel > 0.0001) {
            // Cas atypique : admin ajoute une ligne avec qty deja livree
            // (typiquement pour rattraper un stock arrive sans BC). On ajuste.
            await adjustLineStock(
              { ingredient_id: it.ingredientId ?? null, packaging_id: it.packagingId ?? null }, newDel,
              `Admin edit BC ${orderNumber} : ajout ligne avec qty livree ${newDel} (id ${inserted.rows[0].id})`);
          }
        }

        // Le dernier prix saisi fait foi -> repercute sur le cout catalogue du
        // consommable. Pour les ingredients, le cout standard est desormais pilote
        // par le CMUP a la reception (voir reception-voucher.repository), plus a la
        // commande.
        if (price !== null && price > 0 && it.packagingId) {
          await client.query(`UPDATE packaging_items SET unit_cost = $1, updated_at = NOW() WHERE id = $2`, [price, it.packagingId]);
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

      // Un admin peut completer les quantites livrees sans passer par un bon de
      // reception : on ferme aussi les demandes d'achat depuis ce chemin.
      await closePurchaseRequestsForOrder(client, id, newStatus);

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
