/**
 * G6-05 — PUT /users/me/locale : chaque utilisateur règle la langue de SON interface
 * (fr, ar, en, ou null = défaut de la société). Corps validé par zod, aucune clé de droit.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET ||= 'test-secret-0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL ||= 'postgres://localhost:5432/kalum_test';

const setLocale = vi.hoisted(() => vi.fn());
vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { userId: '11111111-1111-1111-1111-111111111111', role: 'cashier' };
    next();
  },
}));
vi.mock('../repositories/user.repository.js', async (orig) => {
  const real = await orig<typeof import('../repositories/user.repository.js')>();
  return { ...real, userRepository: { ...real.userRepository, setLocale } };
});

let app: express.Express;
beforeAll(async () => {
  const { default: usersRouter } = await import('../routes/users.routes.js');
  app = express();
  app.use(express.json());
  app.use('/users', usersRouter);
}, 60_000);
beforeEach(() => { setLocale.mockReset(); setLocale.mockResolvedValue(true); });

describe('PUT /users/me/locale (G6-05)', () => {
  it('enregistre la langue de l\'utilisateur connecté', async () => {
    const r = await request(app).put('/users/me/locale').send({ locale: 'ar' });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ locale: 'ar' });
    expect(setLocale).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111', 'ar');
  });

  it('accepte null (retour à la langue de la société)', async () => {
    const r = await request(app).put('/users/me/locale').send({ locale: null });
    expect(r.status).toBe(200);
    expect(setLocale).toHaveBeenCalledWith(expect.any(String), null);
  });

  it('refuse une langue inconnue ou un champ en trop', async () => {
    expect((await request(app).put('/users/me/locale').send({ locale: 'de' })).status).toBe(400);
    expect((await request(app).put('/users/me/locale').send({ locale: 'fr', role: 'admin' })).status).toBe(400);
    expect((await request(app).put('/users/me/locale').send({})).status).toBe(400);
    expect(setLocale).not.toHaveBeenCalled();
  });

  it('ne passe par aucune garde de droit (un caissier règle sa propre langue)', async () => {
    const r = await request(app).put('/users/me/locale').send({ locale: 'en' });
    expect(r.status).toBe(200);
  });

  it('404 si le compte n\'existe plus', async () => {
    setLocale.mockResolvedValueOnce(false);
    expect((await request(app).put('/users/me/locale').send({ locale: 'fr' })).status).toBe(404);
  });
});
