/**
 * G0-15 — écart entre les dotations déjà comptabilisées et le plan dégressif corrigé.
 *
 * LECTURE SEULE : aucune écriture. À lancer sur la base à contrôler :
 *   DATABASE_URL=… npx tsx scripts/diagnose-degressif-ecart.ts
 *
 * Pour chaque immobilisation en dégressif ayant des dotations comptabilisées, compare
 * le cumul comptabilisé au cumul que donne le plan corrigé sur les mêmes mois. L'écart
 * se régularise par une écriture décidée par le comptable, jamais en modifiant le passé.
 */
import { db } from '../src/config/database.js';
import { computeSchedule } from '../src/services/depreciation.service.js';

const r2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const assets = (await db.query(
    `SELECT id, label, acquisition_date, acquisition_cost, residual_value, duration_years, method, status
       FROM fixed_assets WHERE method = 'degressive' ORDER BY acquisition_date`)).rows;
  let total = 0, concerned = 0;
  for (const a of assets) {
    const posted = (await db.query(
      `SELECT fiscal_year, period_month, amount FROM depreciation_entries
        WHERE fixed_asset_id = $1 AND NOT COALESCE(disposal, false)`, [a.id])).rows as
      { fiscal_year: number; period_month: number; amount: string }[];
    if (!posted.length) continue;
    const months = new Set(posted.map(p => p.fiscal_year * 100 + Number(p.period_month)));
    const booked = r2(posted.reduce((s, p) => s + Number(p.amount), 0));
    const planned = r2((computeSchedule(a) as { year: number; month: number; amount: number }[])
      .filter(l => months.has(l.year * 100 + l.month)).reduce((s, l) => s + l.amount, 0));
    const gap = r2(booked - planned);
    if (gap === 0) continue;
    concerned++; total = r2(total + gap);
    console.log(`${a.label} | acquis le ${new Date(a.acquisition_date).toISOString().slice(0, 10)} | ${a.duration_years} ans | ${a.status}`
      + ` | ${posted.length} dotations | comptabilisé ${booked.toFixed(2)} | plan corrigé ${planned.toFixed(2)} | écart ${gap.toFixed(2)} DH`);
  }
  console.log(`\n${assets.length} immobilisation(s) en dégressif, ${concerned} avec un écart, écart cumulé ${total.toFixed(2)} DH`
    + ` (positif = trop amorti à ce jour).`);
  await db.pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
