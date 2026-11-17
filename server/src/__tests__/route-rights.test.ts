/**
 * M2-04 / M2-05 — non-régression des droits par route.
 *
 * Pour chaque route et chaque rôle de base, la décision actuelle (gardes authorize et
 * can, lues dans la pile du routeur Express) est identique à l'instantané pris avant la
 * bascule (fixtures/route-rights.snapshot.json). Pour une garde can('clé'), la décision
 * est celle de l'amorçage : les defaultRoles de la clé (shared PERMISSIONS).
 *
 * Changer un droit volontairement : modifier la route, puis régénérer l'instantané
 *   npx tsx scripts/route-rights-snapshot.ts --write   (depuis server/)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.JWT_SECRET ||= 'test-secret-0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL ||= 'postgres://localhost:5432/kalum_test';

const snapshot: Record<string, string[] | null> = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/route-rights.snapshot.json', import.meta.url)), 'utf8'));

describe('Droits par route : bascule authorize → can sans changement de décision (M2-04)', async () => {
  const { default: router } = await import('../routes/index.js');
  const { collectRouteGuards, allowedBaseRoles } = await import('../utils/route-rights.js');
  const { PERMISSIONS, PERMISSION_ROUTES } = await import('@ofauria/shared');
  const defs = PERMISSIONS as Record<string, { defaultRoles: readonly string[] }>;
  const guards = collectRouteGuards(router as never);

  it('l\'inventaire voit bien les routes', () => {
    expect(guards.length).toBeGreaterThan(1000);
  });

  it('toute clé utilisée par une route existe dans le référentiel', () => {
    const unknown = [...new Set(guards.flatMap(g => g.permissionKeys))].filter(k => !defs[k]);
    expect(unknown).toEqual([]);
  });

  it('chaque route basculée porte la clé prévue à l\'amorçage', () => {
    const routes = PERMISSION_ROUTES as Record<string, string>;
    const wrong = guards.filter(g => g.permissionKeys.length && routes[g.key] && !g.permissionKeys.includes(routes[g.key]))
      .map(g => `${g.key} : ${g.permissionKeys.join(', ')} au lieu de ${routes[g.key]}`);
    expect(wrong).toEqual([]);
  });

  it('pour chaque route, les rôles acceptés sont ceux de l\'instantané', () => {
    const current = Object.fromEntries(guards.map(g => [g.key, allowedBaseRoles(g, k => [...(defs[k]?.defaultRoles ?? [])])]));
    const diffs = [...new Set([...Object.keys(snapshot), ...Object.keys(current)])]
      .filter(k => JSON.stringify(snapshot[k] ?? 'absente') !== JSON.stringify(current[k] ?? 'absente'))
      .map(k => `${k} : instantané ${JSON.stringify(snapshot[k] ?? 'absente')}, actuel ${JSON.stringify(current[k] ?? 'absente')}`);
    expect(diffs, diffs.join('\n')).toEqual([]);
  });
});
