import { db } from '../config/database.js';
import { getParameter } from './module-parameters.service.js';
import { localIsoDate } from '../utils/local-date.js';

/**
 * Prévision de trésorerie sur 13 semaines (G4-03, mig 545).
 *
 * Point de départ : le solde au grand livre des comptes de trésorerie (banque et caisse,
 * comptes de treasury_accounts). Puis chaque flux attendu, daté :
 *   - ventes au comptoir : moyenne des ventes payées comptant des 8 dernières semaines,
 *     par jour de la semaine (estimation ; absente si aucune vente sur la période) ;
 *   - créances clients ouvertes, à leur échéance décalée du retard moyen du client
 *     (constaté sur ses factures payées des 12 derniers mois) et du scénario ;
 *   - effets clients en portefeuille (chèques, traites non encaissés), à leur échéance ;
 *   - factures fournisseurs ouvertes, à leur échéance — ou à la date de la campagne de
 *     paiement qui les contient (G4-01) ;
 *   - échéancier hors factures (dettes, charges fixes) ;
 *   - salaires : mensuels en fin de mois, hebdomadaires chaque samedi, par quinzaine le 15
 *     et en fin de mois (montant brut : la prévision reste prudente) ; dettes au personnel
 *     déjà comptabilisées (4432) à régler tout de suite ;
 *   - CNSS (solde 4441) le 10 du mois suivant ; TVA due (4455 − 3455, si positive) le 20 ;
 *   - acomptes d'IS non payés à la fin de leur trimestre ;
 *   - écritures récurrentes (G1-09) qui touchent un compte de trésorerie ;
 *   - lignes manuelles (emprunt, investissement…).
 * Une échéance déjà passée est placée au premier jour : c'est de l'argent dû maintenant.
 *
 * Rien n'est écrit. Analogie Oracle : le « Cash Forecasting » de Cash Management, avec ses
 * sources (AR, AP, payroll, GL).
 */
export type Category = 'ventes' | 'clients' | 'effets' | 'fournisseurs' | 'echeancier' | 'salaires' | 'social' | 'tva' | 'is' | 'recurrent' | 'manuel';
export type ForecastFlow = { date: string; amount: number; category: Category; label: string; ref?: string };
export const CATEGORY_LABELS: Record<Category, string> = {
  ventes: 'Ventes au comptoir (estimation)', clients: 'Créances clients', effets: 'Effets en portefeuille', fournisseurs: 'Factures fournisseurs', echeancier: 'Échéancier',
  salaires: 'Salaires', social: 'CNSS', tva: 'TVA', is: 'Impôt sur les sociétés', recurrent: 'Écritures récurrentes', manuel: 'Lignes manuelles',
};
export type ForecastOptions = {
  from?: string; weeks?: number;
  /** Scénario : retard supplémentaire des clients, en jours. */
  customerDelayDays?: number;
  /** Simulation G4-01 : ces factures fournisseurs payées à cette date. */
  planned?: { date: string; invoiceIds: string[] };
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const endOfMonth = (d: string) => { const t = new Date(`${d.slice(0, 7)}-01T12:00:00Z`); t.setUTCMonth(t.getUTCMonth() + 1); t.setUTCDate(0); return t.toISOString().slice(0, 10); };
const dayOfNextMonth = (d: string, day: number) => { const t = new Date(`${d.slice(0, 7)}-01T12:00:00Z`); t.setUTCMonth(t.getUTCMonth() + 1); t.setUTCDate(day); return t.toISOString().slice(0, 10); };
const clamp = (d: string, from: string) => (d < from ? from : d);

async function treasuryAccountIds(): Promise<string[]> {
  return (await db.query(
    `SELECT DISTINCT a.id FROM accounts a
       JOIN treasury_accounts t ON t.is_active AND (a.code = t.account_code OR a.code LIKE t.account_code || '%')`)).rows.map(r => r.id as string);
}

async function accountBalance(prefixes: string[], side: 'debit' | 'credit', until: string): Promise<number> {
  const r = await db.query(
    `SELECT COALESCE(SUM(${side === 'debit' ? 'l.debit - l.credit' : 'l.credit - l.debit'}), 0)::float8 AS b
       FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id JOIN accounts a ON a.id = l.account_id
      WHERE e.status = 'posted' AND e.entry_date <= $2::date AND a.code LIKE ANY($1)`, [prefixes.map(p => `${p}%`), until]);
  return r2(r.rows[0].b);
}

export async function cashForecast(opts: ForecastOptions = {}) {
  const from = opts.from ?? localIsoDate(new Date());
  const weeks = Math.min(Math.max(opts.weeks ?? 13, 1), 52);
  const to = addDays(from, weeks * 7 - 1);
  const delay = Math.max(0, Math.round(opts.customerDelayDays ?? 0));
  const flows: ForecastFlow[] = [];
  const push = (f: ForecastFlow) => { if (Math.abs(f.amount) >= 0.005) { const date = clamp(f.date, from); if (date <= to) flows.push({ ...f, date, amount: r2(f.amount) }); } };

  // Solde d'ouverture : grand livre des comptes de trésorerie à la veille.
  const accIds = await treasuryAccountIds();
  const opening = r2(Number((await db.query(
    `SELECT COALESCE(SUM(l.debit - l.credit), 0)::float8 AS b FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
      WHERE e.status = 'posted' AND e.entry_date < $2::date AND l.account_id = ANY($1)`, [accIds, from])).rows[0].b));

  // Ventes au comptoir : moyenne par jour de la semaine sur les 8 dernières semaines (ventes payées,
  // non annulées). Une vente à crédit devient une créance : elle est comptée avec les factures.
  const avgByDow = new Map((await db.query(
    `SELECT EXTRACT(DOW FROM d)::int AS dow, AVG(total)::float8 AS avg
       FROM (SELECT s.created_at::date AS d, SUM(s.total) AS total FROM sales s
              WHERE s.cancelled_at IS NULL AND COALESCE(s.payment_status, 'paid') = 'paid'
                AND s.created_at >= $1::date - 56 AND s.created_at < $1::date
              GROUP BY 1) x
      GROUP BY 1`, [from])).rows.map(r => [Number(r.dow), Number(r.avg)]));
  if (avgByDow.size) {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const v = avgByDow.get(new Date(`${d}T12:00:00Z`).getUTCDay()) ?? 0;
      if (v > 0) push({ date: d, amount: v, category: 'ventes', label: 'Ventes au comptoir (moyenne du même jour, 8 semaines)' });
    }
  }

  // Créances clients, à l'échéance + retard moyen du client + scénario.
  for (const r of (await db.query(
    `WITH delays AS (
       SELECT i.customer_id, GREATEST(0, AVG(p.payment_date - COALESCE(i.due_date, i.invoice_date + 30)))::int AS avg_delay
         FROM invoices i JOIN payments p ON p.invoice_id = i.id AND p.voids_payment_id IS NULL
        WHERE i.invoice_type = 'emitted' AND i.status = 'paid' AND p.payment_date >= CURRENT_DATE - 365
        GROUP BY i.customer_id)
     SELECT i.invoice_number, COALESCE(i.due_date, i.invoice_date + 30)::text AS due, COALESCE(d.avg_delay, 0) AS avg_delay,
            (i.total_amount - COALESCE(i.paid_amount, 0))::float8 AS remaining,
            COALESCE(NULLIF(c.company_name, ''), TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))) AS customer
       FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN delays d ON d.customer_id = i.customer_id
      WHERE i.invoice_type = 'emitted' AND i.status NOT IN ('paid', 'cancelled') AND i.total_amount - COALESCE(i.paid_amount, 0) > 0.005`)).rows) {
    push({ date: addDays(r.due, r.avg_delay + delay), amount: r.remaining, category: 'clients',
      label: `${r.customer || 'Client'} — ${r.invoice_number}${r.avg_delay ? ` (retard moyen ${r.avg_delay} j)` : ''}`, ref: r.invoice_number });
  }

  // Effets clients en portefeuille (reçus, ni encaissés, ni remis, ni impayés).
  for (const r of (await db.query(
    `SELECT p.amount::float8 AS amount, COALESCE(p.check_date, i.due_date, p.payment_date)::text AS due, p.check_number, p.payment_method
       FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id
      WHERE p.type = 'income' AND p.payment_method IN ('check', 'traite') AND p.voids_payment_id IS NULL
        AND p.status = 'executed' AND p.cashed_at IS NULL AND p.unpaid_at IS NULL AND p.remittance_id IS NULL`)).rows) {
    push({ date: addDays(r.due, delay), amount: r.amount, category: 'effets', label: `${r.payment_method === 'check' ? 'Chèque' : 'Traite'} ${r.check_number ?? ''}`.trim() });
  }

  // Factures fournisseurs ouvertes : échéance, ou date de la campagne de paiement (réelle ou simulée).
  const planned = new Set(opts.planned?.invoiceIds ?? []);
  for (const r of (await db.query(
    `SELECT i.id, i.invoice_number, COALESCE(i.supplier_invoice_number, i.invoice_number) AS ref,
            COALESCE(i.due_date, i.invoice_date + 30)::text AS due, (i.total_amount - COALESCE(i.paid_amount, 0))::float8 AS remaining,
            s.name AS supplier,
            (SELECT r.payment_date::text FROM payment_run_lines l JOIN payment_runs r ON r.id = l.run_id
              WHERE l.invoice_id = i.id AND l.status = 'pending' AND r.status IN ('approved', 'file_generated') LIMIT 1) AS run_date
       FROM invoices i LEFT JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.invoice_type = 'received' AND i.status NOT IN ('paid', 'cancelled') AND i.total_amount - COALESCE(i.paid_amount, 0) > 0.005`)).rows) {
    const date = planned.has(r.id) ? opts.planned!.date : (r.run_date ?? r.due);
    push({ date, amount: -r.remaining, category: 'fournisseurs', label: `${r.supplier ?? 'Fournisseur'} — ${r.ref}`, ref: r.invoice_number });
  }

  // Échéancier hors factures (dettes, charges fixes) : les factures y sont déjà comptées ci-dessus.
  for (const r of (await db.query(
    `SELECT label, due_date::text AS due, (amount_due - amount_paid)::float8 AS remaining
       FROM scheduled_payments WHERE invoice_id IS NULL AND status NOT IN ('paid', 'cancelled') AND amount_due - amount_paid > 0.005`)).rows) {
    push({ date: r.due, amount: -r.remaining, category: 'echeancier', label: r.label });
  }

  // Salaires (brut) selon la périodicité de paie ; dettes au personnel déjà comptabilisées.
  const pay = (await db.query(
    `SELECT pay_frequency, COALESCE(SUM(monthly_salary), 0)::float8 AS monthly, COALESCE(SUM(weekly_salary), 0)::float8 AS weekly
       FROM employees WHERE is_active GROUP BY pay_frequency`)).rows;
  const monthly = pay.filter(p => p.pay_frequency === 'monthly' || p.pay_frequency == null).reduce((t, p) => t + p.monthly, 0);
  const weekly = pay.filter(p => p.pay_frequency === 'weekly').reduce((t, p) => t + p.weekly, 0);
  const biweekly = pay.filter(p => p.pay_frequency === 'biweekly').reduce((t, p) => t + p.monthly, 0);
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (weekly > 0 && dow === 6) push({ date: d, amount: -weekly, category: 'salaires', label: 'Paie hebdomadaire' });
    if (d === endOfMonth(d)) {
      if (monthly > 0) push({ date: d, amount: -monthly, category: 'salaires', label: 'Paie mensuelle' });
      if (biweekly > 0) push({ date: d, amount: -biweekly / 2, category: 'salaires', label: 'Paie par quinzaine (2e)' });
    }
    if (biweekly > 0 && d.endsWith('-15')) push({ date: d, amount: -biweekly / 2, category: 'salaires', label: 'Paie par quinzaine (1re)' });
  }
  const staffDue = await accountBalance(['4432'], 'credit', from);
  if (staffDue > 0) push({ date: from, amount: -staffDue, category: 'salaires', label: 'Rémunérations dues au personnel (compte 4432)' });

  // CNSS le 10 du mois suivant ; TVA due le 20 du mois suivant.
  const cnss = await accountBalance(['4441'], 'credit', from);
  if (cnss > 0) push({ date: dayOfNextMonth(from, 10), amount: -cnss, category: 'social', label: 'Cotisations CNSS (compte 4441)' });
  const vat = r2((await accountBalance(['4455'], 'credit', from)) - (await accountBalance(['3455'], 'debit', from)));
  if (vat > 0) push({ date: dayOfNextMonth(from, 20), amount: -vat, category: 'tva', label: 'TVA due (4455 − 3455)' });

  // Acomptes d'IS non payés, à la fin de leur trimestre.
  for (const r of (await db.query(
    `SELECT year, quarter, amount::float8 AS amount FROM corporate_tax_installments WHERE paid_on IS NULL AND amount > 0`)).rows) {
    const q = Number(r.quarter) || 1;
    push({ date: endOfMonth(`${r.year}-${String(q * 3).padStart(2, '0')}-01`), amount: -r.amount, category: 'is', label: `Acompte d'IS T${q} ${r.year}` });
  }

  // Écritures récurrentes qui touchent la trésorerie.
  if (accIds.length) {
    const tpls = (await db.query(
      `SELECT t.name, t.recurrence, t.next_run_on::text AS next, t.end_on::text AS end_on,
              SUM(CASE WHEN l.side = 'debit' THEN l.amount ELSE -l.amount END)::float8 AS effect
         FROM journal_entry_templates t JOIN journal_entry_template_lines l ON l.template_id = t.id
        WHERE t.is_active AND t.recurrence IS NOT NULL AND t.next_run_on IS NOT NULL AND l.account_id = ANY($1)
        GROUP BY t.id`, [accIds])).rows;
    for (const t of tpls) {
      const step = t.recurrence === 'monthly' ? 1 : t.recurrence === 'quarterly' ? 3 : 12;
      for (let k = 0, d = t.next as string; d <= to && (!t.end_on || d <= t.end_on) && k < 60; k++) {
        push({ date: d, amount: t.effect, category: 'recurrent', label: t.name });
        const n = new Date(`${t.next}T12:00:00Z`); n.setUTCMonth(n.getUTCMonth() + step * (k + 1)); d = n.toISOString().slice(0, 10);
      }
    }
  }

  // Lignes manuelles.
  for (const r of (await db.query(
    `SELECT id, flow_date::text AS d, label, amount::float8 AS amount FROM cash_forecast_lines WHERE flow_date BETWEEN $1::date AND $2::date`, [from, to])).rows) {
    push({ date: r.d, amount: r.amount, category: 'manuel', label: r.label, ref: r.id });
  }

  // Solde jour par jour et synthèse par semaine.
  flows.sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
  const threshold = Number((await getParameter<{ threshold?: number }>('accounting.cash_forecast'))?.threshold ?? 0);
  const days: { date: string; inflow: number; outflow: number; balance: number }[] = [];
  let balance = opening;
  let i = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    let inflow = 0, outflow = 0;
    while (i < flows.length && flows[i].date === d) { if (flows[i].amount > 0) inflow += flows[i].amount; else outflow += flows[i].amount; i++; }
    balance = r2(balance + inflow + outflow);
    days.push({ date: d, inflow: r2(inflow), outflow: r2(outflow), balance });
  }
  const weeksOut = Array.from({ length: weeks }, (_, w) => {
    const slice = days.slice(w * 7, w * 7 + 7);
    const start = slice[0].date, end = slice[slice.length - 1].date;
    const byCategory: Record<string, number> = {};
    for (const f of flows) if (f.date >= start && f.date <= end) byCategory[f.category] = r2((byCategory[f.category] ?? 0) + f.amount);
    return { start, end, inflow: r2(slice.reduce((t, x) => t + x.inflow, 0)), outflow: r2(slice.reduce((t, x) => t + x.outflow, 0)), closing: slice[slice.length - 1].balance, byCategory };
  });
  const min = days.reduce((m, x) => (x.balance < m.balance ? x : m), days[0]);
  const firstBelow = days.find(x => x.balance < threshold) ?? null;
  return {
    from, to, opening, threshold, customerDelayDays: delay, days, weeks: weeksOut, flows,
    minimum: { date: min.date, balance: min.balance }, firstBelowThreshold: firstBelow ? { date: firstBelow.date, balance: firstBelow.balance } : null,
    categories: CATEGORY_LABELS,
  };
}

/** Lignes manuelles de prévision et seuil d'alerte. */
export const cashForecastLines = {
  async list() {
    return (await db.query(
      `SELECT id, flow_date::text AS flow_date, label, amount::float8 AS amount, category, notes FROM cash_forecast_lines ORDER BY flow_date`)).rows;
  },
  async create(data: { flowDate: string; label: string; amount: number; category?: string; notes?: string | null }, userId: string) {
    return (await db.query(
      `INSERT INTO cash_forecast_lines (flow_date, label, amount, category, notes, created_by) VALUES ($1, $2, $3::numeric, $4, $5, $6)
       RETURNING id, flow_date::text AS flow_date, label, amount::float8 AS amount, category, notes`,
      [data.flowDate, data.label.trim(), data.amount, data.category ?? 'autre', data.notes ?? null, userId])).rows[0];
  },
  async remove(id: string) {
    await db.query(`DELETE FROM cash_forecast_lines WHERE id = $1`, [id]);
  },
  async setThreshold(threshold: number, userId: string) {
    await db.query(
      `UPDATE module_parameters SET value = jsonb_build_object('threshold', $1::numeric), updated_by = $2, updated_at = now() WHERE key = 'accounting.cash_forecast'`,
      [threshold, userId]);
  },
};
