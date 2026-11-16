// Jeu de référence (plan d'action 2026-11, tâche G0-00).
//
// Photographie les CHIFFRES de la base locale avant une tâche qui les touche
// (coût, stock, amortissements, TVA, paie), puis compare après. Tolérance
// nulle : un centime d'écart est signalé.
//
// LECTURE SEULE : le script n'écrit rien en base (transaction READ ONLY).
//
// Usage (depuis server/) :
//   npx tsx scripts/reference-snapshot.ts capture avant-g0
//   npx tsx scripts/reference-snapshot.ts capture apres-g0 --like avant-g0
//   npx tsx scripts/reference-snapshot.ts compare avant-g0 apres-g0
//
//   --like <nom> : reprend les plans, les mois de TVA et les mois de paie de
//                  la capture <nom>, pour comparer le même périmètre même si
//                  de nouvelles données sont arrivées entre-temps.
//
// Sortie : server/scripts/reference/<nom>/*.json (dossier ignoré par git :
// ce sont des données réelles).
//
// Familles :
//   recipe-costs.json   coût de chaque fiche active (fn_recipe_cost), par format
//   plan-yields.json    30 plans clôturés : prévu, produit, pertes, coût réel
//   stock-lots.json     quantités par lot (matière, produit fini, semi-fini)
//                       et par article d'emballage
//   trial-balance.json  balance générale par compte
//   depreciation.json   plan d'amortissement de chaque immobilisation
//   vat.json            déclaration de TVA des 12 derniers mois
//   payroll.json        bulletins des 3 derniers mois (mensuel, hebdo, quinzaine)
//
// `compare` rend le code de sortie 1 s'il y a au moins un écart.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });
const REF_DIR = path.join(here, 'reference');

type Row = Record<string, unknown>;
type Family = { meta?: Row; rows: Record<string, Row> };

const FAMILIES = ['recipe-costs', 'plan-yields', 'stock-lots', 'trial-balance', 'depreciation', 'vat', 'payroll'] as const;

// ─── Outils ──────────────────────────────────────────────────────────
/** Normalise une valeur pour une comparaison exacte et stable. */
function norm(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(norm);
  if (typeof v === 'object') {
    const o: Row = {};
    for (const k of Object.keys(v as Row).sort()) o[k] = norm((v as Row)[k]);
    return o;
  }
  return v;
}
/** Les numériques Postgres arrivent en texte : « 1.50 » et « 1.5000 » sont égaux. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'string' && typeof b === 'string' && /^-?\d+(\.\d+)?$/.test(a) && /^-?\d+(\.\d+)?$/.test(b)) {
    return trimNum(a) === trimNum(b);
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}
function trimNum(s: string): string {
  let r = s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  if (r === '-0') r = '0';
  return r;
}
function toMap(rows: Row[], key: (r: Row) => string): Record<string, Row> {
  const out: Record<string, Row> = {};
  for (const r of rows) out[key(r)] = norm(r) as Row;
  return out;
}
function readFamily(name: string, family: string): Family | null {
  const f = path.join(REF_DIR, name, `${family}.json`);
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf-8')) as Family) : null;
}

// ─── Capture ─────────────────────────────────────────────────────────
async function capture(name: string, like: string | null) {
  const url = process.env.DATABASE_URL ?? '';
  if (!url) throw new Error('DATABASE_URL absent.');
  const conn = new pg.Client({ connectionString: url });
  await conn.connect();
  await conn.query(`SET TIME ZONE 'Africa/Casablanca'`);
  await conn.query('BEGIN TRANSACTION READ ONLY');
  const q = async (sql: string, params: unknown[] = []) => (await conn.query(sql, params)).rows as Row[];
  const out = path.join(REF_DIR, name);
  fs.mkdirSync(out, { recursive: true });
  const write = (family: string, data: Family) => {
    fs.writeFileSync(path.join(out, `${family}.json`), JSON.stringify(data, null, 1) + '\n');
    console.log(`  ✓ ${family}.json — ${Object.keys(data.rows).length} lignes`);
  };
  const likeMeta = (family: string): Row | null => (like ? readFamily(like, family)?.meta ?? null : null);

  console.log(`Capture « ${name} » sur ${url.replace(/\/\/[^@]*@/, '//***@')}`);

  // 1. Coût des fiches actives, par format (et sans format).
  {
    const targets = await q(
      `SELECT r.id AS recipe_id, r.name, NULL::uuid AS format_id FROM recipes r WHERE r.archived_at IS NULL
       UNION ALL
       SELECT r.id, r.name, f.id FROM recipes r JOIN recipe_formats f ON f.recipe_id = r.id AND f.is_active
        WHERE r.archived_at IS NULL
       ORDER BY 1, 3 NULLS FIRST`);
    const rows: Row[] = [];
    for (const t of targets) {
      await conn.query('SAVEPOINT rc');
      try {
        const c = await q(`SELECT * FROM fn_recipe_cost($1, $2)`, [t.recipe_id, t.format_id]);
        rows.push({ ...t, ...(c[0] ?? { vide: true }) });
        await conn.query('RELEASE SAVEPOINT rc');
      } catch (e) {
        await conn.query('ROLLBACK TO SAVEPOINT rc');
        rows.push({ ...t, erreur: (e as Error).message });
      }
    }
    write('recipe-costs', { rows: toMap(rows, r => `${r.recipe_id}|${r.format_id ?? '-'}`) });
  }

  // 2. Trente plans clôturés : 10 récents, 10 de semi-finis, 10 avec coupe.
  {
    let planIds = (likeMeta('plan-yields')?.plan_ids as string[] | undefined) ?? null;
    if (!planIds) {
      const pick = async (cond: string) => (await q(
        `SELECT p.id FROM production_plans p WHERE p.status = 'completed' AND ${cond}
          ORDER BY p.completed_at DESC NULLS LAST, p.id LIMIT 10`)).map(r => r.id as string);
      const recent = await pick('NOT COALESCE(p.is_semi_finished_plan, false)');
      const semi = await pick('COALESCE(p.is_semi_finished_plan, false)');
      const coupe = await pick(`EXISTS (SELECT 1 FROM production_plan_items i
                                         JOIN production_item_outputs o ON o.plan_item_id = i.id WHERE i.plan_id = p.id)`);
      planIds = [...new Set([...recent, ...semi, ...coupe])].sort();
    }
    const rows: Row[] = [];
    rows.push(...(await q(
      `SELECT 'item' AS kind, i.plan_id, i.id AS ref, i.product_id, i.format_id, i.planned_quantity, i.actual_quantity,
              i.status, i.theo_cout_matiere_u, i.theo_cout_complet_u, i.theo_prix_u
         FROM production_plan_items i WHERE i.plan_id = ANY($1::uuid[])`, [planIds])));
    rows.push(...(await q(
      `SELECT 'rendement' AS kind, v.plan_id, v.plan_item_id AS ref, v.theorique_brut_g, v.theorique_net_unites,
              v.quantite_brute_kg, v.quantite_nette_reelle, v.pertes_total, v.rendement_brut_pct,
              v.rendement_net_unites_pct, v.cout_prevu_unite, v.cout_prevu_total, v.cout_reel_unite_estime, v.ecart_cout_estime
         FROM v_plan_item_rendement v WHERE v.plan_id = ANY($1::uuid[])`, [planIds])));
    rows.push(...(await q(
      `SELECT 'pertes' AS kind, l.production_plan_id AS plan_id, l.production_plan_id AS ref,
              COUNT(*)::int AS nb, SUM(l.quantity) AS quantite, SUM(l.total_cost) AS cout
         FROM product_losses l WHERE l.production_plan_id = ANY($1::uuid[]) GROUP BY l.production_plan_id`, [planIds])));
    rows.push(...(await q(
      `SELECT 'cout_reel' AS kind, c.plan_id, c.plan_id AS ref, c.cout_matieres, c.cout_main_oeuvre, c.cout_energie,
              c.cout_pertes, c.cout_charges_fixes, c.cout_prevu, c.cout_prevu_mix_reel, c.ecart_pct, c.ecart_mix, c.cout_total
         FROM production_cout_reel c WHERE c.plan_id = ANY($1::uuid[])`, [planIds])));
    rows.push(...(await q(
      `SELECT 'emballage' AS kind, t.reference_id AS plan_id, t.packaging_id AS ref, t.type,
              COUNT(*)::int AS nb_mouvements, SUM(t.quantity_change) AS quantite
         FROM packaging_stock_transactions t
        WHERE t.reference_id = ANY($1::uuid[]) GROUP BY t.reference_id, t.packaging_id, t.type`, [planIds])));
    write('plan-yields', { meta: { plan_ids: planIds }, rows: toMap(rows, r => `${r.kind}|${r.plan_id}|${r.ref}${r.type ? `|${r.type}` : ''}`) });
  }

  // 3. Stock par lot et par article d'emballage.
  {
    const rows: Row[] = [];
    rows.push(...(await q(
      `SELECT 'matiere' AS kind, id AS ref, ingredient_id, store_id, quantity_received, quantity_remaining,
              economat_quantity, pesage_quantity, unit_cost, status FROM ingredient_lots`)));
    rows.push(...(await q(
      `SELECT 'produit' AS kind, id AS ref, product_id, store_id, quantity_total, backroom_qty, vitrine_qty,
              sold_qty, wasted_qty, recycled_qty, unit_cost, status FROM product_lots`)));
    rows.push(...(await q(
      `SELECT 'semi_fini' AS kind, id AS ref, recipe_id, store_id, quantity_produced, quantity_remaining, unit, status
         FROM semi_finished_lots`)));
    rows.push(...(await q(
      `SELECT 'emballage' AS kind, id AS ref, packaging_id, store_id, stock_quantity FROM packaging_store_stock`)));
    write('stock-lots', { rows: toMap(rows, r => `${r.kind}|${r.ref}`) });
  }

  // 4. Balance générale par compte.
  {
    const rows = await q(
      `SELECT a.code, a.label, COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit,
              COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS solde
         FROM journal_entry_lines l
         JOIN journal_entries e ON e.id = l.journal_entry_id AND e.status IN ('posted', 'reversed')
         JOIN accounts a ON a.id = l.account_id
        GROUP BY a.code, a.label`);
    write('trial-balance', { rows: toMap(rows, r => String(r.code)) });
  }

  // 5. Plan d'amortissement complet de chaque immobilisation (calcul du code).
  {
    const { computeSchedule } = await import('../src/services/depreciation.service.js');
    const assets = await q(
      `SELECT id, label, acquisition_date::text AS acquisition_date, acquisition_cost, residual_value, duration_years, method
         FROM fixed_assets`);
    const rows: Row[] = [];
    for (const a of assets) {
      const sched = computeSchedule(a as never);
      for (const l of sched) rows.push({ asset_id: a.id, label: a.label, year: l.year, month: l.month, amount: l.amount, cumulated: l.cumulated, vnc: l.vnc });
      rows.push({ asset_id: a.id, label: a.label, year: 0, month: 0, lignes: sched.length, total: sched.reduce((s, l) => Math.round((s + l.amount) * 100) / 100, 0) });
    }
    const posted = await q(
      `SELECT fixed_asset_id AS asset_id, 'comptabilise' AS label, fiscal_year AS year, period_month AS month, SUM(amount) AS amount
         FROM depreciation_entries GROUP BY 1, 3, 4`);
    write('depreciation', {
      rows: {
        ...toMap(rows, r => `plan|${r.asset_id}|${r.year}-${String(r.month).padStart(2, '0')}`),
        ...toMap(posted, r => `ecriture|${r.asset_id}|${r.year}-${String(r.month).padStart(2, '0')}`),
      },
    });
  }

  // 6. Déclaration de TVA des 12 derniers mois révolus (calcul du code).
  {
    let months = (likeMeta('vat')?.months as string[] | undefined) ?? null;
    if (!months) {
      months = (await q(
        `SELECT to_char(m, 'YYYY-MM') AS ym
           FROM generate_series(date_trunc('month', CURRENT_DATE) - interval '12 months',
                                date_trunc('month', CURRENT_DATE) - interval '1 month', interval '1 month') m
          ORDER BY 1`)).map(r => r.ym as string);
    }
    // Le dépôt de données ouvre son propre pool : on le pointe sur la même base.
    const { tvaDeclarationRepository } = await import('../src/repositories/ledger.repository.js');
    const rows: Row[] = [];
    for (const ym of months) {
      const [y, m] = ym.split('-').map(Number);
      const startDate = `${ym}-01`;
      const endDate = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      const d = await tvaDeclarationRepository.declaration({ startDate, endDate });
      rows.push({ ym, declaration: d });
    }
    write('vat', { meta: { months }, rows: toMap(rows, r => String(r.ym)) });
  }

  // 7. Paie des 3 derniers mois présents en base.
  {
    let months = (likeMeta('payroll')?.months as string[] | undefined) ?? null;
    if (!months) {
      months = (await q(
        `SELECT DISTINCT year || '-' || lpad(month::text, 2, '0') AS ym FROM payroll ORDER BY 1 DESC LIMIT 3`)).map(r => r.ym as string).sort();
    }
    const rows: Row[] = [];
    rows.push(...(await q(
      `SELECT 'mensuel' AS kind, id AS ref, employee_id, year, month, base_salary, worked_days, absent_days, overtime_amount,
              bonuses, gross_salary, cnss_employee, amo_employee, cimr_employee, ir_net, advance_deduction, other_deductions,
              net_salary, total_charges_patron, paid
         FROM payroll WHERE year || '-' || lpad(month::text, 2, '0') = ANY($1::text[])`, [months])));
    if (months.length) {
      const from = `${months[0]}-01`;
      const last = months[months.length - 1].split('-').map(Number);
      const to = new Date(Date.UTC(last[0], last[1], 0)).toISOString().slice(0, 10);
      rows.push(...(await q(
        `SELECT 'hebdo' AS kind, id AS ref, employee_id, week_start::text, week_end::text, base_amount, worked_days,
                gross_amount, withholding_amount, advance_deduction, net_amount, paid
           FROM weekly_payroll WHERE week_start BETWEEN $1 AND $2`, [from, to])));
      rows.push(...(await q(
        `SELECT 'quinzaine' AS kind, id AS ref, employee_id, period_start::text, period_end::text, base_amount, worked_days,
                gross_amount, withholding_amount, advance_deduction, net_amount, paid
           FROM biweekly_payroll WHERE period_start BETWEEN $1 AND $2`, [from, to])));
    }
    write('payroll', { meta: { months }, rows: toMap(rows, r => `${r.kind}|${r.ref}`) });
  }

  await conn.query('ROLLBACK');
  await conn.end();
  console.log(`Capture écrite dans ${out}`);
}

// ─── Comparaison ─────────────────────────────────────────────────────
function compare(a: string, b: string): number {
  let total = 0;
  for (const family of FAMILIES) {
    const fa = readFamily(a, family);
    const fb = readFamily(b, family);
    if (!fa || !fb) {
      console.log(`✗ ${family} : fichier absent (${!fa ? a : b})`);
      total++;
      continue;
    }
    const diffs: string[] = [];
    const keys = new Set([...Object.keys(fa.rows), ...Object.keys(fb.rows)]);
    for (const k of [...keys].sort()) {
      const ra = fa.rows[k], rb = fb.rows[k];
      if (!ra) { diffs.push(`  + ${k} : présent seulement dans ${b}`); continue; }
      if (!rb) { diffs.push(`  - ${k} : présent seulement dans ${a}`); continue; }
      for (const f of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
        if (!sameValue(ra[f], rb[f])) {
          diffs.push(`  ≠ ${k} · ${f} : ${JSON.stringify(ra[f])} → ${JSON.stringify(rb[f])}`);
        }
      }
    }
    if (diffs.length) {
      console.log(`✗ ${family} : ${diffs.length} écart(s)`);
      for (const d of diffs.slice(0, 200)) console.log(d);
      if (diffs.length > 200) console.log(`  … ${diffs.length - 200} autres`);
    } else {
      console.log(`✓ ${family} : identique (${Object.keys(fa.rows).length} lignes)`);
    }
    total += diffs.length;
  }
  console.log(total ? `\n${total} écart(s) entre « ${a} » et « ${b} ».` : `\nZéro écart entre « ${a} » et « ${b} ».`);
  return total ? 1 : 0;
}

// ─── Entrée ──────────────────────────────────────────────────────────
const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'capture' && args[0]) {
  const likeIdx = args.indexOf('--like');
  await capture(args[0], likeIdx >= 0 ? args[likeIdx + 1] ?? null : null);
  process.exit(0);
} else if (cmd === 'compare' && args[0] && args[1]) {
  process.exit(compare(args[0], args[1]));
} else {
  console.log('Usage : reference-snapshot.ts capture <nom> [--like <autre>] | compare <nomA> <nomB>');
  process.exit(2);
}
