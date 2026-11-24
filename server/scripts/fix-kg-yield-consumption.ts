/**
 * Régularise les sorties de matières des plans semi-finis au kilo, sous-estimées avant le
 * correctif du 2026-11-24 (diviseur nb_par_defaut au lieu de rendement_kg). Voir
 * src/services/kg-yield-correction.ts.
 *
 *   npx tsx scripts/fix-kg-yield-consumption.ts            → simulation : liste, rien n'est écrit
 *   npx tsx scripts/fix-kg-yield-consumption.ts --apply    → sort les compléments
 *   --by <email>  : utilisateur inscrit sur les mouvements (sinon aucun)
 *
 * Rejouable : un plan déjà régularisé (mouvement portant la mention de correction) est ignoré.
 */
import { db } from '../src/config/database.js';
import { planKgYieldCorrections, applyKgYieldCorrections } from '../src/services/kg-yield-correction.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const byIdx = args.indexOf('--by');
const byEmail = byIdx >= 0 ? args[byIdx + 1] : null;
const fr = (n: number, d = 3) => n.toLocaleString('fr-FR', { maximumFractionDigits: d });

async function main() {
  const client = await db.getClient();
  try {
    const plans = await planKgYieldCorrections(client);
    if (!plans.length) { console.log('Aucun plan semi-fini au kilo à régulariser.'); return; }

    const totals = new Map<string, { name: string; unit: string; qty: number; value: number; stock: number }>();
    for (const p of plans) {
      console.log(`\n${p.ofNumber ?? p.planId.slice(0, 8)} · ${p.planDate} · ${p.recipeName} ${fr(p.producedQty)} ${p.yieldUnit}` +
        ` — fournée de ${fr(p.divisorNew)} kg (comptée ${fr(p.divisorOld)})`);
      for (const l of p.lines) {
        console.log(`   ${l.ingredientName.padEnd(28)} sorti ${fr(l.recorded).padStart(9)} · attendu ${fr(l.expected).padStart(9)} · à sortir ${fr(l.delta).padStart(9)} ${l.unit}`);
        const t = totals.get(l.ingredientId) ?? { name: l.ingredientName, unit: l.unit, qty: 0, value: 0, stock: l.stock };
        t.qty += l.delta; t.value += l.delta * l.unitCost; totals.set(l.ingredientId, t);
      }
    }
    console.log(`\n── Total à sortir (${plans.length} plan(s)) ──`);
    let value = 0;
    for (const t of [...totals.values()].sort((a, b) => b.value - a.value)) {
      value += t.value;
      const short = t.qty > t.stock ? `  ⚠ stock actuel ${fr(t.stock)} ${t.unit}` : '';
      console.log(`   ${t.name.padEnd(28)} ${fr(t.qty).padStart(10)} ${t.unit.padEnd(5)} ≈ ${fr(t.value, 2)} DH${short}`);
    }
    console.log(`   Valeur estimée (coût unitaire de la fiche matière) : ≈ ${fr(value, 2)} DH`);

    if (!apply) { console.log('\nSimulation : rien n\'a été écrit. Relancer avec --apply pour sortir ces quantités.'); return; }

    const userId = byEmail ? (await client.query(`SELECT id FROM users WHERE email = $1`, [byEmail])).rows[0]?.id ?? null : null;
    const shortages = await applyKgYieldCorrections(client, plans, userId);
    console.log(`\nAppliqué : ${plans.length} plan(s) régularisé(s).`);
    for (const s of shortages) console.log(`   ⚠ manque ${s.ingredientName} : ${fr(s.missing)} ${s.unit} (stock ramené à 0)`);
  } finally {
    client.release();
    await db.pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
