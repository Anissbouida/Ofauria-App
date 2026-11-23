/**
 * Moteur analytique du coût de revient (mig 655).
 *
 * Analogie Oracle : c'est un « package » PL/SQL de calcul — periodModel() joue le rôle
 * d'une procédure de clôture analytique (répartition primaire → secondaire → taux),
 * imputePlan() celui d'une fonction qui lit ces taux pour un ordre de fabrication.
 *
 * Étapes (méthode des centres d'analyse, imputation rationnelle) :
 *   1. Répartition primaire : chaque charge du référentiel (analytic_charges) va à son
 *      centre, ou est éclatée par une clé (%) ; le coût employeur de chaque salarié va
 *      aux centres où il est affecté (employee_cost_allocations). Une charge DIRECTE
 *      (produit) ne passe pas par les centres.
 *   2. Répartition secondaire : les centres auxiliaires cèdent leur coût (pourcentages,
 *      effectif ou masse salariale), par passes successives (prestations croisées).
 *   3. Taux d'imputation des centres principaux, sur la CAPACITÉ NORMALE de l'inducteur :
 *      taux = charges du centre ÷ capacité normale. Un plan reçoit taux × ses unités
 *      d'œuvre ; ce qui n'est pas absorbé (sous-activité) reste en écart de période,
 *      il n'alourdit jamais le coût des produits.
 *   4. Contrôle : imputé + écart d'activité + écart sur budget = charges réelles.
 */
import { db } from '../config/database.js';

export type Driver = 'units' | 'weight_kg' | 'labour_hours' | 'machine_hours' | 'batches' | 'material_cost' | 'sales_value';
export type Level = 'approvisionnement' | 'production' | 'administration' | 'distribution';
export type Behavior = 'fixed' | 'variable' | 'semi_variable';

export const DRIVERS: Record<Driver, { label: string; unit: string }> = {
  units:         { label: 'Quantité produite',        unit: 'unités' },
  weight_kg:     { label: 'Poids produit',            unit: 'kg' },
  labour_hours:  { label: 'Heures de main-d\'œuvre',  unit: 'h MO' },
  machine_hours: { label: 'Heures machine',           unit: 'h machine' },
  batches:       { label: 'Nombre de lots',           unit: 'lots' },
  material_cost: { label: 'Valeur des matières',      unit: 'DH matières' },
  sales_value:   { label: 'Valeur de vente HT',       unit: 'DH de vente' },
};

export const LEVELS: Record<Level, string> = {
  approvisionnement: 'Approvisionnement (coût d\'achat)',
  production: 'Production',
  administration: 'Administration et direction',
  distribution: 'Distribution et commercial',
};

/** Suggestion de classement d'une charge selon sa nature (modifiable par l'utilisateur). */
export const NATURE_SUGGESTIONS: Record<string, { label: string; behavior: Behavior; fixedPct: number; center: string; hint: string }> = {
  loyer:          { label: 'Loyer',                      behavior: 'fixed',         fixedPct: 100, center: 'PROD',  hint: 'Répartir selon les surfaces occupées (clé %).' },
  assurance:      { label: 'Assurances',                 behavior: 'fixed',         fixedPct: 100, center: 'ADM',   hint: 'Charge de structure ; machines assurées → Production.' },
  abonnement:     { label: 'Abonnements',                behavior: 'fixed',         fixedPct: 100, center: 'ADM',   hint: 'Selon le service qui l\'utilise.' },
  amortissement:  { label: 'Amortissements',             behavior: 'fixed',         fixedPct: 100, center: 'PROD',  hint: 'Machine dédiée à un produit → charge directe sur ce produit.' },
  salaires:       { label: 'Salaires (hors paie)',       behavior: 'fixed',         fixedPct: 100, center: 'ADM',   hint: 'Les salariés de la paie sont repris automatiquement (onglet Personnel).' },
  energie:        { label: 'Énergie',                    behavior: 'semi_variable', fixedPct: 30,  center: 'PROD',  hint: 'Part fixe = abonnements ; part variable suit les heures machine.' },
  eau:            { label: 'Eau',                        behavior: 'semi_variable', fixedPct: 20,  center: 'PROD',  hint: 'Suit surtout la production.' },
  maintenance:    { label: 'Maintenance',                behavior: 'semi_variable', fixedPct: 60,  center: 'MAINT', hint: 'Centre auxiliaire cédé à la production.' },
  informatique:   { label: 'Informatique',               behavior: 'fixed',         fixedPct: 100, center: 'IT',    hint: 'Cédée au prorata de l\'effectif.' },
  securite:       { label: 'Sécurité, gardiennage',      behavior: 'fixed',         fixedPct: 100, center: 'ADM',   hint: 'Charge de structure.' },
  administratif:  { label: 'Frais administratifs',       behavior: 'fixed',         fixedPct: 100, center: 'ADM',   hint: 'Charge de structure.' },
  honoraires:     { label: 'Honoraires, prestations',    behavior: 'fixed',         fixedPct: 100, center: 'FIN',   hint: 'Comptable, avocat… : charge de structure.' },
  transport:      { label: 'Transport, livraisons',      behavior: 'variable',      fixedPct: 0,   center: 'LOG',   hint: 'Suit les volumes livrés.' },
  marketing:      { label: 'Marketing, publicité',       behavior: 'fixed',         fixedPct: 100, center: 'COM',   hint: 'Charge de distribution.' },
  sous_traitance: { label: 'Sous-traitance',             behavior: 'variable',      fixedPct: 0,   center: 'PROD',  hint: 'Façon d\'un produit précis → charge directe.' },
  consommables:   { label: 'Consommables d\'atelier',    behavior: 'variable',      fixedPct: 0,   center: 'PROD',  hint: 'Suit la production.' },
  taxes:          { label: 'Impôts et taxes',            behavior: 'fixed',         fixedPct: 100, center: 'ADM',   hint: 'Charge de structure.' },
  autre:          { label: 'Autre',                      behavior: 'fixed',         fixedPct: 100, center: 'ADM',   hint: '' },
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

interface FV { fixed: number; variable: number }
const fv = (): FV => ({ fixed: 0, variable: 0 });
const addFv = (a: FV, b: FV, k = 1) => { a.fixed += b.fixed * k; a.variable += b.variable * k; };
const sumFv = (a: FV) => a.fixed + a.variable;

export type DriverQty = Record<Driver, number>;
const zeroDrivers = (): DriverQty => ({ units: 0, weight_kg: 0, labour_hours: 0, machine_hours: 0, batches: 0, material_cost: 0, sales_value: 0 });
const DRIVER_KEYS = Object.keys(DRIVERS) as Driver[];

export interface CentreLine { source: 'charge' | 'personnel' | 'transfer' | 'direct_labour'; label: string; budget: FV; actual: FV }

export interface CentreModel {
  id: string; code: string; name: string; kind: 'principal' | 'auxiliaire'; level: Level; driver: Driver;
  parentId: string | null; transferBasis: string; sortOrder: number;
  lines: CentreLine[];
  primary: { budget: FV; actual: FV };
  received: { budget: FV; actual: FV };
  ceded: { budget: FV; actual: FV };
  pool: { budget: FV; actual: FV };
  normalCapacity: number | null; capacitySource: 'configured' | 'history' | 'projection' | 'none';
  maxCapacity: number | null;
  activity: number; activityRate: number | null; utilisationRate: number | null;
  rateFixed: number; rateVariable: number;
  imputed: FV; activityVariance: number; budgetVariance: number;
}

export interface DirectChargeModel {
  id: string; label: string; productId: string; productName: string;
  budget: FV; actual: FV; normalQuantity: number | null; quantitySource: string; activity: number;
  rateFixed: number; rateVariable: number; imputed: FV; activityVariance: number; budgetVariance: number;
}

export interface EmployeeCost {
  id: string; name: string; role: string | null; budget: number; actual: number; source: 'payroll' | 'last_payroll' | 'estimate';
  hourlyRate: number; allocations: { centerId: string; percent: number; laborType: 'direct' | 'indirect' }[]; unallocated: boolean;
}

export interface PeriodModel {
  storeId: string | null; month: string; from: string; to: string;
  elapsedRatio: number; daysElapsed: number; daysInMonth: number; inProgress: boolean;
  centres: CentreModel[]; direct: DirectChargeModel[]; employees: EmployeeCost[];
  transfers: { from: string; to: string; amount: number }[];
  activity: DriverQty; plansCount: number;
  timedLabour: number;
  /** Lot B : main-d'œuvre directe du mois (heures payées, pointées, standard, non productives). */
  directLabour: { rate: number; paidHours: number; timedHours: number; standardHours: number; imputed: number; unproductiveHours: number };
  totals: { charges: number; actual: number; budget: number; imputed: number; activityVariance: number; budgetVariance: number; control: number };
  warnings: string[];
  computedAt: string;
  /** Lot C (mig 658) : mois clôturé — modèle figé à la clôture, relu tel quel. */
  closed?: { at: string; by: string | null; byName: string | null } | null;
}

const cache = new Map<string, { at: number; model: PeriodModel }>();
const TTL_MS = 60_000;
/** À appeler après toute modification du paramétrage analytique. */
export function invalidateCostModel() { cache.clear(); }

function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const daysInMonth = new Date(y, m, 0).getDate();
  return { y, m, from, to: next, daysInMonth };
}

function monthOf(date: string | Date) {
  const d = typeof date === 'string' ? date.slice(0, 7) : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  return d;
}

function addMonths(month: string, k: number) {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

async function driverTotals(storeId: string | null, from: string, to: string) {
  const r = await db.query(
    `SELECT to_char(plan_date, 'YYYY-MM') AS m, COUNT(*)::int AS n,
            SUM(units)::float8 AS units, SUM(weight_kg)::float8 AS weight_kg, SUM(labour_hours)::float8 AS labour_hours,
            SUM(machine_hours)::float8 AS machine_hours, SUM(batches)::float8 AS batches,
            SUM(material_cost)::float8 AS material_cost, SUM(sales_value)::float8 AS sales_value
       FROM fn_plan_cost_drivers($1::uuid, $2::date, $3::date)
      GROUP BY 1`, [storeId, from, to]);
  const byMonth = new Map<string, { n: number; q: DriverQty }>();
  for (const row of r.rows) {
    const q = zeroDrivers();
    for (const k of DRIVER_KEYS) q[k] = Number(row[k]) || 0;
    byMonth.set(row.m, { n: row.n, q });
  }
  return byMonth;
}

async function productQuantities(storeId: string | null, from: string, to: string) {
  const r = await db.query(
    `SELECT ppi.product_id, to_char(pp.plan_date, 'YYYY-MM') AS m,
            SUM(COALESCE(ppi.actual_quantity, ppi.planned_quantity))::float8 AS qty
       FROM production_plan_items ppi JOIN production_plans pp ON pp.id = ppi.plan_id
      WHERE pp.store_id IS NOT DISTINCT FROM $1::uuid AND pp.plan_date >= $2::date AND pp.plan_date < $3::date
        AND pp.status IN ('in_progress', 'completed') AND ppi.status <> 'cancelled'
      GROUP BY 1, 2`, [storeId, from, to]);
  const map = new Map<string, Map<string, number>>();
  for (const row of r.rows) {
    if (!map.has(row.product_id)) map.set(row.product_id, new Map());
    map.get(row.product_id)!.set(row.m, Number(row.qty) || 0);
  }
  return map;
}

/**
 * Modèle analytique d'un mois pour un établissement : centres, taux, activité, écarts.
 * Mis en cache 60 s (un calcul en série de 300 plans ne le refait pas à chaque plan).
 */
export async function periodModel(storeId: string | null, month: string, opts: { fresh?: boolean; live?: boolean } = {}): Promise<PeriodModel> {
  const key = `${storeId ?? '-'}|${month}${opts.live ? '|live' : ''}`;
  const hit = cache.get(key);
  if (!opts.fresh && hit && Date.now() - hit.at < TTL_MS) return hit.model;

  // Lot C (mig 658) : un mois clôturé garde les taux figés à sa clôture.
  if (!opts.live) {
    const closedRow = (await db.query(
      `SELECT ap.snapshot, ap.closed_at, ap.closed_by, NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS by_name
         FROM analytic_periods ap LEFT JOIN users u ON u.id = ap.closed_by
        WHERE ap.store_id IS NOT DISTINCT FROM $1::uuid AND ap.period = $2::date AND ap.status = 'closed'`,
      [storeId, `${month}-01`])).rows[0];
    if (closedRow?.snapshot) {
      const frozen: PeriodModel = { ...closedRow.snapshot, closed: { at: closedRow.closed_at, by: closedRow.closed_by, byName: closedRow.by_name } };
      cache.set(key, { at: Date.now(), model: frozen });
      return frozen;
    }
  }

  const { y, m, from, to, daysInMonth } = monthBounds(month);
  const today = new Date();
  const currentMonth = monthOf(today);
  const inProgress = month === currentMonth;
  const daysElapsed = inProgress ? today.getDate() : (month < currentMonth ? daysInMonth : 0);
  const elapsedRatio = month > currentMonth ? 1 : daysElapsed / daysInMonth;
  // Période future : le modèle prévisionnel complet sert de base (aucune activité).
  const ratio = month > currentMonth ? 1 : elapsedRatio;
  const warnings: string[] = [];

  // ── Centres ──
  const centresRows = (await db.query(
    `SELECT id, code, name, kind, level, driver, parent_id, transfer_basis, sort_order,
            normal_capacity::float8 AS normal_capacity, max_capacity::float8 AS max_capacity
       FROM cost_centers
      WHERE is_active AND ($1::uuid IS NULL OR store_id IS NULL OR store_id = $1)
      ORDER BY sort_order, code`, [storeId])).rows;
  const centres = new Map<string, CentreModel>();
  for (const c of centresRows) {
    centres.set(c.id, {
      id: c.id, code: c.code, name: c.name, kind: c.kind, level: c.level, driver: c.driver,
      parentId: c.parent_id, transferBasis: c.transfer_basis, sortOrder: c.sort_order,
      lines: [], primary: { budget: fv(), actual: fv() }, received: { budget: fv(), actual: fv() },
      ceded: { budget: fv(), actual: fv() }, pool: { budget: fv(), actual: fv() },
      normalCapacity: c.normal_capacity, capacitySource: c.normal_capacity ? 'configured' : 'none', maxCapacity: c.max_capacity,
      activity: 0, activityRate: null, utilisationRate: null, rateFixed: 0, rateVariable: 0,
      imputed: fv(), activityVariance: 0, budgetVariance: 0,
    });
  }
  const principals = [...centres.values()].filter(c => c.kind === 'principal');
  const fallbackCentre = principals.find(c => c.level === 'administration') ?? principals[0] ?? null;
  if (!principals.length) warnings.push('Aucun centre principal actif : les charges ne peuvent pas être imputées aux produits.');

  const addLine = (centreId: string | null, line: CentreLine) => {
    const c = (centreId && centres.get(centreId)) || fallbackCentre;
    if (!c) return;
    c.lines.push(line);
    addFv(c.primary.budget, line.budget);
    addFv(c.primary.actual, line.actual);
  };

  // ── Charges du référentiel ──
  const charges = (await db.query(
    `SELECT ch.id, ch.label, ch.behavior, ch.fixed_pct::float8 AS fixed_pct, ch.assignment, ch.cost_center_id,
            ch.allocation_key_id, ch.product_id, p.name AS product_name, ch.normal_quantity::float8 AS normal_quantity,
            ch.monthly_amount::float8 AS budget, a.amount::float8 AS actual
       FROM analytic_charges ch
       LEFT JOIN products p ON p.id = ch.product_id
       LEFT JOIN analytic_charge_actuals a ON a.charge_id = ch.id AND a.period = $2::date
      WHERE ch.is_active AND ($1::uuid IS NULL OR ch.store_id IS NULL OR ch.store_id = $1)
      ORDER BY ch.label`, [storeId, from])).rows;
  const keyLines = (await db.query(
    `SELECT key_id, cost_center_id, percent::float8 AS percent FROM analytic_key_lines`)).rows as { key_id: string; cost_center_id: string; percent: number }[];
  const split = (b: number, behavior: Behavior, fixedPct: number): FV => {
    const f = behavior === 'fixed' ? 1 : behavior === 'variable' ? 0 : fixedPct / 100;
    return { fixed: b * f, variable: b * (1 - f) };
  };
  const directRows: typeof charges = [];
  for (const ch of charges) {
    if (ch.assignment === 'direct') { directRows.push(ch); continue; }
    const budget = split(ch.budget * ratio, ch.behavior, ch.fixed_pct);
    const actual = split((ch.actual ?? ch.budget) * ratio, ch.behavior, ch.fixed_pct);
    if (ch.cost_center_id && centres.has(ch.cost_center_id)) {
      addLine(ch.cost_center_id, { source: 'charge', label: ch.label, budget, actual });
    } else if (ch.allocation_key_id) {
      const lines = keyLines.filter(l => l.key_id === ch.allocation_key_id && centres.has(l.cost_center_id));
      const tot = lines.reduce((t, l) => t + l.percent, 0);
      if (!tot) { addLine(null, { source: 'charge', label: `${ch.label} (clé vide)`, budget, actual }); warnings.push(`« ${ch.label} » : clé de répartition vide, imputée à l'administration.`); continue; }
      for (const l of lines) {
        const k = l.percent / tot;
        addLine(l.cost_center_id, { source: 'charge', label: `${ch.label} (${Math.round(l.percent * 10) / 10} %)`,
          budget: { fixed: budget.fixed * k, variable: budget.variable * k }, actual: { fixed: actual.fixed * k, variable: actual.variable * k } });
      }
    } else {
      addLine(null, { source: 'charge', label: `${ch.label} (centre inactif)`, budget, actual });
      warnings.push(`« ${ch.label} » : centre inactif ou absent, imputée à l'administration.`);
    }
  }

  // ── Personnel : coût employeur (brut + charges patronales) ──
  const legalHours = Number((await db.query(
    `SELECT COALESCE((SELECT NULLIF(monthly_legal_hours, 0) FROM payroll_settings WHERE id = 1), 191) AS h`)).rows[0].h);
  const empRows = (await db.query(
    `WITH pay AS (
       SELECT employee_id, year, month, SUM(gross_salary + COALESCE(total_charges_patron, 0))::float8 AS cost,
              SUM(gross_salary)::float8 AS gross, SUM(COALESCE(total_charges_patron, 0))::float8 AS patron
         FROM payroll WHERE NOT COALESCE(is_provisional, false) GROUP BY 1, 2, 3)
     SELECT e.id, TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')) AS name, e.role,
            COALESCE(e.monthly_salary, e.weekly_salary * 52 / 12.0, 0)::float8 AS salary,
            (SELECT cost FROM pay WHERE pay.employee_id = e.id AND pay.year = $2 AND pay.month = $3) AS actual,
            (SELECT cost FROM pay WHERE pay.employee_id = e.id AND pay.year * 12 + pay.month < $2 * 12 + $3
              ORDER BY pay.year DESC, pay.month DESC LIMIT 1) AS last,
            (SELECT SUM(patron) / NULLIF(SUM(gross), 0) FROM pay) AS patron_ratio
       FROM employees e
      WHERE ($1::uuid IS NULL OR e.store_id IS NULL OR e.store_id = $1)
        AND (e.hire_date IS NULL OR e.hire_date < $5::date)
        AND (e.is_active OR e.exit_date >= $4::date)
        AND (e.exit_date IS NULL OR e.exit_date >= $4::date)
      ORDER BY name`, [storeId, y, m, from, to])).rows;
  const allocRows = (await db.query(
    `SELECT employee_id, cost_center_id, percent::float8 AS percent, labor_type FROM employee_cost_allocations`)).rows;
  const employees: EmployeeCost[] = [];
  for (const e of empRows) {
    const patronRatio = e.patron_ratio != null ? Number(e.patron_ratio) : 0.2;
    const estimate = Number(e.salary) * (1 + patronRatio);
    const budget = e.last != null ? Number(e.last) : e.actual != null ? Number(e.actual) : estimate;
    const actual = e.actual != null ? Number(e.actual) : budget;
    const source: EmployeeCost['source'] = e.actual != null ? 'payroll' : e.last != null ? 'last_payroll' : 'estimate';
    const allocations = allocRows.filter(a => a.employee_id === e.id && centres.has(a.cost_center_id))
      .map(a => ({ centerId: a.cost_center_id as string, percent: a.percent as number, laborType: a.labor_type as 'direct' | 'indirect' }));
    const tot = allocations.reduce((t, a) => t + a.percent, 0);
    const emp: EmployeeCost = { id: e.id, name: e.name || '—', role: e.role, budget: r2(budget), actual: r2(actual), source,
      hourlyRate: r2(budget / legalHours), allocations, unallocated: tot <= 0 };
    employees.push(emp);
    if (budget <= 0 && actual <= 0) continue;
    if (tot <= 0) {
      addLine(null, { source: 'personnel', label: `${emp.name} (non affecté)`, budget: { fixed: budget * ratio, variable: 0 }, actual: { fixed: actual * ratio, variable: 0 } });
      continue;
    }
    for (const a of allocations) {
      const k = a.percent / tot;
      addLine(a.centerId, { source: 'personnel', label: `${emp.name}${a.percent < 100 ? ` (${Math.round(a.percent)} %)` : ''}${a.laborType === 'direct' ? ' — MO directe' : ''}`,
        budget: { fixed: budget * ratio * k, variable: 0 }, actual: { fixed: actual * ratio * k, variable: 0 } });
    }
  }
  const unallocated = employees.filter(e => e.unallocated && e.budget > 0);
  if (unallocated.length) warnings.push(`${unallocated.length} salarié(s) sans centre : coût imputé à l'administration (${unallocated.map(e => e.name).join(', ')}).`);

  // MO directe déjà imputée aux plans par le temps pointé : elle sort du centre (pas de double compte).
  const timed = (await db.query(
    `SELECT e.id AS employee_id, SUM(pie.duree_reelle_min)::float8 AS minutes
       FROM production_item_etapes pie
       JOIN production_plan_items ppi ON ppi.id = pie.plan_item_id
       JOIN production_plans pp ON pp.id = ppi.plan_id
       JOIN employees e ON e.user_id = pie.completed_by
      WHERE pp.store_id IS NOT DISTINCT FROM $1::uuid AND pp.plan_date >= $2::date AND pp.plan_date < $3::date
        AND pie.status = 'completed' AND pie.duree_reelle_min > 0
      GROUP BY e.id`, [storeId, from, to])).rows;
  let timedLabour = 0;
  for (const t of timed) {
    const emp = employees.find(e => e.id === t.employee_id);
    if (!emp) continue;
    const amount = Number(t.minutes) / 60 * emp.hourlyRate;
    timedLabour += amount;
    const direct = emp.allocations.find(a => a.laborType === 'direct') ?? emp.allocations[0];
    addLine(direct?.centerId ?? null, { source: 'direct_labour', label: `${emp.name} — temps pointé imputé en MO directe`,
      budget: { fixed: -amount, variable: 0 }, actual: { fixed: -amount, variable: 0 } });
  }

  // Lot B (mig 657) : temps standard des gammes pour les lignes sans pointage, valorisé au
  // taux horaire chargé moyen de la main-d'œuvre directe ; il sort lui aussi des centres.
  let directCost = 0, paidHours = 0;
  const directByCentre = new Map<string, number>();
  for (const e of employees) for (const a of e.allocations) {
    if (a.laborType !== 'direct') continue;
    const tot = e.allocations.reduce((t, x) => t + x.percent, 0) || 100;
    const k = a.percent / tot;
    directCost += e.budget * k; paidHours += legalHours * k;
    directByCentre.set(a.centerId, (directByCentre.get(a.centerId) ?? 0) + e.budget * k);
  }
  const directRate = paidHours > 0 ? directCost / paidHours : 0;
  const timedHours = timed.reduce((t, x) => t + Number(x.minutes) / 60, 0);
  const stdHours = Number((await db.query(
    `SELECT COALESCE(SUM(s.labor_min), 0)::float8 / 60 AS h
       FROM production_plan_items ppi
       JOIN production_plans pp ON pp.id = ppi.plan_id
       CROSS JOIN LATERAL fn_plan_item_std_minutes(ppi.id) s
      WHERE pp.store_id IS NOT DISTINCT FROM $1::uuid AND pp.plan_date >= $2::date AND pp.plan_date < $3::date
        AND pp.status IN ('in_progress', 'completed') AND ppi.status <> 'cancelled'
        AND NOT EXISTS (SELECT 1 FROM production_item_etapes pie
                         WHERE pie.plan_item_id = ppi.id AND pie.status = 'completed' AND pie.duree_reelle_min > 0)`,
    [storeId, from, to])).rows[0].h) || 0;
  const stdLabour = stdHours * directRate;
  if (stdLabour > 0 && directCost > 0) {
    for (const [centreId, cost] of directByCentre) {
      const amount = stdLabour * cost / directCost;
      addLine(centreId, { source: 'direct_labour', label: 'Temps standard des gammes imputé en MO directe',
        budget: { fixed: -amount, variable: 0 }, actual: { fixed: -amount, variable: 0 } });
    }
  }

  // ── Répartition secondaire : cessions des auxiliaires ──
  const transferRules = (await db.query(
    `SELECT from_center_id, to_center_id, percent::float8 AS percent FROM cost_center_transfers`)).rows as { from_center_id: string; to_center_id: string; percent: number }[];
  const headcount = new Map<string, number>(); const payrollBy = new Map<string, number>();
  for (const e of employees) for (const a of e.allocations) {
    headcount.set(a.centerId, (headcount.get(a.centerId) ?? 0) + a.percent / 100);
    payrollBy.set(a.centerId, (payrollBy.get(a.centerId) ?? 0) + e.budget * a.percent / 100);
  }
  const targetsOf = (c: CentreModel): { id: string; share: number }[] => {
    if (c.transferBasis === 'headcount' || c.transferBasis === 'payroll') {
      const src = c.transferBasis === 'headcount' ? headcount : payrollBy;
      const t = principals.map(p => ({ id: p.id, w: src.get(p.id) ?? 0 })).filter(x => x.w > 0);
      const tot = t.reduce((s, x) => s + x.w, 0);
      return tot > 0 ? t.map(x => ({ id: x.id, share: x.w / tot })) : [];
    }
    const rules = transferRules.filter(r => r.from_center_id === c.id && centres.has(r.to_center_id) && r.to_center_id !== c.id);
    const tot = rules.reduce((s, r) => s + r.percent, 0);
    return tot > 0 ? rules.map(r => ({ id: r.to_center_id, share: r.percent / tot })) : [];
  };
  const bal = new Map<string, { budget: FV; actual: FV }>();
  for (const c of centres.values()) bal.set(c.id, { budget: { ...c.primary.budget }, actual: { ...c.primary.actual } });
  const flows = new Map<string, number>();
  const auxiliaries = [...centres.values()].filter(c => c.kind === 'auxiliaire');
  const noRule = new Set<string>();
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (const aux of auxiliaries) {
      const b = bal.get(aux.id)!;
      if (Math.abs(sumFv(b.budget)) < 0.005 && Math.abs(sumFv(b.actual)) < 0.005) continue;
      let targets = targetsOf(aux);
      if (!targets.length) { if (fallbackCentre) { targets = [{ id: fallbackCentre.id, share: 1 }]; noRule.add(aux.name); } else continue; }
      for (const t of targets) {
        const dst = bal.get(t.id)!;
        addFv(dst.budget, b.budget, t.share); addFv(dst.actual, b.actual, t.share);
        const tc = centres.get(t.id)!;
        addFv(tc.received.budget, b.budget, t.share); addFv(tc.received.actual, b.actual, t.share);
        const k = `${aux.id}>${t.id}`;
        flows.set(k, (flows.get(k) ?? 0) + sumFv(b.budget) * t.share);
      }
      addFv(aux.ceded.budget, b.budget); addFv(aux.ceded.actual, b.actual);
      b.budget = fv(); b.actual = fv();
      moved = true;
    }
    if (!moved) break;
  }
  if (noRule.size) warnings.push(`Centre(s) auxiliaire(s) sans règle de cession, cédé(s) à l'administration : ${[...noRule].join(', ')}.`);
  for (const c of centres.values()) { const b = bal.get(c.id)!; c.pool.budget = b.budget; c.pool.actual = b.actual; }

  // ── Activité et capacité normale ──
  const histFrom = `${addMonths(month, -3)}-01`;
  const totals = await driverTotals(storeId, histFrom, to);
  const cur = totals.get(month) ?? { n: 0, q: zeroDrivers() };
  const hist = [addMonths(month, -3), addMonths(month, -2), addMonths(month, -1)].map(k => totals.get(k)).filter(Boolean) as { n: number; q: DriverQty }[];
  for (const c of principals) {
    c.activity = cur.q[c.driver];
    let normal = c.normalCapacity;
    if (!normal) {
      const vals = hist.map(h => h.q[c.driver]).filter(v => v > 0);
      if (vals.length) { normal = vals.reduce((s, v) => s + v, 0) / vals.length; c.capacitySource = 'history'; }
      else if (c.activity > 0 && elapsedRatio > 0) { normal = c.activity / elapsedRatio; c.capacitySource = 'projection'; }
      else { normal = null; c.capacitySource = 'none'; }
      c.normalCapacity = normal ? r4(normal) : null;
    }
    const normalAtDate = normal ? normal * ratio : 0;
    if (normal && normal > 0) {
      // Taux sur la capacité normale du MOIS ENTIER (charges mensuelles ÷ capacité mensuelle).
      c.rateFixed = ratio > 0 ? c.pool.budget.fixed / ratio / normal : 0;
      c.rateVariable = ratio > 0 ? c.pool.budget.variable / ratio / normal : 0;
    } else if (sumFv(c.pool.budget) > 0) {
      warnings.push(`${c.name} : pas de capacité normale ni d'activité connue (${DRIVERS[c.driver].label}) — ses charges ne sont pas imputées.`);
    }
    c.activityRate = normalAtDate > 0 ? c.activity / normalAtDate : null;
    c.utilisationRate = c.maxCapacity ? c.activity / (c.maxCapacity * ratio || 1) : null;
    c.imputed = { fixed: c.rateFixed * c.activity, variable: c.rateVariable * c.activity };
    // Écart d'activité = charges fixes prévues − charges fixes imputées (positif = sous-activité).
    c.activityVariance = c.pool.budget.fixed - c.imputed.fixed;
    // Écart sur budget = réel − budget flexible (fixe prévu + variable au taux × activité).
    c.budgetVariance = sumFv(c.pool.actual) - (c.pool.budget.fixed + c.imputed.variable);
  }

  // ── Charges directes (produit) ──
  const direct: DirectChargeModel[] = [];
  if (directRows.length) {
    const pq = await productQuantities(storeId, histFrom, to);
    for (const ch of directRows) {
      const budget = split(ch.budget * ratio, ch.behavior, ch.fixed_pct);
      const actual = split((ch.actual ?? ch.budget) * ratio, ch.behavior, ch.fixed_pct);
      const q = pq.get(ch.product_id);
      const activity = q?.get(month) ?? 0;
      let normal = ch.normal_quantity as number | null; let source = 'configured';
      if (!normal) {
        const vals = [addMonths(month, -3), addMonths(month, -2), addMonths(month, -1)].map(k => q?.get(k) ?? 0).filter(v => v > 0);
        if (vals.length) { normal = vals.reduce((s, v) => s + v, 0) / vals.length; source = 'history'; }
        else if (activity > 0 && elapsedRatio > 0) { normal = activity / elapsedRatio; source = 'projection'; }
        else { normal = null; source = 'none'; }
      }
      const rateFixed = normal && ratio > 0 ? budget.fixed / ratio / normal : 0;
      const rateVariable = normal && ratio > 0 ? budget.variable / ratio / normal : 0;
      const imputed = { fixed: rateFixed * activity, variable: rateVariable * activity };
      direct.push({ id: ch.id, label: ch.label, productId: ch.product_id, productName: ch.product_name,
        budget, actual, normalQuantity: normal ? r4(normal) : null, quantitySource: source, activity,
        rateFixed, rateVariable, imputed,
        activityVariance: budget.fixed - imputed.fixed,
        budgetVariance: sumFv(actual) - (budget.fixed + imputed.variable) });
    }
  }

  // ── Totaux et contrôle d'équilibre ──
  const all = [...principals.map(c => ({ actual: sumFv(c.pool.actual), budget: sumFv(c.pool.budget), imp: sumFv(c.imputed), av: c.activityVariance, bv: c.budgetVariance })),
               ...direct.map(d => ({ actual: sumFv(d.actual), budget: sumFv(d.budget), imp: sumFv(d.imputed), av: d.activityVariance, bv: d.budgetVariance }))];
  const actualTotal = all.reduce((s, x) => s + x.actual, 0);
  const budgetTotal = all.reduce((s, x) => s + x.budget, 0);
  const imputedTotal = all.reduce((s, x) => s + x.imp, 0);
  const avTotal = all.reduce((s, x) => s + x.av, 0);
  const bvTotal = all.reduce((s, x) => s + x.bv, 0);
  // Charges de départ = référentiel + personnel − MO déjà imputée par le pointage (toutes lignes primaires).
  const chargesStart = [...centres.values()].reduce((s, c) => s + sumFv(c.primary.actual), 0) + direct.reduce((s, d) => s + sumFv(d.actual), 0);

  const model: PeriodModel = {
    storeId, month, from, to, elapsedRatio: r4(ratio), daysElapsed, daysInMonth, inProgress,
    centres: [...centres.values()], direct, employees,
    transfers: [...flows].map(([k, amount]) => { const [f, t] = k.split('>'); return { from: f, to: t, amount: r2(amount) }; }).filter(x => Math.abs(x.amount) >= 0.01),
    activity: cur.q, plansCount: cur.n, timedLabour: r2(timedLabour),
    directLabour: {
      rate: r4(directRate), paidHours: r2(paidHours * ratio), timedHours: r2(timedHours), standardHours: r2(stdHours),
      imputed: r2(timedLabour + stdLabour),
      unproductiveHours: r2(Math.max(0, paidHours * ratio - timedHours - stdHours)),
    },
    totals: {
      charges: r2(chargesStart), actual: r2(actualTotal), budget: r2(budgetTotal), imputed: r2(imputedTotal),
      activityVariance: r2(avTotal), budgetVariance: r2(bvTotal),
      // Doit valoir 0 : imputé + écarts = charges réelles, et les cessions ne créent ni ne perdent rien.
      control: r2(chargesStart - (imputedTotal + avTotal + bvTotal)),
    },
    warnings,
    computedAt: new Date().toISOString(),
    closed: null,
  };
  cache.set(key, { at: Date.now(), model });
  return model;
}

export interface PlanDirectCosts {
  matieres: number; emballages: number; mainOeuvre: number; energie: number; machine: number; sousTraitance: number;
  prevu: number | null;
}

export interface PlanImputation {
  month: string;
  drivers: DriverQty;
  lines: { centreId: string; code: string; name: string; level: Level; driver: Driver; driverLabel: string; quantity: number;
           rateFixed: number; rateVariable: number; fixed: number; variable: number; total: number }[];
  directLines: { id: string; label: string; productId: string; productName: string; quantity: number; rate: number; fixed: number; variable: number; total: number }[];
  appro: number; production: number; structure: number; directes: number; total: number;
  variableIndirect: number; variableDirect: number;
  methods: { key: string; label: string; total: number | null; note: string }[];
  warnings: string[];
}

/** Charges imputées à un plan par le moteur analytique (imputation rationnelle). */
export async function imputePlan(planId: string, directCosts: PlanDirectCosts): Promise<PlanImputation> {
  const plan = (await db.query(`SELECT store_id, to_char(plan_date, 'YYYY-MM') AS month FROM production_plans WHERE id = $1`, [planId])).rows[0];
  if (!plan) throw new Error('Plan introuvable');
  const month: string = plan.month;
  const model = await periodModel(plan.store_id, month);
  const d = (await db.query(
    `SELECT units::float8, weight_kg::float8, labour_hours::float8, machine_hours::float8, batches::float8,
            material_cost::float8, sales_value::float8
       FROM fn_plan_cost_drivers(NULL, NULL, NULL, $1)`, [planId])).rows[0] ?? {};
  const drivers = zeroDrivers();
  for (const k of DRIVER_KEYS) drivers[k] = Number(d[k]) || 0;
  // La valeur matières du plan = celle que le calcul vient de mesurer (lots + repli).
  drivers.material_cost = directCosts.matieres;

  const lines: PlanImputation['lines'] = [];
  for (const c of model.centres.filter(c => c.kind === 'principal')) {
    const qty = drivers[c.driver];
    const fixed = r2(c.rateFixed * qty), variable = r2(c.rateVariable * qty);
    if (fixed === 0 && variable === 0) continue;
    lines.push({ centreId: c.id, code: c.code, name: c.name, level: c.level, driver: c.driver, driverLabel: DRIVERS[c.driver].label,
      quantity: r4(qty), rateFixed: r4(c.rateFixed), rateVariable: r4(c.rateVariable), fixed, variable, total: r2(fixed + variable) });
  }
  const directLines: PlanImputation['directLines'] = [];
  if (model.direct.length) {
    const q = (await db.query(
      `SELECT product_id, SUM(COALESCE(actual_quantity, planned_quantity))::float8 AS qty
         FROM production_plan_items WHERE plan_id = $1 AND status <> 'cancelled' GROUP BY product_id`, [planId])).rows;
    for (const ch of model.direct) {
      const qty = Number(q.find(x => x.product_id === ch.productId)?.qty ?? 0);
      if (!qty) continue;
      const fixed = r2(ch.rateFixed * qty), variable = r2(ch.rateVariable * qty);
      directLines.push({ id: ch.id, label: ch.label, productId: ch.productId, productName: ch.productName, quantity: qty, rate: r4(ch.rateFixed + ch.rateVariable), fixed, variable, total: r2(fixed + variable) });
    }
  }
  const byLevel = (lv: Level[]) => r2(lines.filter(l => lv.includes(l.level)).reduce((s, l) => s + l.total, 0));
  const appro = byLevel(['approvisionnement']);
  const production = byLevel(['production']);
  const structure = byLevel(['administration', 'distribution']);
  const directes = r2(directLines.reduce((s, l) => s + l.total, 0));
  const total = r2(appro + production + structure + directes);
  const variableIndirect = r2(lines.reduce((s, l) => s + l.variable, 0));
  const variableDirect = r2(directLines.reduce((s, l) => s + l.variable, 0));

  // ── Comparaison des méthodes ──
  const dc = directCosts;
  const directBase = dc.matieres + dc.emballages + dc.mainOeuvre + dc.energie + dc.machine + dc.sousTraitance;
  const principals = model.centres.filter(c => c.kind === 'principal');
  const poolActual = principals.reduce((s, c) => s + sumFv(c.pool.actual), 0);
  const unitsShare = model.activity.units > 0 ? drivers.units / model.activity.units : null;
  // Coût complet « réel » à clé unique : toutes les charges indirectes de la période au prorata des unités.
  const completReel = unitsShare != null ? directBase + directes + poolActual * unitsShare : null;
  // ABC : chaque centre (activité) répartit son coût réel selon son propre inducteur, sur l'activité réelle.
  let abc: number | null = directBase + directes;
  for (const c of principals) {
    const pool = sumFv(c.pool.actual);
    if (pool === 0) continue;
    if (c.activity > 0) abc += pool * drivers[c.driver] / c.activity; else { abc = null; break; }
  }
  const note = model.inProgress ? `mois en cours (${model.daysElapsed}/${model.daysInMonth} jours) : provisoire` : 'mois complet';
  const methods: PlanImputation['methods'] = [
    { key: 'rationnelle', label: 'Coûts complets — imputation rationnelle', total: r2(directBase + total), note: 'Charges fixes sur la capacité normale ; la sous-activité reste en écart de période. Méthode retenue.' },
    { key: 'complet_reel', label: 'Coûts complets réels (clé unique : unités)', total: completReel != null ? r2(completReel) : null, note: `Toutes les charges de la période au prorata des unités produites — ${note}.` },
    { key: 'abc', label: 'Méthode ABC (inducteurs par activité)', total: abc != null ? r2(abc) : null, note: `Chaque centre réparti selon son inducteur sur l'activité réelle — ${note}.` },
    { key: 'variable', label: 'Coûts variables', total: r2(directBase + variableIndirect + variableDirect), note: 'Coûts directs + part variable des charges indirectes ; les charges fixes restent en charges de période.' },
    { key: 'direct', label: 'Coûts directs', total: r2(directBase + directes), note: 'Matières, emballages, MO directe, énergie, machine, façon et charges directes du produit ; aucune charge indirecte.' },
  ];
  if (dc.prevu != null && dc.prevu > 0) methods.push({ key: 'standard', label: 'Coûts standards (fiches techniques)', total: r2(dc.prevu), note: 'Coût prévu figé au lancement du plan (fiches techniques).' });
  return { month, drivers, lines, directLines, appro, production, structure, directes, total, variableIndirect, variableDirect, methods, warnings: model.warnings };
}

/** Taux horaire chargé (coût employeur ÷ heures légales) des salariés, pour la MO directe pointée. */
export async function chargedHourlyRates(planId: string): Promise<{ byEmployee: Map<string, number>; directRate: number }> {
  const plan = (await db.query(`SELECT store_id, to_char(plan_date, 'YYYY-MM') AS month FROM production_plans WHERE id = $1`, [planId])).rows[0];
  if (!plan) return { byEmployee: new Map(), directRate: 0 };
  const model = await periodModel(plan.store_id, plan.month);
  return { byEmployee: new Map(model.employees.map(e => [e.id, e.hourlyRate])), directRate: model.directLabour.rate };
}
