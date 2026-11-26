/**
 * Refonte Utilisateurs, lot 9 (mig 709) — revue des accès en campagnes :
 *  - une seule campagne ouverte, qui reprend les comptes actifs avec leurs signaux ;
 *  - décisions datées et signées (corrigé exige un commentaire, désactivé un compte inactif) ;
 *  - confirmation groupée des comptes sans signal ; clôture refusée tant qu'un compte reste à examiner.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Revue des accès en campagnes (refonte Utilisateurs, lot 9)', () => {
  let app: express.Express;
  const p = () => testPool();
  const users: string[] = [];
  let actorId = ''; let dormantId = ''; let campaignId = '';
  let previousOpen: string[] = [];

  beforeAll(async () => {
    await importRepositories();
    const { accessReviewController } = await import('../../controllers/access-review.controller.js');
    // Une revue déjà ouverte dans la base de test (autre exécution) : mise de côté le temps du test.
    previousOpen = (await p().query(`UPDATE access_review_campaigns SET status = 'closed', closed_at = now() WHERE status = 'open' RETURNING id`)).rows.map(r => r.id);
    actorId = (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active) VALUES ($1, 'x', 'Rev', 'Admin', 'admin', true) RETURNING id`,
      [`rev-actor-${RUN}@test.local`])).rows[0].id;
    dormantId = (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active, created_at) VALUES ($1, 'x', 'Rev', 'Dormant', 'cashier', true, now() - interval '200 days') RETURNING id`,
      [`rev-dormant-${RUN}@test.local`])).rows[0].id;
    users.push(actorId, dormantId);
    app = express(); app.use(express.json());
    app.use((req, _res, next) => { (req as never as { user: unknown }).user = { userId: actorId, role: 'admin' }; next(); });
    app.get('/reviews', (req, res) => accessReviewController.campaigns(req as never, res));
    app.post('/reviews', (req, res) => accessReviewController.openCampaign(req as never, res));
    app.get('/reviews/:id', (req, res) => accessReviewController.campaign(req as never, res));
    app.put('/reviews/:id/items/:userId', (req, res) => accessReviewController.decide(req as never, res));
    app.delete('/reviews/:id/items/:userId', (req, res) => accessReviewController.resetDecision(req as never, res));
    app.post('/reviews/:id/confirm-clean', (req, res) => accessReviewController.confirmClean(req as never, res));
    app.post('/reviews/:id/close', (req, res) => accessReviewController.closeCampaign(req as never, res));
  });

  afterAll(async () => {
    if (campaignId) await p().query(`DELETE FROM access_review_campaigns WHERE id = $1`, [campaignId]);
    if (previousOpen.length) await p().query(`UPDATE access_review_campaigns SET status = 'open', closed_at = NULL WHERE id = ANY($1::uuid[])`, [previousOpen]);
    try { await p().query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]); }
    catch { await p().query(`UPDATE users SET is_active = false WHERE id = ANY($1::uuid[])`, [users]); }
    await closeTestPool();
  });

  it('ouvre une seule campagne, avec les comptes actifs et leurs signaux', async () => {
    const res = await request(app).post('/reviews').send({ label: 'Revue de test', dueOn: '2026-12-31' });
    expect(res.status).toBe(200);
    campaignId = res.body.data.id;
    expect((await request(app).post('/reviews').send({ label: 'Deuxième' })).status).toBe(409);
    const detail = (await request(app).get(`/reviews/${campaignId}`)).body.data;
    const dormant = detail.items.find((i: { userId: string }) => i.userId === dormantId);
    expect(dormant.signals.dormantDays).toBeGreaterThanOrEqual(60);
    expect(dormant.snapshot.signals.dormantDays).toBeGreaterThanOrEqual(60);
    expect(detail.items.some((i: { userId: string }) => i.userId === actorId)).toBe(true);
  });

  it('enregistre des décisions datées et signées', async () => {
    expect((await request(app).put(`/reviews/${campaignId}/items/${dormantId}`).send({ decision: 'corrected' })).status).toBe(400);
    expect((await request(app).put(`/reviews/${campaignId}/items/${dormantId}`).send({ decision: 'deactivated' })).status).toBe(409);
    await p().query(`UPDATE users SET is_active = false WHERE id = $1`, [dormantId]);
    expect((await request(app).put(`/reviews/${campaignId}/items/${dormantId}`).send({ decision: 'deactivated', comment: 'Compte dormant' })).status).toBe(200);
    const row = (await p().query(`SELECT decision, decided_by, decided_at FROM access_review_items WHERE campaign_id = $1 AND user_id = $2`, [campaignId, dormantId])).rows[0];
    expect(row).toEqual(expect.objectContaining({ decision: 'deactivated', decided_by: actorId }));
    expect(row.decided_at).not.toBeNull();
  });

  it('ne laisse pas décider pour son propre compte quand un autre administrateur existe', async () => {
    const others = Number((await p().query(`SELECT count(*) FROM users WHERE role = 'admin' AND is_active AND NOT is_system AND id <> $1`, [actorId])).rows[0].count);
    const res = await request(app).put(`/reviews/${campaignId}/items/${actorId}`).send({ decision: 'confirmed' });
    expect(res.status).toBe(others > 0 ? 403 : 200);
    if (others === 0) await request(app).delete(`/reviews/${campaignId}/items/${actorId}`);
  });

  it('refuse la clôture tant qu\'un compte reste à examiner, puis clôture', async () => {
    const pending = Number((await p().query(`SELECT count(*) FROM access_review_items WHERE campaign_id = $1 AND decision IS NULL`, [campaignId])).rows[0].count);
    expect(pending).toBeGreaterThan(0);
    expect((await request(app).post(`/reviews/${campaignId}/close`)).status).toBe(409);
    await request(app).post(`/reviews/${campaignId}/confirm-clean`);
    // Comptes restants (avec signal) : confirmés un par un.
    for (const r of (await p().query(`SELECT user_id FROM access_review_items WHERE campaign_id = $1 AND decision IS NULL AND user_id <> $2`, [campaignId, actorId])).rows) {
      expect((await request(app).put(`/reviews/${campaignId}/items/${r.user_id}`).send({ decision: 'confirmed' })).status).toBe(200);
    }
    // Son propre compte : décidé par un autre administrateur (simulé en base).
    await p().query(`UPDATE access_review_items SET decision = 'confirmed', decided_at = now() WHERE campaign_id = $1 AND user_id = $2 AND decision IS NULL`, [campaignId, actorId]);
    expect((await request(app).post(`/reviews/${campaignId}/close`)).status).toBe(200);
    expect((await request(app).put(`/reviews/${campaignId}/items/${actorId}`).send({ decision: 'confirmed' })).status).toBe(409);
    const list = (await request(app).get('/reviews')).body.data;
    expect(list.find((c: { id: string }) => c.id === campaignId)).toEqual(expect.objectContaining({ status: 'closed' }));
  });
});
