// M5-03 — reprise des étapes JSON des fiches en gammes opératoires.
//
// Usage (depuis server/) :
//   npx tsx scripts/etapes-to-routings.ts            rapport seul (lecture), rien n'est écrit
//   npx tsx scripts/etapes-to-routings.ts --apply    crée les gammes des fiches qui n'en ont pas
//   ... --recipe <uuid> [--recipe <uuid>]            limite à certaines fiches
//
// La création des gammes ne change rien à l'atelier : il continue de lire les étapes JSON
// tant que la politique production.steps_source vaut « json » pour lui (bascule atelier par
// atelier, après validation par le chef, dans Production › Paramétrage › Politiques).
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const { routingRepriseRepository } = await import('../src/repositories/routing-reprise.repository.js');
const { db } = await import('../src/config/database.js');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const recipeIds = args.flatMap((a, i) => (a === '--recipe' && args[i + 1] ? [args[i + 1]] : []));

const lines = await routingRepriseRepository.report(recipeIds.length ? recipeIds : undefined);
console.log(`Fiches avec étapes : ${lines.length}`);
for (const l of lines) {
  const flags = [l.steps_without_duration ? `${l.steps_without_duration} sans durée` : '', `${l.steps_without_work_center} sans poste`].filter(Boolean).join(', ');
  console.log(`${l.action === 'creer' ? '+' : '='} ${l.recipe_name} — ${l.steps} étape(s) ; ${flags}${l.action === 'deja_une_gamme' ? ' ; déjà une gamme active' : ''}`);
}
const toCreate = lines.filter(l => l.action === 'creer').length;
console.log(`\nÀ créer : ${toCreate} gamme(s) ; déjà une gamme : ${lines.length - toCreate}.`);
console.log('À compléter après reprise : poste de travail de chaque opération, temps unitaires, durées manquantes.');

if (apply) {
  const created = await routingRepriseRepository.apply(null, recipeIds.length ? recipeIds : undefined);
  console.log(`\nCréé : ${created.length} gamme(s), ${created.reduce((t, c) => t + c.operations, 0)} opération(s).`);
} else {
  console.log('\nRapport seul : relancer avec --apply pour créer les gammes.');
}
await db.pool.end();
