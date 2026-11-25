import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, closeTestPool, importRepositories } from './helpers.js';

describe.skipIf(!hasTestDb)('Assistant — 13 profils et personnalisation des modules (mig 691)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  beforeAll(async () => { repos = await importRepositories(); });
  afterAll(async () => { await repos?.db.pool.end(); await closeTestPool(); });

  it('le catalogue propose les 13 profils de la maquette, avec spécialités et capacités', async () => {
    const { wizardCatalog } = await import('../../services/wizard/catalog.js');
    const catalog = await wizardCatalog(false);
    const cards = catalog.profiles.filter(p => p.wizard).map(p => p.code);
    expect(cards).toEqual(expect.arrayContaining(['boulangerie', 'agroalimentaire', 'fabrication', 'commerce_detail', 'negoce', 'restauration',
      'btp', 'agriculture', 'textile', 'transport', 'services', 'sante', 'ecommerce']));
    expect(cards).toHaveLength(13);
    for (const code of cards) {
      const lineage = catalog.profiles.find(p => p.code === code)!.lineage;
      expect(catalog.specialties.some(s => lineage.includes(s.sector))).toBe(true);
    }
    expect(catalog.capabilities.find(c => c.code === 'lots')).toMatchObject({ module: 'stock', kind: 'reglementaire' });
    expect(catalog.activeCapabilities.length).toBeGreaterThan(0);
  });

  it('un nouveau profil se prépare sans erreur (modules socle compris)', async () => {
    const { sectorRepository } = await import('../../repositories/sector.repository.js');
    const { ACTIVATABLE_MODULES } = await import('@ofauria/shared');
    const { wizardCatalog } = await import('../../services/wizard/catalog.js');
    // Profil qui garde le stock : les capacités réglementaires utilisées restent actives.
    const ecommerce = (await wizardCatalog(false)).profiles.find(p => p.code === 'ecommerce')!;
    const modules = [...new Set([...ecommerce.modules, 'dashboard', 'users', 'settings'])].filter(m => (ACTIVATABLE_MODULES as string[]).includes(m));
    const plan = await sectorRepository.planWizardSelection('ecommerce', [], modules);
    expect(plan.target.sector.code).toBe('ecommerce');
  });

  it('les capacités choisies pour les modules retenus deviennent la cible, avec leurs écarts', async () => {
    const { sectorRepository } = await import('../../repositories/sector.repository.js');
    sectorRepository.invalidate();
    const current = await sectorRepository.activation();
    const modules = [...current.modules] as string[];
    const active = [...current.features];
    const candidate = current.catalog.find(f => f.kind === 'fonction' && modules.includes(f.module_key) && !f.requires.length && !current.catalog.some(o => o.requires.includes(f.key)));
    expect(candidate).toBeDefined();
    const wanted = active.includes(candidate!.key) ? active.filter(k => k !== candidate!.key) : [...active, candidate!.key];
    const plan = await sectorRepository.planWizardSelection(current.sector.code, current.sector.secondarySectors ?? [], modules, wanted);
    expect(plan.target.features[candidate!.key]).toBe(!active.includes(candidate!.key));
    // Sans liste de capacités : les écarts actuels sont conservés tels quels.
    const unchanged = await sectorRepository.planWizardSelection(current.sector.code, current.sector.secondarySectors ?? [], modules);
    expect(unchanged.target.features).toEqual(current.featureOverrides);
    await expect(sectorRepository.planWizardSelection(current.sector.code, [], modules, ['inexistante'])).rejects.toMatchObject({ statusCode: 400 });
  }, 60000);
});
