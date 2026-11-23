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
    await testPool().query(`DELETE FROM config_versions`);
    await testPool().query(`DELETE FROM company_module_pilots`);
    await testPool().query(`DELETE FROM store_module_settings`);
    sectors.invalidate();
  };

  /** Passe une requête dans la garde ; renvoie le statut (200 = laissée passer). */
  const callGuard = (method: string, path: string) => new Promise<number>((resolve, reject) => {
    const res = { status: (code: number) => ({ json: () => resolve(code) }) };
    guard({ method, path, headers: {}, cookies: {} } as never, res as never, (err?: unknown) => (err ? reject(err) : resolve(200)));
  });

  beforeAll(async () => {
    repos = await importRepositories();
    sectors = (await import('../../repositories/sector.repository.js')).sectorRepository;
    guard = (await import('../../middleware/module-activation.middleware.js')).moduleActivationGuard;
    initial = (await sectors.current()).code;
  });

  beforeEach(async () => {
    await sectors.setSector('generique', { keepAdjustments: false });
    await clearAdjustments(); // après : le changement de secteur crée lui-même des versions
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
    // Aucune option hors du socle commun (capacités default_on, mig 632).
    const socle = new Set(act.catalog.filter(f => f.default_on).map(f => f.key));
    expect([...act.features].filter(k => !socle.has(k))).toEqual([]);
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

  it('changement de secteur en gardant les ajustements : les écarts redondants disparaissent', async () => {
    await sectors.applyAdjustments({ modules: { production: true, recipes: true } });
    await sectors.setSector('boulangerie', { keepAdjustments: true });
    // Boulangerie contient déjà Production et Fiches techniques : plus d'écart stocké.
    expect((await testPool().query(`SELECT 1 FROM company_module_settings`)).rowCount).toBe(0);
    expect((await sectors.activation()).modules.has('production')).toBe(true);
  });

  it('aperçu : calcule le changement sans rien écrire', async () => {
    const plan = await sectors.planAdjustments({ modules: { production: true, recipes: true, crm: false } });
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    expect(plan.diff.modulesOn.sort()).toEqual(['production', 'recipes']);
    expect(plan.diff.modulesOff).toEqual(['crm']);
    expect((await testPool().query(`SELECT 1 FROM company_module_settings`)).rowCount).toBe(0);
    expect((await testPool().query(`SELECT 1 FROM config_versions`)).rowCount).toBe(0);
  });

  it("versions : la configuration initiale puis chaque changement, et la restauration s'annule", async () => {
    await sectors.applyAdjustments({ modules: { crm: false } });
    await sectors.applyAdjustments({ modules: { production: true, recipes: true } });
    let versions = await sectors.versions();
    // Initiale (générique sans ajustement), CRM désactivé, Production activée — plus récente en tête.
    expect(versions.map(v => v.label)).toHaveLength(3);
    expect(versions[2].label).toBe('Configuration initiale');
    expect(versions[0].label).toMatch(/Production activé/);

    // Restaurer la version « CRM désactivé » : Production repart, le CRM reste éteint.
    const r = await sectors.restoreVersion(versions[1].id);
    expect('error' in r).toBe(false);
    let act = await sectors.activation();
    expect(act.modules.has('production')).toBe(false);
    expect(act.modules.has('crm')).toBe(false);

    // La restauration est une version : la restaurer à son tour ramène l'état précédent.
    versions = await sectors.versions();
    expect(versions).toHaveLength(4);
    expect(versions[0].label).toMatch(/^Restauration/);
    await sectors.restoreVersion(versions[1].id);
    act = await sectors.activation();
    expect(act.modules.has('production')).toBe(true);
    expect(await sectors.restoreVersion(999999)).toEqual({ error: 'Version introuvable' });
  });

  it("pilote : le module ne se voit que des membres (et de l'administrateur)", async () => {
    await sectors.applyAdjustments({ modules: { production: true, recipes: true } });
    const r = await sectors.applyRollout('production', { pilot: { roles: ['manager'], users: [] }, disabledStores: [] });
    expect('error' in r).toBe(false);
    const cashier = await sectors.forUser({ userId: '00000000-0000-0000-0000-0000000000aa', role: 'cashier' });
    const manager = await sectors.forUser({ userId: '00000000-0000-0000-0000-0000000000bb', role: 'manager' });
    const admin = await sectors.forUser({ userId: '00000000-0000-0000-0000-0000000000cc', role: 'admin' });
    expect(cashier.modules.has('production')).toBe(false);
    expect(manager.modules.has('production')).toBe(true);
    expect(admin.modules.has('production')).toBe(true);
    // La société garde le module actif : rien n'est désactivé.
    expect((await sectors.activation()).modules.has('production')).toBe(true);
    // Ouvrir à tous retire le pilote.
    await sectors.applyRollout('production', { pilot: null, disabledStores: [] });
    expect((await sectors.forUser({ userId: '00000000-0000-0000-0000-0000000000aa', role: 'cashier' })).modules.has('production')).toBe(true);
  });

  it('par établissement : un module se ferme pour un établissement seulement', async () => {
    const store = (await testPool().query(`SELECT id FROM stores LIMIT 1`)).rows[0].id as string;
    const r = await sectors.applyRollout('pos', { pilot: null, disabledStores: [store] });
    expect('error' in r).toBe(false);
    const here = await sectors.forUser({ userId: '00000000-0000-0000-0000-0000000000aa', role: 'cashier', storeId: store });
    const elsewhere = await sectors.forUser({ userId: '00000000-0000-0000-0000-0000000000aa', role: 'cashier', storeId: null });
    expect(here.modules.has('pos')).toBe(false);
    expect(elsewhere.modules.has('pos')).toBe(true);
    // Un module central ne se ferme pas par établissement ; un module inactif n'a pas de diffusion.
    expect(await sectors.applyRollout('accounting', { pilot: null, disabledStores: [store] })).toEqual({ error: '« Comptabilité » ne se règle pas par établissement' });
    expect('error' in (await sectors.applyRollout('production', { pilot: null, disabledStores: [] }))).toBe(true);
    // Le préréglage rouvre tout.
    await sectors.resetAdjustments();
    expect((await sectors.forUser({ userId: '00000000-0000-0000-0000-0000000000aa', role: 'cashier', storeId: store })).modules.has('pos')).toBe(true);
  });

  it('la restauration rétablit aussi pilotes et établissements', async () => {
    const store = (await testPool().query(`SELECT id FROM stores LIMIT 1`)).rows[0].id as string;
    await sectors.applyRollout('pos', { pilot: { roles: ['manager'], users: [] }, disabledStores: [store] });
    await sectors.applyRollout('pos', { pilot: null, disabledStores: [] });
    const versions = await sectors.versions();
    expect(versions[1].label).toMatch(/pilote/);
    await sectors.restoreVersion(versions[1].id);
    const act = await sectors.activation();
    expect(act.rollout.pilots.pos?.roles).toEqual(['manager']);
    expect(act.rollout.storeDisabled[store]).toEqual(['pos']);
  });

  it('secteur Industrie / Fabrication : socle de fabrication sans la couche boulangerie (P1)', async () => {
    await sectors.setSector('fabrication', { keepAdjustments: false });
    const act = await sectors.activation();
    for (const m of ['production', 'recipes', 'stock', 'purchasing', 'sales'] as const) expect(act.modules.has(m)).toBe(true);
    for (const m of ['replenishment', 'unsold', 'reconciliation'] as const) expect(act.modules.has(m)).toBe(false);
    // Aucune option boulangerie (HACCP, DLC du jour…) : seulement le socle commun (mig 632).
    expect([...act.features].filter(k => !act.catalog.find(f => f.key === k)?.default_on)).toEqual([]);
    expect(await callGuard('GET', '/production/plans')).toBe(200);
    expect(await callGuard('GET', '/haccp/logs')).toBe(403);
    expect(await callGuard('GET', '/unsold-decisions')).toBe(200); // préfixe partagé avec la caisse
    expect(await sectors.labels('fabrication')).toMatchObject({ recipe: 'Nomenclature', production: 'Fabrication' });
    // Une option se rallume à la carte.
    await sectors.applyAdjustments({ features: { haccp: true } });
    expect(await callGuard('GET', '/haccp/logs')).toBe(200);
  });

  it('options câblées (P5) : DLC du jour et gel / dégel suivent l\'option', async () => {
    const { productLotRepository } = await import('../../repositories/product-lot.repository.js');
    const p = testPool();
    const store = (await p.query(`SELECT id FROM stores LIMIT 1`)).rows[0].id as string;
    const product = (await p.query(
      `INSERT INTO products (name, slug, price) VALUES ('Lot option P5', 'lot-option-p5-' || floor(random() * 1e9)::text, 1) RETURNING id`)).rows[0].id as string;
    const client = await p.connect();
    try {
      // Fabrication : aucune option boulangerie → lot sans date limite, gel/dégel fermé.
      await sectors.setSector('fabrication', { keepAdjustments: false });
      const sans = await productLotRepository.createFromProduction(client as never, { productId: product, storeId: store, quantityProduced: 2 });
      expect(sans.expires_at).toBeNull();
      expect(await callGuard('GET', '/lot-thermal/lots')).toBe(403);

      // Boulangerie : DLC du jour par défaut, gel/dégel ouvert.
      await sectors.setSector('boulangerie', { keepAdjustments: false });
      const avec = await productLotRepository.createFromProduction(client as never, { productId: product, storeId: store, quantityProduced: 2 });
      expect(avec.expires_at).not.toBeNull();
      expect(await callGuard('GET', '/lot-thermal/lots')).toBe(200);
    } finally {
      await client.query(`DELETE FROM product_lots WHERE product_id = $1`, [product]).catch(() => undefined);
      await client.query(`DELETE FROM products WHERE id = $1`, [product]).catch(() => undefined);
      client.release();
    }
  });

  it("une option éteinte ferme ses routes (HACCP)", async () => {
    await sectors.setSector('boulangerie', { keepAdjustments: false });
    expect(await callGuard('GET', '/haccp/logs')).toBe(200);
    await sectors.applyAdjustments({ features: { haccp: false } });
    expect(await callGuard('GET', '/haccp/logs')).toBe(403);
    expect(await callGuard('GET', '/production/plans')).toBe(200);
  });
});
