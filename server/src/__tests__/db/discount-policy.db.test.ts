/**
 * G0-19 — plafond de remise par rôle, partagé entre commandes et caisse.
 * Caissier à 10 % : 8 % accepté, 15 % refusé, 15 % accepté avec le PIN d'un responsable.
 * Le responsable ne valide que dans la limite de son propre plafond ; un mauvais PIN
 * est compté comme un échec de connexion.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Request } from 'express';
import { hasTestDb, testPool, closeTestPool, TEST_DATABASE_URL, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Plafond de remise par rôle (G0-19)', () => {
  const p = () => testPool();
  let policy: typeof import('../../services/discount-policy.js');
  let database: typeof import('../../config/database.js');
  let previous: unknown;
  const ids: Record<'manager' | 'admin' | 'cashier', string> = { manager: '', admin: '', cashier: '' };
  const PIN = '482915';
  const req = { ip: '127.0.0.1', headers: {}, socket: {}, get: () => undefined } as unknown as Request;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    database = await import('../../config/database.js');
    policy = await import('../../services/discount-policy.js');
    const { hashPin } = await import('../../utils/hash.js');
    const pin = await hashPin(PIN);
    previous = (await p().query(`SELECT value FROM module_parameters WHERE key = 'sales.pricing'`)).rows[0]?.value;
    await p().query(
      `INSERT INTO module_parameters (key, value) VALUES ('sales.pricing', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify({ max_discount_pct_sales: 10, max_discount_pct_manager: 30, max_price_override_pct: 30 })]);
    for (const role of ['manager', 'admin', 'cashier'] as const) {
      ids[role] = (await p().query(
        `INSERT INTO users (email, password_hash, first_name, last_name, role, pin_code, pin_length)
         VALUES ($1, 'x', $2, 'G019', $3, $4, 6) RETURNING id`, [`g019-${role}-${RUN}@test.local`, `Test${role}`, role, pin])).rows[0].id;
    }
  }, 60_000);

  afterAll(async () => {
    if (previous) await p().query(`UPDATE module_parameters SET value = $1::jsonb WHERE key = 'sales.pricing'`, [JSON.stringify(previous)]).catch(() => undefined);
    else await p().query(`DELETE FROM module_parameters WHERE key = 'sales.pricing'`).catch(() => undefined);
    const users = Object.values(ids);
    await p().query(`DELETE FROM auth_events WHERE user_id = ANY($1)`, [users]).catch(() => undefined);
    await p().query(`DELETE FROM users WHERE id = ANY($1)`, [users]).catch(() => undefined);
    await database.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('plafond par rôle : caissier 10 %, gérant 30 %, administrateur non borné', async () => {
    expect(await policy.discountCeiling('cashier')).toBe(10);
    expect(await policy.discountCeiling('manager')).toBe(30);
    expect(await policy.discountCeiling('admin')).toBeNull();
    expect(await policy.exceededCeiling(8, 'cashier')).toBeNull();      // 8 % accepté
    expect(await policy.exceededCeiling(10, 'cashier')).toBeNull();     // le plafond lui-même est permis
    expect(await policy.exceededCeiling(15, 'cashier')).toBe(10);       // 15 % refusé
    expect(await policy.exceededCeiling(80, 'admin')).toBeNull();
    expect(await policy.exceededCeiling(0, 'cashier')).toBeNull();
  });

  it('15 % accepté avec le PIN d\'un gérant', async () => {
    expect(await policy.approveDiscountByPin(req, { userId: ids.manager, pinCode: PIN }, 15)).toEqual({ ok: true, approverId: ids.manager });
  });

  it('le gérant ne valide pas au-delà de son plafond ; l\'administrateur oui', async () => {
    expect(await policy.approveDiscountByPin(req, { userId: ids.manager, pinCode: PIN }, 40)).toMatchObject({ ok: false, status: 403 });
    expect(await policy.approveDiscountByPin(req, { userId: ids.admin, pinCode: PIN }, 40)).toEqual({ ok: true, approverId: ids.admin });
  });

  it('mauvais PIN : refusé et compté comme un échec', async () => {
    const r = await policy.approveDiscountByPin(req, { userId: ids.manager, pinCode: '000000' }, 15);
    expect(r).toMatchObject({ ok: false, status: 403 });
    const failed = (await p().query(`SELECT failed_login_count FROM users WHERE id = $1`, [ids.manager])).rows[0].failed_login_count;
    expect(Number(failed)).toBe(1);
    // Un bon PIN remet le compteur à zéro.
    await policy.approveDiscountByPin(req, { userId: ids.manager, pinCode: PIN }, 15);
    expect(Number((await p().query(`SELECT failed_login_count FROM users WHERE id = $1`, [ids.manager])).rows[0].failed_login_count)).toBe(0);
  });

  it('un caissier ne peut pas valider, même avec son PIN', async () => {
    expect(await policy.approveDiscountByPin(req, { userId: ids.cashier, pinCode: PIN }, 15)).toMatchObject({ ok: false, status: 403 });
  });

  it('la liste des responsables ne contient que gérants et administrateurs avec PIN', async () => {
    const mine = (await policy.discountApprovers()).filter(a => Object.values(ids).includes(a.id)).map(a => a.role).sort();
    expect(mine).toEqual(['admin', 'manager']);
  });
});
