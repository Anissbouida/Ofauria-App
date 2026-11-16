/**
 * G0-02 — limiteurs de débit : la requête au-delà du seuil de la minute reçoit 429,
 * et l'API publique compte par clé d'API (deux clés ne se gênent pas).
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeLimiter, apiKeyOrIp } from '../middleware/rate-limit.middleware.js';

function appWith(max: number) {
  const app = express();
  app.use(makeLimiter(max, apiKeyOrIp, 'trop'));
  app.get('/ping', (_req, res) => { res.json({ ok: true }); });
  return app;
}

describe('Limiteurs de débit (G0-02)', () => {
  it('la 121ᵉ requête de la minute reçoit 429', async () => {
    const app = appWith(120);
    for (let i = 0; i < 120; i++) {
      const r = await request(app).get('/ping').set('Authorization', 'Bearer kalum_aaaa');
      expect(r.status).toBe(200);
    }
    const blocked = await request(app).get('/ping').set('Authorization', 'Bearer kalum_aaaa');
    expect(blocked.status).toBe(429);
    expect(blocked.body.success).toBe(false);
  });

  it('compte par clé d\'API : une autre clé n\'est pas bloquée', async () => {
    const app = appWith(2);
    await request(app).get('/ping').set('Authorization', 'Bearer kalum_aaaa');
    await request(app).get('/ping').set('Authorization', 'Bearer kalum_aaaa');
    expect((await request(app).get('/ping').set('Authorization', 'Bearer kalum_aaaa')).status).toBe(429);
    expect((await request(app).get('/ping').set('Authorization', 'Bearer kalum_bbbb')).status).toBe(200);
  });

  it('un seuil à 0 désactive le limiteur', async () => {
    const app = appWith(0);
    for (let i = 0; i < 5; i++) expect((await request(app).get('/ping')).status).toBe(200);
  });
});
