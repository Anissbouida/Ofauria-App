/**
 * Plan d'action compta, étape 22 (audit C-09) : le RIB d'un fournisseur déjà pourvu d'un RIB ne se
 * change plus d'un seul clic. Le changement est une demande approuvée par un autre utilisateur ; le
 * RIB courant reste en place jusque-là.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

const RIB_A = '011780000012345678901234';
const RIB_B = '007810000098765432109876';
const RIB_C = '230810000011122233344455';

describe.skipIf(!hasTestDb)('Changement de RIB fournisseur sous contrôle', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let suppliers: typeof import('../../repositories/supplier.repository.js').supplierRepository;
  let approvals: typeof import('../../services/approval.service.js').approvalService;
  let fx: Fixtures;
  let managerId = '';
  const supplierIds: string[] = [];
  const p = () => testPool();

  const newSupplier = async (rib: string | null) => {
    const id = (await p().query(`INSERT INTO suppliers (name, rib) VALUES ($1, $2) RETURNING id`, [`Fournisseur RIB ${supplierIds.length} ${RUN}`, rib])).rows[0].id as string;
    supplierIds.push(id);
    return id;
  };
  const rib = async (id: string) => (await p().query(`SELECT rib, rib_changed_at FROM suppliers WHERE id = $1`, [id])).rows[0];
  const change = async (id: string) => (await p().query(`SELECT id, status, old_rib, new_rib, decided_by FROM bank_detail_changes WHERE party_id = $1 ORDER BY requested_at DESC LIMIT 1`, [id])).rows[0];
  const setMode = (mode: string) => p().query(`UPDATE module_parameters SET value = $1::jsonb WHERE key = 'payment.rib_change_control'`, [JSON.stringify({ mode })]);

  beforeAll(async () => {
    repos = await importRepositories();
    suppliers = (await import('../../repositories/supplier.repository.js')).supplierRepository;
    approvals = (await import('../../services/approval.service.js')).approvalService;
    await import('../../services/approval-handlers.js');
    fx = await createBaseFixtures();                        // administrateur : approbateur final
    managerId = (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, store_id) VALUES ($1, 'x', 'Achats', 'RIB', 'manager', $2) RETURNING id`,
      [`rib-${RUN}@test.local`, fx.storeId])).rows[0].id;
    await setMode('approval');
  }, 60_000);

  afterAll(async () => {
    await setMode('approval').catch(() => undefined);
    const cc = await p().connect();
    try {
      await cc.query(`SET session_replication_role = 'replica'`);
      await cc.query(`DELETE FROM approval_steps WHERE request_id IN (SELECT id FROM approval_requests WHERE doc_id IN (SELECT id FROM bank_detail_changes WHERE party_id = ANY($1::uuid[])))`, [supplierIds]).catch(() => undefined);
      await cc.query(`DELETE FROM approval_requests WHERE doc_id IN (SELECT id FROM bank_detail_changes WHERE party_id = ANY($1::uuid[]))`, [supplierIds]).catch(() => undefined);
      await cc.query(`DELETE FROM bank_detail_changes WHERE party_id = ANY($1::uuid[])`, [supplierIds]).catch(() => undefined);
      await cc.query(`DELETE FROM purchasing_master_audit WHERE supplier_id = ANY($1::uuid[])`, [supplierIds]).catch(() => undefined);
      await cc.query(`DELETE FROM suppliers WHERE id = ANY($1::uuid[])`, [supplierIds]).catch(() => undefined);
      await cc.query(`DELETE FROM users WHERE id = $1`, [managerId]).catch(() => undefined);
    } finally {
      await cc.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      cc.release();
    }
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('le premier RIB d\'un fournisseur sans RIB s\'applique sans approbation', async () => {
    const id = await newSupplier(null);
    const r = await suppliers.update(id, { rib: RIB_A }, managerId);
    expect((r as { rib_pending_approval?: boolean }).rib_pending_approval).toBeUndefined();
    expect((await rib(id)).rib).toBe(RIB_A);
  });

  it('un gérant change le RIB : le RIB courant reste, une demande part à approbation', async () => {
    const id = await newSupplier(RIB_A);
    const r = await suppliers.update(id, { rib: RIB_B, bankName: 'Autre banque' }, managerId);
    expect((r as { rib_pending_approval?: boolean }).rib_pending_approval).toBe(true);
    expect((await rib(id)).rib).toBe(RIB_A);                          // inchangé
    const c = await change(id);
    expect(c).toMatchObject({ status: 'pending', old_rib: RIB_A, new_rib: RIB_B });
  });

  it('le demandeur ne peut pas approuver ; l\'administrateur approuve et le RIB change', async () => {
    const id = await newSupplier(RIB_A);
    await suppliers.update(id, { rib: RIB_B }, managerId);
    const c = await change(id);
    const req = (await p().query(`SELECT id FROM approval_requests WHERE doc_type = 'bank_detail_change' AND doc_id = $1`, [c.id])).rows[0];
    await expect(approvals.decide(req.id, { userId: managerId, role: 'manager' }, 'approve')).rejects.toMatchObject({ statusCode: 403 });
    expect((await rib(id)).rib).toBe(RIB_A);

    await approvals.decide(req.id, { userId: fx.userId, role: 'admin' }, 'approve');
    const after = await rib(id);
    expect(after.rib).toBe(RIB_B);
    expect(after.rib_changed_at).not.toBeNull();
    expect(await change(id)).toMatchObject({ status: 'approved', decided_by: fx.userId });
  });

  it('un refus laisse le RIB en place', async () => {
    const id = await newSupplier(RIB_A);
    await suppliers.update(id, { rib: RIB_C }, managerId);
    const c = await change(id);
    const req = (await p().query(`SELECT id FROM approval_requests WHERE doc_type = 'bank_detail_change' AND doc_id = $1`, [c.id])).rows[0];
    await approvals.decide(req.id, { userId: fx.userId, role: 'admin' }, 'reject', 'RIB non confirmé par le fournisseur');
    expect((await rib(id)).rib).toBe(RIB_A);
    expect((await change(id)).status).toBe('rejected');
  });

  it('une nouvelle demande remplace la précédente en attente', async () => {
    const id = await newSupplier(RIB_A);
    await suppliers.update(id, { rib: RIB_B }, managerId);
    const first = await change(id);
    await suppliers.update(id, { rib: RIB_C }, managerId);
    const second = await change(id);
    expect(second.id).not.toBe(first.id);
    expect(second).toMatchObject({ status: 'pending', new_rib: RIB_C });
    expect((await p().query(`SELECT status FROM bank_detail_changes WHERE id = $1`, [first.id])).rows[0].status).toBe('cancelled');
  });

  it('l\'administrateur, approbateur final, change tout de suite ; le changement reste tracé', async () => {
    const id = await newSupplier(RIB_A);
    await suppliers.update(id, { rib: RIB_B }, fx.userId);
    expect((await rib(id)).rib).toBe(RIB_B);
    expect(await change(id)).toMatchObject({ status: 'approved', decided_by: fx.userId });
  });

  it('un RIB inchangé n\'ouvre aucune demande', async () => {
    const id = await newSupplier(RIB_A);
    await suppliers.update(id, { rib: '0117 8000 0012 3456 7890 1234', name: 'Renommé' } as never, managerId);
    expect((await p().query(`SELECT count(*)::int AS n FROM bank_detail_changes WHERE party_id = $1`, [id])).rows[0].n).toBe(0);
  });

  it('contrôle désactivé : le changement s\'applique tout de suite', async () => {
    await setMode('off');
    const id = await newSupplier(RIB_A);
    await suppliers.update(id, { rib: RIB_B }, managerId);
    expect((await rib(id)).rib).toBe(RIB_B);
    await setMode('approval');
  });
});
