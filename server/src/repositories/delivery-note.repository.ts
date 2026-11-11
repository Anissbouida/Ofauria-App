import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import { nextDocumentNumber } from '../utils/document-number.js';
import { invoiceRepository } from './accounting.repository.js';
import { shipProduct, reverseAllocations } from '../services/product-shipment.js';
import { recordDelivered, closeRemainder, reverseDelivered } from '../services/order-fulfilment.js';
import { checkCredit } from '../services/credit-control.js';
import { customerAddressRepository } from './customer-address.repository.js';
import { customerRepository } from './customer.repository.js';
import { netPriceOf } from '../utils/tva.js';

/**
 * Ventes aux professionnels (mig 352) : bon de livraison client → facture.
 *
 * Le BL ne passe aucune écriture ; le chiffre d'affaires, la TVA et la créance
 * naissent à la facture client (FE), qui peut regrouper plusieurs BL d'un même
 * client — la facture mensuelle d'un hôtel ou d'un café livré chaque jour.
 * Sa création vaut expédition (O2C L1, mig 440) : les lots sont affectés en
 * FEFO (réserve puis vitrine), enregistrés par ligne et sortis du stock ; un
 * produit suivi par lots non couvert bloque le BL. L'annulation les remet.
 */

type Fail = Error & { statusCode?: number };
const fail = (code: number, msg: string): Fail => Object.assign(new Error(msg), { statusCode: code });
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface DeliveryLineInput {
  productId?: string | null; description?: string | null;
  quantity: number; unitPrice: number; tvaRate?: number | null;
  orderItemId?: string | null;
}

const NOTE_SELECT = `
  SELECT dn.*, COALESCE(NULLIF(c.company_name, ''), concat_ws(' ', c.first_name, c.last_name)) AS customer_name,
         c.customer_type, c.delai_paiement_jours, c.address AS customer_address, c.city AS customer_city,
         c.phone AS customer_phone, c.ice AS customer_ice, c.if_fiscal AS customer_if, c.billing_frequency,
         o.order_number, inv.invoice_number, inv.status AS invoice_status,
         concat_ws(' ', u.first_name, u.last_name) AS created_by_name,
         COALESCE(t.ht, 0) AS total_ht, COALESCE(t.tva, 0) AS total_tva, COALESCE(t.ht, 0) + COALESCE(t.tva, 0) AS total_ttc,
         COALESCE(t.lines, 0) AS line_count
    FROM delivery_notes dn
    JOIN customers c ON c.id = dn.customer_id
    LEFT JOIN orders o ON o.id = dn.order_id
    LEFT JOIN invoices inv ON inv.id = dn.invoice_id
    LEFT JOIN users u ON u.id = dn.created_by
    LEFT JOIN LATERAL (
      SELECT SUM(subtotal) AS ht, SUM(ROUND(subtotal * COALESCE(tva_rate, 0) / 100, 2)) AS tva, COUNT(*) AS lines
        FROM delivery_note_items WHERE delivery_note_id = dn.id
    ) t ON true`;

/** Une facture annulée (avoir) rend ses BL à facturer de nouveau, et le « facturé » de leurs lignes de commande redescend. */
async function releaseCancelledInvoices(runner: { query: (text: string, params?: unknown[]) => Promise<unknown> }) {
  await runner.query(
    `WITH released AS (
       UPDATE delivery_notes SET status = 'delivered', invoice_id = NULL
        WHERE status = 'invoiced' AND invoice_id IN (SELECT id FROM invoices WHERE status = 'cancelled')
        RETURNING id),
     per_line AS (
       SELECT i.order_item_id, SUM(i.quantity) AS q FROM delivery_note_items i
        WHERE i.delivery_note_id IN (SELECT id FROM released) AND i.order_item_id IS NOT NULL GROUP BY 1)
     UPDATE order_items oi SET qty_invoiced = GREATEST(oi.qty_invoiced - pl.q, 0)
       FROM per_line pl WHERE oi.id = pl.order_item_id`);
}

export const deliveryNoteRepository = {
  async list(params: { storeId?: string; status?: string; customerId?: string; dateFrom?: string; dateTo?: string }) {
    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const cond: string[] = [];
    if (params.storeId) cond.push(`(dn.store_id IS NULL OR dn.store_id = ${add(params.storeId)})`);
    if (params.status) cond.push(`dn.status = ${add(params.status)}`);
    if (params.customerId) cond.push(`dn.customer_id = ${add(params.customerId)}`);
    if (params.dateFrom) cond.push(`dn.delivery_date >= ${add(params.dateFrom)}::date`);
    if (params.dateTo) cond.push(`dn.delivery_date <= ${add(params.dateTo)}::date`);
    const r = await db.query(`${NOTE_SELECT} ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
      ORDER BY dn.delivery_date DESC, dn.number DESC LIMIT 500`, values);
    return r.rows;
  },

  async findById(id: string) {
    const head = (await db.query(`${NOTE_SELECT} WHERE dn.id = $1`, [id])).rows[0];
    if (!head) return null;
    const items = (await db.query(
      `SELECT i.*, p.name AS product_name,
              COALESCE((SELECT json_agg(json_build_object('lot_id', l.product_lot_id, 'lot_number', pl.lot_number, 'quantity', l.quantity,
                                                          'source', l.source, 'dlc', l.dlc_snapshot) ORDER BY l.dlc_snapshot NULLS LAST)
                          FROM delivery_note_item_lots l JOIN product_lots pl ON pl.id = l.product_lot_id
                         WHERE l.delivery_note_item_id = i.id), '[]'::json) AS lots
         FROM delivery_note_items i
         LEFT JOIN products p ON p.id = i.product_id
        WHERE i.delivery_note_id = $1 ORDER BY i.description`, [id])).rows;
    return { ...head, items };
  },

  /**
   * Valeurs par défaut d'une ligne pour ce client : prix catalogue moins la
   * remise du client, et dernier taux de TVA utilisé pour ce produit (aucun
   * taux n'est porté par la fiche produit).
   */
  async lineDefaults(customerId: string | null, productIds: string[]) {
    if (productIds.length === 0) return {};
    const c = customerId ? (await db.query(`SELECT remise_pct, tva_exonere FROM customers WHERE id = $1`, [customerId])).rows[0] : null;
    const remise = Number(c?.remise_pct ?? 0);
    const rows = (await db.query(
      `SELECT p.id, p.price, p.price_includes_tax,
              -- Taux du code TVA porté par l'article (mig 473), résolu au taux
              -- courant du pays de la société. Source prioritaire du défaut.
              (SELECT tc.rate FROM tax_codes tc
                WHERE tc.code = p.tax_code
                  AND tc.country_code = COALESCE((SELECT value->>'code' FROM module_parameters WHERE key = 'company.country_code'), 'MA')
                  AND tc.valid_from <= CURRENT_DATE AND (tc.valid_to IS NULL OR tc.valid_to >= CURRENT_DATE)
                ORDER BY tc.valid_from DESC LIMIT 1) AS code_rate,
              (SELECT i.tva_rate FROM delivery_note_items i JOIN delivery_notes d ON d.id = i.delivery_note_id
                WHERE i.product_id = p.id AND i.tva_rate IS NOT NULL ORDER BY d.created_at DESC LIMIT 1) AS last_tva
         FROM products p WHERE p.id = ANY($1::uuid[])`, [productIds])).rows;
    const out: Record<string, { unitPrice: number; tvaRate: number | null }> = {};
    for (const r of rows) {
      // Le défaut d'une ligne professionnelle est un prix HT (phase 5.1, mig 479).
      // Si l'article déclare un prix TTC, on en déduit le HT au taux intrinsèque
      // de l'article (code TVA), indépendamment de l'exonération du client ;
      // sinon le prix est déjà HT. Ofauria (TTC, sans code TVA) : HT = TTC.
      const net = netPriceOf(Number(r.price ?? 0), r.price_includes_tax !== false, r.code_rate != null ? Number(r.code_rate) : 0);
      const price = net * (1 - remise / 100);
      // Priorité : client exonéré → 0 ; sinon code TVA de l'article ; sinon
      // repli sur le dernier taux utilisé (comportement antérieur).
      const tvaRate = c?.tva_exonere ? 0
        : (r.code_rate != null ? Number(r.code_rate)
        : (r.last_tva != null ? Number(r.last_tva) : null));
      out[r.id] = { unitPrice: round2(price), tvaRate };
    }
    return out;
  },

  /** Commandes d'un client livrables par BL : ni réglées en caisse, ni facturées, ni déjà livrées. */
  async eligibleOrders(customerId: string) {
    const r = await db.query(
      `SELECT o.id, o.order_number, o.pickup_date, o.total, o.status
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
        WHERE o.customer_id = $1 AND o.status IN ('ready', 'partially_delivered')
          AND COALESCE(c.customer_type, 'particulier') <> 'particulier'
          AND COALESCE(o.advance_amount, 0) = 0
          AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.order_id = o.id)
          -- Une facture d'acompte (kind='prepayment', mig 482) ne facture pas la commande :
          -- la commande reste « à facturer » tant que sa facture finale n'existe pas.
          AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.status <> 'cancelled' AND i.kind <> 'prepayment')
          -- O2C L2 : plusieurs BL par commande, tant qu'il reste à livrer.
          AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.quantity - oi.qty_delivered - oi.qty_cancelled > 0)
        ORDER BY o.created_at DESC LIMIT 50`, [customerId]);
    return r.rows;
  },

  async orderLines(orderId: string) {
    const r = await db.query(
      // Prix remisés de la remise de commande (mig 355) : le BL et la facture la portent.
      `SELECT oi.id, oi.product_id, p.name AS description, oi.quantity, oi.tva_rate,
              oi.qty_delivered, oi.qty_cancelled, GREATEST(oi.quantity - oi.qty_delivered - oi.qty_cancelled, 0) AS remaining,
              ROUND(oi.unit_price * (1 - COALESCE(o.discount_amount, 0) / NULLIF(o.subtotal, 0)), 2) AS unit_price
         FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = $1 ORDER BY p.name`, [orderId]);
    return r.rows;
  },

  async create(data: {
    customerId: string; deliveryDate?: string | null; orderId?: string | null; notes?: string | null;
    items: DeliveryLineInput[]; createdBy: string; storeId?: string | null;
    receivedByName?: string | null;
    /** Adresse d'expédition explicite (phase 4.1) ; sinon défaut du client. */
    shipAddress?: string | null;
    /** Commande : solder le reliquat après ce BL (rien d'autre ne sera livré). */
    closeRemainder?: boolean;
    /** Dérogation de la direction au blocage de crédit à l'expédition (motif obligatoire). */
    creditOverride?: { userId: string; reason: string } | null;
  }, outer?: PoolClient) {
    if (!data.items.length) throw fail(400, 'Ajoutez au moins une ligne');
    const client = outer ?? await db.getClient();
    try {
      if (!outer) await client.query('BEGIN');
      const cust = (await client.query(`SELECT id FROM customers WHERE id = $1`, [data.customerId])).rows[0];
      if (!cust) throw fail(400, 'Client introuvable');
      if (data.orderId) {
        const ok = (await client.query(
          `SELECT 1 FROM orders o JOIN customers c ON c.id = o.customer_id
            WHERE o.id = $1 AND o.customer_id = $2 AND o.status IN ('ready', 'partially_delivered')
              AND COALESCE(c.customer_type, 'particulier') <> 'particulier'
              -- Une facture d'acompte (kind='prepayment', mig 482) ne facture pas la commande.
              AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.status <> 'cancelled' AND i.kind <> 'prepayment')
              AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.order_id = o.id)
            FOR UPDATE OF o`, [data.orderId, data.customerId])).rows[0];
        if (!ok) throw fail(409, 'Cette commande n\'est pas une commande de professionnel à livrer, ou elle est déjà livrée, réglée ou facturée');
        // O2C L2 (G-GI-07) : sur un BL de commande, chaque produit livré vient d'une ligne de la commande.
        if (data.items.some(i => i.productId && !i.orderItemId)) {
          throw fail(400, 'BL de commande : chaque produit livré doit correspondre à une ligne de la commande');
        }
      }
      const date = data.deliveryDate || undefined;
      // Magasin expéditeur : celui de l'utilisateur ou de la commande ; à défaut, le magasin unique de la société.
      if (!data.storeId) {
        const stores = (await client.query(`SELECT id FROM stores WHERE is_active ORDER BY created_at LIMIT 2`)).rows;
        if (stores.length === 1) data = { ...data, storeId: stores[0].id };
      }
      const number = await nextDocumentNumber(client, 'delivery_note', date);
      // Adresse d'expédition figée (phase 4.1) : adresse de livraison fournie,
      // sinon l'adresse de livraison par défaut du client (repli legacy).
      const shipAddress = (data.shipAddress?.trim())
        || await customerAddressRepository.resolveText(client, data.customerId ?? null, 'delivery');
      const head = (await client.query(
        `INSERT INTO delivery_notes (number, customer_id, store_id, order_id, delivery_date, notes, created_by, received_by_name, received_at,
                                     lots_tracked, shipped_at, shipped_by, ship_address, salesperson_id)
         VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6, $7, $8::varchar, CASE WHEN $8::varchar IS NULL THEN NULL ELSE now() END,
                 true, now(), $7, $9,
                 -- Commercial attitré repris du client (phase 4.5).
                 (SELECT salesperson_id FROM customers WHERE id = $2)) RETURNING *`,
        [number, data.customerId, data.storeId ?? null, data.orderId ?? null, date ?? null, data.notes ?? null, data.createdBy,
         data.receivedByName?.trim() || null, shipAddress ?? null])).rows[0];
      for (const it of data.items) {
        let description = it.description?.trim() || null;
        if (!description && it.productId) {
          description = (await client.query(`SELECT name FROM products WHERE id = $1`, [it.productId])).rows[0]?.name ?? null;
        }
        if (!description) throw fail(400, 'Chaque ligne doit avoir un produit ou une désignation');
        if (!(it.quantity > 0) || !(it.unitPrice >= 0)) throw fail(400, 'Quantité et prix doivent être positifs');
        const line = (await client.query(
          `INSERT INTO delivery_note_items (delivery_note_id, product_id, description, quantity, unit_price, tva_rate, subtotal, order_item_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [head.id, it.productId ?? null, description, it.quantity, it.unitPrice, it.tvaRate ?? null, round2(it.quantity * it.unitPrice),
           it.orderItemId ?? null])).rows[0];
        if (!it.productId) continue;
        // Expédition (O2C L1) : lots FEFO de la réserve puis de la vitrine, stock du magasin décrémenté.
        if (!head.store_id) throw fail(400, 'Magasin expéditeur requis : les produits sortent du stock d\'un magasin');
        const shipped = await shipProduct(client, {
          productId: it.productId, storeId: head.store_id, quantity: it.quantity, strict: true,
          ref: { type: 'delivery_note', id: head.id }, label: `BL ${number}`, userId: data.createdBy,
        });
        if (shipped.requiresLots) await client.query(`UPDATE delivery_note_items SET requires_lots = true WHERE id = $1`, [line.id]);
        for (const a of shipped.allocations) {
          await client.query(
            `INSERT INTO delivery_note_item_lots (delivery_note_item_id, product_lot_id, quantity, source, dlc_snapshot)
             VALUES ($1, $2, $3, $4, $5::timestamptz)`, [line.id, a.lotId, a.qty, a.source, a.dlc]);
        }
      }
      // O2C L2 : livré cumulé par ligne (tolérance de sur-livraison du client), réservation
      // consommée, commande « partiellement livrée » ou « terminée ».
      if (data.orderId) {
        const tol = Number((await client.query(`SELECT over_delivery_tolerance_pct FROM customers WHERE id = $1`, [data.customerId])).rows[0]?.over_delivery_tolerance_pct ?? 0);
        const perLine = new Map<string, number>();
        for (const it of data.items) if (it.orderItemId) perLine.set(it.orderItemId, (perLine.get(it.orderItemId) ?? 0) + it.quantity);
        await recordDelivered(client, data.orderId, [...perLine].map(([orderItemId, qty]) => ({ orderItemId, qty })), tol);
        if (data.closeRemainder) await closeRemainder(client, data.orderId);
      }
      // Coût figé sur chaque ligne livrée (O2C L6, G-RR-03) : lots expédiés, sinon coût standard.
      await client.query(`SELECT fn_freeze_dn_costs($1)`, [head.id]);
      // O2C L3 (G-CR-02) : contrôle de crédit BLOQUANT à l'expédition, là où la marchandise sort.
      // L'encours inclut déjà ce BL (livré non facturé) et le reste de la commande : rien à ajouter.
      const credit = await checkCredit(client, {
        customerId: data.customerId, amount: 0, checkpoint: 'ship', documentType: 'delivery_note', documentId: head.id,
        override: data.creditOverride ?? null,
      });
      if (credit.decision === 'block') {
        throw Object.assign(new Error(`${credit.message} Expédition bloquée : la direction peut déroger en motivant.`), { statusCode: 409, code: 'CREDIT_BLOCKED' });
      }
      if (!outer) await client.query('COMMIT');
      return head;
    } catch (err) {
      if (!outer) await client.query('ROLLBACK');
      throw err;
    } finally {
      if (!outer) client.release();
    }
  },

  /**
   * Cycle différé (phase 7.1) — crée un BL « préparé » SANS mouvement de stock : la
   * marchandise n'est pas encore sortie. La sortie (FEFO, lots, coût figé, contrôle de
   * crédit) a lieu à l'expédition (ship). Utile pour préparer la veille et expédier le
   * lendemain. Le flux immédiat (create) reste inchangé.
   */
  async createPrepared(data: {
    customerId: string; deliveryDate?: string | null; orderId?: string | null; notes?: string | null;
    items: DeliveryLineInput[]; createdBy: string; storeId?: string | null; shipAddress?: string | null;
  }) {
    if (!data.items.length) throw fail(400, 'Ajoutez au moins une ligne');
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const cust = (await client.query(`SELECT id FROM customers WHERE id = $1`, [data.customerId])).rows[0];
      if (!cust) throw fail(400, 'Client introuvable');
      if (data.orderId && data.items.some(i => i.productId && !i.orderItemId)) {
        throw fail(400, 'BL de commande : chaque produit livré doit correspondre à une ligne de la commande');
      }
      let storeId = data.storeId ?? null;
      if (!storeId) {
        const stores = (await client.query(`SELECT id FROM stores WHERE is_active ORDER BY created_at LIMIT 2`)).rows;
        if (stores.length === 1) storeId = stores[0].id;
      }
      const date = data.deliveryDate || undefined;
      const number = await nextDocumentNumber(client, 'delivery_note', date);
      const shipAddress = (data.shipAddress?.trim())
        || await customerAddressRepository.resolveText(client, data.customerId ?? null, 'delivery');
      const head = (await client.query(
        `INSERT INTO delivery_notes (number, customer_id, store_id, order_id, delivery_date, notes, created_by,
           lots_tracked, status, prepared_at, prepared_by, ship_address, salesperson_id)
         VALUES ($1,$2,$3,$4, COALESCE($5::date, CURRENT_DATE), $6,$7, true, 'prepared', now(), $7, $8,
                 (SELECT salesperson_id FROM customers WHERE id = $2)) RETURNING *`,
        [number, data.customerId, storeId, data.orderId ?? null, date ?? null, data.notes ?? null, data.createdBy, shipAddress ?? null])).rows[0];
      for (const it of data.items) {
        let description = it.description?.trim() || null;
        if (!description && it.productId) description = (await client.query(`SELECT name FROM products WHERE id = $1`, [it.productId])).rows[0]?.name ?? null;
        if (!description) throw fail(400, 'Chaque ligne doit avoir un produit ou une désignation');
        if (!(it.quantity > 0) || !(it.unitPrice >= 0)) throw fail(400, 'Quantité et prix doivent être positifs');
        await client.query(
          `INSERT INTO delivery_note_items (delivery_note_id, product_id, description, quantity, unit_price, tva_rate, subtotal, order_item_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [head.id, it.productId ?? null, description, it.quantity, it.unitPrice, it.tvaRate ?? null, round2(it.quantity * it.unitPrice), it.orderItemId ?? null]);
      }
      await client.query('COMMIT');
      return head;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Expédition d'un BL préparé (phase 7.1) : le stock sort maintenant (FEFO réserve
   * puis vitrine, lots par ligne), le livré de la commande est enregistré, le coût est
   * figé et le crédit contrôlé (bloquant). Statut → « expédié ».
   */
  async ship(id: string, userId: string, opts: { closeRemainder?: boolean; creditOverride?: { userId: string; reason: string } | null } = {}) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const dn = (await client.query(`SELECT * FROM delivery_notes WHERE id = $1 AND status = 'prepared' FOR UPDATE`, [id])).rows[0];
      if (!dn) throw fail(409, 'Bon de livraison introuvable ou déjà expédié');
      if (!dn.store_id) throw fail(400, 'Magasin expéditeur requis : les produits sortent du stock d\'un magasin');
      const items = (await client.query(`SELECT * FROM delivery_note_items WHERE delivery_note_id = $1`, [id])).rows;
      for (const line of items) {
        if (!line.product_id) continue;
        const shipped = await shipProduct(client, {
          productId: line.product_id, storeId: dn.store_id, quantity: Number(line.quantity), strict: true,
          ref: { type: 'delivery_note', id: dn.id }, label: `BL ${dn.number}`, userId,
        });
        if (shipped.requiresLots) await client.query(`UPDATE delivery_note_items SET requires_lots = true WHERE id = $1`, [line.id]);
        for (const a of shipped.allocations) {
          await client.query(
            `INSERT INTO delivery_note_item_lots (delivery_note_item_id, product_lot_id, quantity, source, dlc_snapshot)
             VALUES ($1,$2,$3,$4,$5::timestamptz)`, [line.id, a.lotId, a.qty, a.source, a.dlc]);
        }
      }
      if (dn.order_id) {
        const tol = Number((await client.query(`SELECT over_delivery_tolerance_pct FROM customers WHERE id = $1`, [dn.customer_id])).rows[0]?.over_delivery_tolerance_pct ?? 0);
        const perLine = new Map<string, number>();
        for (const it of items) if (it.order_item_id) perLine.set(it.order_item_id, (perLine.get(it.order_item_id) ?? 0) + Number(it.quantity));
        await recordDelivered(client, dn.order_id, [...perLine].map(([orderItemId, qty]) => ({ orderItemId, qty })), tol);
        if (opts.closeRemainder) await closeRemainder(client, dn.order_id);
      }
      await client.query(`SELECT fn_freeze_dn_costs($1)`, [id]);
      const credit = await checkCredit(client, {
        customerId: dn.customer_id, amount: 0, checkpoint: 'ship', documentType: 'delivery_note', documentId: id,
        override: opts.creditOverride ?? null,
      });
      if (credit.decision === 'block') throw Object.assign(new Error(`${credit.message} Expédition bloquée : la direction peut déroger en motivant.`), { statusCode: 409, code: 'CREDIT_BLOCKED' });
      const head = (await client.query(`UPDATE delivery_notes SET status = 'shipped', shipped_at = now(), shipped_by = $2 WHERE id = $1 RETURNING *`, [id, userId])).rows[0];
      await client.query('COMMIT');
      return head;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Bon de préparation (phase 7.2) : regroupe plusieurs BL préparés (donc plusieurs
   * commandes) en une liste de prélèvement agrégée par article — total à préparer et
   * détail par BL. Liste imprimable pour le préparateur.
   */
  async pickingList(ids: string[]) {
    if (!ids.length) return { notes: [], lines: [] };
    const notes = (await db.query(
      `SELECT dn.id, dn.number, dn.delivery_date, dn.status,
              COALESCE(c.company_name, c.first_name || ' ' || c.last_name) AS customer_name
         FROM delivery_notes dn LEFT JOIN customers c ON c.id = dn.customer_id
        WHERE dn.id = ANY($1) AND dn.status IN ('draft','prepared')
        ORDER BY dn.number`, [ids])).rows;
    const lines = (await db.query(
      `SELECT di.product_id, COALESCE(p.name, di.description) AS name,
              SUM(di.quantity)::float8 AS total,
              json_agg(json_build_object('number', dn.number, 'qty', di.quantity) ORDER BY dn.number) AS breakdown
         FROM delivery_note_items di
         JOIN delivery_notes dn ON dn.id = di.delivery_note_id AND dn.status IN ('draft','prepared')
         LEFT JOIN products p ON p.id = di.product_id
        WHERE di.delivery_note_id = ANY($1)
        GROUP BY di.product_id, COALESCE(p.name, di.description)
        ORDER BY name`, [ids])).rows;
    return { notes, lines };
  },

  /**
   * Réception client (phase 7.1) : un BL expédié devient « livré ». Phase 7.6 : preuve de
   * livraison — signature, heure réelle, réserves (un litige se rattache alors au BL).
   */
  async markDelivered(id: string, pod: { receivedByName?: string | null; signature?: string | null; reserves?: string | null; deliveredAt?: string | null } = {}) {
    return (await db.query(
      `UPDATE delivery_notes SET status = 'delivered', received_at = now(),
         received_by_name = COALESCE($2, received_by_name),
         pod_signature = COALESCE($3, pod_signature),
         pod_reserves = COALESCE($4, pod_reserves),
         delivered_at = COALESCE($5::timestamptz, now())
        WHERE id = $1 AND status = 'shipped' RETURNING *`,
      [id, pod.receivedByName?.trim() || null, pod.signature || null, pod.reserves?.trim() || null, pod.deliveredAt || null])).rows[0] ?? null;
  },

  /**
   * Livrer une commande de professionnel sur bon de livraison (module Commandes,
   * direction) : lignes de la commande (prix HT et TVA de la commande, sinon
   * dernier taux utilisé), quantités livrées éventuellement corrigées, nom du
   * réceptionnaire. Client facturé « à chaque livraison » : la facture suit le BL
   * dans la même transaction.
   */
  async createFromOrder(orderId: string, createdBy: string, storeId?: string | null, opts: {
    quantities?: Record<string, number>; receivedByName?: string | null; deliveryDate?: string | null; notes?: string | null;
    closeRemainder?: boolean; creditOverride?: { userId: string; reason: string } | null;
  } = {}) {
    const order = (await db.query(
      `SELECT o.id, o.customer_id, o.store_id, o.status, c.customer_type, c.billing_frequency
         FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = $1`, [orderId])).rows[0];
    if (!order) throw fail(404, 'Commande introuvable');
    if (!order.customer_id) throw fail(400, 'La commande n\'a pas de fiche client : elle se remet en caisse');
    if ((order.customer_type ?? 'particulier') === 'particulier') {
      throw fail(400, 'Commande de particulier : elle se remet en caisse contre le solde, sans bon de livraison');
    }
    if (order.status !== 'ready' && order.status !== 'partially_delivered') throw fail(409, 'La commande doit être prête pour être livrée');
    const lines = await this.orderLines(orderId);
    if (!lines.length) throw fail(400, 'La commande n\'a aucune ligne');
    const defaults = await this.lineDefaults(order.customer_id, lines.map((l: Record<string, unknown>) => l.product_id as string));
    const items = lines.map((l: Record<string, unknown>) => {
      const id = l.id as string;
      // Par défaut : le reste à livrer de la ligne (O2C L2).
      const qty = opts.quantities && opts.quantities[id] !== undefined ? Number(opts.quantities[id]) : Number(l.remaining);
      return {
        productId: l.product_id as string, description: l.description as string, orderItemId: id,
        quantity: qty, unitPrice: Number(l.unit_price),
        tvaRate: l.tva_rate != null ? Number(l.tva_rate) : defaults[l.product_id as string]?.tvaRate ?? null,
      };
    }).filter(i => i.quantity > 0);
    if (!items.length && !opts.closeRemainder) throw fail(400, 'Aucune quantité livrée');
    if (!items.length) {
      // Rien à livrer de plus : on solde seulement le reliquat.
      const c = await db.getClient();
      try {
        await c.query('BEGIN');
        await closeRemainder(c, orderId);
        await c.query('COMMIT');
        return { closed: true };
      } catch (err) {
        await c.query('ROLLBACK'); throw err;
      } finally { c.release(); }
    }
    if (items.some(i => !Number.isFinite(i.quantity) || i.quantity < 0)) throw fail(400, 'Quantité livrée invalide');

    const client: PoolClient = await db.getClient();
    try {
      await client.query('BEGIN');
      const note = await this.create({
        customerId: order.customer_id, orderId, createdBy, storeId: order.store_id ?? storeId ?? null,
        deliveryDate: opts.deliveryDate ?? null, notes: opts.notes ?? null, receivedByName: opts.receivedByName ?? null, items,
        closeRemainder: opts.closeRemainder ?? false, creditOverride: opts.creditOverride ?? null,
      }, client);
      let invoice: Record<string, unknown> | null = null;
      if (order.billing_frequency === 'per_delivery') {
        invoice = await this.invoice({ deliveryNoteIds: [note.id], invoiceDate: opts.deliveryDate ?? null, createdBy, storeId }, client);
      }
      await client.query('COMMIT');
      return { ...note, invoice };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /** Annulation d'un BL livré non facturé : les quantités expédiées reviennent dans leurs lots et en stock. */
  async cancel(id: string, userId: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `UPDATE delivery_notes SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2
          WHERE id = $1 AND status = 'delivered' RETURNING *`, [id, userId]);
      const note = r.rows[0];
      if (!note) throw fail(409, 'Seul un BL livré et non facturé peut être annulé');
      if (note.lots_tracked && note.store_id) {
        const lines = (await client.query(
          `SELECT i.id, i.product_id, i.quantity::float8 AS quantity,
                  COALESCE(json_agg(json_build_object('lotId', l.product_lot_id, 'qty', l.quantity::float8 - l.returned_qty::float8, 'source', l.source))
                           FILTER (WHERE l.id IS NOT NULL), '[]') AS lots
             FROM delivery_note_items i LEFT JOIN delivery_note_item_lots l ON l.delivery_note_item_id = i.id
            WHERE i.delivery_note_id = $1 AND i.product_id IS NOT NULL GROUP BY i.id`, [id])).rows as
          { product_id: string; quantity: number; lots: { lotId: string; qty: number; source: 'backroom' | 'vitrine' }[] }[];
        for (const l of lines) {
          const allocations = l.lots.filter(a => a.qty > 0);
          const covered = allocations.reduce((s, a) => s + a.qty, 0);
          await reverseAllocations(client, {
            productId: l.product_id, storeId: note.store_id, allocations, untracked: Math.max(0, Math.round((l.quantity - covered) * 1000) / 1000),
            ref: { type: 'delivery_note', id }, label: `Annulation BL ${note.number}`, userId,
          });
        }
      }
      // O2C L2 (G-GI-09) : la commande se rouvre (livré retiré, stock remis de nouveau réservé).
      if (note.order_id) {
        const back = (await client.query(
          `SELECT order_item_id, SUM(quantity)::float8 AS qty FROM delivery_note_items
            WHERE delivery_note_id = $1 AND order_item_id IS NOT NULL GROUP BY 1`, [id])).rows as { order_item_id: string; qty: number }[];
        await reverseDelivered(client, note.order_id, back.map(b => ({ orderItemId: b.order_item_id, qty: b.qty })), note.store_id);
      }
      await client.query('COMMIT');
      return note;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },

  /** À facturer : par client, BL livrés non facturés (jusqu'à une date). */
  async toInvoice(params: { storeId?: string; until?: string }) {
    await releaseCancelledInvoices(db);
    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const cond = [`dn.status = 'delivered'`];
    if (params.storeId) cond.push(`(dn.store_id IS NULL OR dn.store_id = ${add(params.storeId)})`);
    if (params.until) cond.push(`dn.delivery_date <= ${add(params.until)}::date`);
    const notes = (await db.query(`${NOTE_SELECT} WHERE ${cond.join(' AND ')} ORDER BY dn.delivery_date, dn.number`, values)).rows;
    const byCustomer = new Map<string, { customerId: string; name: string; notes: Record<string, unknown>[]; totalHt: number; totalTtc: number; firstDate: string; lastDate: string }>();
    for (const n of notes) {
      const k = n.customer_id as string;
      const d = String(n.delivery_date instanceof Date ? (n.delivery_date as Date).toISOString().slice(0, 10) : n.delivery_date);
      let g = byCustomer.get(k);
      if (!g) { g = { customerId: k, name: n.customer_name as string, notes: [], totalHt: 0, totalTtc: 0, firstDate: d, lastDate: d }; byCustomer.set(k, g); }
      g.notes.push(n);
      g.totalHt = round2(g.totalHt + Number(n.total_ht));
      g.totalTtc = round2(g.totalTtc + Number(n.total_ttc));
      if (d < g.firstDate) g.firstDate = d;
      if (d > g.lastDate) g.lastDate = d;
    }
    return Array.from(byCustomer.values()).sort((a, b) => a.firstDate.localeCompare(b.firstDate));
  },

  /**
   * Facture client regroupant des BL d'un même client (mig 352). Une seule
   * transaction : facture FE (numérotation continue, écriture comptable) + BL
   * passés « facturés ». Échéance = date de facture + délai de paiement du client.
   */
  async invoice(data: { deliveryNoteIds: string[]; invoiceDate?: string | null; createdBy: string; storeId?: string | null }, outer?: PoolClient) {
    if (!data.deliveryNoteIds.length) throw fail(400, 'Choisissez au moins un bon de livraison');
    const client: PoolClient = outer ?? await db.getClient();
    try {
      if (!outer) await client.query('BEGIN');
      await releaseCancelledInvoices(client);
      const notes = (await client.query(
        `SELECT dn.*, dn.delivery_date::text AS delivery_day, c.delai_paiement_jours FROM delivery_notes dn JOIN customers c ON c.id = dn.customer_id
          WHERE dn.id = ANY($1::uuid[]) ORDER BY dn.delivery_date, dn.number FOR UPDATE OF dn`, [data.deliveryNoteIds])).rows;
      if (notes.length !== data.deliveryNoteIds.length) throw fail(404, 'Bon de livraison introuvable');
      if (notes.some(n => n.status !== 'delivered')) throw fail(409, 'Un des bons est déjà facturé ou annulé');
      const customers = new Set(notes.map(n => n.customer_id));
      if (customers.size !== 1) throw fail(400, 'Une facture regroupe les bons d\'un seul client');

      const lines = (await client.query(
        `SELECT i.*, d.number AS note_number FROM delivery_note_items i JOIN delivery_notes d ON d.id = i.delivery_note_id
          WHERE i.delivery_note_id = ANY($1::uuid[]) ORDER BY d.delivery_date, d.number, i.description`, [data.deliveryNoteIds])).rows;
      const invoiceDate = data.invoiceDate || (await client.query(`SELECT (now() AT TIME ZONE 'Africa/Casablanca')::date AS d`)).rows[0].d;
      const isoDate = String(invoiceDate instanceof Date ? invoiceDate.toISOString().slice(0, 10) : invoiceDate);
      // O2C L4 (G-IV-09) : on ne facture pas une livraison avant qu'elle ait eu lieu.
      const lastDelivery = notes.map(n => n.delivery_day as string).sort().at(-1)!;
      if (isoDate < lastDelivery) throw fail(400, `Date de facture (${isoDate}) antérieure à la dernière livraison facturée (${lastDelivery})`);
      const term = Number(notes[0].delai_paiement_jours ?? 0);
      const due = (await client.query(`SELECT ($1::date + $2::int)::text AS d`, [isoDate, term])).rows[0].d as string;
      const multi = notes.length > 1;
      const items = lines.map(l => ({
        productId: l.product_id ?? undefined,
        description: multi ? `${l.note_number} · ${l.description}` : l.description,
        quantity: Number(l.quantity), unitPrice: Number(l.unit_price), subtotal: Number(l.subtotal),
        tvaRate: l.tva_rate != null ? Number(l.tva_rate) : null,
        // O2C L4 (G-IV-02) : chaque ligne de facture désigne la ligne de BL (et de commande) qu'elle facture.
        deliveryNoteItemId: l.id as string, orderItemId: (l.order_item_id as string | null) ?? null,
      }));
      const amount = round2(items.reduce((s, i) => s + i.subtotal, 0));
      const tax = round2(items.reduce((s, i) => s + (i.tvaRate != null ? Math.round(i.subtotal * i.tvaRate) / 100 : 0), 0));
      const numbers = notes.map(n => n.number).join(', ');
      // Phase 4.2 : la facture part au PAYEUR (siège), pas forcément au client
      // livré (filiale). Le BL garde son customer_id ; la créance suit le payeur.
      const payerId = await customerRepository.resolvePayer(client, notes[0].customer_id);
      const invoice = await invoiceRepository.create({
        invoiceType: 'emitted', customerId: payerId, invoiceDate: isoDate, dueDate: due,
        amount, taxAmount: tax, totalAmount: round2(amount + tax),
        notes: `Facture des bons de livraison ${numbers}`, createdBy: data.createdBy,
        storeId: notes[0].store_id ?? data.storeId ?? undefined, items,
      }, client);
      // Commercial attitré figé sur la facture (phase 4.5) : celui du client
      // LIVRÉ (pas le payeur), pour lire le CA par commercial sur les pièces.
      await client.query(
        `UPDATE invoices SET salesperson_id = (SELECT salesperson_id FROM customers WHERE id = $1) WHERE id = $2`,
        [notes[0].customer_id, invoice.id]);
      await client.query(
        `UPDATE delivery_notes SET status = 'invoiced', invoice_id = $2 WHERE id = ANY($1::uuid[])`,
        [data.deliveryNoteIds, invoice.id]);
      // O2C L2 : facturé cumulé sur les lignes de commande (borné par le livré, contrainte en base).
      await client.query(
        `UPDATE order_items oi SET qty_invoiced = oi.qty_invoiced + x.q
           FROM (SELECT order_item_id, SUM(quantity) AS q FROM delivery_note_items
                  WHERE delivery_note_id = ANY($1::uuid[]) AND order_item_id IS NOT NULL GROUP BY 1) x
          WHERE oi.id = x.order_item_id`, [data.deliveryNoteIds]);
      if (!outer) await client.query('COMMIT');
      return invoice;
    } catch (err) {
      if (!outer) await client.query('ROLLBACK');
      throw err;
    } finally {
      if (!outer) client.release();
    }
  },
};
