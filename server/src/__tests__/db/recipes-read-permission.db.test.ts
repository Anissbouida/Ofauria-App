/**
 * Scénario 1, constat 105 — la lecture des fiches techniques demande un droit.
 *  - `recipes.view` amorcé pour la production, le magasin et la direction, pas pour la caisse ;
 *  - les routes de lecture des fiches portent la garde (sauf les deux listes de référence).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hasTestDb, closeTestPool, importRepositories } from './helpers.js';

describe.skipIf(!hasTestDb)('Lecture des fiches techniques (recipes.view)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let perms: typeof import('../../services/permissions.js');

  beforeAll(async () => {
    repos = await importRepositories();
    perms = await import('../../services/permissions.js');
    await perms.seedPermissions();
    perms.invalidatePermissionCaches();
  }, 60_000);

  afterAll(async () => {
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('la caisse ne lit pas les fiches ; production, magasin et direction oui', async () => {
    for (const role of ['cashier', 'saleswoman']) {
      expect(await perms.permissionsOfRole(role), role).not.toContain('recipes.view');
    }
    for (const role of ['admin', 'manager', 'baker', 'pastry_chef', 'viennoiserie', 'beldi_sale', 'magasinier']) {
      expect(await perms.permissionsOfRole(role), role).toContain('recipes.view');
    }
  });

  it('toutes les routes de lecture des fiches sont gardées', () => {
    const src = readFileSync(fileURLToPath(new URL('../../routes/recipes.routes.ts', import.meta.url)), 'utf8');
    const open = src.split('\n')
      .filter(l => l.startsWith('router.get(') && !l.includes('can('))
      .map(l => l.split("'")[1]);
    expect(open.sort()).toEqual(['/categories', '/component-roles']);
  });
});
