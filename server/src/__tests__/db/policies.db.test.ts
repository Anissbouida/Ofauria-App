/**
 * M1-02 — politiques à héritage (mig 538).
 *  - sans valeur posée, le défaut du catalogue s'applique ;
 *  - la valeur la plus précise l'emporte : article → type d'ordre → atelier →
 *    établissement → société ;
 *  - retirer une valeur fait retomber sur le niveau au-dessus ;
 *  - une valeur hors bornes, un niveau inexistant, une clé inconnue sont refusés ;
 *  - chaque écriture crée une version de configuration, et restaurer une version
 *    remet les politiques dans son état ;
 *  - l'écran Paramètres lit et écrit le niveau société.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createProductWithRecipe, cleanupFixtures, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Politiques à héritage (M1-02)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let pol: typeof import('../../services/policies.js');
  let center: typeof import('../../services/settings-center.js');
  let sector: typeof import('../../repositories/sector.repository.js')['sectorRepository'];
  let fx: Fixtures;
  let productId: string, workshop: string, otherWorkshop: string;
  let saved: { key: string; scope_type: string; scope_id: string; value: unknown }[] = [];
  const KEY = 'production.yield_target';
  const p = () => testPool();
  const pct = async (ctx: Parameters<typeof pol.resolvePolicy>[1] = {}) => {
    const r = await pol.resolvePolicy<{ pct: number }>(KEY, ctx);
    return `${r.value.pct}@${r.source}`;
  };
  const set = (scope: Parameters<typeof pol.setPolicy>[1], id: string, value: unknown) => pol.setPolicy(KEY, scope, id, value, fx.userId);

  beforeAll(async () => {
    repos = await importRepositories();
    pol = await import('../../services/policies.js');
    center = await import('../../services/settings-center.js');
    ({ sectorRepository: sector } = await import('../../repositories/sector.repository.js'));
    fx = await createBaseFixtures();
    productId = (await createProductWithRecipe(fx, { name: 'Pain M102', price: 5, ingredients: [] })).productId;
    const ws = (await p().query(`SELECT code FROM production_workshops WHERE is_active ORDER BY sort_order, code LIMIT 2`)).rows;
    workshop = ws[0].code; otherWorkshop = ws[1].code;
    saved = (await p().query(`SELECT key, scope_type, scope_id, value FROM policy_values WHERE key = $1`, [KEY])).rows;
    await p().query(`DELETE FROM policy_values WHERE key = $1`, [KEY]);
    pol.invalidatePolicies();
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM policy_values WHERE key = $1`, [KEY]).catch(() => undefined);
    for (const r of saved) await p().query(
      `INSERT INTO policy_values (key, scope_type, scope_id, value) VALUES ($1, $2, $3, $4::jsonb)`,
      [r.key, r.scope_type, r.scope_id, JSON.stringify(r.value)]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('sans valeur posée : le défaut du catalogue (90 %)', async () => {
    expect(await pct()).toBe('90@default');
    expect(await pct({ workshop, storeId: fx.storeId, productId })).toBe('90@default');
    expect(await pol.policyNumber(KEY, 'pct', { workshop })).toBe(90);
  });

  it('la valeur de l\'atelier l\'emporte sur celle de la société', async () => {
    expect(await set('company', '', { pct: 88 })).toEqual({ value: { pct: 88 } });
    expect(await pct({ workshop })).toBe('88@company');
    expect(await set('workshop', workshop, { pct: 80 })).toEqual({ value: { pct: 80 } });
    expect(await pct({ workshop })).toBe('80@workshop');
    expect(await pct({ workshop: otherWorkshop })).toBe('88@company');   // un autre atelier hérite de la société
    expect(await pct()).toBe('88@company');
  });

  it('ordre complet : article, puis type d\'ordre, puis atelier, puis établissement', async () => {
    await set('store', fx.storeId, { pct: 86 });
    expect(await pct({ storeId: fx.storeId })).toBe('86@store');
    expect(await pct({ storeId: fx.storeId, workshop })).toBe('80@workshop');
    await set('order_type', 'daily', { pct: 75 });
    expect(await pct({ storeId: fx.storeId, workshop, orderType: 'daily' })).toBe('75@order_type');
    await set('product', productId, { pct: 70 });
    expect(await pct({ storeId: fx.storeId, workshop, orderType: 'daily', productId })).toBe('70@product');
    expect(await pct({ storeId: fx.storeId, workshop, orderType: 'weekly', productId: null })).toBe('80@workshop');
  });

  it('retirer une valeur fait retomber sur le niveau au-dessus', async () => {
    expect(await set('product', productId, null)).toEqual({ value: null });
    expect(await pct({ workshop, orderType: 'daily', productId })).toBe('75@order_type');
    await set('order_type', 'daily', null);
    await set('workshop', workshop, null);
    expect(await pct({ storeId: fx.storeId, workshop, orderType: 'daily', productId })).toBe('86@store');
  });

  it('refus : hors bornes, champ inconnu, niveau inexistant, clé inconnue', async () => {
    expect(await set('company', '', { pct: 150 })).toEqual({ error: 'Rendement cible : maximum 100' });
    expect(await set('company', '', { taux: 5 })).toEqual({ error: 'Champ inconnu : taux' });
    expect(await set('workshop', 'atelier_fantome', { pct: 80 })).toEqual({ error: 'Atelier introuvable' });
    expect(await set('store', '00000000-0000-0000-0000-000000000000', { pct: 80 })).toEqual({ error: 'Établissement introuvable' });
    expect(await set('company', 'x', { pct: 80 })).toEqual({ error: 'Le niveau société ne porte pas d\'identifiant' });
    expect(await pol.setPolicy('production.inconnue', 'company', '', { pct: 80 }, fx.userId)).toEqual({ error: 'Politique inconnue' });
    expect(await pol.setPolicy('sales.quotes', 'company', '', { validity_days: 10 }, fx.userId)).toEqual({ error: 'Politique inconnue' });   // paramètre simple, pas une politique
    await expect(pol.resolvePolicy('production.inconnue')).rejects.toThrow(/Politique inconnue/);
    expect(await pct({ storeId: fx.storeId })).toBe('86@store');   // rien n'a bougé
  });

  it('chaque écriture crée une version ; restaurer une version remet les politiques', async () => {
    const versionId = async () => (await p().query(`SELECT id::int AS id, label, snapshot FROM config_versions ORDER BY id DESC LIMIT 1`)).rows[0];
    await set('workshop', workshop, { pct: 82 });
    const v1 = await versionId();
    expect(v1.label).toContain('Rendement cible');
    expect(v1.label).toContain(workshop);
    expect((v1.snapshot.policies as { key: string; scope_type: string; value: { pct: number } }[])
      .find(r => r.key === KEY && r.scope_type === 'workshop')?.value).toEqual({ pct: 82 });

    await set('workshop', workshop, { pct: 60 });
    await set('company', '', null);
    expect(await pct({ workshop })).toBe('60@workshop');
    expect(await pct()).toBe('90@default');

    const out = await sector.restoreVersion(v1.id, fx.userId);
    expect('error' in out).toBe(false);
    expect(await pct({ workshop })).toBe('82@workshop');
    expect(await pct()).toBe('88@company');
    expect((await versionId()).label).toMatch(/^Restauration de la version/);
  }, 60_000);

  it('journal du paramétrage : l\'écriture est tracée avec son auteur', async () => {
    const r = (await p().query(
      `SELECT changed_by, operation FROM config_audit_log
        WHERE table_name = 'policy_values' AND record_id = $1 AND subject_id = 'workshop' ORDER BY id DESC LIMIT 1`, [KEY])).rows[0];
    expect(r.changed_by).toBe(fx.userId);
  });

  it('écran Paramètres : lit et écrit le niveau société', async () => {
    expect((await center.readAll()).get(KEY)).toEqual({ pct: 88 });
    const def = (await import('../../services/parameters-catalog.js')).parameterByKey(KEY)!;
    expect(await center.write(def, { pct: 91 }, fx.userId)).toBe(true);
    expect(await pct()).toBe('91@company');
    expect((await center.readAll()).get(KEY)).toEqual({ pct: 91 });
  });
});
