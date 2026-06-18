/**
 * Service d'amortissement des immobilisations (CGNC Maroc).
 *
 * Calcule le plan d'amortissement (lineaire ou degressif) et genere les
 * ecritures de dotation : 6191 (dotation) D / 28xx (amortissement cumule) C.
 *
 * Lineaire : annuite constante = (cout - valeur residuelle) / duree.
 * Degressif : taux = coefficient / duree, applique a la VNC, avec bascule
 *   vers le lineaire quand celui-ci devient plus avantageux. Coefficients CGNC :
 *     duree 3-4 ans -> 1.5 ; 5-6 ans -> 2 ; > 6 ans -> 3.
 */

import type { PoolClient } from 'pg';
import { db } from '../config/database.js';

function round2(n: number): number { return Math.round(n * 100) / 100; }

/** Normalise une date (Date pg ou string) en 'YYYY-MM-DD'. */
function toIso(raw: unknown): string {
  if (raw instanceof Date) {
    const y = raw.getUTCFullYear();
    const m = String(raw.getUTCMonth() + 1).padStart(2, '0');
    const d = String(raw.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(raw).slice(0, 10);
}

export interface FixedAssetRow {
  id: string;
  label: string;
  asset_account_code: string;
  depreciation_account_code: string;
  expense_account_code: string;
  acquisition_date: string;
  acquisition_cost: string | number;
  residual_value: string | number;
  duration_years: number;
  method: 'linear' | 'degressive';
  store_id: string | null;
}

export interface ScheduleLine {
  year: number;
  month: number;
  amount: number;
  cumulated: number;
  vnc: number; // valeur nette comptable = cout - cumulated
}

function degressiveCoefficient(duration: number): number {
  if (duration <= 4) return 1.5;
  if (duration <= 6) return 2;
  return 3;
}

/**
 * Calcule le plan d'amortissement complet, mois par mois, depuis le mois
 * d'acquisition jusqu'a amortissement total.
 */
export function computeSchedule(asset: {
  acquisition_date: string;
  acquisition_cost: string | number;
  residual_value: string | number;
  duration_years: number;
  method: 'linear' | 'degressive';
}): ScheduleLine[] {
  const cost = parseFloat(String(asset.acquisition_cost)) || 0;
  const residual = parseFloat(String(asset.residual_value)) || 0;
  const base = round2(cost - residual);
  const duration = asset.duration_years;
  const isoDate = toIso(asset.acquisition_date);
  const startYear = parseInt(isoDate.slice(0, 4), 10);
  const startMonth = parseInt(isoDate.slice(5, 7), 10);

  const lines: ScheduleLine[] = [];
  let cumulated = 0;

  if (asset.method === 'linear') {
    const totalMonths = duration * 12;
    const monthly = round2(base / totalMonths);
    let y = startYear, m = startMonth;
    for (let i = 0; i < totalMonths; i++) {
      let amount = monthly;
      if (i === totalMonths - 1) amount = round2(base - cumulated); // derniere ajuste l'arrondi
      cumulated = round2(cumulated + amount);
      lines.push({ year: y, month: m, amount, cumulated, vnc: round2(cost - cumulated) });
      m++; if (m > 12) { m = 1; y++; }
    }
    return lines;
  }

  // Degressif : annuites par exercice, puis reparties mensuellement.
  const coef = degressiveCoefficient(duration);
  const degressiveRate = coef / duration;
  let remaining = base;
  const annuals: { year: number; annual: number }[] = [];
  for (let yearIdx = 0; yearIdx < duration; yearIdx++) {
    const yearsLeft = duration - yearIdx;
    const linearRate = 1 / yearsLeft;
    const rate = Math.max(degressiveRate, linearRate); // bascule vers lineaire
    let annual = round2(remaining * rate);
    if (yearIdx === duration - 1) annual = round2(remaining); // derniere annee solde le reste
    annuals.push({ year: startYear + yearIdx, annual });
    remaining = round2(remaining - annual);
  }

  // Repartition mensuelle. La premiere annee est proratisee a partir du mois
  // d'acquisition (mois restants jusqu'a decembre).
  for (let yearIdx = 0; yearIdx < annuals.length; yearIdx++) {
    const { year, annual } = annuals[yearIdx];
    const firstMonth = yearIdx === 0 ? startMonth : 1;
    const monthsInYear = 12 - firstMonth + 1;
    const monthly = round2(annual / monthsInYear);
    for (let mi = 0; mi < monthsInYear; mi++) {
      const m = firstMonth + mi;
      let amount = monthly;
      if (mi === monthsInYear - 1) {
        // derniere du bloc annee : ajuste pour que la somme du bloc = annual
        const blockSoFar = round2(monthly * (monthsInYear - 1));
        amount = round2(annual - blockSoFar);
      }
      cumulated = round2(cumulated + amount);
      lines.push({ year, month: m, amount, cumulated, vnc: round2(cost - cumulated) });
    }
  }
  return lines;
}

/**
 * Genere les ecritures de dotation pour une periode (annee, mois) donnee,
 * pour toutes les immobilisations actives concernees. Idempotent : une
 * depreciation_entry existante pour (asset, annee, mois) n'est pas recreee.
 *
 * Retourne le nombre d'ecritures creees et le montant total.
 */
export async function runDepreciation(
  client: PoolClient,
  params: { year: number; month: number; userId: string; storeId?: string }
): Promise<{ created: number; skipped: number; totalAmount: number }> {
  const storeFilter = params.storeId ? 'AND (fa.store_id IS NULL OR fa.store_id = $1)' : '';
  const assets = await client.query(
    `SELECT fa.id, fa.label, fa.acquisition_date, fa.acquisition_cost, fa.residual_value,
            fa.duration_years, fa.method, fa.store_id,
            aa.code AS asset_account_code,
            ad.code AS depreciation_account_code,
            ae.code AS expense_account_code
     FROM fixed_assets fa
     JOIN accounts aa ON aa.id = fa.asset_account_id
     JOIN accounts ad ON ad.id = fa.depreciation_account_id
     JOIN accounts ae ON ae.id = fa.expense_account_id
     WHERE fa.status = 'active' ${storeFilter}`,
    params.storeId ? [params.storeId] : []
  );

  let created = 0, skipped = 0, totalAmount = 0;

  for (const fa of assets.rows as FixedAssetRow[]) {
    const schedule = computeSchedule(fa);
    const line = schedule.find(l => l.year === params.year && l.month === params.month);
    if (!line || line.amount <= 0) { skipped++; continue; }

    // Idempotence : deja amorti pour cette periode ?
    const existing = await client.query(
      `SELECT id FROM depreciation_entries WHERE fixed_asset_id = $1 AND fiscal_year = $2 AND period_month = $3`,
      [fa.id, params.year, params.month]
    );
    if (existing.rows.length > 0) { skipped++; continue; }

    // Genere l'ecriture : 6191 D / 28xx C
    const dateStr = `${params.year}-${String(params.month).padStart(2, '0')}-${String(
      new Date(params.year, params.month, 0).getDate()
    ).padStart(2, '0')}`;

    const entry = await persistDepreciationEntry(client, {
      date: dateStr,
      label: `Dotation amortissement ${fa.label} ${String(params.month).padStart(2, '0')}/${params.year}`,
      expenseCode: fa.expense_account_code,
      depreciationCode: fa.depreciation_account_code,
      amount: line.amount,
      storeId: fa.store_id,
      sourceId: fa.id,
      sourceDetail: `${params.year}-${String(params.month).padStart(2, '0')}`,
      userId: params.userId,
    });

    await client.query(
      `INSERT INTO depreciation_entries (fixed_asset_id, fiscal_year, period_month, amount, journal_entry_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [fa.id, params.year, params.month, line.amount, entry.id]
    );

    // Si totalement amorti, basculer le statut.
    if (line.vnc <= parseFloat(String(fa.residual_value)) + 0.01) {
      await client.query(`UPDATE fixed_assets SET status = 'fully_depreciated' WHERE id = $1`, [fa.id]);
    }

    created++;
    totalAmount = round2(totalAmount + line.amount);
  }

  return { created, skipped, totalAmount };
}

/** Persiste une ecriture de dotation amortissement (journal OD). */
async function persistDepreciationEntry(
  client: PoolClient,
  p: {
    date: string; label: string; expenseCode: string; depreciationCode: string;
    amount: number; storeId: string | null; sourceId: string; sourceDetail: string; userId: string;
  }
): Promise<{ id: string; entry_number: string }> {
  const jrn = await client.query(`SELECT id FROM journals WHERE code = 'OD'`);
  const journalId = jrn.rows[0].id;

  const fp = await client.query(
    `SELECT id, status FROM fiscal_periods WHERE $1::DATE BETWEEN start_date AND end_date LIMIT 1`,
    [p.date]
  );
  if (!fp.rows[0]) throw new Error(`Aucune periode fiscale pour ${p.date}`);
  if (fp.rows[0].status !== 'open') throw new Error(`Periode ${p.date} non ouverte`);

  const year = parseInt(p.date.slice(0, 4), 10);
  const num = await client.query('SELECT next_entry_number($1, $2) AS num', [journalId, year]);

  const acc = await client.query(
    `SELECT id, code FROM accounts WHERE code = ANY($1::text[])`,
    [[p.expenseCode, p.depreciationCode]]
  );
  const byCode = new Map<string, string>();
  for (const r of acc.rows) byCode.set(r.code, r.id);

  const ins = await client.query(
    `INSERT INTO journal_entries (entry_number, journal_id, entry_date, fiscal_period_id, description,
       source_kind, source_id, source_detail, status, store_id, created_by)
     VALUES ($1,$2,$3,$4,$5,'manual',$6,$7,'draft',$8,$9) RETURNING id`,
    [num.rows[0].num, journalId, p.date, fp.rows[0].id, p.label, p.sourceId, `depr:${p.sourceDetail}`, p.storeId, p.userId]
  );
  const entryId = ins.rows[0].id;

  await client.query(
    `INSERT INTO journal_entry_lines (journal_entry_id, line_order, account_id, debit, credit, label)
     VALUES ($1, 1, $2, $3, 0, $4), ($1, 2, $5, 0, $3, $6)`,
    [entryId, byCode.get(p.expenseCode), p.amount, 'Dotation', byCode.get(p.depreciationCode), 'Amortissement cumule']
  );

  await client.query(
    `UPDATE journal_entries SET status = 'posted', posted_at = NOW(), posted_by = $2 WHERE id = $1`,
    [entryId, p.userId]
  );

  return { id: entryId, entry_number: num.rows[0].num };
}

/* ═══ Repository CRUD immobilisations ═══ */
export const fixedAssetRepository = {
  async findAll(opts: { storeId?: string } = {}) {
    const where = opts.storeId ? 'WHERE (fa.store_id IS NULL OR fa.store_id = $1)' : '';
    const result = await db.query(
      `SELECT fa.*,
              aa.code AS asset_account_code, aa.label AS asset_account_label,
              ad.code AS depreciation_account_code,
              ae.code AS expense_account_code,
              s.name AS supplier_name,
              COALESCE((SELECT SUM(amount) FROM depreciation_entries WHERE fixed_asset_id = fa.id), 0) AS total_depreciated
       FROM fixed_assets fa
       JOIN accounts aa ON aa.id = fa.asset_account_id
       JOIN accounts ad ON ad.id = fa.depreciation_account_id
       JOIN accounts ae ON ae.id = fa.expense_account_id
       LEFT JOIN suppliers s ON s.id = fa.supplier_id
       ${where}
       ORDER BY fa.acquisition_date DESC, fa.created_at DESC`,
      opts.storeId ? [opts.storeId] : []
    );
    return result.rows;
  },

  async findById(id: string) {
    const result = await db.query(
      `SELECT fa.*, aa.code AS asset_account_code, ad.code AS depreciation_account_code,
              ae.code AS expense_account_code
       FROM fixed_assets fa
       JOIN accounts aa ON aa.id = fa.asset_account_id
       JOIN accounts ad ON ad.id = fa.depreciation_account_id
       JOIN accounts ae ON ae.id = fa.expense_account_id
       WHERE fa.id = $1`,
      [id]
    );
    return result.rows[0] || null;
  },

  async getSchedule(id: string) {
    const asset = await this.findById(id);
    if (!asset) return null;
    const schedule = computeSchedule(asset);
    // Marque les lignes deja amorties (avec une ecriture)
    const done = await db.query(
      `SELECT fiscal_year, period_month FROM depreciation_entries WHERE fixed_asset_id = $1`,
      [id]
    );
    const doneSet = new Set(done.rows.map((r: { fiscal_year: number; period_month: number }) => `${r.fiscal_year}-${r.period_month}`));
    return {
      asset,
      schedule: schedule.map(l => ({ ...l, posted: doneSet.has(`${l.year}-${l.month}`) })),
    };
  },

  async create(data: {
    label: string; assetAccountId: string; depreciationAccountId: string; expenseAccountId: string;
    acquisitionDate: string; acquisitionCost: number; residualValue?: number; durationYears: number;
    method?: 'linear' | 'degressive'; supplierId?: string; storeId?: string; notes?: string; createdBy: string;
  }) {
    const result = await db.query(
      `INSERT INTO fixed_assets (label, asset_account_id, depreciation_account_id, expense_account_id,
         acquisition_date, acquisition_cost, residual_value, duration_years, method,
         supplier_id, store_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [data.label, data.assetAccountId, data.depreciationAccountId, data.expenseAccountId,
       data.acquisitionDate, data.acquisitionCost, data.residualValue || 0, data.durationYears,
       data.method || 'linear', data.supplierId || null, data.storeId || null, data.notes || null, data.createdBy]
    );
    return result.rows[0];
  },

  async delete(id: string) {
    // Reverse d'abord les ecritures de dotation generees pour cette immo,
    // puis supprime l'immo (depreciation_entries en cascade).
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const entries = await client.query(
        `SELECT journal_entry_id FROM depreciation_entries WHERE fixed_asset_id = $1 AND journal_entry_id IS NOT NULL`,
        [id]
      );
      for (const e of entries.rows) {
        // Suppression simple si periode ouverte (les dotations recentes le sont).
        await client.query(`DELETE FROM journal_entries WHERE id = $1`, [e.journal_entry_id]);
      }
      await client.query(`DELETE FROM fixed_assets WHERE id = $1`, [id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
