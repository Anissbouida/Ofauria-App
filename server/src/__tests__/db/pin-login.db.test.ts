/**
 * G0-06 (plan d'action 2026-11) — connexion par PIN.
 *
 *  - une tentative ne déclenche qu'UNE comparaison de hachage, quel que soit le
 *    nombre de comptes dotés d'un PIN ;
 *  - cinq échecs verrouillent le compte : la sixième tentative est refusée (423)
 *    même avec le bon PIN, sans nouvelle comparaison ;
 *  - les tuiles n'exposent que le prénom et l'initiale du nom ;
 *  - un mot de passe hors politique impose son changement.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { hasTestDb, testPool, closeTestPool, TEST_DATABASE_URL, RUN } from './helpers.js';

vi.mock('../../utils/hash.js', async (orig) => {
  const real = await orig<typeof import('../../utils/hash.js')>();
  return { ...real, comparePin: vi.fn(real.comparePin) };
});

describe.skipIf(!hasTestDb)('Connexion par PIN (G0-06)', () => {
  const p = () => testPool();
  let authController: typeof import('../../controllers/auth.controller.js')['authController'];
  let hash: typeof import('../../utils/hash.js');
  const ids: string[] = [];
  let target: string;

  const fakeRes = () => {
    const r = { statusCode: 200, body: undefined as any,
      status(c: number) { r.statusCode = c; return r; },
      json(b: unknown) { r.body = b; return r; },
      cookie() { return r; }, clearCookie() { return r; } };
    return r;
  };
  const fakeReq = (body: unknown, user?: unknown) => ({ body, user, headers: {}, ip: '127.0.0.1', socket: {} });
  const pinLogin = async (userId: string, pinCode: string) => {
    const res = fakeRes();
    await authController.pinLogin(fakeReq({ userId, pinCode }) as never, res as never);
    return res;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    ({ authController } = await import('../../controllers/auth.controller.js'));
    hash = await import('../../utils/hash.js');
    const pin = await hash.hashPin('482915');
    const other = await hash.hashPin('111111');
    const pw = await hash.hashPassword('court');
    // Trois comptes dotés d'un PIN : avant G0-06, une tentative les comparait tous.
    for (const [i, h] of [pin, other, other].entries()) {
      const r = await p().query(
        `INSERT INTO users (email, password_hash, first_name, last_name, role, pin_code) VALUES ($1,$2,$3,'Benali','cashier',$4) RETURNING id`,
        [`pin${i}-${RUN}@test.local`, pw, `Caisse${i}`, h]);
      ids.push(r.rows[0].id);
    }
    target = ids[0];
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM auth_events WHERE user_id = ANY($1)`, [ids]).catch(() => undefined);
    await p().query(`DELETE FROM user_roles WHERE user_id = ANY($1)`, [ids]).catch(() => undefined);
    await p().query(`DELETE FROM users WHERE id = ANY($1)`, [ids]).catch(() => undefined);
    await closeTestPool();
  });

  it('les tuiles n\'exposent que le prénom et l\'initiale', async () => {
    const res = fakeRes();
    await authController.pinUsers(fakeReq({}) as never, res as never);
    const mine = res.body.data.find((u: { id: string }) => u.id === target);
    expect(mine).toEqual({ id: target, firstName: 'Caisse0', lastInitial: 'B' });
    expect(JSON.stringify(res.body)).not.toContain('@test.local');
  });

  it('une tentative = une seule comparaison de hachage', async () => {
    vi.mocked(hash.comparePin).mockClear();
    const res = await pinLogin(target, '482915');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.user.id).toBe(target);
    expect(hash.comparePin).toHaveBeenCalledTimes(1);
    // La longueur du PIN est apprise à la connexion réussie.
    expect((await p().query(`SELECT pin_length FROM users WHERE id = $1`, [target])).rows[0].pin_length).toBe(6);
  });

  it('le PIN d\'un autre compte ne connecte pas', async () => {
    const res = await pinLogin(target, '111111');
    expect(res.statusCode).toBe(401);
    await p().query(`UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1`, [target]);
  });

  it('un compte inconnu ou sans PIN reçoit 401 après une comparaison factice', async () => {
    vi.mocked(hash.comparePin).mockClear();
    const res = await pinLogin('00000000-0000-4000-8000-000000000000', '482915');
    expect(res.statusCode).toBe(401);
    expect(hash.comparePin).toHaveBeenCalledTimes(1);
  });

  it('cinq échecs verrouillent : la sixième tentative est refusée, même avec le bon PIN', async () => {
    for (let i = 1; i <= 4; i++) expect((await pinLogin(target, '000000')).statusCode).toBe(401);
    expect((await pinLogin(target, '000000')).statusCode).toBe(423); // 5ᵉ échec : verrouillage
    vi.mocked(hash.comparePin).mockClear();
    const sixth = await pinLogin(target, '482915');
    expect(sixth.statusCode).toBe(423);
    expect(hash.comparePin).not.toHaveBeenCalled();
    const ev = (await p().query(`SELECT count(*)::int AS n FROM auth_events WHERE user_id = $1 AND event_type = 'account_locked'`, [target])).rows[0].n;
    expect(ev).toBe(1);
    await p().query(`UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1`, [target]);
  }, 60_000);

  it('un mot de passe hors politique impose son changement, levé après changement', async () => {
    const res = fakeRes();
    await authController.login(fakeReq({ email: `pin0-${RUN}@test.local`, password: 'court' }) as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.user.mustChangePassword).toBe(true);
    expect((await p().query(`SELECT must_change_password FROM users WHERE id = $1`, [target])).rows[0].must_change_password).toBe(true);

    const bad = fakeRes();
    await authController.changePassword(fakeReq({ currentPassword: 'faux', newPassword: 'Nouveau-Secret-2026!' }, { userId: target }) as never, bad as never);
    expect(bad.statusCode).toBe(400);

    const ok = fakeRes();
    await authController.changePassword(fakeReq({ currentPassword: 'court', newPassword: 'Nouveau-Secret-2026!' }, { userId: target }) as never, ok as never);
    expect(ok.statusCode).toBe(200);
    expect((await p().query(`SELECT must_change_password FROM users WHERE id = $1`, [target])).rows[0].must_change_password).toBe(false);

    const again = fakeRes();
    await authController.login(fakeReq({ email: `pin0-${RUN}@test.local`, password: 'Nouveau-Secret-2026!' }) as never, again as never);
    expect(again.body.data.user.mustChangePassword).toBe(false);
  }, 60_000);
});
