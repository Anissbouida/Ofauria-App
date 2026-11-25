import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories } from './helpers.js';

describe.skipIf(!hasTestDb)('Assistant — brouillons persistants (PostgreSQL)', () => {
  let services: typeof import('../../services/wizard/sessions.js');
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  const ids: string[] = [];
  beforeAll(async () => { repos = await importRepositories(); services = await import('../../services/wizard/sessions.js'); });
  afterAll(async () => {
    await testPool().query('DELETE FROM config_wizard_sessions WHERE id = ANY($1::uuid[])', [ids]);
    await repos?.db.pool.end(); await closeTestPool();
  });
  it('reprise, mode, concurrence, abandon sans changement de configuration active', async () => {
    const before = await testPool().query('SELECT id, sector_pack FROM company_settings WHERE id=1');
    const beforeVersions = await testPool().query('SELECT count(*) FROM config_versions');
    const created = await services.createWizardSession('evolution', 'advanced', null!); ids.push(created.id);
    const a = { operations: { note: 'Sur stock', reviewed: true } };
    const updated = await services.saveWizardSession(created.id, { mode: 'quick', current_step: 'operations', revision: created.revision, answers: a }, null!);
    expect(updated.current_step).toBe('vocabulary');
    const resumed = (await services.listWizardSessions()).find(s => s.id === created.id)!;
    expect(resumed.answers).toEqual(a);
    await expect(services.saveWizardSession(created.id, { mode: 'advanced', current_step: 'company', revision: created.revision, answers: {} }, null!)).rejects.toMatchObject({ statusCode: 409 });
    await services.abandonWizardSession(created.id, updated.revision, null!);
    expect((await services.listWizardSessions()).some(s => s.id === created.id)).toBe(false);
    expect((await testPool().query('SELECT id, sector_pack FROM company_settings WHERE id=1')).rows).toEqual(before.rows);
    expect((await testPool().query('SELECT count(*) FROM config_versions')).rows).toEqual(beforeVersions.rows);
  });
});
