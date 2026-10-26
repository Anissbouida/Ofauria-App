import { db } from '../config/database.js';

/**
 * Créances clients (mig 351) : ce que les clients doivent, tous documents
 * confondus — tickets de caisse impayés et factures clients ouvertes — classé
 * par client et par ancienneté de l'échéance (balance âgée, comme Odoo
 * « Aged Receivable », SAP FI-AR ou l'échéancier Sage).
 *
 * Échéance : ticket = sales.due_date (date + délai de paiement du client) ;
 * facture = due_date, sinon date de facture + délai de paiement du client.
 */

export type AgingBucket = 'current' | 'd30' | 'd60' | 'd90' | 'over90';

export interface ReceivableDoc {
  kind: 'ticket' | 'invoice';
  id: string;
  number: string;
  customer_id: string | null;
  legacy_name: string | null;
  doc_date: string;
  due_date: string;
  days_late: number;
  amount: number;
  paid: number;
  remaining: number;
  bucket: AgingBucket;
}

export interface CustomerReceivable {
  customerId: string | null;
  name: string;
  phone: string | null;
  customerType: string | null;
  creditLimit: number | null;
  total: number;
  overdue: number;
  buckets: Record<AgingBucket, number>;
  oldestDue: string | null;
  maxDaysLate: number;
  docs: ReceivableDoc[];
}

const emptyBuckets = (): Record<AgingBucket, number> => ({ current: 0, d30: 0, d60: 0, d90: 0, over90: 0 });
const round2 = (n: number) => Math.round(n * 100) / 100;

function bucketOf(daysLate: number): AgingBucket {
  if (daysLate <= 0) return 'current';
  if (daysLate <= 30) return 'd30';
  if (daysLate <= 60) return 'd60';
  if (daysLate <= 90) return 'd90';
  return 'over90';
}

async function openDocuments(params: { storeId?: string; customerId?: string }): Promise<ReceivableDoc[]> {
  const values: unknown[] = [];
  const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
  // Pièce sans magasin (facture « société », import) : visible de tous les magasins.
  const saleStore = params.storeId ? ` AND (s.store_id IS NULL OR s.store_id = ${add(params.storeId)})` : '';
  const invStore = params.storeId ? ` AND (i.store_id IS NULL OR i.store_id = $${values.length})` : '';
  const saleCust = params.customerId ? ` AND s.customer_id = ${add(params.customerId)}` : '';
  const invCust = params.customerId ? ` AND i.customer_id = $${values.length}` : '';
  const r = await db.query(
    `WITH docs AS (
       SELECT 'ticket'::text AS kind, s.id, s.sale_number AS number, s.customer_id, s.unpaid_customer_name AS legacy_name,
              (s.created_at AT TIME ZONE 'Africa/Casablanca')::date AS doc_date,
              COALESCE(s.due_date, (s.created_at AT TIME ZONE 'Africa/Casablanca')::date) AS due_date,
              s.total::numeric AS amount, 0::numeric AS paid
         FROM sales s
        WHERE s.payment_status = 'unpaid'${saleStore}${saleCust}
       UNION ALL
       SELECT 'invoice', i.id, i.invoice_number, i.customer_id, NULL,
              i.invoice_date,
              COALESCE(i.due_date, i.invoice_date + COALESCE(c.delai_paiement_jours, 0)),
              i.total_amount::numeric, COALESCE(i.paid_amount, 0)::numeric
         FROM invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.invoice_type = 'emitted' AND i.status NOT IN ('paid', 'cancelled')
          AND i.total_amount - COALESCE(i.paid_amount, 0) > 0.005${invStore}${invCust}
     )
     SELECT *, ((now() AT TIME ZONE 'Africa/Casablanca')::date - due_date) AS days_late, amount - paid AS remaining
       FROM docs ORDER BY due_date, number`,
    values);
  return r.rows.map((row: Record<string, unknown>) => {
    const daysLate = Number(row.days_late);
    return {
      kind: row.kind as 'ticket' | 'invoice',
      id: row.id as string,
      number: row.number as string,
      customer_id: (row.customer_id as string | null) ?? null,
      legacy_name: (row.legacy_name as string | null) ?? null,
      doc_date: String(row.doc_date instanceof Date ? (row.doc_date as Date).toISOString().slice(0, 10) : row.doc_date),
      due_date: String(row.due_date instanceof Date ? (row.due_date as Date).toISOString().slice(0, 10) : row.due_date),
      days_late: daysLate,
      amount: round2(Number(row.amount)),
      paid: round2(Number(row.paid)),
      remaining: round2(Number(row.remaining)),
      bucket: bucketOf(daysLate),
    };
  });
}

function customerName(c: Record<string, unknown> | undefined): string {
  if (!c) return 'Client inconnu';
  const person = [c.first_name, c.last_name].filter(Boolean).join(' ');
  return (c.company_name as string) || person || 'Client sans nom';
}

export const receivablesRepository = {
  /** Balance âgée : une ligne par client (les impayés historiques sans fiche sont regroupés à part). */
  async agedBalance(storeId?: string) {
    const docs = await openDocuments({ storeId });
    const ids = Array.from(new Set(docs.map(d => d.customer_id).filter(Boolean))) as string[];
    const customers = ids.length
      ? (await db.query(`SELECT id, first_name, last_name, company_name, phone, customer_type, credit_limit FROM customers WHERE id = ANY($1::uuid[])`, [ids])).rows
      : [];
    const byId = new Map(customers.map((c: Record<string, unknown>) => [c.id as string, c]));

    const groups = new Map<string, CustomerReceivable>();
    for (const d of docs) {
      const key = d.customer_id ?? `legacy:${d.legacy_name ?? ''}`;
      let g = groups.get(key);
      if (!g) {
        const c = d.customer_id ? byId.get(d.customer_id) : undefined;
        g = {
          customerId: d.customer_id,
          name: d.customer_id ? customerName(c) : `${d.legacy_name || 'Sans nom'} (sans fiche client)`,
          phone: (c?.phone as string | null) ?? null,
          customerType: (c?.customer_type as string | null) ?? null,
          creditLimit: c?.credit_limit != null && Number(c.credit_limit) > 0 ? Number(c.credit_limit) : null,
          total: 0, overdue: 0, buckets: emptyBuckets(), oldestDue: null, maxDaysLate: 0, docs: [],
        };
        groups.set(key, g);
      }
      g.docs.push(d);
      g.total = round2(g.total + d.remaining);
      g.buckets[d.bucket] = round2(g.buckets[d.bucket] + d.remaining);
      if (d.days_late > 0) g.overdue = round2(g.overdue + d.remaining);
      if (!g.oldestDue || d.due_date < g.oldestDue) g.oldestDue = d.due_date;
      g.maxDaysLate = Math.max(g.maxDaysLate, d.days_late);
    }
    // Les plus urgents d'abord : retard le plus ancien, puis montant.
    const rows = Array.from(groups.values()).sort((a, b) => b.maxDaysLate - a.maxDaysLate || b.total - a.total);
    const totals = rows.reduce((t, r) => {
      t.total = round2(t.total + r.total);
      t.overdue = round2(t.overdue + r.overdue);
      (Object.keys(r.buckets) as AgingBucket[]).forEach(k => { t.buckets[k] = round2(t.buckets[k] + r.buckets[k]); });
      return t;
    }, { total: 0, overdue: 0, buckets: emptyBuckets(), customers: rows.length, documents: docs.length });
    return { asOf: new Date().toISOString().slice(0, 10), totals, customers: rows };
  },

  /** Situation d'un client (fiche client, contrôle d'encours) : dû, échu, plafond, disponible. */
  async customerSituation(customerId: string) {
    const docs = await openDocuments({ customerId });
    const c = (await db.query(`SELECT credit_limit, delai_paiement_jours FROM customers WHERE id = $1`, [customerId])).rows[0];
    const total = round2(docs.reduce((s, d) => s + d.remaining, 0));
    const overdue = round2(docs.filter(d => d.days_late > 0).reduce((s, d) => s + d.remaining, 0));
    const creditLimit = c?.credit_limit != null && Number(c.credit_limit) > 0 ? Number(c.credit_limit) : null;
    return {
      total, overdue,
      creditLimit,
      available: creditLimit != null ? round2(creditLimit - total) : null,
      paymentTermDays: c?.delai_paiement_jours != null ? Number(c.delai_paiement_jours) : 0,
      maxDaysLate: docs.reduce((m, d) => Math.max(m, d.days_late), 0),
      documents: docs,
    };
  },
};
