import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import { nextDocumentNumber } from '../utils/document-number.js';
import { invoiceRepository } from './accounting.repository.js';

/**
 * Ventes aux professionnels (mig 352) : bon de livraison client → facture.
 *
 * Le BL ne passe aucune écriture et ne touche pas au stock vitrine (comme
 * l'ancienne « vente spéciale ») ; le chiffre d'affaires, la TVA et la créance
 * naissent à la facture client (FE), qui peut regrouper plusieurs BL d'un même
 * client — la facture mensuelle d'un hôtel ou d'un café livré chaque jour.
 */

type Fail = Error & { statusCode?: number };
const fail = (code: number, msg: string): Fail => Object.assign(new Error(msg), { statusCode: code });
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface DeliveryLineInput {
  productId?: string | null; description?: string | null;
  quantity: number; unitPrice: number; tvaRate?: number | null;
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

/** Une facture annulée (avoir) rend ses BL à facturer de nouveau. */
async function releaseCancelledInvoices(runner: { query: (text: string, params?: unknown[]) => Promise<unknown> }) {
  await runner.query(
    `UPDATE delivery_notes SET status = 'delivered', invoice_id = NULL
      WHERE status = 'invoiced' AND invoice_id IN (SELECT id FROM invoices WHERE status = 'cancelled')`);
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
      `SELECT i.*, p.name AS product_name FROM delivery_note_items i
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
      `SELECT p.id, p.price,
              (SELECT i.tva_rate FROM delivery_note_items i JOIN delivery_notes d ON d.id = i.delivery_note_id
                WHERE i.product_id = p.id AND i.tva_rate IS NOT NULL ORDER BY d.created_at DESC LIMIT 1) AS last_tva
         FROM products p WHERE p.id = ANY($1::uuid[])`, [productIds])).rows;
    const out: Record<string, { unitPrice: number; tvaRate: number | null }> = {};
    for (const r of rows) {
      const price = Number(r.price ?? 0) * (1 - remise / 100);
      out[r.id] = { unitPrice: round2(price), tvaRate: c?.tva_exonere ? 0 : (r.last_tva != null ? Number(r.last_tva) : null) };
    }
    return out;
  },

  /** Commandes d'un client livrables par BL : ni réglées en caisse, ni facturées, ni déjà livrées. */
  async eligibleOrders(customerId: string) {
    const r = await db.query(
      `SELECT o.id, o.order_number, o.pickup_date, o.total, o.status
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
        WHERE o.customer_id = $1 AND o.status IN ('ready', 'completed')
          AND COALESCE(c.customer_type, 'particulier') <> 'particulier'
          AND COALESCE(o.advance_amount, 0) = 0
          AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.order_id = o.id)
          AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.status <> 'cancelled')
          AND NOT EXISTS (SELECT 1 FROM delivery_notes d WHERE d.order_id = o.id AND d.status <> 'cancelled')
        ORDER BY o.created_at DESC LIMIT 50`, [customerId]);
    return r.rows;
  },

  async orderLines(orderId: string) {
    const r = await db.query(
      `SELECT oi.id, oi.product_id, p.name AS description, oi.quantity, oi.unit_price, oi.tva_rate
         FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = $1 ORDER BY p.name`, [orderId]);
    return r.rows;
  },

  async create(data: {
    customerId: string; deliveryDate?: string | null; orderId?: string | null; notes?: string | null;
    items: DeliveryLineInput[]; createdBy: string; storeId?: string | null;
    receivedByName?: string | null;
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
            WHERE o.id = $1 AND o.customer_id = $2 AND o.status IN ('ready', 'completed')
              AND COALESCE(c.customer_type, 'particulier') <> 'particulier'
              AND NOT EXISTS (SELECT 1 FROM delivery_notes d WHERE d.order_id = o.id AND d.status <> 'cancelled')
              AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.status <> 'cancelled')
              AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.order_id = o.id)`, [data.orderId, data.customerId])).rows[0];
        if (!ok) throw fail(409, 'Cette commande n\'est pas une commande de professionnel à livrer, ou elle est déjà livrée, réglée ou facturée');
      }
      const date = data.deliveryDate || undefined;
      const number = await nextDocumentNumber(client, 'delivery_note', date);
      const head = (await client.query(
        `INSERT INTO delivery_notes (number, customer_id, store_id, order_id, delivery_date, notes, created_by, received_by_name, received_at)
         VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6, $7, $8::varchar, CASE WHEN $8::varchar IS NULL THEN NULL ELSE now() END) RETURNING *`,
        [number, data.customerId, data.storeId ?? null, data.orderId ?? null, date ?? null, data.notes ?? null, data.createdBy,
         data.receivedByName?.trim() || null])).rows[0];
      for (const it of data.items) {
        let description = it.description?.trim() || null;
        if (!description && it.productId) {
          description = (await client.query(`SELECT name FROM products WHERE id = $1`, [it.productId])).rows[0]?.name ?? null;
        }
        if (!description) throw fail(400, 'Chaque ligne doit avoir un produit ou une désignation');
        if (!(it.quantity > 0) || !(it.unitPrice >= 0)) throw fail(400, 'Quantité et prix doivent être positifs');
        await client.query(
          `INSERT INTO delivery_note_items (delivery_note_id, product_id, description, quantity, unit_price, tva_rate, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [head.id, it.productId ?? null, description, it.quantity, it.unitPrice, it.tvaRate ?? null, round2(it.quantity * it.unitPrice)]);
      }
      // Livrée : la commande prête passe « terminée » (elle sort du suivi de production).
      if (data.orderId) {
        await client.query(`UPDATE orders SET status = 'completed', completed_at = COALESCE(completed_at, now()) WHERE id = $1 AND status = 'ready'`, [data.orderId]);
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
   * Livrer une commande de professionnel sur bon de livraison (module Commandes,
   * direction) : lignes de la commande (prix HT et TVA de la commande, sinon
   * dernier taux utilisé), quantités livrées éventuellement corrigées, nom du
   * réceptionnaire. Client facturé « à chaque livraison » : la facture suit le BL
   * dans la même transaction.
   */
  async createFromOrder(orderId: string, createdBy: string, storeId?: string | null, opts: {
    quantities?: Record<string, number>; receivedByName?: string | null; deliveryDate?: string | null; notes?: string | null;
  } = {}) {
    const order = (await db.query(
      `SELECT o.id, o.customer_id, o.store_id, o.status, c.customer_type, c.billing_frequency
         FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = $1`, [orderId])).rows[0];
    if (!order) throw fail(404, 'Commande introuvable');
    if (!order.customer_id) throw fail(400, 'La commande n\'a pas de fiche client : elle se remet en caisse');
    if ((order.customer_type ?? 'particulier') === 'particulier') {
      throw fail(400, 'Commande de particulier : elle se remet en caisse contre le solde, sans bon de livraison');
    }
    if (order.status !== 'ready') throw fail(409, 'La commande doit être prête pour être livrée');
    const lines = await this.orderLines(orderId);
    if (!lines.length) throw fail(400, 'La commande n\'a aucune ligne');
    const defaults = await this.lineDefaults(order.customer_id, lines.map((l: Record<string, unknown>) => l.product_id as string));
    const items = lines.map((l: Record<string, unknown>) => {
      const id = l.id as string;
      const qty = opts.quantities && opts.quantities[id] !== undefined ? Number(opts.quantities[id]) : Number(l.quantity);
      return {
        productId: l.product_id as string, description: l.description as string,
        quantity: qty, unitPrice: Number(l.unit_price),
        tvaRate: l.tva_rate != null ? Number(l.tva_rate) : defaults[l.product_id as string]?.tvaRate ?? null,
      };
    }).filter(i => i.quantity > 0);
    if (!items.length) throw fail(400, 'Aucune quantité livrée');
    if (items.some(i => !Number.isFinite(i.quantity) || i.quantity < 0)) throw fail(400, 'Quantité livrée invalide');

    const client: PoolClient = await db.getClient();
    try {
      await client.query('BEGIN');
      const note = await this.create({
        customerId: order.customer_id, orderId, createdBy, storeId: order.store_id ?? storeId ?? null,
        deliveryDate: opts.deliveryDate ?? null, notes: opts.notes ?? null, receivedByName: opts.receivedByName ?? null, items,
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

  async cancel(id: string, userId: string) {
    const r = await db.query(
      `UPDATE delivery_notes SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2
        WHERE id = $1 AND status = 'delivered' RETURNING *`, [id, userId]);
    if (!r.rows[0]) throw fail(409, 'Seul un BL livré et non facturé peut être annulé');
    return r.rows[0];
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
        `SELECT dn.*, c.delai_paiement_jours FROM delivery_notes dn JOIN customers c ON c.id = dn.customer_id
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
      const term = Number(notes[0].delai_paiement_jours ?? 0);
      const due = (await client.query(`SELECT ($1::date + $2::int)::text AS d`, [isoDate, term])).rows[0].d as string;
      const multi = notes.length > 1;
      const items = lines.map(l => ({
        productId: l.product_id ?? undefined,
        description: multi ? `${l.note_number} · ${l.description}` : l.description,
        quantity: Number(l.quantity), unitPrice: Number(l.unit_price), subtotal: Number(l.subtotal),
        tvaRate: l.tva_rate != null ? Number(l.tva_rate) : null,
      }));
      const amount = round2(items.reduce((s, i) => s + i.subtotal, 0));
      const tax = round2(items.reduce((s, i) => s + (i.tvaRate != null ? Math.round(i.subtotal * i.tvaRate) / 100 : 0), 0));
      const numbers = notes.map(n => n.number).join(', ');
      const invoice = await invoiceRepository.create({
        invoiceType: 'emitted', customerId: notes[0].customer_id, invoiceDate: isoDate, dueDate: due,
        amount, taxAmount: tax, totalAmount: round2(amount + tax),
        notes: `Facture des bons de livraison ${numbers}`, createdBy: data.createdBy,
        storeId: notes[0].store_id ?? data.storeId ?? undefined, items,
      }, client);
      await client.query(
        `UPDATE delivery_notes SET status = 'invoiced', invoice_id = $2 WHERE id = ANY($1::uuid[])`,
        [data.deliveryNoteIds, invoice.id]);
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
