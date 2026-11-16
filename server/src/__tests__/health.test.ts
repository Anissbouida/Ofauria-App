/**
 * G0-05 — sondes de santé : /health/live ne dépend de rien, /health teste la base
 * (503 si elle ne répond pas).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';

process.env.JWT_SECRET ||= 'test-secret-0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL ||= 'postgres://localhost:5432/kalum_test';

const query = vi.hoisted(() => vi.fn());
vi.mock('../config/database.js', async (orig) => {
  const real = await orig<typeof import('../config/database.js')>();
  return { ...real, db: { ...real.db, query } };
});

let app: import('express').Express;
beforeAll(async () => { app = (await import('../app.js')).default; }, 60_000);

describe('Sondes de santé (G0-05)', () => {
  it('/health/live répond sans toucher la base', async () => {
    query.mockClear();
    const r = await request(app).get('/health/live');
    expect(r.status).toBe(200);
    expect(query).not.toHaveBeenCalled();
  });

  it('/health répond 200 quand la base répond', async () => {
    query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body.database).toBe('ok');
  });

  it('/health répond 503 quand la base est injoignable', async () => {
    query.mockRejectedValueOnce(new Error('connexion refusée'));
    const r = await request(app).get('/health');
    expect(r.status).toBe(503);
    expect(r.body.database).toBe('unreachable');
  });
});
