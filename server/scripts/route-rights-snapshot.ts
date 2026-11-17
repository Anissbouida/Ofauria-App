// M2-04 — instantané des droits par route : pour chaque « MÉTHODE /chemin », les rôles
// de base acceptés (null = tout utilisateur connecté). Référence du test de
// non-régression src/__tests__/route-rights.test.ts : la bascule authorize → can
// (M2-05) ne doit changer aucune décision.
//
// Usage (depuis server/) : npx tsx scripts/route-rights-snapshot.ts [--write]
// Sans --write : affiche les écarts entre l'état actuel et l'instantané.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.JWT_SECRET ||= 'snapshot-'.padEnd(40, 'x');
process.env.DATABASE_URL ||= 'postgres://localhost:5432/kalum_test';
const { default: router } = await import('../src/routes/index.js');
const { collectRouteGuards, allowedBaseRoles } = await import('../src/utils/route-rights.js');
const { PERMISSIONS } = await import('@ofauria/shared');

const FILE = fileURLToPath(new URL('../src/__tests__/fixtures/route-rights.snapshot.json', import.meta.url));
const defaults = (k: string) => (PERMISSIONS as Record<string, { defaultRoles: readonly string[] }>)[k]?.defaultRoles as string[] ?? [];
const current: Record<string, string[] | null> = {};
for (const g of collectRouteGuards(router as never).sort((a, b) => a.key.localeCompare(b.key))) {
  current[g.key] = allowedBaseRoles(g, defaults);
}
if (process.argv.includes('--write')) {
  writeFileSync(FILE, JSON.stringify(current, null, 1) + '\n');
  console.log(`${Object.keys(current).length} routes écrites dans ${FILE}`);
} else {
  const snap = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, string[] | null>;
  const diffs = [...new Set([...Object.keys(snap), ...Object.keys(current)])]
    .filter(k => JSON.stringify(snap[k] ?? 'absente') !== JSON.stringify(current[k] ?? 'absente'))
    .map(k => `${k}  instantané=${JSON.stringify(snap[k] ?? 'absente')}  actuel=${JSON.stringify(current[k] ?? 'absente')}`);
  console.log(diffs.length ? diffs.join('\n') : 'Aucun écart.');
}
process.exit(0);
