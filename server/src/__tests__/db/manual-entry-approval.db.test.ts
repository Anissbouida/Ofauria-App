/**
 * Plan d'action compta, étape 21 (audit C-09) : une écriture manuelle au-dessus du seuil de la règle
 * d'approbation n'est plus comptabilisée par celui qui l'a saisie. Elle reste brouillon, un autre
 * utilisateur l'approuve, et elle est comptabilisée à son nom.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Approbation des écritures manuelles', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let manual: typeof import('../../repositories/manual-entry.repository.js').manualEntryRepository;
  let approvals: typeof import('../../services/approval.service.js').approvalService;
  let fx: Fixtures;
  let requesterId = '';
  const acc: Record<string, string> = {};
  const entryIds: string[] = [];
  const day = new Date().toISOString().slice(0, 10);
  const p = () => testPool();

  const od = (amount: number, description: string) => ({
    journalCode: 'OD', date: day, description: `${description} ${RUN}`,
    lines: [
      { accountId: acc['6181'], debit: amount, credit: 0, label: 'Charge' },
      { accountId: acc['5161'], debit: 0, credit: amount, label: 'Caisse' },
    ],
  });
  const asRequester = () => ({ userId: requesterId, storeId: null as string | null });
  const entry = async (id: string) => (await p().query(`SELECT status, entry_number, posted_by FROM journal_entries WHERE id = $1`, [id])).rows[0];
  const request = async (docId: string) => (await p().query(`SELECT id, status FROM approval_requests WHERE doc_type = 'journal_entry' AND doc_id = $1 ORDER BY requested_at DESC LIMIT 1`, [docId])).rows[0];

  beforeAll(async () => {
    repos = await importRepositories();
    manual = (await import('../../repositories/manual-entry.repository.js')).manualEntryRepository;
    approvals = (await import('../../services/approval.service.js')).approvalService;
    await import('../../services/approval-handlers.js');
    fx = await createBaseFixtures();                       // administrateur : approbateur
    requesterId = (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, store_id) VALUES ($1, 'x', 'Saisie', 'OD', 'manager', $2) RETURNING id`,
      [`saisie-${RUN}@test.local`, fx.storeId])).rows[0].id;
    for (const r of (await p().query(`SELECT id, code FROM accounts WHERE code IN ('6181', '5161')`)).rows) acc[r.code] = r.id;
    await p().query(`UPDATE approval_rules SET enabled = true WHERE code = 'od_montant_eleve'`);
  }, 60_000);

  afterAll(async () => {
    await p().query(`UPDATE approval_rules SET enabled = false WHERE code = 'od_montant_eleve'`).catch(() => undefined);
    const cc = await p().connect();
    try {
      await cc.query(`SET session_replication_role = 'replica'`);
      await cc.query(`DELETE FROM approval_steps WHERE request_id IN (SELECT id FROM approval_requests WHERE doc_id = ANY($1::uuid[]))`, [entryIds]).catch(() => undefined);
      await cc.query(`DELETE FROM approval_requests WHERE doc_id = ANY($1::uuid[])`, [entryIds]).catch(() => undefined);
      await cc.query(`DELETE FROM ledger_audit_log WHERE entry_id = ANY($1::uuid[])`, [entryIds]).catch(() => undefined);
      await cc.query(`DELETE FROM journal_entry_lines WHERE journal_entry_id = ANY($1::uuid[])`, [entryIds]).catch(() => undefined);
      await cc.query(`DELETE FROM journal_entries WHERE id = ANY($1::uuid[])`, [entryIds]).catch(() => undefined);
      await cc.query(`DELETE FROM notifications WHERE target_user_id = $1 OR created_by = $1`, [requesterId]).catch(() => undefined);
      await cc.query(`DELETE FROM users WHERE id = $1`, [requesterId]).catch(() => undefined);
    } finally {
      await cc.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      cc.release();
    }
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('sous le seuil : comptabilisée tout de suite, comme avant', async () => {
    const r = await manual.createAndPost(od(100, 'OD courante'), asRequester());
    entryIds.push(r.id);
    expect(r.pending_approval).toBeUndefined();
    expect((await entry(r.id)).status).toBe('posted');
  });

  it('au-dessus du seuil : reste brouillon et part à approbation', async () => {
    const r = await manual.createAndPost(od(60_000, 'OD importante'), asRequester());
    entryIds.push(r.id);
    expect(r.pending_approval).toBe(true);
    const e = await entry(r.id);
    expect(e.status).toBe('draft');
    expect(e.entry_number).toMatch(/^BROUILLON-/);
    expect((await request(r.id)).status).toBe('pending');
  });

  it('le demandeur ne peut pas approuver sa propre écriture ; l\'administrateur l\'approuve et elle est comptabilisée à son nom', async () => {
    const r = await manual.createAndPost(od(75_000, 'OD à approuver'), asRequester());
    entryIds.push(r.id);
    const req = await request(r.id);
    await expect(approvals.decide(req.id, { userId: requesterId, role: 'manager' }, 'approve'))
      .rejects.toMatchObject({ statusCode: 403 });
    expect((await entry(r.id)).status).toBe('draft');

    await approvals.decide(req.id, { userId: fx.userId, role: 'admin' }, 'approve');
    const e = await entry(r.id);
    expect(e.status).toBe('posted');
    expect(e.entry_number).not.toMatch(/^BROUILLON-/);
    expect(e.posted_by).toBe(fx.userId);                   // l'approbateur, pas le demandeur
  });

  it('un brouillon modifié pendant l\'attente annule la demande en cours', async () => {
    const r = await manual.createAndPost(od(80_000, 'OD modifiée'), asRequester());
    entryIds.push(r.id);
    expect((await request(r.id)).status).toBe('pending');
    await manual.updateDraft(r.id, od(90_000, 'OD modifiée'), asRequester());
    expect((await request(r.id)).status).toBe('cancelled');
  });

  it('un refus laisse le brouillon en place, non comptabilisé', async () => {
    const r = await manual.createAndPost(od(65_000, 'OD refusée'), asRequester());
    entryIds.push(r.id);
    const req = await request(r.id);
    await approvals.decide(req.id, { userId: fx.userId, role: 'admin' }, 'reject', 'Pièce justificative manquante');
    expect((await entry(r.id)).status).toBe('draft');
    expect((await request(r.id)).status).toBe('rejected');
  });
});
