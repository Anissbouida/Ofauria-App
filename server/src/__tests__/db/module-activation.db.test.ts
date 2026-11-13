/**
 * Activation des modules et options (mig 507, plan Production générique P0a).
 * Le secteur est un préréglage ; les ajustements ne stockent que les écarts ;
 * dépendances et modules socle sont contrôlés ; la garde serveur ferme l'API
 * d'un module désactivé, administrateur compris ; les données ne sont pas touchées.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories } from './helpers.js';

describe.skipIf(!hasTestDb)('Activation des modules et options', () => {
  let sectors: typeof import('../../repositories/sector.repository.js').sectorRepository;
  let guard: typeof import('../../middleware/module-activation.middleware.js').moduleActivationGuard;
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let initial = 'boulangerie';

  const clearAdjustments = async () => {
    await testPool().query(`DELETE FROM company_module_settings`);
    await testPool().query(`DELETE FROM company_feature_settings`);
    sectors.invalidate();
  };

  /** Passe une requête dans la garde ; renvoie le statut (200 = laissée passer). */
  const callGuard = (method: string, path: string) => new Promise<number>((resolve, reject) => {
    const res = { status: (code: number) => ({ json: () => resolve(code) }) };
    guard({ method, path } as never, res as never, (err?: unknown) => (err ? reject(err) : resolve(200)));
  });

  beforeAll(async () => {
    repos = await importRepositories();
    sectors = (await import('../../repositories/sector.repository.js')).sectorRepository;
    guard = (await import('../../middleware/module-activation.middleware.js')).moduleActivationGuard;
    initial = (await sectors.current()).code;
  });

  beforeEach(async () => {
    await clearAdjustments();
    await sectors.setSector('generique', { keepAdjustments: false });
  });

  afterAll(async () => {
    await clearAdjustments().catch(() => undefined);
    await testPool().query(`UPDATE company_settings SET sector_pack = $1 WHERE id = 1`, [initial]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('sans ajustement, les modules effectifs sont ceux du secteur (socle toujours présent)', async () => {
    const act = await sectors.activation();
    expect(act.modules.has('production')).toBe(false);
    expect(act.modules.has('sales')).toBe(true);
    for (const m of ['dashboard', 'settings', 'users'] as const) expect(act.modules.has(m)).toBe(true);
    expect(act.features.size).toBe(0);
  });

  it('active Production en générique, et ne stocke que les écarts', async () => {
    const r = await sectors.applyAdjustments({ modules: { production: true, recipes: true } });
    expect('error' in r).toBe(false);
    const act = await sectors.activation();
    expect(act.modules.has('production')).toBe(true);
    expect(act.modules.has('recipes')).toBe(true);
    const { rows } = await testPool().query(`SELECT module_key, enabled FROM company_module_settings ORDER BY 1`);
    expect(rows).toEqual([{ module_key: 'production', enabled: true }, { module_key: 'recipes', enabled: true }]);

    // Remettre la valeur du préréglage efface l'écart au lieu de le stocker.
    await sectors.applyAdjustments({ modules: { crm: true } });
    expect((await testPool().query(`SELECT 1 FROM company_module_settings WHERE module_key = 'crm'`)).rowCount).toBe(0);
  });

  it('refuse une dépendance manquante, un module socle désactivé, une clé inconnue', async () => {
    const dep = await sectors.applyAdjustments({ modules: { production: true } });
    expect('error' in dep && dep.error).toMatch(/Fiches techniques/);
    const core = await sectors.applyAdjustments({ modules: { settings: false } });
    expect('error' in core && core.error).toMatch(/ne peut pas être désactivé/);
    const unknown = await sectors.applyAdjustments({ modules: { fusee: true } });
    expect('error' in unknown && unknown.error).toMatch(/inconnu/);
    const feature = await sectors.applyAdjustments({ features: { inexistante: true } });
    expect('error' in feature && feature.error).toMatch(/inconnue/);
    expect((await testPool().query(`SELECT 1 FROM company_module_settings`)).rowCount).toBe(0);
  });

  it("une option n'est effective que si son module l'est", async () => {
    await sectors.applyAdjustments({ features: { dlc_jour: true } });
    expect((await sectors.activation()).features.has('dlc_jour')).toBe(false);
    await sectors.applyAdjustments({ modules: { production: true, recipes: true } });
    expect((await sectors.activation()).features.has('dlc_jour')).toBe(true);
  });

  it('désactiver le Stock retire aussi ses alias (packaging)', async () => {
    // Générique contient « packaging » (alias du Stock) : il ne doit pas le maintenir actif.
    const r = await sectors.applyAdjustments({ modules: { stock: false } });
    expect('error' in r).toBe(false);
    const act = await sectors.activation();
    expect(act.modules.has('stock')).toBe(false);
    expect(act.modules.has('packaging' as never)).toBe(false);
  });

  it('changement de secteur : garde ou efface les ajustements', async () => {
    await sectors.applyAdjustments({ modules: { production: true, recipes: true } });
    await sectors.setSector('negoce', { keepAdjustments: true });
    expect((await sectors.activation()).modules.has('production')).toBe(true);
    await sectors.setSector('negoce', { keepAdjustments: false });
    expect((await sectors.activation()).modules.has('production')).toBe(false);
  });

  it('retour au préréglage : supprime tous les écarts', async () => {
    await sectors.applyAdjustments({ modules: { production: true, recipes: true }, features: { haccp: true } });
    const act = await sectors.resetAdjustments();
    expect(Object.keys(act.moduleOverrides)).toHaveLength(0);
    expect(Object.keys(act.featureOverrides)).toHaveLength(0);
    expect(act.modules.has('production')).toBe(false);
  });

  it("la garde serveur ferme l'API d'un module désactivé et la rouvre à l'activation", async () => {
    expect(await callGuard('GET', '/production/plans')).toBe(403);
    expect(await callGuard('POST', '/recipes')).toBe(403);
    expect(await callGuard('GET', '/sales')).toBe(200);
    expect(await callGuard('GET', '/auth/me')).toBe(200); // hors table : non concerné
    await sectors.applyAdjustments({ modules: { production: true, recipes: true } });
    expect(await callGuard('GET', '/production/plans')).toBe(200);
    expect(await callGuard('POST', '/recipes')).toBe(200);
  });

  it("une option éteinte ferme ses routes (HACCP)", async () => {
    await sectors.setSector('boulangerie', { keepAdjustments: false });
    expect(await callGuard('GET', '/haccp/logs')).toBe(200);
    await sectors.applyAdjustments({ features: { haccp: false } });
    expect(await callGuard('GET', '/haccp/logs')).toBe(403);
    expect(await callGuard('GET', '/production/plans')).toBe(200);
  });
});
