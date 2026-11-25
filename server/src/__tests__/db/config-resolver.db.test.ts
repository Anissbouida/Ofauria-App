import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MODULE_RELATIONS } from '@ofauria/shared';
import { hasTestDb, testPool, closeTestPool, importRepositories } from './helpers.js';

describe.skipIf(!hasTestDb)('Socle config — projection et migration sans perte', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  beforeAll(async () => { repos = await importRepositories(); });
  afterAll(async () => { await repos?.db.pool.end(); await closeTestPool(); });
  it('la projection historique conserve toutes les valeurs sans copie ni modification', async () => {
    const expected = await testPool().query(`SELECT (SELECT count(*) FROM policy_values)+(SELECT count(*) FROM module_parameters) AS n`);
    const current = await testPool().query(`SELECT count(*) AS n FROM config_legacy_values`);
    expect(current.rows[0].n).toBe(expected.rows[0].n);
    const diff = await testPool().query(`SELECT count(*) AS n FROM policy_values p LEFT JOIN config_legacy_values c ON c.key=p.key AND c.scope_type=p.scope_type AND c.scope_id=p.scope_id AND c.source='policy_values' WHERE c.value IS DISTINCT FROM p.value`);
    expect(Number(diff.rows[0].n)).toBe(0);
  });
  it('les prérequis du catalogue correspondent aux relations actuellement utilisées', async () => {
    const result = await testPool().query(`SELECT module,related,kind FROM module_relations WHERE kind='requires'`);
    expect(result.rows).toEqual(expect.arrayContaining([...MODULE_RELATIONS]));
  });
  it('le schéma refuse un verrou de sécurité au niveau secteur', async () => {
    await expect(testPool().query(`INSERT INTO config_values(key,scope_type,scope_id,value,locked,lock_reason) VALUES ('test.invalid.lock','sector','test','true',true,'security')`)).rejects.toMatchObject({ code:'23514' });
  });
});
