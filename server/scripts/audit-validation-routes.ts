// G0-07 (plan d'action 2026-11) — mutations sans schéma de validation.
//
// Lit le code des routes (analyse statique, aucune base) et liste les POST / PUT /
// PATCH dont la déclaration ne passe ni par validate(...) ni par un .parse( en
// ligne. Les DELETE (sans corps) ne sont pas comptés.
//
// Usage (depuis server/) :
//   npx tsx scripts/audit-validation-routes.ts            # synthèse par fichier
//   npx tsx scripts/audit-validation-routes.ts --list     # toutes les routes
//   npx tsx scripts/audit-validation-routes.ts --write    # régénère la liste blanche du test
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scanRoutes } from '../src/utils/route-scan.js';

const ROUTES = fileURLToPath(new URL('../src/routes/', import.meta.url));
const ALLOWLIST = fileURLToPath(new URL('../src/__tests__/fixtures/unvalidated-mutations.json', import.meta.url));

const routes = scanRoutes(ROUTES).filter(r => r.method !== 'DELETE');
const missing = routes.filter(r => !r.validated);

const byFile = new Map<string, { ok: number; ko: number }>();
for (const r of routes) {
  const e = byFile.get(r.file) ?? { ok: 0, ko: 0 };
  if (r.validated) e.ok++; else e.ko++;
  byFile.set(r.file, e);
}
console.log(`Mutations avec corps : ${routes.length} — avec schéma : ${routes.length - missing.length}, sans schéma : ${missing.length}\n`);
for (const [file, e] of [...byFile.entries()].filter(([, e]) => e.ko > 0).sort((a, b) => b[1].ko - a[1].ko)) {
  console.log(`  ${String(e.ko).padStart(3)} / ${String(e.ok + e.ko).padEnd(3)} ${file}`);
}
if (process.argv.includes('--list')) {
  console.log('');
  for (const r of missing) console.log(`  ${r.key}`);
}
if (process.argv.includes('--write')) {
  writeFileSync(ALLOWLIST, JSON.stringify(missing.map(r => r.key).sort(), null, 1) + '\n');
  console.log(`\nListe blanche régénérée : ${missing.length} entrées.`);
}
