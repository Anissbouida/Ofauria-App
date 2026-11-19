/**
 * M5-05 — référentiel équipement unique (mig 569).
 *  - rapprochement par les noms : l'immobilisation « Four Bongard sole » est proposée pour
 *    l'équipement « Four à sole Bongard » ; rien n'est lié tant que le lien n'est pas validé ;
 *  - un arrêt de poste ouvre une demande d'intervention sur l'équipement du poste (liée aux deux) ;
 *  - une intervention terminée sur l'équipement du poste crée l'arrêt correspondant, une seule fois.
 *  - nameSimilarity : indice sur les mots, insensible aux accents.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Référentiel équipement (M5-05)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let el: typeof import('../../repositories/equipment-link.repository.js');
  let rr: typeof import('../../repositories/routing.repository.js')['routingRepository'];
  let mr: typeof import('../../repositories/maintenance.repository.js')['maintenanceRepository'];
  let fx: Fixtures; let wcId: string; let eqId: string; let assetId: string;
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    el = await import('../../repositories/equipment-link.repository.js');
    rr = (await import('../../repositories/routing.repository.js')).routingRepository;
    mr = (await import('../../repositories/maintenance.repository.js')).maintenanceRepository;
    fx = await createBaseFixtures();
    wcId = (await rr.createWorkCenter({ name: `Fournil M505 ${RUN}`, hourlyCost: 30, userId: fx.userId })).id;
    eqId = (await p().query(`INSERT INTO production_equipements (nom, type, store_id) VALUES ($1, 'four', $2) RETURNING id`, [`Four à sole Bongard ${RUN}`, fx.storeId])).rows[0].id;
    const acc = (await p().query(`SELECT id FROM accounts LIMIT 1`)).rows[0]?.id;
    if (acc) {
      assetId = (await p().query(
        `INSERT INTO fixed_assets (label, asset_account_id, depreciation_account_id, expense_account_id, acquisition_date, acquisition_cost, duration_years)
         VALUES ($1, $2, $2, $2, CURRENT_DATE, 120000, 10) RETURNING id`, [`Four Bongard sole ${RUN}`, acc])).rows[0].id;
    }
  }, 60_000);

  afterAll(async () => {
    await p().query(`UPDATE production_equipements SET is_active = false, work_center_id = NULL, fixed_asset_id = NULL WHERE id = $1`, [eqId]).catch(() => undefined);
    if (wcId) await p().query(`UPDATE work_centers SET is_active = false WHERE id = $1`, [wcId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('similarité des noms', () => {
    expect(el.nameSimilarity('Four à sole Bongard', 'four bongard SOLE')).toBe(1);
    expect(el.nameSimilarity('Pétrin spirale', 'Four ventilé')).toBe(0);
  });

  it('proposition d\'immobilisation, puis lien validé à la main', async () => {
    let row = (await el.equipmentLinkRepository.overview(fx.storeId)).find(e => e.id === eqId)!;
    expect(row.fixed_asset_id).toBeNull();
    if (assetId) expect(row.asset_proposals.map((a: { id: string }) => a.id)).toContain(assetId);
    await el.equipmentLinkRepository.link(eqId, { workCenterId: wcId, fixedAssetId: assetId ?? null });
    row = (await el.equipmentLinkRepository.overview(fx.storeId)).find(e => e.id === eqId)!;
    expect(row.work_center_id).toBe(wcId);
  });

  it('arrêt → intervention, intervention terminée → arrêt (une seule fois)', async () => {
    const d = await rr.recordDowntime({ workCenterId: wcId, fromTime: new Date(Date.now() - 3600_000).toISOString(), reason: 'panne', createIntervention: true }, fx.userId, fx.storeId);
    expect(d.intervention_id).toBeTruthy();
    const i = (await p().query(`SELECT equipment_id, work_center_downtime_id, status FROM maintenance_interventions WHERE id = $1`, [d.intervention_id])).rows[0];
    expect(i).toMatchObject({ equipment_id: eqId, work_center_downtime_id: d.id, status: 'requested' });
    // Intervention ouverte depuis l'arrêt : sa clôture ne crée pas un second arrêt.
    await mr.setStatus(d.intervention_id, 'in_progress', { userId: fx.userId });
    await mr.setStatus(d.intervention_id, 'done', { userId: fx.userId, workDone: 'Résistance changée' });
    expect((await p().query(`SELECT count(*)::int AS n FROM work_center_downtime WHERE work_center_id = $1`, [wcId])).rows[0].n).toBe(1);

    // Intervention préventive sur l'équipement : sa clôture crée l'arrêt du poste.
    const prev = await mr.create({ title: `Entretien four ${RUN}`, kind: 'preventive', equipmentId: eqId, equipmentLabel: 'Four' }, { userId: fx.userId, storeId: fx.storeId });
    await mr.setStatus(prev!.id, 'in_progress', { userId: fx.userId });
    await mr.setStatus(prev!.id, 'done', { userId: fx.userId, workDone: 'Nettoyage sole' });
    const stops = (await p().query(`SELECT reason, intervention_id FROM work_center_downtime WHERE work_center_id = $1 ORDER BY created_at`, [wcId])).rows;
    expect(stops).toHaveLength(2);
    expect(stops[1]).toMatchObject({ reason: 'maintenance', intervention_id: prev!.id });
  });

  it('intervention saisie depuis la Maintenance avec l\'équipement seul : immobilisation reprise', async () => {
    expect((await mr.equipments(fx.storeId)).map((e: { id: string }) => e.id)).toContain(eqId);
    const i = await mr.create({ title: `Contrôle four ${RUN}`, kind: 'corrective', equipmentId: eqId }, { userId: fx.userId, storeId: fx.storeId });
    const row = (await p().query(`SELECT equipment_id, fixed_asset_id, equipment_label FROM maintenance_interventions WHERE id = $1`, [i!.id])).rows[0];
    expect(row.equipment_id).toBe(eqId);
    if (assetId) expect(row).toMatchObject({ fixed_asset_id: assetId, equipment_label: null });
    else expect(row.equipment_label).toMatch(/Four à sole Bongard/);
  });
});
