/**
 * Paramétrage de la comptabilité analytique du coût de revient (mig 655) :
 * centres (capacités, inducteurs, cessions), charges, personnel par centre, clés de
 * répartition, et recalcul des plans d'un mois. Le calcul lui-même est dans
 * services/cost-engine.ts.
 */
import { db, withTransaction } from '../config/database.js';
import { invalidateCostModel, periodModel, DRIVERS, LEVELS, NATURE_SUGGESTIONS } from '../services/cost-engine.js';
import { productionCoutRepository } from './production-cout.repository.js';
import { logger } from '../utils/logger.js';

export class AnalyticError extends Error {}

const DRIVER_KEYS = Object.keys(DRIVERS);

export const analyticCostRepository = {
  meta() {
    return {
      drivers: Object.entries(DRIVERS).map(([value, d]) => ({ value, ...d })),
      levels: Object.entries(LEVELS).map(([value, label]) => ({ value, label })),
      natures: Object.entries(NATURE_SUGGESTIONS).map(([value, s]) => ({ value, ...s })),
    };
  },

  async method() {
    const r = (await db.query(`SELECT production_charges_method AS m FROM company_settings WHERE id = 1`)).rows[0];
    return (r?.m ?? 'rate') as 'rate' | 'monthly' | 'analytic';
  },

  async setMethod(method: 'rate' | 'analytic') {
    await db.query(`UPDATE company_settings SET production_charges_method = $1 WHERE id = 1`, [method]);
    invalidateCostModel();
    return { method };
  },

  // ─── Centres ───
  async centres(storeId: string | null) {
    const centres = (await db.query(
      `SELECT c.id, c.code, c.name, c.is_active, c.kind, c.level, c.driver, c.parent_id, c.transfer_basis, c.sort_order,
              c.description, c.normal_capacity::float8 AS normal_capacity, c.max_capacity::float8 AS max_capacity, c.store_id
         FROM cost_centers c
        WHERE ($1::uuid IS NULL OR c.store_id IS NULL OR c.store_id = $1)
        ORDER BY c.is_active DESC, c.sort_order, c.code`, [storeId])).rows;
    const transfers = (await db.query(
      `SELECT from_center_id, to_center_id, percent::float8 AS percent FROM cost_center_transfers`)).rows;
    return centres.map(c => ({ ...c, transfers: transfers.filter(t => t.from_center_id === c.id).map(t => ({ toId: t.to_center_id, percent: t.percent })) }));
  },

  async createCentre(input: { code: string; name: string; kind: string; level: string; driver: string; parentId?: string | null;
    storeId?: string | null; userId: string | null }) {
    const code = input.code.trim().toUpperCase().slice(0, 20);
    if (!code) throw new AnalyticError('Code requis');
    if ((await db.query(`SELECT 1 FROM cost_centers WHERE code = $1`, [code])).rows.length) throw new AnalyticError('Ce code existe déjà');
    const r = await db.query(
      `INSERT INTO cost_centers (code, name, axis_id, kind, level, driver, parent_id, store_id, created_by, sort_order)
       VALUES ($1, $2, (SELECT id FROM analytic_axes WHERE code = 'ACT'), $3, $4, $5, $6, $7, $8,
               (SELECT COALESCE(MAX(sort_order), 0) + 5 FROM cost_centers)) RETURNING id`,
      [code, input.name.trim().slice(0, 120), input.kind, input.level, input.driver, input.parentId ?? null, input.storeId ?? null, input.userId]);
    invalidateCostModel();
    return { id: r.rows[0].id as string };
  },

  async updateCentre(id: string, input: { name?: string; kind?: string; level?: string; driver?: string; parentId?: string | null;
    normalCapacity?: number | null; maxCapacity?: number | null; transferBasis?: string; isActive?: boolean; description?: string | null;
    transfers?: { toId: string; percent: number }[] }) {
    return withTransaction(async () => {
      const cur = (await db.query(`SELECT id, kind FROM cost_centers WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!cur) throw new AnalyticError('Centre introuvable');
      if (input.parentId && input.parentId === id) throw new AnalyticError('Un centre ne peut pas être son propre parent');
      const sets: string[] = []; const params: unknown[] = [];
      const set = (col: string, v: unknown) => { params.push(v); sets.push(`${col} = $${params.length}`); };
      if (input.name !== undefined) set('name', input.name.trim().slice(0, 120));
      if (input.kind !== undefined) set('kind', input.kind);
      if (input.level !== undefined) set('level', input.level);
      if (input.driver !== undefined) set('driver', input.driver);
      if (input.parentId !== undefined) set('parent_id', input.parentId);
      if (input.normalCapacity !== undefined) set('normal_capacity', input.normalCapacity);
      if (input.maxCapacity !== undefined) set('max_capacity', input.maxCapacity);
      if (input.transferBasis !== undefined) set('transfer_basis', input.transferBasis);
      if (input.isActive !== undefined) set('is_active', input.isActive);
      if (input.description !== undefined) set('description', input.description);
      if (sets.length) { params.push(id); await db.query(`UPDATE cost_centers SET ${sets.join(', ')} WHERE id = $${params.length}`, params); }
      if (input.transfers) {
        const rows = input.transfers.filter(t => t.percent > 0);
        if (rows.some(t => t.toId === id)) throw new AnalyticError('Un centre ne peut pas se céder à lui-même');
        const tot = rows.reduce((s, t) => s + t.percent, 0);
        if (rows.length && Math.abs(tot - 100) > 0.01) throw new AnalyticError(`Les cessions doivent totaliser 100 % (actuellement ${Math.round(tot * 100) / 100} %)`);
        await db.query(`DELETE FROM cost_center_transfers WHERE from_center_id = $1`, [id]);
        for (const t of rows) {
          await db.query(`INSERT INTO cost_center_transfers (from_center_id, to_center_id, percent) VALUES ($1, $2, $3)`, [id, t.toId, t.percent]);
        }
      }
      invalidateCostModel();
      return { id };
    });
  },

  // ─── Clés de répartition (axe Activités) ───
  async keys() {
    const keys = (await db.query(
      `SELECT k.id, k.name, k.is_active FROM analytic_keys k JOIN analytic_axes x ON x.id = k.axis_id AND x.code = 'ACT' ORDER BY k.name`)).rows;
    const lines = (await db.query(`SELECT key_id, cost_center_id, percent::float8 AS percent FROM analytic_key_lines`)).rows;
    return keys.map(k => ({ ...k, lines: lines.filter(l => l.key_id === k.id).map(l => ({ centerId: l.cost_center_id, percent: l.percent })) }));
  },

  async saveKey(id: string | null, input: { name: string; lines: { centerId: string; percent: number }[]; userId: string | null }) {
    const tot = input.lines.reduce((s, l) => s + l.percent, 0);
    if (!input.lines.length || Math.abs(tot - 100) > 0.01) throw new AnalyticError(`Une clé doit totaliser 100 % (actuellement ${Math.round(tot * 100) / 100} %)`);
    return withTransaction(async () => {
      let keyId = id;
      if (!keyId) {
        const dup = await db.query(`SELECT 1 FROM analytic_keys k JOIN analytic_axes x ON x.id = k.axis_id AND x.code = 'ACT' WHERE k.name = $1`, [input.name.trim()]);
        if (dup.rows.length) throw new AnalyticError('Une clé porte déjà ce nom');
        keyId = (await db.query(
          `INSERT INTO analytic_keys (axis_id, name, created_by) VALUES ((SELECT id FROM analytic_axes WHERE code = 'ACT'), $1, $2) RETURNING id`,
          [input.name.trim().slice(0, 120), input.userId])).rows[0].id as string;
      } else {
        await db.query(`UPDATE analytic_keys SET name = $2 WHERE id = $1`, [keyId, input.name.trim().slice(0, 120)]);
        await db.query(`DELETE FROM analytic_key_lines WHERE key_id = $1`, [keyId]);
      }
      for (const l of input.lines) {
        await db.query(`INSERT INTO analytic_key_lines (key_id, cost_center_id, percent) VALUES ($1, $2, $3)`, [keyId, l.centerId, l.percent]);
      }
      invalidateCostModel();
      return { id: keyId };
    });
  },

  // ─── Charges ───
  async charges(storeId: string | null, month: string) {
    const r = await db.query(
      `SELECT ch.id, ch.label, ch.nature, ch.behavior, ch.fixed_pct::float8 AS fixed_pct, ch.assignment, ch.cost_center_id,
              c.code AS center_code, c.name AS center_name, ch.allocation_key_id, k.name AS key_name,
              ch.product_id, p.name AS product_name, ch.normal_quantity::float8 AS normal_quantity,
              ch.monthly_amount::float8 AS monthly_amount, a.amount::float8 AS actual_amount, ch.is_active, ch.notes, ch.store_id,
              fn_analytic_ledger_amount(ch.id, $1::uuid, $2::date)::float8 AS ledger_amount,
              COALESCE((SELECT json_agg(json_build_object('id', ac.id, 'code', ac.code, 'label', ac.label) ORDER BY ac.code)
                          FROM analytic_charge_accounts x JOIN accounts ac ON ac.id = x.account_id WHERE x.charge_id = ch.id), '[]') AS accounts
         FROM analytic_charges ch
         LEFT JOIN cost_centers c ON c.id = ch.cost_center_id
         LEFT JOIN analytic_keys k ON k.id = ch.allocation_key_id
         LEFT JOIN products p ON p.id = ch.product_id
         LEFT JOIN analytic_charge_actuals a ON a.charge_id = ch.id AND a.period = $2::date
        WHERE ($1::uuid IS NULL OR ch.store_id IS NULL OR ch.store_id = $1)
        ORDER BY ch.is_active DESC, ch.label`, [storeId, `${month}-01`]);
    return r.rows;
  },

  validateCharge(c: { assignment: string; costCenterId?: string | null; allocationKeyId?: string | null; productId?: string | null }) {
    if (c.assignment === 'direct' && !c.productId) throw new AnalyticError('Une charge directe vise un produit');
    if (c.assignment === 'indirect' && !c.costCenterId && !c.allocationKeyId) throw new AnalyticError('Choisissez un centre ou une clé de répartition');
  },

  async createCharge(input: { label: string; nature: string; behavior: string; fixedPct: number; assignment: string;
    costCenterId?: string | null; allocationKeyId?: string | null; productId?: string | null; normalQuantity?: number | null;
    monthlyAmount: number; notes?: string | null; storeId?: string | null; userId: string | null; accountIds?: string[] }) {
    this.validateCharge(input);
    const direct = input.assignment === 'direct';
    const r = await db.query(
      `INSERT INTO analytic_charges (label, nature, behavior, fixed_pct, assignment, cost_center_id, allocation_key_id, product_id,
                                     normal_quantity, monthly_amount, notes, store_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [input.label.trim().slice(0, 160), input.nature, input.behavior, this.fixedPct(input.behavior, input.fixedPct), input.assignment,
       direct ? null : (input.allocationKeyId ? null : input.costCenterId ?? null), direct ? null : input.allocationKeyId ?? null,
       direct ? input.productId : null, direct ? input.normalQuantity ?? null : null,
       input.monthlyAmount, input.notes ?? null, input.storeId ?? null, input.userId]);
    if (input.accountIds) await this.setChargeAccounts(r.rows[0].id, input.accountIds);
    invalidateCostModel();
    return { id: r.rows[0].id as string };
  },

  /** Lot D (mig 659) : comptes de classe 6 rattachés à une charge (remplace la liste). */
  async setChargeAccounts(chargeId: string, accountIds: string[]) {
    const ids = [...new Set(accountIds)];
    const bad = ids.length ? (await db.query(
      `SELECT count(*)::int AS n FROM accounts WHERE id = ANY($1::uuid[]) AND account_class <> 6`, [ids])).rows[0].n : 0;
    if (bad) throw new AnalyticError('Seuls des comptes de charges (classe 6) se rattachent à une charge');
    await db.query(`DELETE FROM analytic_charge_accounts WHERE charge_id = $1 AND NOT (account_id = ANY($2::uuid[]))`, [chargeId, ids]);
    for (const a of ids) {
      await db.query(`INSERT INTO analytic_charge_accounts (charge_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [chargeId, a]);
    }
  },

  /** Comptes de charges (classe 6) proposés au rattachement. */
  async expenseAccounts() {
    return (await db.query(
      `SELECT id, code, label FROM accounts WHERE account_class = 6 AND is_active ORDER BY code`)).rows;
  },

  /**
   * Rapprochement d'un mois : chaque compte de classe 6 mouvementé, son solde, et ce qui le
   * couvre dans le coût de revient (charge analytique, paie, consommations de matières).
   */
  async reconciliation(storeId: string | null, month: string) {
    const rows = (await db.query(
      `SELECT a.id, a.code, a.label, SUM(l.debit - l.credit)::float8 AS amount,
              (SELECT string_agg(ch.label, ', ' ORDER BY ch.label) FROM analytic_charge_accounts x
                 JOIN analytic_charges ch ON ch.id = x.charge_id AND ch.is_active WHERE x.account_id = a.id) AS charges
         FROM journal_entry_lines l
         JOIN journal_entries e ON e.id = l.journal_entry_id
         JOIN accounts a ON a.id = l.account_id
        WHERE a.account_class = 6 AND e.status IN ('posted', 'reversed')
          AND e.entry_date >= $2::date AND e.entry_date < ($2::date + interval '1 month')
          AND ($1::uuid IS NULL OR e.store_id IS NULL OR e.store_id = $1)
        GROUP BY a.id, a.code, a.label
       HAVING SUM(l.debit - l.credit) <> 0
        ORDER BY a.code`, [storeId, `${month}-01`])).rows;
    return rows.map(r => {
      const code = String(r.code);
      const coverage = r.charges ? 'charge'
        : /^619/.test(code) ? 'amortissements'
        : /^617/.test(code) ? 'paie'
        : /^(611|612)/.test(code) ? 'matieres'
        : /^(63|65|67)/.test(code) ? 'hors_exploitation'
        : 'non_rattache';
      return { ...r, coverage };
    });
  },

  fixedPct(behavior: string, pct: number) {
    return behavior === 'fixed' ? 100 : behavior === 'variable' ? 0 : Math.min(100, Math.max(0, pct));
  },

  async updateCharge(id: string, input: { label: string; nature: string; behavior: string; fixedPct: number; assignment: string;
    costCenterId?: string | null; allocationKeyId?: string | null; productId?: string | null; normalQuantity?: number | null;
    monthlyAmount: number; notes?: string | null; isActive?: boolean; accountIds?: string[] }) {
    this.validateCharge(input);
    const direct = input.assignment === 'direct';
    const r = await db.query(
      `UPDATE analytic_charges SET label = $2, nature = $3, behavior = $4, fixed_pct = $5, assignment = $6, cost_center_id = $7,
              allocation_key_id = $8, product_id = $9, normal_quantity = $10, monthly_amount = $11, notes = $12,
              is_active = COALESCE($13, is_active), updated_at = now()
        WHERE id = $1 RETURNING id`,
      [id, input.label.trim().slice(0, 160), input.nature, input.behavior, this.fixedPct(input.behavior, input.fixedPct), input.assignment,
       direct ? null : (input.allocationKeyId ? null : input.costCenterId ?? null), direct ? null : input.allocationKeyId ?? null,
       direct ? input.productId : null, direct ? input.normalQuantity ?? null : null, input.monthlyAmount, input.notes ?? null,
       input.isActive ?? null]);
    if (!r.rows.length) throw new AnalyticError('Charge introuvable');
    if (input.accountIds) await this.setChargeAccounts(id, input.accountIds);
    invalidateCostModel();
    return { id };
  },

  async setChargeActive(id: string, active: boolean) {
    await db.query(`UPDATE analytic_charges SET is_active = $2, updated_at = now() WHERE id = $1`, [id, active]);
    invalidateCostModel();
    return { id, active };
  },

  async setActual(id: string, month: string, amount: number | null, userId: string | null, storeId: string | null = null) {
    await this.assertOpen(storeId, month);
    if (amount == null) await db.query(`DELETE FROM analytic_charge_actuals WHERE charge_id = $1 AND period = $2::date`, [id, `${month}-01`]);
    else await db.query(
      `INSERT INTO analytic_charge_actuals (charge_id, period, amount, updated_by) VALUES ($1, $2::date, $3, $4)
       ON CONFLICT (charge_id, period) DO UPDATE SET amount = EXCLUDED.amount, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [id, `${month}-01`, amount, userId]);
    invalidateCostModel();
    return { id, month, amount };
  },

  // ─── Personnel ───
  async personnel(storeId: string | null, month: string) {
    const model = await periodModel(storeId, month, { fresh: true });
    return model.employees;
  },

  async setAllocations(employeeId: string, allocations: { centerId: string; percent: number; laborType: 'direct' | 'indirect' }[]) {
    const tot = allocations.reduce((s, a) => s + a.percent, 0);
    if (allocations.length && Math.abs(tot - 100) > 0.01) throw new AnalyticError(`La répartition doit totaliser 100 % (actuellement ${Math.round(tot * 100) / 100} %)`);
    if (new Set(allocations.map(a => a.centerId)).size !== allocations.length) throw new AnalyticError('Un centre apparaît deux fois');
    return withTransaction(async () => {
      await db.query(`DELETE FROM employee_cost_allocations WHERE employee_id = $1`, [employeeId]);
      for (const a of allocations) {
        await db.query(`INSERT INTO employee_cost_allocations (employee_id, cost_center_id, percent, labor_type) VALUES ($1, $2, $3, $4)`,
          [employeeId, a.centerId, a.percent, a.laborType]);
      }
      invalidateCostModel();
      return { employeeId, count: allocations.length };
    });
  },

  // ─── Période ───
  async period(storeId: string | null, month: string) {
    const model = await periodModel(storeId, month, { fresh: true });
    const plans = (await db.query(
      `SELECT COUNT(*)::int AS total, COUNT(pcr.id)::int AS costed,
              COALESCE(SUM(pcr.cout_total), 0)::float8 AS revient, COALESCE(SUM(pcr.cout_charges_fixes), 0)::float8 AS charges
         FROM production_plans pp LEFT JOIN production_cout_reel pcr ON pcr.plan_id = pp.id
        WHERE pp.store_id IS NOT DISTINCT FROM $1::uuid AND pp.plan_date >= $2::date AND pp.plan_date < $3::date
          AND pp.status IN ('in_progress', 'completed')`, [storeId, model.from, model.to])).rows[0];
    const now = new Date();
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return { ...model, method: await this.method(), plans, driverKeys: DRIVER_KEYS,
             canClose: !model.closed && month < current, history: await this.periods(storeId) };
  },

  async periodStatus(storeId: string | null, month: string) {
    const r = (await db.query(
      `SELECT status FROM analytic_periods WHERE store_id IS NOT DISTINCT FROM $1::uuid AND period = $2::date`,
      [storeId, `${month}-01`])).rows[0];
    return (r?.status ?? 'open') as 'open' | 'closed';
  },

  async assertOpen(storeId: string | null, month: string) {
    if (await this.periodStatus(storeId, month) === 'closed') {
      throw new AnalyticError(`Le mois ${month} est clôturé : rouvrez-le d'abord (Analyse des coûts › Période).`);
    }
  },

  /**
   * Lot C (mig 658) : clôture d'un mois révolu. Tous ses plans sont recalculés avec le
   * paramétrage courant, puis le modèle du mois (taux, activité, écarts) est figé.
   */
  async closeMonth(storeId: string | null, month: string, userId: string) {
    const now = new Date();
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (month >= current) throw new AnalyticError('Seul un mois terminé peut être clôturé.');
    await this.assertOpen(storeId, month);
    if (await this.method() !== 'analytic') throw new AnalyticError('Activez d\'abord le moteur analytique.');
    const recalc = await this.recalcMonth(storeId, month, userId);
    if (recalc.failed > 0) throw new AnalyticError(`${recalc.failed} plan(s) n'ont pas pu être recalculés : clôture refusée.`);
    const model = await periodModel(storeId, month, { fresh: true, live: true });
    if (Math.abs(model.totals.control) >= 0.05) throw new AnalyticError(`Contrôle déséquilibré (${model.totals.control}) : clôture refusée.`);
    await withTransaction(async () => {
      await db.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      await db.query(
        `INSERT INTO analytic_periods (store_id, period, status, snapshot, closed_at, closed_by)
         VALUES ($1, $2::date, 'closed', $3, now(), $4)
         ON CONFLICT (COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid), period)
         DO UPDATE SET status = 'closed', snapshot = EXCLUDED.snapshot, closed_at = now(), closed_by = EXCLUDED.closed_by`,
        [storeId, `${month}-01`, JSON.stringify(model), userId]);
    });
    invalidateCostModel();
    return { month, plans: recalc.calculated, control: model.totals.control };
  },

  async reopenMonth(storeId: string | null, month: string, userId: string, reason: string) {
    if (await this.periodStatus(storeId, month) !== 'closed') throw new AnalyticError('Ce mois n\'est pas clôturé.');
    await withTransaction(async () => {
      await db.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      await db.query(
        `UPDATE analytic_periods SET status = 'open', reopened_at = now(), reopened_by = $3, reopen_reason = $4
          WHERE store_id IS NOT DISTINCT FROM $1::uuid AND period = $2::date`,
        [storeId, `${month}-01`, userId, reason]);
    });
    invalidateCostModel();
    return { month, status: 'open' };
  },

  async periods(storeId: string | null) {
    return (await db.query(
      `SELECT to_char(ap.period, 'YYYY-MM') AS month, ap.status, ap.closed_at, ap.reopened_at, ap.reopen_reason,
              NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS closed_by_name
         FROM analytic_periods ap LEFT JOIN users u ON u.id = ap.closed_by
        WHERE ap.store_id IS NOT DISTINCT FROM $1::uuid ORDER BY ap.period DESC LIMIT 36`, [storeId])).rows;
  },

  /**
   * Lot F : rentabilité sur une période de mois [from, to].
   *  - par produit et par famille : ventes réelles HT − quantités vendues × coût de revient
   *    unitaire moyen des plans chiffrés de la période (coût propre de l'article, lot A) ;
   *  - seuil de rentabilité : charges fixes d'un mois ÷ taux de marge sur coûts variables ;
   *  - historique 12 mois : charges, imputé, sous-activité, taux d'activité, coût unitaire ;
   *  - éléments de simulation (ventes, coûts variables, charges fixes d'un mois moyen).
   */
  async profitability(storeId: string | null, from: string, to: string) {
    const first = `${from}-01`;
    const [ty, tm] = to.split('-').map(Number);
    const end = tm === 12 ? `${ty + 1}-01-01` : `${ty}-${String(tm + 1).padStart(2, '0')}-01`;
    const months = Math.max(1, (ty * 12 + tm) - (Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7))) + 1);
    const produced = (await db.query(
      `SELECT (it->>'product_id')::uuid AS product_id, SUM((it->>'quantity')::numeric)::float8 AS qty,
              SUM((it->>'cout_revient')::numeric)::float8 AS revient, SUM((it->>'cout_production')::numeric)::float8 AS production,
              SUM(COALESCE((it->>'matieres')::numeric, 0))::float8 AS matieres
         FROM production_cout_reel pcr
         JOIN production_plans pp ON pp.id = pcr.plan_id
         CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pcr.niveaux->'items', '[]'::jsonb)) it
        WHERE pp.store_id IS NOT DISTINCT FROM $1::uuid AND pp.plan_date >= $2::date AND pp.plan_date < $3::date
          AND it ? 'product_id'
        GROUP BY 1`, [storeId, first, end])).rows as { product_id: string; qty: number; revient: number; production: number; matieres: number }[];
    const sales = (await db.query(
      `SELECT si.product_id, p.name, COALESCE(c.name, 'Sans famille') AS family,
              SUM(si.quantity)::float8 AS qty, SUM(si.subtotal - COALESCE(si.tax_amount, 0))::float8 AS ca_ht
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         JOIN products p ON p.id = si.product_id
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE s.cancelled_at IS NULL AND s.created_at >= $2::date AND s.created_at < $3::date
          AND ($1::uuid IS NULL OR s.store_id IS NULL OR s.store_id = $1)
        GROUP BY si.product_id, p.name, c.name`, [storeId, first, end])).rows as { product_id: string; name: string; family: string; qty: number; ca_ht: number }[];
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const products = sales.map(sl => {
      const pr = produced.find(x => x.product_id === sl.product_id);
      const unit = pr && pr.qty > 0 ? pr.revient / pr.qty : null;
      const cost = unit != null ? sl.qty * unit : null;
      const marge = cost != null ? sl.ca_ht - cost : null;
      return {
        product_id: sl.product_id, name: sl.name, family: sl.family, qty_sold: sl.qty, ca_ht: r2(sl.ca_ht),
        qty_produced: pr?.qty ?? 0, cout_revient_u: unit != null ? Math.round(unit * 10000) / 10000 : null,
        cout_ventes: cost != null ? r2(cost) : null, marge: marge != null ? r2(marge) : null,
        taux_marque: marge != null && sl.ca_ht > 0 ? Math.round(marge / sl.ca_ht * 10000) / 100 : null,
      };
    }).sort((a, b) => (a.marge == null ? 1 : 0) - (b.marge == null ? 1 : 0) || (b.marge ?? 0) - (a.marge ?? 0) || b.ca_ht - a.ca_ht);
    const famMap = new Map<string, { family: string; ca_ht: number; ca_costed: number; cout_ventes: number; products: number; uncosted: number }>();
    for (const pr of products) {
      const f = famMap.get(pr.family) ?? { family: pr.family, ca_ht: 0, ca_costed: 0, cout_ventes: 0, products: 0, uncosted: 0 };
      f.ca_ht += pr.ca_ht; f.products++;
      if (pr.cout_ventes != null) { f.cout_ventes += pr.cout_ventes; f.ca_costed += pr.ca_ht; } else f.uncosted++;
      famMap.set(pr.family, f);
    }
    const families = [...famMap.values()].map(f => ({
      ...f, ca_ht: r2(f.ca_ht), ca_costed: r2(f.ca_costed), cout_ventes: r2(f.cout_ventes), marge: r2(f.ca_costed - f.cout_ventes),
      taux_marque: f.ca_costed > 0 ? Math.round((f.ca_costed - f.cout_ventes) / f.ca_costed * 10000) / 100 : null,
    })).sort((a, b) => b.ca_ht - a.ca_ht);

    // Coûts variables / ventes des plans chiffrés de la période → taux de marge sur coûts variables.
    const v = (await db.query(
      `SELECT COALESCE(SUM((pcr.niveaux->>'ventes_ht')::numeric), 0)::float8 AS ventes,
              COALESCE(SUM(pcr.cout_matieres + pcr.cout_emballages + pcr.cout_energie + pcr.cout_sous_traitance), 0)::float8 AS directs,
              COALESCE(SUM((SELECT SUM((l->>'variable')::numeric) FROM jsonb_array_elements(COALESCE(pcr.detail_analytique->'lines', '[]'::jsonb)) l)), 0)::float8 AS var_charges,
              COUNT(*)::int AS plans
         FROM production_cout_reel pcr JOIN production_plans pp ON pp.id = pcr.plan_id
        WHERE pp.store_id IS NOT DISTINCT FROM $1::uuid AND pp.plan_date >= $2::date AND pp.plan_date < $3::date
          AND pcr.niveaux IS NOT NULL`, [storeId, first, end])).rows[0];
    const variableRate = v.ventes > 0 ? (v.directs + v.var_charges) / v.ventes : null;
    const mscvRate = variableRate != null ? 1 - variableRate : null;
    // Charges fixes d'un mois entier (dernier mois de la période) : centres + charges directes + MO imputée.
    const last = await periodModel(storeId, to);
    const ratio = last.elapsedRatio > 0 ? last.elapsedRatio : 1;
    const fixed = (last.centres.filter(c => c.kind === 'principal').reduce((t, c) => t + c.pool.budget.fixed, 0)
      + last.direct.reduce((t, d) => t + d.budget.fixed, 0) + (last.directLabour?.imputed ?? 0)) / ratio;
    const caTotal = sales.reduce((t, x) => t + x.ca_ht, 0);
    const caMonthly = caTotal / months;
    const breakEven = mscvRate && mscvRate > 0 ? fixed / mscvRate : null;

    // Historique : les 12 mois jusqu'à « to ».
    const history: { month: string; charges: number; imputed: number; activityVariance: number; activityRate: number | null; units: number; revient: number | null; coutUnitaire: number | null }[] = [];
    for (let k = 11; k >= 0; k--) {
      const t = ty * 12 + (tm - 1) - k;
      const mo = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
      const m = await periodModel(storeId, mo);
      if (!m.plansCount) continue;
      const prod = m.centres.find(c => c.kind === 'principal' && c.level === 'production');
      const rev = (await db.query(
        `SELECT COALESCE(SUM(pcr.cout_total), 0)::float8 AS revient, COUNT(*)::int AS n
           FROM production_cout_reel pcr JOIN production_plans pp ON pp.id = pcr.plan_id
          WHERE pp.store_id IS NOT DISTINCT FROM $1::uuid AND to_char(pp.plan_date, 'YYYY-MM') = $2`, [storeId, mo])).rows[0];
      const fullyCosted = rev.n >= m.plansCount;
      history.push({
        month: mo, charges: m.totals.charges, imputed: m.totals.imputed, activityVariance: m.totals.activityVariance,
        activityRate: prod?.activityRate ?? null, units: m.activity.units,
        revient: fullyCosted ? r2(rev.revient) : null,
        coutUnitaire: fullyCosted && m.activity.units > 0 ? Math.round(rev.revient / m.activity.units * 10000) / 10000 : null,
      });
    }
    return {
      from, to, months, products, families,
      totals: {
        ca_ht: r2(caTotal), ca_costed: r2(products.filter(x => x.cout_ventes != null).reduce((t, x) => t + x.ca_ht, 0)),
        cout_ventes: r2(products.reduce((t, x) => t + (x.cout_ventes ?? 0), 0)),
        marge: r2(products.reduce((t, x) => t + (x.marge ?? 0), 0)),
        produits_sans_cout: products.filter(x => x.cout_ventes == null).length,
      },
      breakEven: {
        fixedMonthly: r2(fixed), variableRate: variableRate != null ? Math.round(variableRate * 10000) / 10000 : null,
        mscvRate: mscvRate != null ? Math.round(mscvRate * 10000) / 10000 : null,
        seuilMensuel: breakEven != null ? r2(breakEven) : null, caMensuel: r2(caMonthly),
        margeSecurite: breakEven != null ? r2(caMonthly - breakEven) : null,
        plansChiffres: v.plans,
      },
      history,
    };
  },

  // ─── Équipements (immobilisations) et outillage (mig 660) ───
  async equipment(storeId: string | null, month: string) {
    const period = `${month}-01`;
    const assets = (await db.query(
      `SELECT fa.id, fa.label, fa.acquisition_date, fa.acquisition_cost::float8 AS acquisition_cost, fa.residual_value::float8 AS residual_value,
              fa.duration_years, fa.method, fa.status, fa.cost_center_id, c.code AS center_code, c.name AS center_name,
              fa.product_id, p.name AS product_name, fa.analytic_excluded,
              fn_fixed_asset_month_depreciation(fa.id, $2::date)::float8 AS month_amount,
              (SELECT string_agg(pe.nom, ', ') FROM production_equipements pe WHERE pe.fixed_asset_id = fa.id) AS equipment_names
         FROM fixed_assets fa
         LEFT JOIN cost_centers c ON c.id = fa.cost_center_id
         LEFT JOIN products p ON p.id = fa.product_id
        WHERE ($1::uuid IS NULL OR fa.store_id IS NULL OR fa.store_id = $1) AND fa.status <> 'disposed'
        ORDER BY fa.acquisition_date DESC, fa.label`, [storeId, period])).rows;
    const tools = (await db.query(
      `SELECT t.id, t.label, t.category, t.unit_cost::float8 AS unit_cost, t.quantity::float8 AS quantity, t.purchase_date, t.life_months,
              t.cost_center_id, c.code AS center_code, c.name AS center_name, t.product_id, p.name AS product_name, t.is_active, t.notes,
              (t.unit_cost * t.quantity / t.life_months)::float8 AS monthly_cost,
              to_char(date_trunc('month', t.purchase_date) + make_interval(months => t.life_months) - interval '1 day', 'YYYY-MM-DD') AS end_date,
              (date_trunc('month', t.purchase_date) <= $2::date
                 AND $2::date < date_trunc('month', t.purchase_date) + make_interval(months => t.life_months)) AS in_use
         FROM production_tools t
         LEFT JOIN cost_centers c ON c.id = t.cost_center_id
         LEFT JOIN products p ON p.id = t.product_id
        WHERE ($1::uuid IS NULL OR t.store_id IS NULL OR t.store_id = $1)
        ORDER BY t.is_active DESC, t.category, t.label`, [storeId, period])).rows;
    return {
      assets, tools,
      totals: {
        amortissements: Math.round(assets.filter(a => !a.analytic_excluded).reduce((t, a) => t + (a.month_amount ?? 0), 0) * 100) / 100,
        outillage: Math.round(tools.filter(t => t.is_active && t.in_use).reduce((s2, t) => s2 + t.monthly_cost, 0) * 100) / 100,
      },
    };
  },

  async updateAsset(id: string, input: { costCenterId: string | null; productId: string | null; excluded: boolean }, userId: string) {
    return withTransaction(async () => {
      await db.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      const r = await db.query(
        `UPDATE fixed_assets SET cost_center_id = $2, product_id = $3, analytic_excluded = $4 WHERE id = $1 RETURNING id`,
        [id, input.productId ? null : input.costCenterId, input.productId, input.excluded]);
      if (!r.rows.length) throw new AnalyticError('Immobilisation introuvable');
      invalidateCostModel();
      return { id };
    });
  },

  async saveTool(id: string | null, input: { label: string; category: string; unitCost: number; quantity: number; purchaseDate: string;
    lifeMonths: number; costCenterId?: string | null; productId?: string | null; notes?: string | null; storeId?: string | null }, userId: string) {
    const params = [input.label.trim().slice(0, 160), input.category, input.unitCost, input.quantity, input.purchaseDate, input.lifeMonths,
      input.productId ? null : input.costCenterId ?? null, input.productId ?? null, input.notes ?? null];
    const r = id
      ? await db.query(
          `UPDATE production_tools SET label = $2, category = $3, unit_cost = $4, quantity = $5, purchase_date = $6, life_months = $7,
                  cost_center_id = $8, product_id = $9, notes = $10, updated_at = now() WHERE id = $1 RETURNING id`, [id, ...params])
      : await db.query(
          `INSERT INTO production_tools (label, category, unit_cost, quantity, purchase_date, life_months, cost_center_id, product_id, notes, store_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`, [...params, input.storeId ?? null, userId]);
    if (!r.rows.length) throw new AnalyticError('Outil introuvable');
    invalidateCostModel();
    return { id: r.rows[0].id as string };
  },

  async setToolActive(id: string, active: boolean) {
    await db.query(`UPDATE production_tools SET is_active = $2, updated_at = now() WHERE id = $1`, [id, active]);
    invalidateCostModel();
    return { id, active };
  },

  /** Recalcule le coût de tous les plans (en cours, terminés) d'un mois. */
  async recalcMonth(storeId: string | null, month: string, userId: string) {
    await this.assertOpen(storeId, month);
    invalidateCostModel();
    const [y, m] = month.split('-').map(Number);
    const from = `${month}-01`;
    const to = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const plans = (await db.query(
      `SELECT id FROM production_plans
        WHERE store_id IS NOT DISTINCT FROM $1::uuid AND plan_date >= $2::date AND plan_date < $3::date
          AND status IN ('in_progress', 'completed') ORDER BY plan_date`, [storeId, from, to])).rows;
    let calculated = 0; const failed: string[] = [];
    for (const p of plans) {
      try { await productionCoutRepository.calculateAndSave(p.id, userId); calculated++; }
      catch (err) { failed.push(p.id); logger.error({ err }, `Recalcul analytique : plan ${p.id}`); }
    }
    return { total: plans.length, calculated, failed: failed.length };
  },
};
