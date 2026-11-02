/**
 * Liasse fiscale (lot Bonus 14) : soldes des comptes de l'exercice N et N−1
 * lus dans un même instantané, mis en forme par liasse.rules (bilan actif et
 * passif, CPC, ESG) avec le passage au résultat fiscal de l'IS (mig 430).
 *
 *   - Bilan au 31/12 : comptes de classes 1 à 5 depuis les derniers
 *     à-nouveaux, résultat de l'exercice (classes 6-7) et résultat
 *     d'exercices antérieurs non clôturés (en instance d'affectation).
 *   - CPC et ESG : classes 6-7 de l'exercice, hors à-nouveaux.
 * Rien n'est écrit : la liasse est définitive dès que l'exercice est clôturé
 * (écritures scellées, mig 413/416).
 */
import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import { loadCompanyLegal } from '../utils/company-legal.js';
import { corporateTaxRepository } from './corporate-tax.repository.js';
import {
  ACTIF, PASSIF, computeBilan, computeCpc, computeEsg, simplifyBilan, controls,
  type AccountBalance, type LiasseModel,
} from '../services/liasse.rules.js';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

async function balancesOf(c: PoolClient, year: number) {
  const end = `${year}-12-31`;
  const w = (await c.query(
    `SELECT fn_ledger_window_start($1::date, 1)::text AS bilan, fn_ledger_window_start($1::date, 6)::text AS gestion`, [end])).rows[0];
  const start = w.gestion === '-infinity' || w.gestion < `${year}-01-01` ? `${year}-01-01` : w.gestion;
  const bil = (await c.query(
    `SELECT a.code, a.label, sum(jel.debit - jel.credit)::float8 AS balance
       FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id JOIN accounts a ON a.id = jel.account_id
      WHERE je.status IN ('posted', 'reversed') AND je.entry_date <= $1::date AND je.entry_date >= $2::date AND a.account_class BETWEEN 1 AND 5
      GROUP BY a.code, a.label HAVING sum(jel.debit - jel.credit) <> 0 ORDER BY a.code`, [end, w.bilan])).rows as AccountBalance[];
  const ges = (await c.query(
    `SELECT a.code, a.label, sum(jel.debit - jel.credit)::float8 AS balance
       FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id JOIN accounts a ON a.id = jel.account_id
      WHERE je.status IN ('posted', 'reversed') AND je.source_kind <> 'opening' AND je.entry_date BETWEEN $1::date AND $2::date
        AND a.account_class IN (6, 7)
      GROUP BY a.code, a.label HAVING sum(jel.debit - jel.credit) <> 0 ORDER BY a.code`, [start, end])).rows as AccountBalance[];
  // Résultat d'exercices antérieurs pas encore clôturés (entre les derniers AN et le début de l'exercice).
  const prior = Number((await c.query(
    `SELECT COALESCE(sum(jel.credit - jel.debit), 0)::float8 AS s
       FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id JOIN accounts a ON a.id = jel.account_id
      WHERE je.status IN ('posted', 'reversed') AND a.account_class IN (6, 7)
        AND je.entry_date >= $1::date AND je.entry_date < $2::date`, [w.bilan, start])).rows[0].s);
  const fy = (await c.query(`SELECT status, closed_at FROM fiscal_years WHERE year = $1`, [year])).rows[0] ?? null;
  const entries = Number((await c.query(
    `SELECT count(*)::int AS n FROM journal_entries WHERE status IN ('posted', 'reversed') AND entry_date BETWEEN $1::date AND $2::date`,
    [`${year}-01-01`, end])).rows[0].n);
  return { bil, ges, prior: r2(prior), fy, entries };
}

function statementsOf(b: Awaited<ReturnType<typeof balancesOf>>, model: LiasseModel) {
  const cpc = computeCpc(b.ges);
  const bilan = computeBilan(b.bil, cpc.result, b.prior);
  const esg = computeEsg(b.ges);
  const ctrl = controls({
    totalActif: bilan.total_actif, totalPassif: bilan.total_passif,
    bilanResult: bilan.passif.find(l => l.id === 'K8')!.amount, cpcResult: cpc.result, esgResult: esg.net,
    unmapped: [...bilan.unmapped, ...cpc.unmapped], anomalies: bilan.anomalies,
  });
  return {
    actif: model === 'simplifie' ? simplifyBilan(bilan.actif, ACTIF) : bilan.actif,
    passif: model === 'simplifie' ? simplifyBilan(bilan.passif, PASSIF) : bilan.passif,
    cpc: cpc.lines, tfr: esg.tfr, caf: esg.caf,
    total_actif: bilan.total_actif, total_passif: bilan.total_passif, result: cpc.result, revenue: cpc.revenue,
    controls: ctrl, fiscal_year: b.fy, entries: b.entries,
  };
}

export type Liasse = Awaited<ReturnType<typeof liasseRepository.build>>;

export const liasseRepository = {
  /** Liasse de l'exercice `year` avec la colonne de l'exercice précédent. */
  async build(year: number, model: LiasseModel = 'normal') {
    const client = await db.getClient();
    let cur, prev;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      cur = await balancesOf(client, year);
      prev = await balancesOf(client, year - 1);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    const n = statementsOf(cur, model), n1 = statementsOf(prev, model);
    const [legal, tax] = await Promise.all([loadCompanyLegal(), corporateTaxRepository.summary(year)]);

    // Passage du résultat net comptable au résultat net fiscal (IS, mig 430) :
    // l'IS comptabilisé (6701) est réintégré, puis les retraitements saisis.
    const isBooked = r2(n.cpc.find(l => l.id === 'XII')!.amount);
    const passage = {
      net_result: n.result,
      reintegrations: [
        ...(isBooked ? [{ label: 'Impôt sur les sociétés comptabilisé (6701)', amount: isBooked }] : []),
        ...tax.adjustments.filter(a => a.kind === 'reintegration').map(a => ({ label: a.label, amount: a.amount })),
      ],
      deductions: tax.adjustments.filter(a => a.kind === 'deduction').map(a => ({ label: a.label, amount: a.amount })),
      taxable_result: 0,
      tax_due: tax.tax_due, cm_amount: tax.cm_amount, is_amount: tax.is_amount, rate: tax.rate, tax_status: tax.status,
    };
    passage.taxable_result = r2(passage.net_result + passage.reintegrations.reduce((s, x) => s + x.amount, 0) - passage.deductions.reduce((s, x) => s + x.amount, 0));
    const ctrl = [...n.controls];
    if (Math.abs(passage.taxable_result - tax.taxable_result) >= 0.01)
      ctrl.push({ level: 'warning', message: `Résultat fiscal de la liasse (${passage.taxable_result.toFixed(2)}) différent de celui de l'écran IS (${tax.taxable_result.toFixed(2)}) : vérifiez la charge d'IS comptabilisée` });
    if (n.fiscal_year?.status !== 'closed')
      ctrl.push({ level: 'warning', message: `Exercice ${year} non clôturé : la liasse reste provisoire tant que des écritures peuvent être passées` });
    const missing = (['if', 'ice', 'rc'] as const).filter(k => !legal[k]);
    if (missing.length)
      ctrl.push({ level: 'error', message: `Identité fiscale incomplète (${missing.map(k => k.toUpperCase()).join(', ')}) : renseignez-la dans Paramètres › Entreprise` });

    // Chaque ligne porte le montant N et celui de N−1.
    const withPrev = <T extends { id: string; amount: number }>(a: T[], b: T[]) =>
      a.map(l => ({ ...l, previous: b.find(y => y.id === l.id)?.amount ?? 0 }));
    return {
      year, model, closing_date: `${year}-12-31`,
      company: legal,
      suggested_model: n.revenue > 0 && n.revenue <= 10_000_000 ? 'simplifie' : 'normal',
      actif: n.actif.map(l => ({ ...l, previous_net: n1.actif.find(y => y.id === l.id)?.net ?? 0 })),
      passif: withPrev(n.passif, n1.passif),
      cpc: withPrev(n.cpc, n1.cpc),
      tfr: withPrev(n.tfr, n1.tfr),
      caf: withPrev(n.caf, n1.caf),
      totals: { actif: n.total_actif, passif: n.total_passif, result: n.result, revenue: n.revenue, previous_result: n1.result },
      passage,
      controls: ctrl,
      status: n.fiscal_year?.status === 'closed' ? 'final' as const : 'provisional' as const,
      has_previous: prev.entries > 0,
    };
  },
};
