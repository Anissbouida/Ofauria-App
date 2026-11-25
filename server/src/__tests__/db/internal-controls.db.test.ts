/**
 * Refonte Utilisateurs, lot 5 (mig 704) — contrôles internes réunis :
 *  - séparation des tâches sur les pièces : mode réglable depuis Utilisateurs, « Désactivé »
 *    ne bloque ni ne journalise ;
 *  - plafonds : seuls les types de pièce qui lisent leur plafond sont acceptés, la liste dit
 *    s'il est appliqué et quels circuits couvrent le même type ;
 *  - délégations réunies : approbations seulement (motif, début futur = programmée), prolongation,
 *    retrait.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Contrôles internes (refonte Utilisateurs, lot 5)', () => {
  let app: express.Express;
  const p = () => testPool();
  const users: string[] = [];
  let actorId = ''; let fromId = ''; let toId = '';
  let previousMode: unknown = null;

  const mkUser = async (tag: string, role = 'manager') => (await p().query(
    `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active) VALUES ($1, 'x', $2, 'Test', $3, true) RETURNING id`,
    [`ctrl-${tag}-${RUN}@test.local`, tag, role])).rows[0].id as string;

  beforeAll(async () => {
    await importRepositories();
    const { governanceController } = await import('../../controllers/governance.controller.js');
    actorId = await mkUser('actor'); fromId = await mkUser('from'); toId = await mkUser('to', 'cashier');
    users.push(actorId, fromId, toId);
    previousMode = (await p().query(`SELECT value FROM module_parameters WHERE key = 'purchasing.sod_mode'`)).rows[0]?.value ?? null;
    app = express(); app.use(express.json());
    app.use((req, _res, next) => { (req as never as { user: unknown }).user = { userId: actorId, role: 'admin' }; next(); });
    app.get('/sod/documents', (req, res) => governanceController.documentSod(req as never, res));
    app.put('/sod/documents/mode', (req, res) => governanceController.setDocumentSodMode(req as never, res));
    app.get('/limits', (req, res) => governanceController.limitsList(req as never, res));
    app.post('/limits', (req, res) => governanceController.limitsSet(req as never, res));
    app.get('/delegations', (req, res) => governanceController.delegationsList(req as never, res));
    app.post('/delegations', (req, res) => governanceController.delegationsCreate(req as never, res));
    app.put('/delegations/:kind/:id', (req, res) => governanceController.delegationsExtend(req as never, res));
    app.delete('/delegations/approvals/:id', (req, res) => governanceController.approvalDelegationRemove(req as never, res));
  });

  afterAll(async () => {
    if (previousMode) await p().query(`UPDATE module_parameters SET value = $1 WHERE key = 'purchasing.sod_mode'`, [JSON.stringify(previousMode)]);
    await p().query(`DELETE FROM approval_delegations WHERE from_user_id = ANY($1::uuid[]) OR to_user_id = ANY($1::uuid[])`, [users]);
    await p().query(`DELETE FROM approval_limits WHERE role_code = 'cashier' AND updated_by = $1`, [actorId]).catch(() => undefined);
    try { await p().query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]); }
    catch { await p().query(`UPDATE users SET is_active = false WHERE id = ANY($1::uuid[])`, [users]); }
    await closeTestPool();
  });

  it('règle le mode des pièces ; « Désactivé » ne journalise rien', async () => {
    expect((await request(app).put('/sod/documents/mode').send({ mode: 'n_importe' })).status).toBe(400);
    expect((await request(app).put('/sod/documents/mode').send({ mode: 'off' })).status).toBe(200);
    const read = await request(app).get('/sod/documents');
    expect(read.body.data.mode).toBe('off');
    expect(read.body.data.rules.length).toBeGreaterThan(0);
    const before = Number((await p().query(`SELECT count(*) FROM sod_violations`)).rows[0].count);
    await p().query(`SELECT fn_sod_enforce('GR_NOT_BUYER', 'purchase_order', gen_random_uuid(), $1, 'test')`, [actorId]);
    expect(Number((await p().query(`SELECT count(*) FROM sod_violations`)).rows[0].count)).toBe(before);
  });

  it('refuse un plafond qui ne serait lu nulle part ; la liste dit s\'il est appliqué', async () => {
    const refused = await request(app).post('/limits').send({ roleCode: 'cashier', documentType: 'invoice', maxAmount: 100 });
    expect(refused.status).toBe(400);
    const ok = await request(app).post('/limits').send({ roleCode: 'cashier', documentType: 'purchase_order', maxAmount: 1234 });
    expect(ok.status).toBe(200);
    const list = await request(app).get('/limits');
    const row = list.body.data.find((r: { role_code: string; document_type: string }) => r.role_code === 'cashier' && r.document_type === 'purchase_order');
    expect(row.enforced).toBe(true);
    expect(Array.isArray(row.circuits)).toBe(true);
    expect(list.body.meta.enforcedTypes).toEqual(['purchase_order']);
  });

  it('crée une délégation des approbations programmée, la prolonge et la retire', async () => {
    const start = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const end = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);
    const res = await request(app).post('/delegations').send({ kind: 'approvals', fromUserId: fromId, toUserId: toId, startsAt: start, endsAt: end, reason: 'Salon professionnel' });
    expect(res.status).toBe(201);
    const id = res.body.data.id as string;
    const listed = (await request(app).get('/delegations')).body.data.find((d: { id: string }) => d.id === id);
    expect(listed).toEqual(expect.objectContaining({ kind: 'approvals', status: 'scheduled', reason: 'Salon professionnel', active: false }));
    const later = new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10);
    expect((await request(app).put(`/delegations/approvals/${id}`).send({ endsAt: later })).status).toBe(200);
    expect((await request(app).put(`/delegations/approvals/${id}`).send({ endsAt: '2000-01-01' })).status).toBe(404);
    const ends = (await p().query(`SELECT ends_on::text FROM approval_delegations WHERE id = $1`, [id])).rows[0].ends_on;
    expect(ends).toBe(later);
    expect((await request(app).delete(`/delegations/approvals/${id}`)).status).toBe(200);
    expect((await p().query(`SELECT 1 FROM approval_delegations WHERE id = $1`, [id])).rows.length).toBe(0);
  });

  it('refuse une délégation de rôle sans rôle connu', async () => {
    const end = new Date(Date.now() + 86_400_000).toISOString();
    expect((await request(app).post('/delegations').send({ fromUserId: fromId, toUserId: toId, roleCode: 'inconnu_xyz', endsAt: end })).status).toBe(400);
  });
});
