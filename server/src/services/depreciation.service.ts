import { extourneEntryById } from './journal-generator.service.js';
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
      // Mig 427 : une immobilisation sortie garde sa trace ; on annule d'abord la sortie.
      const st = (await client.query(`SELECT status FROM fixed_assets WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (st?.status === 'disposed') throw fail('Immobilisation sortie : annulez d\'abord la cession', 409);
      const entries = await client.query(
        `SELECT journal_entry_id FROM depreciation_entries WHERE fixed_asset_id = $1 AND journal_entry_id IS NOT NULL`,
        [id]
      );
      for (const e of entries.rows) {
        // Mig 311 (G-D8-02) : une dotation comptabilisée ne se supprime plus, elle s'extourne.
        await extourneEntryById(client, e.journal_entry_id);
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

/* ═══ Cession et mise au rebut (mig 427) ═══════════════════════════════ */

const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const ym = (y: number, m: number) => y * 100 + m;
/** TVA facturée par taux (comptes 4455x du plan). */
const VAT_ACCOUNT: Record<number, string> = { 20: '44551', 14: '44552', 10: '44553', 7: '44554' };
const COUNTERPART: Record<'receivable' | 'bank' | 'cash', string> = { receivable: '3481', bank: '5141', cash: '5161' };

export type DisposalInput = {
  date: string; kind: 'sale' | 'scrap';
  price?: number; vatRate?: number; counterpart?: 'receivable' | 'bank' | 'cash';
  buyer?: string | null; reason?: string | null;
};

type OdLine = { code: string; debit: number; credit: number; label: string };

/** Écriture d'OD validée (numéro pris à la validation), rattachée à l'immobilisation. */
async function postOd(client: PoolClient, p: {
  date: string; label: string; lines: OdLine[]; sourceId: string; sourceDetail: string; storeId: string | null; userId: string;
}): Promise<{ id: string; entry_number: string }> {
  const jrn = (await client.query(`SELECT id FROM journals WHERE code = 'OD'`)).rows[0].id;
  const periodId = (await client.query(`SELECT fn_ensure_fiscal_period($1::date) AS id`, [p.date])).rows[0].id;
  const num = (await client.query('SELECT next_entry_number($1, $2::smallint) AS n', [jrn, Number(p.date.slice(0, 4))])).rows[0].n;
  const codes = [...new Set(p.lines.map(l => l.code))];
  const ids = new Map<string, string>((await client.query(`SELECT id, code FROM accounts WHERE code = ANY($1::text[])`, [codes])).rows
    .map((r: { id: string; code: string }) => [r.code, r.id]));
  const missing = codes.filter(c => !ids.has(c));
  if (missing.length) throw fail(`Compte(s) absent(s) du plan comptable : ${missing.join(', ')}`);
  const id = (await client.query(
    `INSERT INTO journal_entries (entry_number, journal_id, entry_date, fiscal_period_id, description,
       source_kind, source_id, source_detail, status, store_id, created_by)
     VALUES ($1, $2, $3, $4, $5, 'manual', $6, $7, 'draft', $8, $9) RETURNING id`,
    [num, jrn, p.date, periodId, p.label, p.sourceId, p.sourceDetail, p.storeId, p.userId])).rows[0].id as string;
  let order = 0;
  for (const l of p.lines.filter(x => x.debit > 0 || x.credit > 0)) {
    await client.query(
      `INSERT INTO journal_entry_lines (journal_entry_id, line_order, account_id, debit, credit, label) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, ++order, ids.get(l.code), round2(l.debit), round2(l.credit), l.label]);
  }
  await client.query(`UPDATE journal_entries SET status = 'posted', posted_at = NOW(), posted_by = $2 WHERE id = $1`, [id, p.userId]);
  return { id, entry_number: num };
}

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

/** Ce que donnerait la sortie à cette date : dotation complémentaire, cumul, VNC, plus-value. */
async function disposalFigures(client: PoolClient | typeof db, asset: FixedAssetRow & { status: string }, date: string, priceHt: number) {
  if (date < toIso(asset.acquisition_date)) throw fail('La sortie ne peut précéder l\'acquisition');
  const posted = (await client.query(
    `SELECT fiscal_year, period_month, amount FROM depreciation_entries WHERE fixed_asset_id = $1`, [asset.id])).rows as
    { fiscal_year: number; period_month: number; amount: string }[];
  const target = ym(Number(date.slice(0, 4)), Number(date.slice(5, 7)));
  const lastPosted = posted.reduce((m, r) => Math.max(m, ym(r.fiscal_year, r.period_month)), 0);
  if (lastPosted > target) {
    throw fail(`Des dotations sont déjà passées après cette date (dernière : ${String(lastPosted % 100).padStart(2, '0')}/${Math.floor(lastPosted / 100)}) : datez la sortie au plus tôt ce mois-là`, 409);
  }
  const done = new Set(posted.map(r => ym(r.fiscal_year, r.period_month)));
  // Dotation complémentaire : mois du plan non encore passés, jusqu'au mois de sortie inclus.
  const missing = computeSchedule(asset).filter(l => ym(l.year, l.month) <= target && !done.has(ym(l.year, l.month)) && l.amount > 0);
  const complementary = round2(missing.reduce((s, l) => s + l.amount, 0));
  const cost = Number(asset.acquisition_cost);
  const cumulated = round2(posted.reduce((s, r) => s + Number(r.amount), 0) + complementary);
  const vnc = round2(cost - cumulated);
  return { missing, complementary, cumulated, vnc, cost, gain: round2(priceHt - vnc) };
}

async function lockAsset(client: PoolClient, id: string) {
  const a = (await client.query(
    `SELECT fa.*, aa.code AS asset_account_code, ad.code AS depreciation_account_code, ae.code AS expense_account_code
       FROM fixed_assets fa
       JOIN accounts aa ON aa.id = fa.asset_account_id
       JOIN accounts ad ON ad.id = fa.depreciation_account_id
       JOIN accounts ae ON ae.id = fa.expense_account_id
      WHERE fa.id = $1 FOR UPDATE OF fa`, [id])).rows[0];
  if (!a) throw fail('Immobilisation introuvable', 404);
  return a as FixedAssetRow & Record<string, unknown> & { status: string; store_id: string | null };
}

export const fixedAssetDisposal = {
  /** Aperçu de la sortie (rien n'est écrit). */
  async preview(id: string, input: DisposalInput) {
    const client = await db.getClient();
    try {
      const a = await lockAsset(client, id);
      const price = input.kind === 'scrap' ? 0 : round2(input.price ?? 0);
      const f = await disposalFigures(client, a, input.date, price);
      return { cost: f.cost, complementary: f.complementary, months: f.missing.length, cumulated: f.cumulated, vnc: f.vnc, price, gain: f.gain };
    } finally {
      client.release();
    }
  },

  /**
   * Sortie de l'immobilisation : dotation complémentaire jusqu'au mois de sortie,
   * puis écriture de cession (sortie de l'actif, VNC en 651x, prix en 751x) et
   * statut « sortie ». Tout ou rien.
   */
  dispose(id: string, input: DisposalInput, userId: string) {
    return withTx(userId, async c => {
      const a = await lockAsset(c, id);
      if (a.status === 'disposed') throw fail('Immobilisation déjà sortie', 409);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw fail('Date de sortie invalide');
      const period = (await c.query(`SELECT status FROM fiscal_periods WHERE id = fn_ensure_fiscal_period($1::date)`, [input.date])).rows[0];
      if (period.status !== 'open') throw fail('Période de la date de sortie fermée : choisissez une date dans une période ouverte', 409);
      const sale = input.kind === 'sale';
      const price = sale ? round2(input.price ?? 0) : 0;
      if (sale && price <= 0) throw fail('Prix de cession obligatoire pour une vente (mise au rebut sinon)');
      const rate = sale ? Number(input.vatRate ?? 0) : 0;
      if (rate && !VAT_ACCOUNT[rate]) throw fail('Taux de TVA non géré');
      const vat = round2(price * rate / 100);
      const counterpart = sale ? (input.counterpart ?? 'receivable') : null;
      const f = await disposalFigures(c, a, input.date, price);
      const intangible = a.asset_account_code.startsWith('22');
      const label = `${sale ? 'Cession' : 'Mise au rebut'} ${a.label}`;

      // 1. Dotation complémentaire (une écriture, rattachée aux mois rattrapés).
      if (f.complementary > 0) {
        const dot = await postOd(c, {
          date: input.date, label: `Dotation complémentaire avant sortie ${a.label}`,
          lines: [
            { code: a.expense_account_code, debit: f.complementary, credit: 0, label: 'Dotation complémentaire' },
            { code: a.depreciation_account_code, debit: 0, credit: f.complementary, label: 'Amortissement cumulé' },
          ],
          sourceId: id, sourceDetail: `depr:cession`, storeId: a.store_id, userId,
        });
        for (const l of f.missing) {
          await c.query(
            `INSERT INTO depreciation_entries (fixed_asset_id, fiscal_year, period_month, amount, journal_entry_id, disposal)
             VALUES ($1, $2, $3, $4, $5, true)`, [id, l.year, l.month, l.amount, dot.id]);
        }
      }

      // 2. Sortie de l'actif et constatation du prix.
      const lines: OdLine[] = [
        { code: a.depreciation_account_code, debit: f.cumulated, credit: 0, label: 'Annulation des amortissements cumulés' },
        { code: intangible ? '6512' : '6513', debit: f.vnc, credit: 0, label: 'Valeur nette d\'amortissements' },
        { code: a.asset_account_code, debit: 0, credit: f.cost, label: 'Sortie de la valeur brute' },
      ];
      if (sale) {
        lines.push(
          { code: COUNTERPART[counterpart!], debit: round2(price + vat), credit: 0, label: input.buyer ? `Prix de cession — ${input.buyer}` : 'Prix de cession' },
          { code: intangible ? '7512' : '7513', debit: 0, credit: price, label: 'Produit de cession' },
        );
        if (vat) lines.push({ code: VAT_ACCOUNT[rate], debit: 0, credit: vat, label: `TVA facturée ${rate} %` });
      }
      const entry = await postOd(c, { date: input.date, label, lines, sourceId: id, sourceDetail: 'cession', storeId: a.store_id, userId });

      await c.query(
        `UPDATE fixed_assets SET status = 'disposed', disposal_date = $2, disposal_kind = $3, disposal_price = $4, disposal_vat = $5,
                disposal_counterpart = $6, disposal_buyer = $7, disposal_reason = $8, disposal_cumulated = $9, disposal_vnc = $10,
                disposal_gain = $11, disposal_entry_id = $12, disposed_by = $13, disposed_at = now()
          WHERE id = $1`,
        [id, input.date, input.kind, price, vat, counterpart, input.buyer?.trim() || null, input.reason?.trim() || null,
         f.cumulated, f.vnc, f.gain, entry.id, userId]);
      return { entry_number: entry.entry_number, complementary: f.complementary, cumulated: f.cumulated, vnc: f.vnc, price, vat, gain: f.gain };
    });
  },

  /** Annule une sortie : extourne de l'écriture de cession et de la dotation complémentaire. */
  cancel(id: string, reason: string, userId: string) {
    return withTx(userId, async c => {
      const a = await lockAsset(c, id);
      if (a.status !== 'disposed') throw fail('Cette immobilisation n\'est pas sortie', 409);
      await extourneEntryById(c, String(a.disposal_entry_id), undefined, { userId, reason: `Annulation de la sortie — ${reason}` });
      const dots = (await c.query(
        `SELECT DISTINCT journal_entry_id FROM depreciation_entries WHERE fixed_asset_id = $1 AND disposal AND journal_entry_id IS NOT NULL`, [id])).rows;
      for (const d of dots) await extourneEntryById(c, d.journal_entry_id, undefined, { userId, reason: `Annulation de la sortie — ${reason}` });
      await c.query(`DELETE FROM depreciation_entries WHERE fixed_asset_id = $1 AND disposal`, [id]);
      const cum = Number((await c.query(`SELECT COALESCE(sum(amount), 0) AS s FROM depreciation_entries WHERE fixed_asset_id = $1`, [id])).rows[0].s);
      const done = cum >= Number(a.acquisition_cost) - Number(a.residual_value) - 0.01;
      await c.query(
        `UPDATE fixed_assets SET status = $2, disposal_date = NULL, disposal_kind = NULL, disposal_price = NULL, disposal_vat = 0,
                disposal_counterpart = NULL, disposal_buyer = NULL, disposal_reason = NULL, disposal_cumulated = NULL,
                disposal_vnc = NULL, disposal_gain = NULL, disposal_entry_id = NULL, disposed_by = NULL, disposed_at = NULL
          WHERE id = $1`, [id, done ? 'fully_depreciated' : 'active']);
      return { id, status: done ? 'fully_depreciated' : 'active' };
    });
  },

  /**
   * Tableau des immobilisations d'un exercice (modèle liasse : brut et
   * amortissements, début, augmentations, diminutions, fin) et cessions de
   * l'exercice. Tiré du registre et des dotations effectivement passées.
   */
  async table(year: number, storeId?: string | null) {
    const start = `${year}-01-01`, end = `${year}-12-31`;
    const rows = (await db.query(
      `SELECT fa.id, fa.label, fa.acquisition_date::text AS acquisition_date, fa.acquisition_cost, fa.status,
              fa.disposal_date::text AS disposal_date, fa.disposal_kind, fa.disposal_price, fa.disposal_cumulated,
              fa.disposal_vnc, fa.disposal_gain, aa.code AS account_code, aa.label AS account_label,
              COALESCE(sum(de.amount) FILTER (WHERE de.fiscal_year < $1), 0) AS dep_start,
              COALESCE(sum(de.amount) FILTER (WHERE de.fiscal_year = $1), 0) AS dep_year
         FROM fixed_assets fa
         JOIN accounts aa ON aa.id = fa.asset_account_id
         LEFT JOIN depreciation_entries de ON de.fixed_asset_id = fa.id
        WHERE fa.acquisition_date <= $3::date AND (fa.disposal_date IS NULL OR fa.disposal_date >= $2::date)
          AND ($4::uuid IS NULL OR fa.store_id IS NULL OR fa.store_id = $4::uuid)
        GROUP BY fa.id, aa.code, aa.label
        ORDER BY aa.code, fa.acquisition_date, fa.label`, [year, start, end, storeId || null])).rows;
    const items = rows.map((r: Record<string, unknown>) => {
      const cost = Number(r.acquisition_cost);
      const acquiredBefore = String(r.acquisition_date) < start;
      const disposedIn = !!r.disposal_date && String(r.disposal_date) <= end;
      const grossStart = acquiredBefore ? cost : 0;
      const acquisitions = acquiredBefore ? 0 : cost;
      const disposals = disposedIn ? cost : 0;
      const depStart = round2(Number(r.dep_start)), depYear = round2(Number(r.dep_year));
      const depOut = disposedIn ? round2(Number(r.disposal_cumulated)) : 0;
      const grossEnd = round2(grossStart + acquisitions - disposals);
      const depEnd = round2(depStart + depYear - depOut);
      return {
        id: r.id as string, label: r.label as string, account_code: r.account_code as string, account_label: r.account_label as string,
        acquisition_date: r.acquisition_date as string, status: r.status as string,
        gross_start: grossStart, acquisitions, disposals, gross_end: grossEnd,
        dep_start: depStart, dep_year: depYear, dep_out: depOut, dep_end: depEnd, vnc_end: round2(grossEnd - depEnd),
        disposal: disposedIn ? {
          date: r.disposal_date as string, kind: r.disposal_kind as string, price: Number(r.disposal_price ?? 0),
          cumulated: Number(r.disposal_cumulated), vnc: Number(r.disposal_vnc), gain: Number(r.disposal_gain),
        } : null,
      };
    });
    const keys = ['gross_start', 'acquisitions', 'disposals', 'gross_end', 'dep_start', 'dep_year', 'dep_out', 'dep_end', 'vnc_end'] as const;
    const sum = (list: typeof items) => Object.fromEntries(keys.map(k => [k, round2(list.reduce((s, i) => s + i[k], 0))])) as Record<typeof keys[number], number>;
    const groups = [...new Set(items.map(i => i.account_code))].map(code => {
      const list = items.filter(i => i.account_code === code);
      return { account_code: code, account_label: list[0].account_label, items: list, totals: sum(list) };
    });
    const disposals = items.filter(i => i.disposal).map(i => ({ id: i.id, label: i.label, account_code: i.account_code, cost: i.disposals, ...i.disposal! }));
    return { year, groups, totals: sum(items), disposals, gain_total: round2(disposals.reduce((s, d) => s + d.gain, 0)) };
  },
};
