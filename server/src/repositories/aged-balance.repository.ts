/**
 * Balance âgée comptable (feuille de route compta, lot Important 6) — celle de
 * Sage : par tiers, ce qui reste ouvert sur les comptes collectifs (4411
 * fournisseurs, 3421 clients), classé par ancienneté de l'échéance.
 *
 *   - Source : les lignes NON LETTRÉES du grand livre à la date choisie. Une
 *     ligne lettrée après cette date était encore ouverte : elle compte. Son
 *     total égale donc le solde comptable des comptes de tiers (contrôle rendu).
 *   - Une facture et ses règlements partiels (lien payments.invoice_id) forment
 *     une seule pièce : son reste dû vieillit depuis l'échéance de la facture
 *     (due_date, sinon date de facture + délai du client).
 *   - Le reste (règlement non imputé, OD, à-nouveau) vieillit depuis sa date.
 *   - Fenêtre de cumul : depuis le lendemain du dernier exercice clôturé
 *     (fn_ledger_window_start) ; les à-nouveaux portent le report.
 *
 * Différence avec Ventes › Créances (receivables.repository) : celle-ci part
 * des pièces de gestion, y compris les tickets de caisse impayés qui ne passent
 * au grand livre qu'à leur encaissement.
 */
import type { PoolClient } from 'pg';
import { db } from '../config/database.js';

export type AgedSide = 'suppliers' | 'customers';
export type AgedBucket = 'current' | 'd30' | 'd60' | 'd90' | 'over90';
export const AGED_BUCKETS: AgedBucket[] = ['current', 'd30', 'd60', 'd90', 'over90'];

export interface AgedItem {
  key: string;
  kind: 'invoice' | 'payment' | 'opening' | 'other';
  reference: string;
  label: string;
  doc_date: string;
  due_date: string;
  days_late: number;
  amount: number;            // reste dû (positif = dû par nous côté fournisseurs, à nous côté clients)
  bucket: AgedBucket;
  partial: boolean;          // pièce et acomptes pré-lettrés (mig 466) : rapprochés sans être soldés
}
export interface AgedTiers {
  auxiliary_id: string;
  code: string;
  label: string;
  account_code: string;
  customer_id: string | null;
  supplier_id: string | null;
  total: number;
  overdue: number;
  buckets: Record<AgedBucket, number>;
  max_days_late: number;
  items: AgedItem[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const emptyBuckets = (): Record<AgedBucket, number> => ({ current: 0, d30: 0, d60: 0, d90: 0, over90: 0 });
export function bucketOf(daysLate: number): AgedBucket {
  if (daysLate <= 0) return 'current';
  if (daysLate <= 30) return 'd30';
  if (daysLate <= 60) return 'd60';
  if (daysLate <= 90) return 'd90';
  return 'over90';
}

export const agedBalanceRepository = {
  /** Lectures dans un même instantané (REPEATABLE READ) : total et solde de contrôle concordent. */
  async compute(p: { side: AgedSide; asOf: string }) {
    const c = await db.getClient();
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const out = await computeIn(c, p);
      await c.query('COMMIT');
      return out;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  },
};

async function computeIn(c: PoolClient, p: { side: AgedSide; asOf: string }) {
  const kind = p.side === 'suppliers' ? 'supplier' : 'customer';
  // Signe : côté fournisseurs, le dû est au crédit ; côté clients, au débit.
  const sgn = p.side === 'suppliers' ? '(jel.credit - jel.debit)' : '(jel.debit - jel.credit)';
  const r = await c.query(
    `WITH win AS (SELECT fn_ledger_window_start($2::date, 4) AS start),
     grp_end AS (   -- date à laquelle un groupe de lettrage s'est soldé
       SELECT jel.lettrage_id, max(je.entry_date) AS done
         FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id
        WHERE jel.lettrage_id IS NOT NULL GROUP BY jel.lettrage_id),
     open AS (
       -- inv : la facture rattachée, par la source OU l'axe de lettrage par ligne
       -- (mig 451) — un règlement réparti porte jel.invoice_id sans source facture.
       SELECT jel.id, jel.auxiliary_id, a.code AS account_code, ${sgn} AS amount,
              je.entry_date, je.entry_number, je.source_kind, COALESCE(jel.label, je.description) AS label,
              jel.lettrage_partiel_id, COALESCE(i.id, pay.invoice_id, jel.invoice_id) AS inv
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status IN ('posted', 'reversed')
         JOIN accounts a ON a.id = jel.account_id AND a.is_collective AND a.auxiliary_kind = $1
         LEFT JOIN grp_end g ON g.lettrage_id = jel.lettrage_id
         LEFT JOIN invoices i ON i.id = je.source_id
         LEFT JOIN payments pay ON pay.id = je.source_id
         , win
        WHERE je.entry_date <= $2::date AND je.entry_date >= win.start
          AND (jel.lettrage_id IS NULL OR g.done > $2::date))
     SELECT o.auxiliary_id, o.account_code,
            COALESCE(o.inv::text, o.id::text) AS key,
            CASE WHEN o.inv IS NOT NULL THEN 'invoice'
                 WHEN bool_or(o.source_kind = 'opening') THEN 'opening'
                 WHEN bool_or(o.source_kind IN ('payment', 'backfill')) THEN 'payment'
                 ELSE 'other' END AS kind,
            COALESCE(min(inv.invoice_number), min(o.entry_number)) AS reference,
            min(o.label) AS label,
            COALESCE(min(inv.invoice_date), min(o.entry_date))::text AS doc_date,
            COALESCE(min(inv.due_date), min(inv.invoice_date) + COALESCE(min(c.delai_paiement_jours), 0), min(o.entry_date))::text AS due_date,
            sum(o.amount) AS amount,
            bool_or(o.lettrage_partiel_id IS NOT NULL) AS partial
       FROM open o
       LEFT JOIN invoices inv ON inv.id = o.inv
       LEFT JOIN customers c ON c.id = inv.customer_id
      GROUP BY o.auxiliary_id, o.account_code, COALESCE(o.inv::text, o.id::text), o.inv
     HAVING sum(o.amount) <> 0`,
    [kind, p.asOf]);

  const aux = new Map((await c.query(
    `SELECT ax.id, ax.code, ax.label, ax.customer_id, ax.supplier_id FROM account_auxiliaries ax
       JOIN accounts a ON a.id = ax.account_id WHERE a.auxiliary_kind = $1`, [kind])).rows
    .map((x: { id: string; code: string; label: string; customer_id: string | null; supplier_id: string | null }) => [x.id, x]));

  const asOfMs = Date.parse(`${p.asOf}T00:00:00Z`);
  const groups = new Map<string, AgedTiers>();
  for (const row of r.rows as { auxiliary_id: string; account_code: string; key: string; kind: AgedItem['kind']; reference: string; label: string; doc_date: string; due_date: string; amount: string; partial: boolean }[]) {
    const daysLate = Math.round((asOfMs - Date.parse(`${row.due_date}T00:00:00Z`)) / 86_400_000);
    const item: AgedItem = {
      key: row.key, kind: row.kind, reference: row.reference, label: row.label,
      doc_date: row.doc_date, due_date: row.due_date, days_late: daysLate,
      amount: round2(Number(row.amount)), bucket: bucketOf(daysLate), partial: Boolean(row.partial),
    };
    let g = groups.get(row.auxiliary_id);
    if (!g) {
      const a = aux.get(row.auxiliary_id);
      g = {
        auxiliary_id: row.auxiliary_id, code: a?.code ?? '', label: a?.label ?? 'Tiers inconnu', account_code: row.account_code,
        customer_id: a?.customer_id ?? null, supplier_id: a?.supplier_id ?? null,
        total: 0, overdue: 0, buckets: emptyBuckets(), max_days_late: 0, items: [],
      };
      groups.set(row.auxiliary_id, g);
    }
    g.items.push(item);
    g.total = round2(g.total + item.amount);
    g.buckets[item.bucket] = round2(g.buckets[item.bucket] + item.amount);
    // Échu = toutes les tranches en retard, règlements non imputés compris
    // (ils viennent en déduction) ; le retard max ne regarde que les dus.
    if (item.days_late > 0) g.overdue = round2(g.overdue + item.amount);
    if (item.days_late > 0 && item.amount > 0) g.max_days_late = Math.max(g.max_days_late, item.days_late);
  }
  for (const g of groups.values()) g.items.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.reference.localeCompare(b.reference));
  const tiers = [...groups.values()]
    .filter(g => g.total !== 0 || g.items.length > 0)
    .sort((a, b) => b.overdue - a.overdue || b.total - a.total);

  const totals = tiers.reduce((t, g) => {
    t.total = round2(t.total + g.total);
    t.overdue = round2(t.overdue + g.overdue);
    for (const k of AGED_BUCKETS) t.buckets[k] = round2(t.buckets[k] + g.buckets[k]);
    return t;
  }, { total: 0, overdue: 0, buckets: emptyBuckets(), tiers: tiers.length });

  // Contrôle : solde comptable des mêmes comptes à la même date, même fenêtre.
  const ledger = Number((await c.query(
    `SELECT COALESCE(sum(${sgn}), 0) AS s
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status IN ('posted', 'reversed')
       JOIN accounts a ON a.id = jel.account_id AND a.is_collective AND a.auxiliary_kind = $1
      WHERE je.entry_date <= $2::date AND je.entry_date >= fn_ledger_window_start($2::date, 4)`,
    [kind, p.asOf])).rows[0].s);

  return { side: p.side, as_of: p.asOf, totals, ledger_balance: round2(ledger), tiers };
}
