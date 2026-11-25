/**
 * Héritage vivant des profils, famille Agroalimentaire, spécialisations
 * (plan d'exécution multi-industries, étape 2, mig 633).
 *
 *   - Les profils convertis donnent EXACTEMENT les listes qu'ils avaient (boulangerie,
 *     process, discret, atelier) ;
 *   - une capacité ajoutée au parent apparaît chez l'enfant ; un retrait de l'enfant est respecté ;
 *   - un cycle d'héritage ne fait pas tourner la résolution en boucle ;
 *   - libellés et couches production suivent toute la chaîne ;
 *   - spécialisations : activer n'ajoute que ce qui manque, désactiver ne supprime rien ;
 *   - modèle v3 : le secteur enregistré hérite de son secteur de base (écarts seulement).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe.skipIf(!hasTestDb)('Héritage des profils et spécialisations', () => {
  let sectors: typeof import('../../repositories/sector.repository.js').sectorRepository;
  let specs: typeof import('../../repositories/specialization.repository.js').specializationRepository;
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  const p = () => testPool();
  let initialSector = 'boulangerie';
  let agroFeatures: string[] = [];
  let agroProfile: unknown = null;
  let condRemove: string[] = [];
  const createdCodes: string[] = [];

  beforeAll(async () => {
    repos = await importRepositories();
    sectors = (await import('../../repositories/sector.repository.js')).sectorRepository;
    specs = (await import('../../repositories/specialization.repository.js')).specializationRepository;
    initialSector = (await sectors.current()).code;
    const agro = (await p().query(`SELECT features, profile FROM sector_packs WHERE code = 'agroalimentaire'`)).rows[0];
    agroFeatures = agro.features; agroProfile = agro.profile;
    condRemove = (await p().query(`SELECT remove_features FROM sector_packs WHERE code = 'agro_conditionne'`)).rows[0].remove_features;
  }, 60_000);

  afterAll(async () => {
    await p().query(`UPDATE sector_packs SET features = $1, profile = $2::jsonb, base_sector = NULL, inherits = false WHERE code = 'agroalimentaire'`,
      [agroFeatures, agroProfile === null ? null : JSON.stringify(agroProfile)]).catch(() => undefined);
    await p().query(`UPDATE sector_packs SET remove_features = $1 WHERE code = 'agro_conditionne'`, [condRemove]).catch(() => undefined);
    await p().query(`DELETE FROM sector_labels WHERE sector_pack = 'agroalimentaire' AND label_key = $1`, [`test_${RUN}`]).catch(() => undefined);
    for (const c of createdCodes) await p().query(`DELETE FROM sector_packs WHERE code = $1`, [c]).catch(() => undefined);
    await p().query(`UPDATE company_settings SET sector_pack = $1 WHERE id = 1`, [initialSector]).catch(() => undefined);
    sectors.invalidate();
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('les profils convertis redonnent exactement leurs anciennes listes', async () => {
    const { rows } = await p().query(`SELECT code, enabled_modules, features FROM sector_packs WHERE inherits AND NOT is_custom`);
    expect(rows.map(r => r.code).sort()).toEqual(expect.arrayContaining(['agro_conditionne', 'atelier', 'boulangerie', 'discret', 'process']));
    for (const r of rows) {
      const pack = (await sectors.pack(r.code))!;
      expect([...pack.modules].sort(), r.code).toEqual([...new Set(r.enabled_modules as string[])].sort());
      expect([...(pack.features ?? [])].sort(), r.code).toEqual([...new Set(r.features as string[])].sort());
    }
    const boul = (await sectors.pack('boulangerie'))!;
    expect(boul.lineage).toEqual(['agroalimentaire', 'boulangerie']);
    expect(boul.family).toBe('agroalimentaire');
  });

  it('une capacité ajoutée au parent apparaît chez l\'enfant ; le retrait de l\'enfant est respecté', async () => {
    await p().query(`UPDATE sector_packs SET features = array_append(features, 'ccp_cuisson') WHERE code = 'agroalimentaire'`);
    expect((await sectors.pack('agro_conditionne'))!.features).toContain('ccp_cuisson');
    await p().query(`UPDATE sector_packs SET remove_features = array_append(remove_features, 'ccp_cuisson') WHERE code = 'agro_conditionne'`);
    expect((await sectors.pack('agro_conditionne'))!.features).not.toContain('ccp_cuisson');
    // La boulangerie, elle, l'avait déjà en propre : inchangée.
    expect((await sectors.pack('boulangerie'))!.features).toContain('ccp_cuisson');
  });

  it('un cycle d\'héritage ne boucle pas', async () => {
    await p().query(`UPDATE sector_packs SET base_sector = 'agro_conditionne', inherits = true WHERE code = 'agroalimentaire'`);
    const list = await sectors.list();
    expect(list.find(s => s.code === 'agro_conditionne')).toBeDefined();
    await p().query(`UPDATE sector_packs SET base_sector = NULL, inherits = false WHERE code = 'agroalimentaire'`);
  });

  it('libellés et couches production suivent toute la chaîne', async () => {
    await p().query(`INSERT INTO sector_labels (sector_pack, label_key, label_value) VALUES ('agroalimentaire', $1, 'Terme agro')`, [`test_${RUN}`]);
    expect((await sectors.sectorLabels('boulangerie'))[`test_${RUN}`]).toBe('Terme agro');
    expect((await sectors.sectorLabels('agro_conditionne'))[`test_${RUN}`]).toBe('Terme agro');

    await p().query(`UPDATE sector_packs SET profile = $1::jsonb WHERE code = 'agroalimentaire'`, [JSON.stringify({
      order_types: [], print_templates: [],
      policies: [{ key: 'quality.auto_release', value: { enabled: true } }, { key: 'production.yield_target', value: { pct: 92 } }],
    })]);
    const prof = (await sectors.resolvedProfile('agro_conditionne')) as any;
    const pol = new Map(prof.policies.map((x: any) => [x.key, x.value]));
    expect(pol.get('production.yield_target')).toEqual({ pct: 92 });          // hérité du parent
    expect(pol.get('quality.auto_release')).toEqual({ enabled: false });      // l'enfant l'emporte (profil process)
    expect(prof.order_types.length).toBeGreaterThan(0);                       // ses propres types d'ordre
  });

  it('spécialisations : proposées par le profil, activer n\'ajoute que ce qui manque, désactiver ne supprime rien', async () => {
    await sectors.setSector('boulangerie', { keepAdjustments: true });
    const list = await specs.list();
    expect(list.filter(s => s.offered).map(s => s.code)).toEqual(
      expect.arrayContaining(['boulangerie', 'patisserie', 'viennoiserie', 'biscuiterie', 'traiteur_sale', 'beldi', 'chocolaterie']));

    const hadWorkshop = (await p().query(`SELECT 1 FROM production_workshops WHERE code IN ('chocolaterie', 'confiserie')`)).rows.length > 0;
    const hadTemperage = (await p().query(`SELECT 1 FROM ref_entries WHERE table_id = 'production_step_types' AND code = 'temperage'`)).rows.length > 0;
    try {
      const r = await specs.enable('chocolaterie');
      expect('error' in r).toBe(false);
      expect((await specs.active())).toContain('chocolaterie');
      expect((await p().query(`SELECT 1 FROM production_workshops WHERE code = 'chocolaterie' AND is_active`)).rows.length).toBe(1);
      expect((await p().query(`SELECT 1 FROM ref_entries WHERE table_id = 'production_step_types' AND code = 'temperage'`)).rows.length).toBe(1);
      // Réactiver ne crée rien de plus.
      const again = await specs.enable('chocolaterie');
      expect(again).toMatchObject({ workshops: 0, stepTypes: 0 });

      const off = await specs.disable('chocolaterie');
      expect('error' in off).toBe(false);
      expect((await specs.active())).not.toContain('chocolaterie');
      expect((await p().query(`SELECT 1 FROM production_workshops WHERE code = 'chocolaterie'`)).rows.length).toBe(1);
      expect('error' in (await specs.enable('inexistante'))).toBe(true);
    } finally {
      await p().query(`DELETE FROM company_specializations WHERE code = 'chocolaterie'`);
      if (!hadWorkshop) await p().query(`DELETE FROM production_workshops WHERE code = 'chocolaterie'`);
      if (!hadTemperage) await p().query(`DELETE FROM ref_entries WHERE table_id = 'production_step_types' AND code IN ('temperage', 'moulage')`);
    }
  });

  it('annule atelier, référentiel, adhésion et versions si une capacité échoue', async () => {
    const act=await sectors.activation();
    const feature=act.catalog.find(f=>!act.features.has(f.key));
    expect(feature).toBeDefined();
    const code=`rollback_${RUN}`.slice(0,40);
    const versionCount=async()=>(await p().query('SELECT count(*)::int AS n FROM config_versions')).rows[0].n;
    const before=await versionCount();
    await p().query(`INSERT INTO sector_specializations(code,sector_pack,label,content) VALUES($1,$2,$3,$4::jsonb)`,[code,act.sector.code,'Test rollback',JSON.stringify({workshop:{code,label:'Test rollback'},step_types:[{code,label:'Test rollback'}],features:[feature!.key]})]);
    const fail=vi.spyOn(sectors,'applyAdjustments').mockResolvedValueOnce({error:'Échec de capacité injecté'});
    try{
      expect(await specs.enable(code)).toEqual({error:'Échec de capacité injecté'});
      expect(fail).toHaveBeenCalled();
      expect(await specs.active()).not.toContain(code);
      expect((await p().query('SELECT 1 FROM production_workshops WHERE code=$1',[code])).rowCount).toBe(0);
      expect((await p().query('SELECT 1 FROM ref_entries WHERE code=$1 AND table_id=\'production_step_types\'',[code])).rowCount).toBe(0);
      expect(await versionCount()).toBe(before);
    }finally{
      fail.mockRestore();
      await p().query('DELETE FROM sector_specializations WHERE code=$1',[code]);
    }
  });

  it('modèle v3 : spécialisations exportées, secteur enregistré en héritage (écarts seulement)', async () => {
    const tpl = await import('../../services/config-templates.js');
    const model = await tpl.exportCurrentConfig(`Profil test ${RUN}`);
    expect(model.version).toBe(3);
    expect(Array.isArray(model.specializations)).toBe(true);
    const saved = await tpl.saveModelAsSector({ ...model, name: `Profil test ${RUN}` });
    expect('error' in saved).toBe(false);
    const code = (saved as { code: string }).code; createdCodes.push(code);
    const row = (await p().query(`SELECT inherits, base_sector, add_modules, remove_modules, add_features, remove_features FROM sector_packs WHERE code = $1`, [code])).rows[0];
    expect(row.inherits).toBe(true);
    expect(row.base_sector).toBe(model.base_sector);
    const pack = (await sectors.pack(code))!;
    expect([...pack.modules].sort()).toEqual([...model.modules].sort());
    expect([...(pack.features ?? [])].sort()).toEqual([...model.features].sort());

    // Un modèle de version 2 reste accepté.
    const v2 = await tpl.previewConfigModel({ ...model, version: 2, specializations: undefined });
    expect('error' in v2).toBe(false);
  });
});
