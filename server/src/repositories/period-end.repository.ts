import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import { persistEntry, postingAccount, reverseEntriesForSource, type GeneratedEntry } from '../services/journal-generator.service.js';
import { withActor } from '../services/document-actions.service.js';

/**
 * Opérations de fin de période du cycle de vente (O2C L6, mig 452).
 *
 *   - Factures à établir (FAE, G-RR-02) : les BL livrés et pas encore facturés à
 *     la fin du mois portent leur chiffre d'affaires sur ce mois (3427 / 7111),
 *     extourné au premier jour du mois suivant, quand la facture le reprend.
 *   - Stock de produits finis (G-RR-05) : valorisé au coût figé des lots (sinon
 *     au coût standard) ; la variation depuis la valorisation précédente passe
 *     en 3151 / 7132 (inventaire intermittent du CGNC).
 *
 * Relancer une opération remplace la précédente : ses écritures sont extournées.
 */

type Fail = Error & { statusCode?: number };
const fail = (statusCode: number, message: string): Fail => Object.assign(new Error(message), { statusCode });
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

async function openPeriod(c: PoolClient, periodId: string) {
  const p = (await c.query(
    `SELECT id, status, start_date::text AS start_date, end_date::text AS end_date, (end_date + 1)::text AS next_day
       FROM fiscal_periods WHERE id = $1 FOR UPDATE`, [periodId])).rows[0];
  if (!p) throw fail(404, 'Période introuvable');
  if (p.status !== 'open') throw fail(409, 'Période close : rouvrez-la pour passer les opérations de fin de période');
  return p as { id: string; status: string; start_date: string; end_date: string; next_day: string };
}

/** Remplace l'opération active de ce type : écritures extournées, ligne marquée remplacée. */
async function supersede(c: PoolClient, periodId: string, kind: string) {
  const prev = (await c.query(
    `UPDATE period_end_operations SET superseded_at = now() WHERE period_id = $1 AND kind = $2 AND superseded_at IS NULL RETURNING id`,
    [periodId, kind])).rows[0];
  if (prev) await reverseEntriesForSource(c, { sourceId: prev.id, sourceKinds: ['period_accrual', 'accrual_reversal'] });
}

async function inTx<T>(userId: string, fn: (c: PoolClient) => Promise<T>) {
  const c = await db.getClient();
  try {
    await c.query('BEGIN');
    await withActor(c, userId);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

export const periodEndRepository = {
  async list(periodId: string) {
    return (await db.query(
      `SELECT o.*, o.amount::float8 AS amount, concat_ws(' ', u.first_name, u.last_name) AS created_by_name
         FROM period_end_operations o LEFT JOIN users u ON u.id = o.created_by
        WHERE o.period_id = $1 ORDER BY o.created_at DESC`, [periodId])).rows;
  },

  /** BL livrés non facturés à la fin de la période (aperçu avant de passer les FAE). */
  async unbilled(periodId: string) {
    return (await db.query(
      `SELECT x.delivery_note_id, x.number, x.delivery_date::text AS delivery_date, x.ht::float8 AS ht,
              COALESCE(NULLIF(c.company_name, ''), concat_ws(' ', c.first_name, c.last_name)) AS customer_name
         FROM v_o2c_unbilled_at x JOIN fiscal_periods fp ON fp.end_date = x.as_of
         JOIN customers c ON c.id = x.customer_id
        WHERE fp.id = $1 ORDER BY x.delivery_date, x.number`, [periodId])).rows;
  },

  async fae(periodId: string, userId: string) {
    return inTx(userId, async c => {
      const p = await openPeriod(c, periodId);
      await supersede(c, periodId, 'fae');
      const rows = (await c.query(
        `SELECT x.number, x.ht::float8 AS ht FROM v_o2c_unbilled_at x WHERE x.as_of = $1::date ORDER BY x.number`, [p.end_date])).rows;
      const amount = r2(rows.reduce((s: number, r: { ht: number }) => s + r.ht, 0));
      const op = (await c.query(
        `INSERT INTO period_end_operations (period_id, kind, amount, detail, created_by) VALUES ($1, 'fae', $2, $3, $4) RETURNING *`,
        [periodId, amount, JSON.stringify({ delivery_notes: rows.map((r: { number: string }) => r.number) }), userId])).rows[0];
      if (amount > 0) {
        const fae = await postingAccount(c, 'unbilled_receivable');
        const entry = {
          journal_code: 'OD', entry_date: p.end_date, description: `Factures à établir au ${p.end_date} (${rows.length} BL)`,
          source_kind: 'period_accrual', source_id: op.id, store_id: null,
          lines: [
            { account_code: fae, debit: amount, credit: 0, label: 'BL livrés non facturés' },
            { account_code: '7111', debit: 0, credit: amount, label: 'Ventes livrées à facturer' },
          ],
        } as unknown as GeneratedEntry;
        await persistEntry(c, entry, { userId });
        // Extourne au premier jour de la période suivante : la facture reprendra ce CA.
        await persistEntry(c, {
          ...entry, entry_date: p.next_day, source_kind: 'accrual_reversal', source_detail: 'reversal',
          description: `Extourne des factures à établir au ${p.end_date}`,
          lines: entry.lines.map(l => ({ ...l, debit: l.credit, credit: l.debit })),
        } as unknown as GeneratedEntry, { userId });
      }
      return { ...op, amount: Number(op.amount), delivery_notes: rows.length };
    });
  },

  async fgStock(periodId: string, userId: string) {
    return inTx(userId, async c => {
      const p = await openPeriod(c, periodId);
      await supersede(c, periodId, 'fg_stock');
      // Valeur : lots au coût figé, plus la part du stock non suivie par lots au coût standard.
      const v = (await c.query(
        `WITH lots AS (
           SELECT product_id, store_id, SUM(backroom_qty + vitrine_qty) AS qty,
                  SUM((backroom_qty + vitrine_qty) * COALESCE(unit_cost, 0)) AS value
             FROM product_lots WHERE status = 'active' AND backroom_qty + vitrine_qty > 0
            GROUP BY product_id, store_id)
         SELECT COALESCE(SUM(COALESCE(l.value, 0)
                  + GREATEST(COALESCE(s.stock_quantity, 0) - COALESCE(l.qty, 0), 0) * COALESCE(std.unit_cost, 0)), 0)::float8 AS value,
                COUNT(*) FILTER (WHERE std.unit_cost IS NULL AND COALESCE(s.stock_quantity, 0) > COALESCE(l.qty, 0))::int AS without_cost
           FROM product_store_stock s
           FULL JOIN lots l ON l.product_id = s.product_id AND l.store_id = s.store_id
           LEFT JOIN v_product_unit_cost std ON std.product_id = COALESCE(s.product_id, l.product_id)`)).rows[0];
      const value = r2(Number(v.value));
      const previous = Number((await c.query(
        `SELECT o.amount FROM period_end_operations o JOIN fiscal_periods fp ON fp.id = o.period_id
          WHERE o.kind = 'fg_stock' AND o.superseded_at IS NULL AND fp.end_date < $1::date
          ORDER BY fp.end_date DESC LIMIT 1`, [p.end_date])).rows[0]?.amount ?? 0);
      const delta = r2(value - previous);
      const op = (await c.query(
        `INSERT INTO period_end_operations (period_id, kind, amount, detail, created_by) VALUES ($1, 'fg_stock', $2, $3, $4) RETURNING *`,
        [periodId, value, JSON.stringify({ previous, delta, products_without_cost: v.without_cost }), userId])).rows[0];
      if (delta !== 0) {
        const stock = await postingAccount(c, 'fg_stock');
        const variation = await postingAccount(c, 'fg_stock_variation');
        await persistEntry(c, {
          journal_code: 'OD', entry_date: p.end_date, description: `Variation du stock de produits finis au ${p.end_date}`,
          source_kind: 'period_accrual', source_id: op.id, store_id: null,
          lines: delta > 0
            ? [{ account_code: stock, debit: delta, credit: 0, label: 'Stock de produits finis' },
               { account_code: variation, debit: 0, credit: delta, label: 'Variation de stock (augmentation)' }]
            : [{ account_code: variation, debit: -delta, credit: 0, label: 'Variation de stock (diminution)' },
               { account_code: stock, debit: 0, credit: -delta, label: 'Stock de produits finis' }],
        } as unknown as GeneratedEntry, { userId });
      }
      return { ...op, amount: value, previous, delta, products_without_cost: v.without_cost };
    });
  },
};
