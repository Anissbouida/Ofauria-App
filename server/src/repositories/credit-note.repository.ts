import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import { invoiceRepository } from './accounting.repository.js';
import { autoLettrer } from '../services/journal-generator.service.js';

/**
 * Avoirs clients (O2C L4, mig 450). Une facture client émise ne se modifie
 * pas : on la corrige par un avoir AV, pièce numérotée liée à la facture
 * d'origine ligne à ligne.
 *
 *   - annulation : toute la facture ; ses BL repassent « à facturer » ;
 *   - retour : des quantités, au prix facturé ;
 *   - erreur de prix, geste commercial : un montant HT par ligne (7129).
 *
 * L'avoir est aussitôt imputé sur la facture d'origine (règlement « avoir »,
 * sans trésorerie) à hauteur de ce qui reste dû ; le surplus reste au crédit
 * du client et s'impute plus tard sur une autre de ses factures.
 */

export type CreditReason = 'cancellation' | 'return' | 'price' | 'commercial';
export const CREDIT_REASONS: CreditReason[] = ['cancellation', 'return', 'price', 'commercial'];
const LABEL: Record<CreditReason, string> = {
  cancellation: 'Annulation', return: 'Retour de marchandise', price: 'Erreur de prix', commercial: 'Geste commercial',
};

type Fail = Error & { statusCode?: number };
const fail = (statusCode: number, message: string): Fail => Object.assign(new Error(message), { statusCode });
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

async function today(c: PoolClient) {
  return (await c.query(`SELECT (now() AT TIME ZONE 'Africa/Casablanca')::date::text AS d`)).rows[0].d as string;
}

/** Impute `amount` (au plus) d'un avoir sur une facture du même client. Renvoie le montant imputé. */
async function impute(c: PoolClient, cn: Record<string, any>, invoiceId: string, userId: string, date: string, amount?: number) {
  const inv = (await c.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [invoiceId])).rows[0];
  if (!inv || inv.invoice_type !== 'emitted' || inv.kind === 'credit_note') throw fail(404, 'Facture client introuvable');
  if (inv.customer_id !== cn.customer_id) throw fail(400, 'L\'avoir et la facture doivent concerner le même client');
  if (inv.status === 'cancelled') throw fail(409, 'Facture annulée');
  const cnOpen = r2(Number(cn.total_amount) - Number(cn.paid_amount ?? 0));
  const invOpen = r2(Number(inv.total_amount) - Number(inv.paid_amount ?? 0));
  const take = r2(Math.min(cnOpen, invOpen, amount ?? Infinity));
  if (take <= 0.005) return 0;
  await c.query(
    `INSERT INTO payments (reference, type, invoice_id, amount, payment_method, payment_date, description, created_by, store_id, credit_note_id)
     VALUES ($1, 'income', $2, $3, 'avoir', $4, $5, $6, $7, $8)`,
    [cn.invoice_number, inv.id, take, date, `Avoir ${cn.invoice_number} imputé sur ${inv.invoice_number}`, userId, inv.store_id, cn.id]);
  await invoiceRepository.updatePaidAmount(inv.id, c);
  const updated = await invoiceRepository.updatePaidAmount(cn.id, c);
  Object.assign(cn, updated);
  await autoLettrer(c, inv.id);
  return take;
}

export const creditNoteRepository = {
  async create(p: {
    invoiceId: string; reason: CreditReason; userId: string; date?: string | null; note?: string | null;
    /** Retour : quantités ; prix / geste : montant HT. Ignoré pour une annulation (toute la facture). */
    lines?: { invoiceItemId: string; quantity?: number; amount?: number }[];
  }, outer?: PoolClient) {
    if (!CREDIT_REASONS.includes(p.reason)) throw fail(400, 'Motif d\'avoir invalide');
    const c = outer ?? await db.getClient();
    try {
      if (!outer) await c.query('BEGIN');
      const inv = (await c.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [p.invoiceId])).rows[0];
      if (!inv || inv.invoice_type !== 'emitted') throw fail(404, 'Facture client introuvable');
      if (inv.kind === 'credit_note') throw fail(400, 'Un avoir ne se crédite pas');
      if (inv.status === 'cancelled') throw fail(409, 'Facture annulée');
      if (!inv.customer_id) throw fail(400, 'Facture sans client');
      const date = p.date || await today(c);
      if (date < iso(inv.invoice_date)) throw fail(400, 'L\'avoir ne peut pas précéder la facture qu\'il corrige');

      // Lignes de la facture et ce qui en a déjà été crédité (quantités : annulations et retours).
      const items = (await c.query(
        `SELECT ii.*, COALESCE(x.q, 0)::float8 AS credited_qty, COALESCE(x.amt, 0)::float8 AS credited_amount
           FROM invoice_items ii
           LEFT JOIN LATERAL (
             SELECT SUM(cl.quantity) FILTER (WHERE ci.credit_reason IN ('cancellation', 'return')) AS q, SUM(cl.subtotal) AS amt
               FROM invoice_items cl JOIN invoices ci ON ci.id = cl.invoice_id
              WHERE cl.credited_item_id = ii.id AND ci.status <> 'cancelled') x ON true
          WHERE ii.invoice_id = $1 ORDER BY ii.created_at, ii.id`, [inv.id])).rows;
      if (!items.length) throw fail(400, 'Facture sans lignes : elle ne peut être créditée que par une annulation comptable');

      type Line = { productId?: string; description: string; quantity: number; unitPrice: number; subtotal: number; tvaRate: number | null;
                    deliveryNoteItemId: string | null; orderItemId: string | null; creditedItemId: string };
      let lines: Line[];
      const base = (it: Record<string, any>) => ({
        productId: it.product_id ?? undefined, tvaRate: it.tva_rate != null ? Number(it.tva_rate) : null,
        deliveryNoteItemId: it.delivery_note_item_id, orderItemId: it.order_item_id, creditedItemId: it.id as string,
      });
      if (p.reason === 'cancellation') {
        if (items.some(it => Number(it.credited_amount) > 0.005)) {
          throw fail(409, 'Facture déjà créditée en partie : créditez le reste ligne à ligne (retour, prix ou geste)');
        }
        lines = items.map(it => ({ ...base(it), description: it.description ?? '', quantity: Number(it.quantity),
          unitPrice: Number(it.unit_price), subtotal: Number(it.subtotal) }));
      } else {
        if (!p.lines?.length) throw fail(400, 'Indiquez les lignes à créditer');
        const byId = new Map(items.map(it => [it.id as string, it]));
        lines = [];
        for (const l of p.lines) {
          const it = byId.get(l.invoiceItemId);
          if (!it) throw fail(400, 'Ligne étrangère à la facture');
          const restAmount = r2(Number(it.subtotal) - Number(it.credited_amount));
          if (p.reason === 'return') {
            const q = Number(l.quantity);
            const restQty = Math.round((Number(it.quantity) - Number(it.credited_qty)) * 1000) / 1000;
            if (!(q > 0) || q > restQty + 0.0005) throw fail(400, `Quantité retournée invalide pour « ${it.description} » (reste créditable : ${restQty})`);
            const subtotal = Math.min(r2(q * Number(it.unit_price)), restAmount);
            lines.push({ ...base(it), description: `Retour · ${it.description ?? ''}`, quantity: q, unitPrice: Number(it.unit_price), subtotal });
          } else {
            const amount = r2(Number(l.amount));
            if (!(amount > 0) || amount > restAmount + 0.005) throw fail(400, `Montant invalide pour « ${it.description} » (reste créditable : ${restAmount.toFixed(2)} DH HT)`);
            // Montant porté sur la quantité facturée : seul le prix est corrigé.
            const qty = Number(it.quantity) || 1;
            lines.push({ ...base(it), description: `${LABEL[p.reason]} · ${it.description ?? ''}`, quantity: qty,
              unitPrice: Math.round(amount / qty * 10000) / 10000, subtotal: amount });
          }
        }
      }
      const amount = r2(lines.reduce((s, l) => s + l.subtotal, 0));
      if (!(amount > 0)) throw fail(400, 'Avoir sans montant');
      // Facture sans TVA par ligne : TVA de l'avoir au prorata de la facture.
      const perLineTva = lines.some(l => l.tvaRate != null);
      const tax = perLineTva ? undefined
        : Number(inv.amount) > 0 ? r2(Number(inv.tax_amount ?? 0) * amount / Number(inv.amount)) : 0;

      const cn = await invoiceRepository.create({
        invoiceType: 'emitted', customerId: inv.customer_id, invoiceDate: date, dueDate: date,
        amount, taxAmount: tax, notes: [`${LABEL[p.reason]} — facture ${inv.invoice_number}`, p.note?.trim()].filter(Boolean).join(' · '),
        createdBy: p.userId, storeId: inv.store_id ?? undefined,
        currencyCode: inv.currency_code, exchangeRate: Number(inv.exchange_rate),
        items: lines, creditNote: { creditedInvoiceId: inv.id, reason: p.reason },
      }, c);

      // Annulation : les BL de la facture repassent à facturer, le facturé des commandes redescend.
      if (p.reason === 'cancellation') {
        await c.query(
          `WITH released AS (
             UPDATE delivery_notes SET status = 'delivered', invoice_id = NULL
              WHERE invoice_id = $1 AND status = 'invoiced' RETURNING id),
           per_line AS (
             SELECT i.order_item_id, SUM(i.quantity) AS q FROM delivery_note_items i
              WHERE i.delivery_note_id IN (SELECT id FROM released) AND i.order_item_id IS NOT NULL GROUP BY 1)
           UPDATE order_items oi SET qty_invoiced = GREATEST(oi.qty_invoiced - pl.q, 0)
             FROM per_line pl WHERE oi.id = pl.order_item_id`, [inv.id]);
      }

      const applied = await impute(c, cn, inv.id, p.userId, date);
      if (!outer) await c.query('COMMIT');
      return { creditNote: cn, applied, unapplied: r2(Number(cn.total_amount) - applied) };
    } catch (err) {
      if (!outer) await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      if (!outer) c.release();
    }
  },

  /** Impute le solde d'un avoir sur une autre facture ouverte du même client. */
  async apply(p: { creditNoteId: string; invoiceId: string; amount?: number | null; userId: string }) {
    const c = await db.getClient();
    try {
      await c.query('BEGIN');
      const cn = (await c.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [p.creditNoteId])).rows[0];
      if (!cn || cn.invoice_type !== 'emitted' || cn.kind !== 'credit_note') throw fail(404, 'Avoir introuvable');
      if (cn.status === 'cancelled') throw fail(409, 'Avoir annulé');
      const applied = await impute(c, cn, p.invoiceId, p.userId, await today(c), p.amount ?? undefined);
      if (applied <= 0) throw fail(409, 'Rien à imputer : avoir déjà imputé ou facture soldée');
      await c.query('COMMIT');
      return { applied, unapplied: r2(Number(cn.total_amount) - Number(cn.paid_amount ?? 0)) };
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  },

  /** Avoirs d'une facture, et avoirs non imputés de son client (pour l'écran de la facture). */
  async forInvoice(invoiceId: string) {
    const inv = (await db.query(`SELECT customer_id FROM invoices WHERE id = $1`, [invoiceId])).rows[0];
    if (!inv) return null;
    const notes = (await db.query(
      `SELECT id, invoice_number, invoice_date, credit_reason, total_amount::float8 AS total_amount, paid_amount::float8 AS applied
         FROM invoices WHERE credited_invoice_id = $1 AND kind = 'credit_note' AND status <> 'cancelled'
        ORDER BY invoice_date, invoice_number`, [invoiceId])).rows;
    const open = inv.customer_id ? (await db.query(
      `SELECT id, invoice_number, invoice_date, (total_amount - COALESCE(paid_amount, 0))::float8 AS unapplied
         FROM invoices WHERE customer_id = $1 AND invoice_type = 'emitted' AND kind = 'credit_note'
          AND status NOT IN ('paid', 'cancelled') AND total_amount - COALESCE(paid_amount, 0) > 0.005
        ORDER BY invoice_date`, [inv.customer_id])).rows : [];
    return { creditNotes: notes, openCredits: open };
  },
};
