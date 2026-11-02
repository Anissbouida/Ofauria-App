/**
 * Comptabilité analytique (mig 428) : axes, sections (centres de coûts), clés
 * de répartition, ventilation des lignes de charges et de produits, balance
 * analytique.
 *
 *   - Une ligne 6/7 se ventile sur un axe : une section (100 %), une clé
 *     (pourcentages, arrondis au centime, le reste sur la dernière section) ou
 *     des montants libres. Le total ventilé égale le montant de la ligne
 *     (contrôlé par la base au COMMIT).
 *   - Les factures affectées à un centre sont ventilées automatiquement
 *     (triggers de la mig 428) ; une ventilation manuelle n'est pas écrasée.
 *   - La balance analytique reprend les écritures validées (extournes
 *     comprises) : sections + « non ventilé » = résultat du CPC.
 */
import type { PoolClient } from 'pg';
import { db } from '../config/database.js';

type Actor = { userId: string };
const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const cents = (v: number | string) => Math.round((Number(v) || 0) * 100);
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** Lignes analysées : écritures validées (extournes comprises), hors à-nouveaux, classes 6 et 7. */
const SCOPE = `je.status IN ('posted', 'reversed') AND je.source_kind <> 'opening' AND a.account_class IN (6, 7)`;

async function withTx<T>(userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Répartit un montant (centimes) selon des pourcentages ; l'écart d'arrondi va à la dernière part. */
export function splitByPercent(amountCents: number, parts: { id: string; percent: number }[]): { id: string; cents: number }[] {
  let left = amountCents;
  return parts.map((p, i) => {
    const c = i === parts.length - 1 ? left : Math.round((amountCents * p.percent) / 100);
    left -= c;
    return { id: p.id, cents: c };
  }).filter(p => p.cents > 0);
}

export const analyticRepository = {
  /* ─── Paramétrage ─── */
  async axes() {
    return (await db.query(
      `SELECT x.*, (SELECT count(*) FROM cost_centers c WHERE c.axis_id = x.id)::int AS sections
         FROM analytic_axes x ORDER BY x.is_active DESC, x.code`)).rows;
  },
  async createAxis(p: { code: string; name: string }) {
    const code = p.code.trim().toUpperCase().slice(0, 20);
    if (!code || !p.name.trim()) throw fail('Code et nom requis');
    try {
      return (await db.query(`INSERT INTO analytic_axes (code, name) VALUES ($1, $2) RETURNING *`, [code, p.name.trim().slice(0, 120)])).rows[0];
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw fail(`L'axe ${code} existe déjà`, 409);
      throw err;
    }
  },
  async keys(axisId?: string) {
    return (await db.query(
      `SELECT k.id, k.axis_id, k.name, k.is_active,
              COALESCE(json_agg(json_build_object('cost_center_id', l.cost_center_id, 'code', c.code, 'name', c.name, 'percent', l.percent)
                       ORDER BY c.code) FILTER (WHERE l.key_id IS NOT NULL), '[]') AS lines
         FROM analytic_keys k
         LEFT JOIN analytic_key_lines l ON l.key_id = k.id
         LEFT JOIN cost_centers c ON c.id = l.cost_center_id
        WHERE k.is_active AND ($1::uuid IS NULL OR k.axis_id = $1::uuid)
        GROUP BY k.id ORDER BY k.name`, [axisId || null])).rows;
  },
  createKey(p: { axisId: string; name: string; lines: { costCenterId: string; percent: number }[] }, actor: Actor) {
    return withTx(actor.userId, async c => {
      if (!p.name.trim()) throw fail('Nom de la clé requis');
      if (p.lines.length < 2) throw fail('Une clé répartit sur au moins deux sections');
      const total = p.lines.reduce((s, l) => s + Math.round(l.percent * 10000), 0);
      if (total !== 1_000_000) throw fail(`Les pourcentages totalisent ${total / 10000} % au lieu de 100 %`);
      const foreign = (await c.query(
        `SELECT count(*)::int AS n FROM cost_centers WHERE id = ANY($1::uuid[]) AND (axis_id <> $2 OR NOT is_active)`,
        [p.lines.map(l => l.costCenterId), p.axisId])).rows[0].n;
      if (foreign) throw fail('Toutes les sections de la clé doivent être actives et de l\'axe choisi');
      let key;
      try {
        key = (await c.query(`INSERT INTO analytic_keys (axis_id, name, created_by) VALUES ($1, $2, $3) RETURNING *`,
          [p.axisId, p.name.trim().slice(0, 120), actor.userId])).rows[0];
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw fail(`Une clé « ${p.name.trim()} » existe déjà sur cet axe`, 409);
        throw err;
      }
      for (const l of p.lines) {
        await c.query(`INSERT INTO analytic_key_lines (key_id, cost_center_id, percent) VALUES ($1, $2, $3)`, [key.id, l.costCenterId, l.percent]);
      }
      return key;
    });
  },
  async deleteKey(id: string) {
    await db.query(`UPDATE analytic_keys SET is_active = false WHERE id = $1`, [id]);
  },

  /* ─── Ventilation ─── */
  /** Lignes 6/7 d'une période avec leur ventilation sur l'axe (à ventiler, ventilées, toutes). */
  async lines(p: { axisId: string; from: string; to: string; status: 'open' | 'done' | 'all'; search?: string; accountClass?: 6 | 7; storeId?: string | null }) {
    const r = await db.query(
      `SELECT jel.id, jel.debit, jel.credit, COALESCE(jel.label, je.description) AS label,
              je.entry_number, je.entry_date::text AS entry_date, je.source_kind, a.code AS account_code, a.label AS account_label,
              COALESCE(json_agg(json_build_object('cost_center_id', x.cost_center_id, 'code', c.code, 'amount', x.amount, 'source', x.source)
                       ORDER BY c.code) FILTER (WHERE x.id IS NOT NULL), '[]') AS ventilation
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         JOIN accounts a ON a.id = jel.account_id
         LEFT JOIN journal_line_analytics x ON x.journal_entry_line_id = jel.id AND x.axis_id = $1
         LEFT JOIN cost_centers c ON c.id = x.cost_center_id
        WHERE ${SCOPE} AND je.entry_date BETWEEN $2::date AND $3::date
          AND ($4::int IS NULL OR a.account_class = $4::int)
          AND ($5::text IS NULL OR COALESCE(jel.label, je.description) ILIKE '%' || $5 || '%' OR a.code LIKE $5 || '%' OR je.entry_number ILIKE '%' || $5 || '%')
          AND ($6::uuid IS NULL OR je.store_id IS NULL OR je.store_id = $6::uuid)
        GROUP BY jel.id, je.id, a.id
       HAVING ($7 = 'all' OR ($7 = 'open') = (count(x.id) = 0))
        ORDER BY je.entry_date DESC, je.entry_number DESC, jel.line_order
        LIMIT 1000`,
      [p.axisId, p.from, p.to, p.accountClass ?? null, p.search?.trim() || null, p.storeId || null, p.status]);
    return r.rows;
  },

  /**
   * Ventile des lignes sur un axe : une section, une clé, ou des montants
   * libres (une seule ligne). Remplace la ventilation existante de l'axe.
   */
  ventilate(p: {
    lineIds: string[]; axisId: string; costCenterId?: string | null; keyId?: string | null;
    splits?: { costCenterId: string; amount: number }[] | null;
  }, actor: Actor) {
    return withTx(actor.userId, async c => {
      const ids = [...new Set(p.lineIds)];
      if (!ids.length) throw fail('Aucune ligne choisie');
      const modes = [p.costCenterId, p.keyId, p.splits?.length].filter(Boolean).length;
      if (modes !== 1) throw fail('Choisissez une section, une clé de répartition ou des montants');
      const lines = (await c.query(
        `SELECT jel.id, jel.debit + jel.credit AS amount, a.account_class, je.status, je.entry_number
           FROM journal_entry_lines jel JOIN accounts a ON a.id = jel.account_id JOIN journal_entries je ON je.id = jel.journal_entry_id
          WHERE jel.id = ANY($1::uuid[]) FOR UPDATE OF jel`, [ids])).rows as
        { id: string; amount: string; account_class: number; status: string; entry_number: string }[];
      if (lines.length !== ids.length) throw fail('Ligne introuvable', 404);
      const bad = lines.find(l => ![6, 7].includes(l.account_class));
      if (bad) throw fail(`Écriture ${bad.entry_number} : seules les charges (6) et les produits (7) se ventilent`);
      const draft = lines.find(l => l.status === 'draft');
      if (draft) throw fail(`Écriture ${draft.entry_number} en brouillon : comptabilisez-la avant de la ventiler`, 409);

      let parts: { id: string; percent: number }[] | null = null;
      let source: 'manual' | 'key' = 'manual';
      if (p.costCenterId) parts = [{ id: p.costCenterId, percent: 100 }];
      if (p.keyId) {
        source = 'key';
        parts = (await c.query(
          `SELECT l.cost_center_id AS id, l.percent::float8 AS percent FROM analytic_key_lines l JOIN analytic_keys k ON k.id = l.key_id
            WHERE k.id = $1 AND k.is_active AND k.axis_id = $2 ORDER BY l.percent DESC`, [p.keyId, p.axisId])).rows;
        if (!parts!.length) throw fail('Clé de répartition introuvable sur cet axe', 404);
      }
      if (p.splits?.length && ids.length !== 1) throw fail('Des montants libres se saisissent ligne par ligne');

      await c.query(`DELETE FROM journal_line_analytics WHERE journal_entry_line_id = ANY($1::uuid[]) AND axis_id = $2`, [ids, p.axisId]);
      for (const l of lines) {
        const amount = cents(l.amount);
        const rows = parts
          ? splitByPercent(amount, parts)
          : p.splits!.map(s => ({ id: s.costCenterId, cents: cents(s.amount) })).filter(s => s.cents > 0);
        for (const r of rows) {
          await c.query(
            `INSERT INTO journal_line_analytics (journal_entry_line_id, axis_id, cost_center_id, amount, source, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)`, [l.id, p.axisId, r.id, r.cents / 100, source, actor.userId]);
        }
      }
      return { lines: lines.length };
    });
  },

  /** Retire la ventilation de lignes sur un axe. */
  clear(p: { lineIds: string[]; axisId: string }, actor: Actor) {
    return withTx(actor.userId, async c => {
      const r = await c.query(`DELETE FROM journal_line_analytics WHERE journal_entry_line_id = ANY($1::uuid[]) AND axis_id = $2`, [p.lineIds, p.axisId]);
      return { removed: r.rowCount ?? 0 };
    });
  },

  /* ─── États ─── */
  /**
   * Balance analytique d'un axe : par section, produits, charges, résultat et
   * détail par compte ; le non-ventilé ferme l'écart avec le CPC.
   * Produit = crédit − débit (classe 7) ; charge = débit − crédit (classe 6).
   */
  async balance(p: { axisId: string; from: string; to: string; storeId?: string | null }) {
    const axis = (await db.query(`SELECT id, code, name FROM analytic_axes WHERE id = $1`, [p.axisId])).rows[0];
    if (!axis) throw fail('Axe introuvable', 404);
    const r = await db.query(
      `WITH l AS (
         SELECT jel.id, jel.debit, jel.credit, a.code, a.label, a.account_class,
                CASE WHEN jel.debit > 0 THEN 1 ELSE -1 END AS dsign
           FROM journal_entry_lines jel
           JOIN journal_entries je ON je.id = jel.journal_entry_id
           JOIN accounts a ON a.id = jel.account_id
          WHERE ${SCOPE} AND je.entry_date BETWEEN $2::date AND $3::date
            AND ($4::uuid IS NULL OR je.store_id IS NULL OR je.store_id = $4::uuid)),
       parts AS (   -- part ventilée par section, et reste non ventilé
         SELECT l.code, l.label, l.account_class, x.cost_center_id, x.amount * l.dsign AS signed
           FROM l JOIN journal_line_analytics x ON x.journal_entry_line_id = l.id AND x.axis_id = $1
         UNION ALL
         SELECT l.code, l.label, l.account_class, NULL,
                ((l.debit + l.credit) - COALESCE((SELECT sum(y.amount) FROM journal_line_analytics y
                                                   WHERE y.journal_entry_line_id = l.id AND y.axis_id = $1), 0)) * l.dsign
           FROM l)
       SELECT cost_center_id, code, label, account_class,
              sum(CASE WHEN account_class = 7 THEN -signed ELSE 0 END)::float8 AS produits,
              sum(CASE WHEN account_class = 6 THEN signed ELSE 0 END)::float8 AS charges
         FROM parts GROUP BY cost_center_id, code, label, account_class
       HAVING sum(signed) <> 0
        ORDER BY code`, [p.axisId, p.from, p.to, p.storeId || null]);
    const sections = (await db.query(
      `SELECT id, code, name, is_active FROM cost_centers WHERE axis_id = $1 ORDER BY code`, [p.axisId])).rows as
      { id: string; code: string; name: string; is_active: boolean }[];
    type Acc = { code: string; label: string; produits: number; charges: number };
    const build = (rows: { code: string; label: string; produits: number; charges: number }[]) => {
      const accounts: Acc[] = rows.map(x => ({ code: x.code, label: x.label, produits: r2(x.produits), charges: r2(x.charges) }));
      const produits = r2(accounts.reduce((s, a) => s + a.produits, 0));
      const charges = r2(accounts.reduce((s, a) => s + a.charges, 0));
      return { produits, charges, result: r2(produits - charges), accounts };
    };
    const rows = r.rows as { cost_center_id: string | null; code: string; label: string; produits: number; charges: number }[];
    const bySection = sections.map(s => ({ ...s, ...build(rows.filter(x => x.cost_center_id === s.id)) }))
      .filter(s => s.is_active || s.accounts.length);
    const unventilated = build(rows.filter(x => x.cost_center_id == null));
    const all = build(rows.map(x => ({ ...x })));
    return {
      axis, from: p.from, to: p.to, sections: bySection, unventilated,
      totals: { produits: all.produits, charges: all.charges, result: all.result },
      ventilated_rate: all.produits + all.charges
        ? Math.round(((all.produits + all.charges - unventilated.produits - unventilated.charges) / (all.produits + all.charges)) * 1000) / 10 : 100,
    };
  },

  /** Lignes d'une section (ou du non-ventilé) : grand livre analytique. */
  async sectionLines(p: { axisId: string; costCenterId: string | null; from: string; to: string; storeId?: string | null }) {
    const r = await db.query(
      p.costCenterId
        ? `SELECT je.entry_date::text AS entry_date, je.entry_number, a.code AS account_code, a.label AS account_label,
                  COALESCE(jel.label, je.description) AS label, (x.amount * CASE WHEN jel.debit > 0 THEN 1 ELSE -1 END)::float8 AS amount, x.source
             FROM journal_line_analytics x
             JOIN journal_entry_lines jel ON jel.id = x.journal_entry_line_id
             JOIN journal_entries je ON je.id = jel.journal_entry_id
             JOIN accounts a ON a.id = jel.account_id
            WHERE x.axis_id = $1 AND x.cost_center_id = $5 AND ${SCOPE} AND je.entry_date BETWEEN $2::date AND $3::date
              AND ($4::uuid IS NULL OR je.store_id IS NULL OR je.store_id = $4::uuid)
            ORDER BY je.entry_date, je.entry_number LIMIT 2000`
        : `SELECT je.entry_date::text AS entry_date, je.entry_number, a.code AS account_code, a.label AS account_label,
                  COALESCE(jel.label, je.description) AS label, ((jel.debit + jel.credit) * CASE WHEN jel.debit > 0 THEN 1 ELSE -1 END)::float8 AS amount, NULL AS source
             FROM journal_entry_lines jel
             JOIN journal_entries je ON je.id = jel.journal_entry_id
             JOIN accounts a ON a.id = jel.account_id
            WHERE ${SCOPE} AND je.entry_date BETWEEN $2::date AND $3::date
              AND ($4::uuid IS NULL OR je.store_id IS NULL OR je.store_id = $4::uuid)
              AND NOT EXISTS (SELECT 1 FROM journal_line_analytics x WHERE x.journal_entry_line_id = jel.id AND x.axis_id = $1)
            ORDER BY je.entry_date, je.entry_number LIMIT 2000`,
      p.costCenterId ? [p.axisId, p.from, p.to, p.storeId || null, p.costCenterId] : [p.axisId, p.from, p.to, p.storeId || null]);
    return r.rows;
  },
};
