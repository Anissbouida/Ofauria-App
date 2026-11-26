/**
 * Référentiels du procédé (mig 513, plan Production générique P4) : types d'étape,
 * d'équipement et paramètres de relevé ne sont plus figés. Reprise à l'identique
 * (codes et CCP d'avant), puis un type « Usinage » ajouté au référentiel devient
 * accepté sans toucher au code.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories } from './helpers.js';

describe.skipIf(!hasTestDb)('Référentiels du procédé', () => {
  let refs: typeof import('../../services/process-referentials.js');
  let repos: Awaited<ReturnType<typeof importRepositories>>;

  const guard = (body: unknown) => new Promise<number>((resolve, reject) => {
    const res = { status: (c: number) => ({ json: () => resolve(c) }) };
    refs.requireStepTypes((b: { etapes?: { type?: string | null }[] }) => (b.etapes ?? []).map(e => e.type))(
      { body } as never, res as never, (err?: unknown) => (err ? reject(err) : resolve(200)));
  });

  beforeAll(async () => {
    repos = await importRepositories();
    refs = await import('../../services/process-referentials.js');
  });

  afterAll(async () => {
    // Supprimée (et non désactivée) : une valeur désactivée en activation automatique serait
    // réactivée par la synchronisation des secteurs et fausserait referentiels-sectoriels.
    await testPool().query(`DELETE FROM ref_entries WHERE table_id = 'production_step_types' AND code = 'usinage_test'`)
      .catch(() => testPool().query(`UPDATE ref_entries SET is_active = false, activation = 'forced_off' WHERE table_id = 'production_step_types' AND code = 'usinage_test'`))
      .catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('reprend les codes et les points critiques d\'avant', async () => {
    const steps = (await refs.processRefs('production_step_types')).map(e => e.code);
    expect(steps).toEqual(expect.arrayContaining(['petrissage', 'cuisson', 'refroidissement', 'autre']));
    expect([...(await refs.ccpStepTypes())].sort()).toEqual(['cuisson', 'refroidissement']);
    expect(await refs.readingParamMeta('temp_four')).toEqual({ label: 'Température four', unit: '°C' });
    expect(await refs.unknownCodes('production_equipment_types', ['four', null, 'presse'])).toEqual(['presse']);
  });

  it('un type ajouté au référentiel est accepté sans toucher au code', async () => {
    expect(await guard({ etapes: [{ type: 'cuisson' }, { type: null }] })).toBe(200);
    expect(await guard({ etapes: [{ type: 'usinage_test' }] })).toBe(400);
    await testPool().query(
      `INSERT INTO ref_entries (table_id, code, label, display_order, metadata) VALUES ('production_step_types', 'usinage_test', 'Usinage', 200, '{}')
       ON CONFLICT (table_id, code) DO UPDATE SET is_active = true`);
    refs.invalidateProcessRefs();
    expect(await guard({ etapes: [{ type: 'usinage_test' }] })).toBe(200);
  });

  it('les contraintes figées en base ont disparu', async () => {
    const { rows } = await testPool().query(
      `SELECT conname FROM pg_constraint WHERE conname IN
         ('production_item_etapes_type_etape_check', 'production_equipements_type_check', 'production_step_readings_parametre_check')`);
    expect(rows).toEqual([]);
  });
});
