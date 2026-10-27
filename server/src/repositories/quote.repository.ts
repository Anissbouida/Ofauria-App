import { db } from '../config/database.js';
import { nextDocumentNumber } from '../utils/document-number.js';
import { orderRepository } from './order.repository.js';
import { crmRepository } from './crm.repository.js';
import { loadCustomer, isProCustomer, priceLines, taxAfterDiscount, creditWarning, creditGate, notifyProductionChefs, documentDiscount } from '../controllers/order.controller.js';
import { recordApplied } from '../services/promotions.js';

/**
 * Devis clients (mig 365).
 *
 * Prix : un devis pour un professionnel est en HT avec TVA par ligne (with_tax), comme ses
 * commandes ; pour un particulier, prix TTC sans TVA. Un prospect sans fiche choisit.
 * Les prix par défaut viennent des mêmes règles que la commande (catalogue, remise du
 * client, dernière TVA facturée) ; un prix saisi l'emporte.
 * Conversion : la commande reprend les prix et la remise du devis, puis suit son cycle
 * normal (sourcing stock / production, BL et facture pour un professionnel).
 */

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'refused' | 'expired' | 'converted' | 'cancelled';
export type QuoteLineInput = { productId: string; quantity: number; unitPrice?: number | null; tvaRate?: number | null; description?: string | null };
export type QuoteInput = {
  customerId?: string | null; prospectName?: string | null; prospectCompany?: string | null; prospectPhone?: string | null; prospectEmail?: string | null;
  title?: string | null; quoteDate?: string; validUntil?: string; withTax?: boolean; discountPct?: number;
  deliveryTerms?: string | null; notes?: string | null; internalNotes?: string | null; items: QuoteLineInput[];
  /** Opportunité d'origine (CRM, mig 371). */
  opportunityId?: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const NAME = (a: string) => `NULLIF(concat_ws(' ', ${a}.first_name, ${a}.last_name), '')`;
const EDITABLE: QuoteStatus[] = ['draft', 'sent'];

const SELECT = `
  SELECT q.*,
         COALESCE(NULLIF(c.company_name, ''), ${NAME('c')}, q.prospect_company, q.prospect_name) AS client_label,
         c.customer_type, c.company_name AS customer_company, c.email AS customer_email, c.phone AS customer_phone,
         c.address AS customer_address, c.city AS customer_city, c.ice AS customer_ice,
         o.order_number, ${NAME('u')} AS created_by_name,
         re.label AS lost_reason_label,
         (SELECT COUNT(*) FROM quote_items qi WHERE qi.quote_id = q.id)::int AS item_count,
         (q.status = 'sent' AND q.valid_until < CURRENT_DATE) AS is_overdue,
         (q.status = 'sent' AND q.valid_until BETWEEN CURRENT_DATE AND CURRENT_DATE + 3) AS expires_soon
    FROM quotes q
    LEFT JOIN customers c ON c.id = q.customer_id
    LEFT JOIN orders o ON o.id = q.order_id
    LEFT JOIN users u ON u.id = q.created_by
    LEFT JOIN ref_entries re ON re.table_id = 'quote_lost_reasons' AND re.code = q.lost_reason_code`;

type Runner = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, any>[]; rowCount: number | null }> };

async function addEvent(runner: Runner, quoteId: string, p: { type: string; from?: string | null; to?: string | null; note?: string | null; userId: string | null }) {
  await runner.query(
    `INSERT INTO quote_events (quote_id, event_type, from_value, to_value, note, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
    [quoteId, p.type, p.from ?? null, p.to ?? null, p.note ?? null, p.userId]);
}

/** Lignes chiffrées et totaux, selon le client (professionnel = HT + TVA). */
async function compute(input: QuoteInput, storeId: string | null = null) {
  const customer = await loadCustomer(input.customerId ?? null);
  if (input.customerId && !customer) return { error: 'Client introuvable' } as const;
  const pro = isProCustomer(customer) ? customer : null;
  const withTax = pro ? true : customer ? false : !!input.withTax;
  if (!input.items?.length) return { error: 'Ajoutez au moins un article' } as const;
  for (const it of input.items) {
    if (!Number.isInteger(Number(it.quantity)) || Number(it.quantity) <= 0) return { error: 'Les quantités sont des nombres entiers positifs' } as const;
  }
  const priced = await priceLines(input.items.map(i => ({ productId: i.productId, quantity: Number(i.quantity), unitPrice: i.unitPrice ?? null, tvaRate: i.tvaRate ?? null })), pro);
  if ('error' in priced) return { error: priced.error as string } as const;
  const lines = priced.lines.map((l, i) => ({
    ...l,
    // Prospect en HT : TVA saisie sur la ligne (pas d'historique de facturation).
    tvaRate: withTax ? (pro ? l.tvaRate : (input.items[i].tvaRate != null ? Number(input.items[i].tvaRate) : null)) : null,
    description: input.items[i].description?.trim() || null,
  }));
  const subtotal = priced.subtotal;
  const pct = round2(Math.min(100, Math.max(0, Number(input.discountPct ?? 0) || 0)));
  // Promotions en vigueur (mig 372), puis la remise manuelle sur le reste.
  const promo = await documentDiscount(lines, priced.products as Record<string, any>[], subtotal, pct, { channel: 'quotes', storeId, customerId: input.customerId ?? null });
  const discount = promo.discount;
  const tax = withTax ? taxAfterDiscount(lines, subtotal, discount) : 0;
  return { customer, pro, withTax, lines, products: priced.products, subtotal, pct, discount, promotionAmount: promo.promotionAmount, applied: promo.applied, tax, total: round2(subtotal - discount + tax) };
}

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export const quoteRepository = {
  async list(p: { status?: string; search?: string; customerId?: string; dateFrom?: string; dateTo?: string; storeId?: string; limit: number; offset: number }) {
    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const cond: string[] = ['true'];
    if (p.storeId) cond.push(`(q.store_id IS NULL OR q.store_id = ${add(p.storeId)}::uuid)`);
    if (p.status === 'open') cond.push(`q.status IN ('draft', 'sent')`);
    else if (p.status === 'lost') cond.push(`q.status IN ('refused', 'expired')`);
    else if (p.status) cond.push(`q.status = ${add(p.status)}`);
    if (p.customerId) cond.push(`q.customer_id = ${add(p.customerId)}::uuid`);
    if (p.dateFrom) cond.push(`q.quote_date >= ${add(p.dateFrom)}::date`);
    if (p.dateTo) cond.push(`q.quote_date <= ${add(p.dateTo)}::date`);
    if (p.search) {
      const s = add(`%${p.search}%`);
      cond.push(`(q.number ILIKE ${s} OR q.title ILIKE ${s} OR q.prospect_name ILIKE ${s} OR q.prospect_company ILIKE ${s}
                 OR c.company_name ILIKE ${s} OR concat_ws(' ', c.first_name, c.last_name) ILIKE ${s})`);
    }
    const where = cond.join(' AND ');
    const baseVals = [...values];
    const rows = await db.query(
      `${SELECT} WHERE ${where} ORDER BY (q.status IN ('draft', 'sent')) DESC, q.created_at DESC LIMIT ${add(p.limit)} OFFSET ${add(p.offset)}`, values);
    const total = await db.query(`SELECT COUNT(*)::int AS n FROM quotes q LEFT JOIN customers c ON c.id = q.customer_id WHERE ${where}`, baseVals);
    return { rows: rows.rows, total: total.rows[0].n };
  },

  /** Tableau de bord : en cours, taux de transformation (90 j), pertes par motif. */
  async overview(storeId?: string) {
    const v: unknown[] = storeId ? [storeId] : [];
    const s = storeId ? `(q.store_id IS NULL OR q.store_id = $1::uuid)` : 'true';
    const [byStatus, rate, lost] = await Promise.all([
      db.query(`SELECT q.status, COUNT(*)::int AS count, COALESCE(SUM(q.total), 0)::numeric(14,2) AS amount,
                       COUNT(*) FILTER (WHERE q.status = 'sent' AND q.valid_until < CURRENT_DATE)::int AS overdue,
                       COUNT(*) FILTER (WHERE q.status = 'sent' AND q.valid_until BETWEEN CURRENT_DATE AND CURRENT_DATE + 3)::int AS expiring
                  FROM quotes q WHERE ${s} GROUP BY q.status`, v),
      db.query(`SELECT COUNT(*) FILTER (WHERE q.status IN ('accepted', 'converted'))::int AS won,
                       COUNT(*) FILTER (WHERE q.status IN ('refused', 'expired'))::int AS lost,
                       COALESCE(SUM(q.total) FILTER (WHERE q.status IN ('accepted', 'converted')), 0)::numeric(14,2) AS won_amount,
                       COALESCE(SUM(q.total) FILTER (WHERE q.status IN ('refused', 'expired')), 0)::numeric(14,2) AS lost_amount
                  FROM quotes q WHERE ${s} AND COALESCE(q.decided_at, q.updated_at) > now() - interval '90 days'`, v),
      db.query(`SELECT COALESCE(re.label, 'Sans motif') AS label, COUNT(*)::int AS count, COALESCE(SUM(q.total), 0)::numeric(14,2) AS amount
                  FROM quotes q LEFT JOIN ref_entries re ON re.table_id = 'quote_lost_reasons' AND re.code = q.lost_reason_code
                 WHERE ${s} AND q.status IN ('refused', 'expired') AND COALESCE(q.decided_at, q.updated_at) > now() - interval '90 days'
                 GROUP BY 1 ORDER BY 2 DESC`, v),
    ]);
    const r = rate.rows[0];
    const decided = r.won + r.lost;
    return {
      byStatus: Object.fromEntries(byStatus.rows.map(x => [x.status, { count: x.count, amount: Number(x.amount), overdue: x.overdue, expiring: x.expiring }])),
      conversion: { won: r.won, lost: r.lost, wonAmount: Number(r.won_amount), lostAmount: Number(r.lost_amount), rate: decided ? Math.round(r.won / decided * 100) : null },
      lostByReason: lost.rows.map(x => ({ label: x.label, count: x.count, amount: Number(x.amount) })),
    };
  },

  async findById(id: string) {
    const r = await db.query(`${SELECT} WHERE q.id = $1`, [id]);
    const q = r.rows[0];
    if (!q) return null;
    const [items, events] = await Promise.all([
      db.query(`SELECT qi.*, p.name AS product_name, p.price AS catalog_price FROM quote_items qi JOIN products p ON p.id = qi.product_id
                 WHERE qi.quote_id = $1 ORDER BY qi.display_order`, [id]),
      db.query(`SELECT e.*, ${NAME('u')} AS by_name FROM quote_events e LEFT JOIN users u ON u.id = e.created_by WHERE e.quote_id = $1 ORDER BY e.created_at`, [id]),
    ]);
    return { ...q, items: items.rows, events: events.rows };
  },

  async create(input: QuoteInput, ctx: { userId: string; storeId: string | null; validityDays: number }) {
    const c = await compute(input, ctx.storeId);
    if ('error' in c) return { error: c.error };
    const quoteDate = input.quoteDate ?? today();
    const validUntil = input.validUntil ?? plusDays(quoteDate, ctx.validityDays);
    if (validUntil < quoteDate) return { error: 'La date de validité précède la date du devis' };
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const number = await nextDocumentNumber(client, 'quote');
      const r = await client.query(
        `INSERT INTO quotes (number, store_id, customer_id, prospect_name, prospect_company, prospect_phone, prospect_email, title,
                             quote_date, valid_until, with_tax, discount_pct, subtotal, discount_amount, tax_amount, total,
                             delivery_terms, notes, internal_notes, created_by, opportunity_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21) RETURNING id`,
        [number, ctx.storeId, input.customerId ?? null,
         input.customerId ? null : input.prospectName?.trim() || null, input.customerId ? null : input.prospectCompany?.trim() || null,
         input.customerId ? null : input.prospectPhone?.trim() || null, input.customerId ? null : input.prospectEmail?.trim() || null,
         input.title?.trim() || null, quoteDate, validUntil, c.withTax, c.pct, c.subtotal, c.discount, c.tax, c.total,
         input.deliveryTerms?.trim() || null, input.notes?.trim() || null, input.internalNotes?.trim() || null, ctx.userId, input.opportunityId ?? null]);
      const id = r.rows[0].id as string;
      await this._writeLines(client, id, c.lines);
      await client.query(`UPDATE quotes SET promotion_amount = $2 WHERE id = $1`, [id, c.promotionAmount]);
      await recordApplied(client, { quoteId: id }, c.applied);
      await addEvent(client, id, { type: 'created', to: 'draft', userId: ctx.userId });
      await client.query('COMMIT');
      return { data: await this.findById(id) };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async _writeLines(client: Runner, quoteId: string, lines: { productId: string; quantity: number; unitPrice: number; subtotal: number; tvaRate: number | null; description: string | null }[]) {
    await client.query(`DELETE FROM quote_items WHERE quote_id = $1`, [quoteId]);
    let i = 0;
    for (const l of lines) {
      await client.query(
        `INSERT INTO quote_items (quote_id, product_id, description, quantity, unit_price, tva_rate, subtotal, display_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [quoteId, l.productId, l.description, l.quantity, l.unitPrice, l.tvaRate, l.subtotal, i++]);
    }
  },

  async update(id: string, input: QuoteInput, userId: string) {
    const cur = await this.findById(id);
    if (!cur) return { error: 'not_found' as const };
    if (!EDITABLE.includes(cur.status)) return { error: `Un devis ${cur.status === 'converted' ? 'converti' : 'clos'} ne se modifie plus : dupliquez-le` };
    const c = await compute(input, cur.store_id ?? null);
    if ('error' in c) return { error: c.error };
    const quoteDate = input.quoteDate ?? String(cur.quote_date instanceof Date ? cur.quote_date.toISOString().slice(0, 10) : cur.quote_date).slice(0, 10);
    const validUntil = input.validUntil ?? String(cur.valid_until instanceof Date ? cur.valid_until.toISOString().slice(0, 10) : cur.valid_until).slice(0, 10);
    if (validUntil < quoteDate) return { error: 'La date de validité précède la date du devis' };
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE quotes SET customer_id = $2, prospect_name = $3, prospect_company = $4, prospect_phone = $5, prospect_email = $6, title = $7,
                quote_date = $8, valid_until = $9, with_tax = $10, discount_pct = $11, subtotal = $12, discount_amount = $13, tax_amount = $14,
                total = $15, delivery_terms = $16, notes = $17, internal_notes = $18, expiry_notified_at = NULL WHERE id = $1`,
        [id, input.customerId ?? null,
         input.customerId ? null : input.prospectName?.trim() || null, input.customerId ? null : input.prospectCompany?.trim() || null,
         input.customerId ? null : input.prospectPhone?.trim() || null, input.customerId ? null : input.prospectEmail?.trim() || null,
         input.title?.trim() || null, quoteDate, validUntil, c.withTax, c.pct, c.subtotal, c.discount, c.tax, c.total,
         input.deliveryTerms?.trim() || null, input.notes?.trim() || null, input.internalNotes?.trim() || null]);
      await this._writeLines(client, id, c.lines);
      await client.query(`UPDATE quotes SET promotion_amount = $2 WHERE id = $1`, [id, c.promotionAmount]);
      await recordApplied(client, { quoteId: id }, c.applied);
      await addEvent(client, id, { type: 'edited', note: cur.status === 'sent' ? 'Modifié après envoi' : null, userId });
      await client.query('COMMIT');
      return { data: await this.findById(id) };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  /** Transitions : send, accept, refuse (motif), reopen, cancel. */
  async transition(id: string, action: 'send' | 'accept' | 'refuse' | 'reopen' | 'cancel', p: { userId: string; reasonCode?: string | null; note?: string | null }) {
    const cur = await this.findById(id);
    if (!cur) return { error: 'not_found' as const };
    const from = cur.status as QuoteStatus;
    const allowed: Record<typeof action, QuoteStatus[]> = {
      send: ['draft'], accept: ['draft', 'sent', 'expired'], refuse: ['draft', 'sent', 'expired'],
      reopen: ['refused', 'expired', 'accepted', 'cancelled'], cancel: ['draft', 'sent', 'accepted'],
    };
    if (!allowed[action].includes(from)) return { error: `Action impossible sur un devis « ${from} »` };
    if (action === 'refuse' && !p.reasonCode) return { error: 'Indiquez le motif de la perte' };
    const to: QuoteStatus = { send: 'sent', accept: 'accepted', refuse: 'refused', reopen: 'draft', cancel: 'cancelled' }[action] as QuoteStatus;
    // Rouvrir un devis expiré : la validité repart d'aujourd'hui si elle est dépassée.
    await db.query(
      `UPDATE quotes SET status = $2::text,
              sent_at = CASE WHEN $2::text = 'sent' THEN now() ELSE sent_at END,
              decided_at = CASE WHEN $2::text IN ('accepted', 'refused') THEN now() WHEN $2::text = 'draft' THEN NULL ELSE decided_at END,
              lost_reason_code = CASE WHEN $2::text = 'refused' THEN $3::text WHEN $2::text = 'draft' THEN NULL ELSE lost_reason_code END,
              lost_note = CASE WHEN $2::text = 'refused' THEN $4::text WHEN $2::text = 'draft' THEN NULL ELSE lost_note END,
              valid_until = CASE WHEN $2::text = 'draft' AND valid_until < CURRENT_DATE THEN CURRENT_DATE + (valid_until - quote_date) ELSE valid_until END,
              quote_date = CASE WHEN $2::text = 'draft' AND valid_until < CURRENT_DATE THEN CURRENT_DATE ELSE quote_date END,
              expiry_notified_at = CASE WHEN $2::text = 'draft' THEN NULL ELSE expiry_notified_at END
        WHERE id = $1`, [id, to, p.reasonCode ?? null, p.note?.trim() || null]);
    await addEvent(db as unknown as Runner, id, { type: 'status', from, to, note: p.note ?? (action === 'refuse' ? p.reasonCode : null), userId: p.userId });
    if (action === 'send') await crmRepository.onQuoteEvent(id, 'sent', p.userId);
    if (action === 'accept' && cur.created_by && cur.created_by !== p.userId) {
      await db.query(
        `INSERT INTO notifications (target_role, target_user_id, store_id, type, title, message, reference_type, reference_id, created_by)
         VALUES ('all', $1, $2, 'quote_accepted', $3, $4, 'quote', $5, $6)`,
        [cur.created_by, cur.store_id, `Devis accepté · ${cur.number}`, `${cur.client_label} — ${Number(cur.total).toFixed(2)} DH`, id, p.userId]);
    }
    return { data: await this.findById(id) };
  },

  /** Copie d'un devis (nouvelle version) en brouillon, prix et lignes repris tels quels. */
  async duplicate(id: string, ctx: { userId: string; storeId: string | null; validityDays: number }) {
    const cur = await this.findById(id);
    if (!cur) return { error: 'not_found' as const };
    const r = await this.create({
      customerId: cur.customer_id, prospectName: cur.prospect_name, prospectCompany: cur.prospect_company,
      prospectPhone: cur.prospect_phone, prospectEmail: cur.prospect_email, title: cur.title, withTax: cur.with_tax,
      discountPct: Number(cur.discount_pct), deliveryTerms: cur.delivery_terms, notes: cur.notes, internalNotes: cur.internal_notes,
      items: cur.items.map((i: Record<string, any>) => ({ productId: i.product_id, quantity: i.quantity, unitPrice: Number(i.unit_price),
        tvaRate: i.tva_rate != null ? Number(i.tva_rate) : null, description: i.description })),
    }, ctx);
    if ('data' in r && r.data) {
      await db.query(`UPDATE quotes SET revision_of = $2 WHERE id = $1`, [r.data.id, id]);
      await addEvent(db as unknown as Runner, r.data.id, { type: 'duplicated', from: cur.number, userId: ctx.userId });
    }
    return r;
  },

  /** Numéro de proforma, attribué à la première édition. */
  async ensureProformaNumber(id: string) {
    const cur = await db.query(`SELECT proforma_number FROM quotes WHERE id = $1`, [id]);
    if (!cur.rows[0]) return null;
    if (cur.rows[0].proforma_number) return cur.rows[0].proforma_number as string;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const locked = await client.query(`SELECT proforma_number FROM quotes WHERE id = $1 FOR UPDATE`, [id]);
      let n = locked.rows[0].proforma_number as string | null;
      if (!n) {
        n = await nextDocumentNumber(client, 'proforma');
        await client.query(`UPDATE quotes SET proforma_number = $2 WHERE id = $1`, [id, n]);
      }
      await client.query('COMMIT');
      return n;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  /**
   * Devis accepté (ou envoyé) → commande. Un prospect devient soit un client choisi, soit
   * une commande au nom saisi (particulier). Le régime de prix doit correspondre au client.
   */
  async convert(id: string, p: { pickupDate: string; customerId?: string | null; userId: string; storeId: string | null }) {
    const q = await this.findById(id);
    if (!q) return { error: 'not_found' as const };
    if (!['accepted', 'sent', 'draft'].includes(q.status)) return { error: 'Seul un devis en cours ou accepté se convertit en commande' };
    const customerId = q.customer_id ?? p.customerId ?? null;
    const customer = await loadCustomer(customerId);
    if (customerId && !customer) return { error: 'Client introuvable' };
    const pro = isProCustomer(customer) ? customer : null;
    if (pro && !q.with_tax) return { error: 'Ce devis est en TTC : un client professionnel est facturé en HT. Dupliquez le devis pour ce client.' };
    // Devis HT vers un particulier : prix ramenés en TTC ligne à ligne.
    const toTtc = !pro && q.with_tax;
    const items = q.items.map((i: Record<string, any>) => {
      const ht = Number(i.unit_price); const t = i.tva_rate != null ? Number(i.tva_rate) : 0;
      return { productId: i.product_id, quantity: Number(i.quantity), unitPrice: toTtc ? round2(ht * (1 + t / 100)) : ht,
        tvaRate: pro ? (i.tva_rate != null ? Number(i.tva_rate) : null) : null,
        notes: i.description ?? undefined };
    });
    const priced = await priceLines(items, pro);
    if ('error' in priced) return { error: priced.error as string };
    const subtotal = priced.subtotal;
    const pct = Number(q.discount_pct) || 0;
    // Les promotions accordées au devis restent acquises, même expirées depuis (mig 372).
    const promotionAmount = Math.min(subtotal, Number(q.promotion_amount) || 0);
    const discount = round2(promotionAmount + (subtotal - promotionAmount) * pct / 100);
    const tax = pro ? taxAfterDiscount(priced.lines, subtotal, discount) : 0;
    const total = round2(subtotal - discount + tax);
    if (pro) {
      const refused = await creditGate(pro, total);
      if (refused) return { error: refused };
    }

    const orderNumber = await orderRepository.generateOrderNumber();
    const order = await orderRepository.create({
      orderNumber, customerId: customerId ?? undefined,
      customerName: customerId ? undefined : (q.prospect_company || q.prospect_name),
      customerPhone: customerId ? undefined : (q.prospect_phone ?? undefined),
      userId: p.userId, type: 'custom', subtotal, taxAmount: tax, discountAmount: discount, discountPct: pct, total,
      advanceAmount: 0, paymentMethod: pro ? 'deferred' : 'cash',
      notes: [`Devis ${q.number}`, q.title, q.delivery_terms].filter(Boolean).join(' · '),
      pickupDate: p.pickupDate, storeId: p.storeId ?? q.store_id ?? undefined, items: priced.lines,
    });
    if (promotionAmount > 0) {
      const applied = (await db.query(`SELECT promotion_id, label, amount FROM document_promotions WHERE quote_id = $1`, [id])).rows;
      await db.query(`UPDATE orders SET promotion_amount = $2 WHERE id = $1`, [order.id, promotionAmount]);
      await recordApplied(db, { orderId: order.id }, applied.map(a => ({ promotionId: a.promotion_id, label: a.label, amount: Number(a.amount) })));
    }
    await db.query(`UPDATE quotes SET status = 'converted', order_id = $2, converted_at = now(),
                           customer_id = COALESCE(customer_id, $3), decided_at = COALESCE(decided_at, now()) WHERE id = $1`,
      [id, order.id, customerId]);
    await addEvent(db as unknown as Runner, id, { type: 'status', from: q.status, to: 'converted', note: `Commande ${orderNumber}`, userId: p.userId });
    await crmRepository.onQuoteEvent(id, 'converted', p.userId);
    const planId = (order as Record<string, unknown>)._productionPlanId as string | null;
    if (planId) await notifyProductionChefs({ productionPlanId: planId, products: priced.products, storeId: p.storeId, orderNumber, pickupDate: p.pickupDate, userId: p.userId });
    const warning = pro ? await creditWarning(pro, total, order.id) : null;
    return { data: await this.findById(id), order: { id: order.id, orderNumber, total }, creditWarning: warning };
  },
};
