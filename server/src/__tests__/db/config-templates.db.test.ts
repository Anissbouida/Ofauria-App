/**
 * Modèles de configuration (P10, mig 517) : la configuration courante s'exporte, se
 * réimporte comme secteur personnalisé (proposé dans la liste), dont les données de
 * départ se chargent ; un fichier non fiable est filtré ; seul un secteur personnalisé
 * non utilisé se supprime.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories } from './helpers.js';

describe.skipIf(!hasTestDb)('Modèles de configuration', () => {
  let tpl: typeof import('../../services/config-templates.js');
  let starter: typeof import('../../services/sector-starter.service.js');
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    tpl = await import('../../services/config-templates.js');
    starter = await import('../../services/sector-starter.service.js');
  });

  afterAll(async () => {
    await p().query(`DELETE FROM sector_packs WHERE is_custom AND label LIKE 'P10 %'`).catch(() => undefined);
    await p().query(`DELETE FROM ref_entries WHERE table_id = 'production_step_types' AND code = 'p10_vernissage'`).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('exporter puis réimporter donne un secteur personnalisé identique', async () => {
    const { sectorRepository } = await import('../../repositories/sector.repository.js');
    const act = await sectorRepository.activation();
    const model = await tpl.exportCurrentConfig('P10 Traiteur');
    expect(model).toMatchObject({ format: 'kalum.config', version: 3, base_sector: act.sector.code });
    expect(model.modules).toEqual([...act.modules].sort());

    const saved = await tpl.saveModelAsSector(JSON.parse(JSON.stringify(model)));
    if ('error' in saved) throw new Error(saved.error);
    expect(saved.code).toBe('perso_p10_traiteur');
    const pack = await sectorRepository.pack(saved.code);
    expect(pack).toMatchObject({ label: 'P10 Traiteur', is_custom: true });
    expect([...pack!.modules].sort()).toEqual(model.modules);
    expect(await sectorRepository.labels(saved.code)).toEqual(model.labels);
    // Un deuxième secteur du même nom est refusé.
    expect(await tpl.saveModelAsSector(model)).toEqual({ error: 'Un secteur s\'appelle déjà « P10 Traiteur »' });
  });

  it('un fichier non fiable est filtré, et ses données de départ se chargent', async () => {
    const preview = await tpl.previewConfigModel({
      format: 'kalum.config', version: 1, name: 'P10 Meubles',
      modules: ['production', 'pirate'], features: ['inconnue'],
      labels: { recipe: 'Nomenclature', 'bad key!': 'x' },
      home_route: 'javascript:alert(1)',
      starter: { stepTypes: [{ code: 'p10_vernissage', label: 'Vernissage', metadata: { ccp: true, script: '<x>' } }, { code: 'BAD CODE', label: 'x' }] },
    });
    if ('error' in preview) throw new Error(preview.error);
    expect(preview.warnings.join(' ')).toMatch(/Modules inconnus ignorés : pirate/);
    expect(preview.warnings.join(' ')).toMatch(/Ajoutés pour les dépendances/);
    expect(preview).toMatchObject({ labels: 1, starter: { stepTypes: 1 } });

    const saved = await tpl.saveModelAsSector({
      format: 'kalum.config', version: 1, name: 'P10 Meubles', modules: ['production'], home_route: 'javascript:alert(1)',
      starter: { stepTypes: [{ code: 'p10_vernissage', label: 'Vernissage', metadata: { ccp: true, script: '<x>' } }] },
    });
    if ('error' in saved) throw new Error(saved.error);
    const row = (await p().query(`SELECT home_route, enabled_modules, starter FROM sector_packs WHERE code = $1`, [saved.code])).rows[0];
    expect(row.home_route).toBeNull();
    expect(row.enabled_modules).toEqual(expect.arrayContaining(['production', 'recipes', 'stock']));
    expect(row.starter.stepTypes).toEqual([{ code: 'p10_vernissage', label: 'Vernissage', metadata: { ccp: true } }]);

    expect((await starter.sectorStarterPreview(saved.code)).items.join(' ')).toContain('Vernissage');
    const loaded = await starter.loadSectorStarter(saved.code);
    expect(loaded.stepTypes).toBe(1);

    expect(await tpl.previewConfigModel({ format: 'autre' })).toEqual({ error: 'Ce fichier n\'est pas un modèle de configuration Kalum' });
  });

  it('seul un secteur personnalisé non utilisé se supprime', async () => {
    expect(await tpl.deleteCustomSector('boulangerie')).toEqual({ error: 'Seul un secteur personnalisé peut être supprimé' });
    expect(await tpl.deleteCustomSector('perso_p10_meubles')).toEqual({ ok: true });
    expect((await p().query(`SELECT count(*)::int AS n FROM sector_labels WHERE sector_pack = 'perso_p10_meubles'`)).rows[0].n).toBe(0);
  });
});
