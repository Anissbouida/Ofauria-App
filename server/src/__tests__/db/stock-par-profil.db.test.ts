/**
 * Stock selon le profil (mig 711-712, feuille de route phases 1 et 2), sur une vraie base :
 *   - politique purchasing.reception_quarantine : lue par la réception ;
 *   - stock pour le compte d'un client : hors valorisation de la société ;
 *   - capacité « promotions et fidélité » éteinte : la caisse calcule sans promotion ;
 *   - profil qui éteint une capacité du socle (off_features).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, createBaseFixtures, createIngredient, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Stock selon le profil', () => {
  let fx: Fixtures;
  let ingredientId = '';
  let customerId = '';

  beforeAll(async () => {
    fx = await createBaseFixtures();
    ingredientId = await createIngredient(fx, { name: `Article dépôt ${RUN}`, unit: 'kg', unitCost: 10 });
    customerId = (await testPool().query(`INSERT INTO customers (first_name, last_name) VALUES ('Client', $1) RETURNING id`, [`Déposant ${RUN}`])).rows[0].id;
  });

  afterAll(async () => {
    const p = testPool();
    await p.query(`DELETE FROM ingredient_lots WHERE ingredient_id = $1`, [ingredientId]);
    await p.query(`DELETE FROM policy_values WHERE key = 'purchasing.reception_quarantine'`);
    await p.query(`DELETE FROM company_feature_settings WHERE feature_key = 'promotions_fidelite'`);
    await p.query(`DELETE FROM customers WHERE id = $1`, [customerId]);
    await cleanupFixtures(fx);
    await closeTestPool();
  });

  it('la politique de quarantaine se lit par la société (désactivée par défaut)', async () => {
    const { resolvePolicy, invalidatePolicies } = await import('../../services/policies.js');
    invalidatePolicies();
    expect((await resolvePolicy<{ enabled: boolean }>('purchasing.reception_quarantine')).value.enabled).toBe(false);
    await testPool().query(
      `INSERT INTO policy_values (key, scope_type, scope_id, value) VALUES ('purchasing.reception_quarantine', 'company', '', '{"enabled": true}')`);
    invalidatePolicies();
    expect((await resolvePolicy<{ enabled: boolean }>('purchasing.reception_quarantine')).value.enabled).toBe(true);
  });

  it('le profil Santé impose la quarantaine, BTP et transport ont leurs lieux', async () => {
    const r = await testPool().query(`SELECT code, profile FROM sector_packs WHERE code IN ('sante', 'btp', 'transport')`);
    const by = Object.fromEntries(r.rows.map(x => [x.code, x.profile]));
    expect(by.sante.policies).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'purchasing.reception_quarantine' })]));
    expect(by.btp.locations.map((l: { role: string }) => l.role)).toContain('chantier');
    expect(by.transport.locations.map((l: { role: string }) => l.role)).toContain('quai');
  });

  it('un lot détenu pour un client n’entre pas dans la valeur du stock', async () => {
    await testPool().query(
      // quantity_remaining est recalculé par déclencheur depuis la réserve (economat_quantity).
      `INSERT INTO ingredient_lots (ingredient_id, lot_number, quantity_received, quantity_remaining, economat_quantity, unit_cost, store_id, status, owner_customer_id)
       VALUES ($1, $2, 5, 5, 5, 10, $3, 'active', NULL), ($1, $4, 7, 7, 7, 10, $3, 'active', $5)`,
      [ingredientId, `A-${RUN}`, fx.storeId, `B-${RUN}`, customerId]);
    const { inventoryRepository } = await import('../../repositories/inventory.repository.js');
    const v = await inventoryRepository.stockValuation(fx.storeId);
    const mine = (v.lines as { ingredient_id: string; quantity: number; value: number }[]).find(x => x.ingredient_id === ingredientId);
    expect(mine?.quantity).toBe(5);
    expect(mine?.value).toBe(50);
  });

  it('promotions éteintes : la caisse calcule sans promotion', async () => {
    const p = testPool();
    await p.query(`INSERT INTO company_feature_settings (feature_key, enabled) VALUES ('promotions_fidelite', false)
                   ON CONFLICT (feature_key) DO UPDATE SET enabled = false`);
    const { sectorRepository } = await import('../../repositories/sector.repository.js');
    sectorRepository.invalidate();
    expect(await sectorRepository.featureOn('promotions_fidelite')).toBe(false);
    const { evaluate } = await import('../../services/promotions.js');
    const r = await evaluate([{ productId: '00000000-0000-0000-0000-000000000000', quantity: 1, unitPrice: 10, subtotal: 10 } as never], { channel: 'pos' } as never);
    expect(r.total).toBe(0);
    await p.query(`DELETE FROM company_feature_settings WHERE feature_key = 'promotions_fidelite'`);
    sectorRepository.invalidate();
  });

  it('le contenu de production des profils (mig 715) passe le nettoyage de l’activation sans perte', async () => {
    const { cleanLayers } = await import('../../services/industry-profile.js');
    const { sectorRepository } = await import('../../repositories/sector.repository.js');
    for (const code of ['sante', 'textile', 'restauration', 'agriculture', 'btp', 'transport']) {
      const warnings: string[] = [];
      const layers = cleanLayers(await sectorRepository.resolvedProfile(code), warnings);
      expect(warnings, code).toEqual([]);
      if (code === 'sante') {
        expect(layers.order_types.find(t => t.code === 'ORDRE_LOT')).toMatchObject({ requires_weighing: true, requires_quality_check: true });
        expect(layers.policies.map(p => p.key)).toEqual(expect.arrayContaining(['production.segregation_of_duties', 'quality.auto_release', 'purchasing.reception_quarantine']));
      }
    }
  });

  it('un profil enregistré depuis la configuration garde les capacités éteintes (off_features)', async () => {
    const { exportCurrentConfig, saveModelAsSector, deleteCustomSector } = await import('../../services/config-templates.js');
    const model = await exportCurrentConfig(`Profil test ${RUN}`) as { features: string[]; modules: string[] };
    expect(model.modules).toContain('sales');
    model.features = model.features.filter(k => k !== 'abonnements');
    const r = await saveModelAsSector(model, fx.userId);
    if ('error' in r) throw new Error(r.error);
    const off = (await testPool().query(`SELECT off_features FROM sector_packs WHERE code = $1`, [r.code])).rows[0].off_features as string[];
    expect(off).toContain('abonnements');
    expect(off).not.toContain('devis');
    await deleteCustomSector(r.code);
  });

  it('un profil éteint une capacité du socle, la société peut la rallumer', async () => {
    const { capabilityDefault } = await import('@ofauria/shared');
    const def = { key: 'abonnements', module_key: 'sales', label: 'Abonnements', default_on: true };
    expect(capabilityDefault(def, [], 'abonnements', ['abonnements'])).toBe(false);
    expect(capabilityDefault(def, [], 'abonnements', [])).toBe(true);
    const r = await testPool().query(`SELECT off_features FROM sector_packs WHERE code = 'btp'`);
    expect(r.rows[0].off_features).toContain('abonnements');
  });
});
