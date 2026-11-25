import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Assistant — approbations et réglages des règles (mig 692)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  beforeAll(async () => { repos = await importRepositories(); fx = await createBaseFixtures(); });
  afterAll(async () => { if (fx) await cleanupFixtures(fx); await repos?.db.pool.end(); await closeTestPool(); });

  it('le catalogue expose les règles à seuil et les nouveaux réglages', async () => {
    const { wizardCatalog } = await import('../../services/wizard/catalog.js');
    const catalog = await wizardCatalog(false);
    expect(catalog.parameters?.map(p => p.key)).toEqual(expect.arrayContaining(['production.demand_source', 'production.flow', 'stock.low_stock_alerts', 'sales.pricing']));
    expect(catalog.parameters?.find(p => p.key === 'production.flow')?.value).toMatchObject({ material_issue_required: true, transfer_reception: true });
    for (const r of catalog.approvalRules) expect(typeof r.value).toBe('number');
  });

  it('seuil et activation d’une règle appliqués dans la transaction, seuil invalide refusé', async () => {
    const { withTransaction, db } = await import('../../config/database.js');
    const { wizardApprovalRules, applyWizardApprovals, approvalIssues } = await import('../../services/wizard/approval-operations.js');
    const rules = await wizardApprovalRules();
    if (!rules.length) return; // base sans règle à seuil
    const rule = rules[0];
    expect(approvalIssues({ rules: { data: { [`approval:${rule.code}:value`]: 'abc' } } }, rules)[0]?.severity).toBe('blocking');
    const rollback = new Error('rollback test');
    await expect(withTransaction(async () => {
      const changes = await applyWizardApprovals({ rules: { data: { [`approval:${rule.code}:value`]: String(rule.value + 1000), [`approval:${rule.code}:enabled`]: !rule.enabled } } }, fx.userId);
      expect(changes).toEqual([{ code: rule.code, before: { enabled: rule.enabled, value: rule.value }, after: { enabled: !rule.enabled, value: rule.value + 1000 } }]);
      const row = (await db.query(`SELECT enabled, condition FROM approval_rules WHERE code = $1`, [rule.code])).rows[0];
      expect(row.enabled).toBe(!rule.enabled);
      expect(Number(row.condition.value)).toBe(rule.value + 1000);
      throw rollback;
    })).rejects.toBe(rollback);
  }, 60000);

  it('changer de rythme règle l’horizon du plan directeur et le contrôle de capacité', async () => {
    const { withTransaction } = await import('../../config/database.js');
    const { write, readAll } = await import('../../services/settings-center.js');
    const { parameterByKey } = await import('../../services/parameters-catalog.js');
    const { resolvePolicy } = await import('../../services/policies.js');
    const rollback = new Error('rollback test');
    await expect(withTransaction(async () => {
      const current = (await readAll()).get('production.rhythm')?.mode;
      const target = current === 'industrial' ? 'continuous' : 'industrial';
      expect(await write(parameterByKey('production.rhythm')!, { mode: target }, fx.userId)).toBe(true);
      expect((await resolvePolicy<{ days: number }>('production.mrp_horizon')).value.days).toBe(target === 'industrial' ? 14 : 28);
      expect((await resolvePolicy<{ mode: string }>('production.equipment_capacity')).value.mode).toBe('block');
      throw rollback;
    })).rejects.toBe(rollback);
  }, 60000);

  it('production en continu à la commande : incohérence bloquante', async () => {
    const { operatingModelIssues } = await import('../../services/wizard/catalog.js');
    const issues = operatingModelIssues({ operations: { data: { 'production.rhythm:mode': 'continuous', 'production.demand_source:mode': 'orders' } } }, { parameters: [], centralStoreAvailable: true });
    expect(issues).toEqual([expect.objectContaining({ step: 'operations', severity: 'blocking' })]);
    expect(operatingModelIssues({ operations: { data: { 'production.rhythm:mode': 'continuous', 'production.demand_source:mode': 'both' } } }, { parameters: [], centralStoreAvailable: true })).toEqual([]);
  });

  it('établissements préparés : créés à la publication, doublon refusé', async () => {
    const { withTransaction, db } = await import('../../config/database.js');
    const { applyWizardStores, storeIssues, existingStoreNames } = await import('../../services/wizard/store-operations.js');
    const existing = await existingStoreNames();
    const answers = { company: { data: { 'store:1:name': 'Dépôt test assistant', 'store:1:kind': 'warehouse', 'store:1:city': 'Rabat' } } };
    expect(storeIssues(answers, existing)).toEqual([]);
    if (existing.length) expect(storeIssues({ company: { data: { 'store:1:name': existing[0], 'store:1:kind': 'shop' } } }, existing)[0]?.severity).toBe('blocking');
    expect(storeIssues({ company: { data: { 'store:1:city': 'Fès' } } }, existing)[0]?.severity).toBe('blocking');
    const rollback = new Error('rollback test');
    await expect(withTransaction(async () => {
      expect(await applyWizardStores(answers, fx.userId)).toEqual(['Dépôt test assistant']);
      expect((await db.query(`SELECT kind, city FROM stores WHERE name = $1`, ['Dépôt test assistant'])).rows[0]).toEqual({ kind: 'warehouse', city: 'Rabat' });
      throw rollback;
    })).rejects.toBe(rollback);
  }, 60000);
});
