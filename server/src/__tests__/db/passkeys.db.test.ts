/**
 * Passkeys (mig 705) — parcours complet avec un appareil simulé (clé ES256 générée en logiciel,
 * attestation « none ») passé par les vrais contrôleurs :
 *  - ajout d'une passkey (options → réponse de l'appareil → clé publique enregistrée) ;
 *  - connexion sans mot de passe ; la même réponse rejouée est refusée ;
 *  - compte protégé : le mot de passe seul ne suffit plus, la passkey sert de second facteur ;
 *  - signature falsifiée, adresse non autorisée, passkey d'un autre compte : refus ;
 *  - une passkey satisfait l'exigence de double authentification ; la dernière ne se supprime
 *    pas tant qu'elle est exigée ; « Réinitialiser » (administrateur) efface les passkeys.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

const ORIGIN = 'http://localhost:5173';
const RP_ID = 'localhost';
const b64u = (b: Uint8Array | Buffer) => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array | Buffer | string) => createHash('sha256').update(b).digest();
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

/** Appareil simulé : une paire de clés P-256 par passkey. */
class SoftAuthenticator {
  readonly credId = randomBytes(32);
  private readonly key: KeyObject;
  private readonly cosePub: Uint8Array;
  private counter = 0;
  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.key = privateKey;
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    this.cosePub = isoCBOR.encode(new Map<number, number | Uint8Array>([
      [1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')],
    ]));
  }
  create(options: { challenge: string }, origin = ORIGIN) {
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }));
    const credLen = Buffer.alloc(2); credLen.writeUInt16BE(this.credId.length);
    // Drapeaux : présence (0x01) + vérification de l'utilisateur (0x04) + données de clé (0x40).
    const authData = Buffer.concat([sha256(RP_ID), Buffer.from([0x45]), u32(0), Buffer.alloc(16), credLen, this.credId, Buffer.from(this.cosePub)]);
    const attestationObject = isoCBOR.encode(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]) as never);
    return {
      id: b64u(this.credId), rawId: b64u(this.credId), type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ['internal'] },
    };
  }
  get(options: { challenge: string }, opts: { origin?: string; tamper?: boolean } = {}) {
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: opts.origin ?? ORIGIN, crossOrigin: false }));
    const authData = Buffer.concat([sha256(RP_ID), Buffer.from([0x05]), u32(++this.counter)]);
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), this.key);
    if (opts.tamper) signature[signature.length - 1] ^= 0xff;
    return {
      id: b64u(this.credId), rawId: b64u(this.credId), type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature) },
    };
  }
}

describe.skipIf(!hasTestDb)('Passkeys (mig 705)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let mfa: typeof import('../../repositories/mfa.repository.js')['mfaRepository'];
  let jwtu: typeof import('../../utils/jwt.js');
  let app: express.Express;
  let userId: string; let otherId: string;
  const email = `passkey-${RUN}@test.local`.toLowerCase();
  const password = 'Motdepasse-P704!';
  const phone = new SoftAuthenticator();
  const p = () => testPool();

  const register = async (auth: SoftAuthenticator, as: string) => {
    const o = await request(app).post('/passkeys/register/options').set('Origin', ORIGIN).set('x-test-user', as).send({});
    expect(o.status).toBe(200);
    return request(app).post('/passkeys/register/verify').set('Origin', ORIGIN).set('x-test-user', as)
      .send({ ticket: o.body.data.ticket, response: auth.create(o.body.data.options), label: 'iPhone de test' });
  };

  beforeAll(async () => {
    repos = await importRepositories();
    mfa = (await import('../../repositories/mfa.repository.js')).mfaRepository;
    jwtu = await import('../../utils/jwt.js');
    const { authController } = await import('../../controllers/auth.controller.js');
    const { passkeyController } = await import('../../controllers/passkey.controller.js');
    const { hashPassword } = await import('../../utils/hash.js');
    const hash = await hashPassword(password);
    userId = (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active) VALUES ($1, $2, 'Passkey', 'Test', 'manager', true) RETURNING id`,
      [email, hash])).rows[0].id;
    otherId = (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active) VALUES ($1, $2, 'Autre', 'Test', 'manager', true) RETURNING id`,
      [`autre-${email}`, hash])).rows[0].id;
    app = express(); app.use(express.json()); app.use(cookieParser());
    // Authentification simulée pour les routes « Mes passkeys ».
    const as = (fn: (req: never, res: express.Response) => unknown) => (req: express.Request, res: express.Response) => {
      (req as unknown as { user: { userId: string } }).user = { userId: String(req.get('x-test-user')) };
      return fn(req as never, res);
    };
    app.post('/login', (req, res) => authController.login(req as never, res));
    app.post('/passkeys/register/options', as(passkeyController.registerOptions));
    app.post('/passkeys/register/verify', as(passkeyController.registerVerify));
    app.delete('/passkeys/:id', as(passkeyController.remove));
    app.post('/passkeys/login/options', (req, res) => passkeyController.loginOptions(req as never, res));
    app.post('/passkeys/login/verify', (req, res) => passkeyController.loginVerify(req as never, res));
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM user_passkeys WHERE user_id = ANY($1::uuid[])`, [[userId, otherId]]).catch(() => undefined);
    await p().query(`UPDATE users SET is_active = false, mfa_required = false WHERE id = ANY($1::uuid[])`, [[userId, otherId]]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('ajout : la clé publique est enregistrée, pas deux fois', async () => {
    const r = await register(phone, userId);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ label: 'iPhone de test' });
    const row = (await p().query(`SELECT credential_id, rp_id, transports FROM user_passkeys WHERE user_id = $1`, [userId])).rows;
    expect(row).toEqual([{ credential_id: b64u(phone.credId), rp_id: RP_ID, transports: ['internal'] }]);
    expect((await register(phone, userId)).status).toBe(409);
  });

  it('adresse non autorisée : refus', async () => {
    const o = await request(app).post('/passkeys/login/options').set('Origin', 'https://pirate.example').send({});
    expect(o.status).toBe(400);
  });

  it('connexion sans mot de passe ; réponse rejouée refusée', async () => {
    const o = await request(app).post('/passkeys/login/options').set('Origin', ORIGIN).send({});
    expect(o.status).toBe(200);
    expect(o.body.data.options.allowCredentials ?? []).toEqual([]);
    const body = { ticket: o.body.data.ticket, response: phone.get(o.body.data.options) };
    const ok = await request(app).post('/passkeys/login/verify').set('Origin', ORIGIN).send(body);
    expect(ok.status).toBe(200);
    expect(jwtu.verifyToken(ok.body.data.token).userId).toBe(userId);
    expect((await request(app).post('/passkeys/login/verify').set('Origin', ORIGIN).send(body)).status).toBe(401);
  });

  it('signature falsifiée ou autre origine : refus', async () => {
    const o = await request(app).post('/passkeys/login/options').set('Origin', ORIGIN).send({});
    const bad = await request(app).post('/passkeys/login/verify').send({ ticket: o.body.data.ticket, response: phone.get(o.body.data.options, { tamper: true }) });
    expect(bad.status).toBe(401);
    const o2 = await request(app).post('/passkeys/login/options').set('Origin', ORIGIN).send({});
    const other = await request(app).post('/passkeys/login/verify').send({ ticket: o2.body.data.ticket, response: phone.get(o2.body.data.options, { origin: 'https://pirate.example' }) });
    expect(other.status).toBe(401);
  });

  it('compte protégé : mot de passe puis passkey en second facteur', async () => {
    const first = await request(app).post('/login').send({ email, password });
    expect(first.body.data).toMatchObject({ mfaRequired: true, methods: { totp: false, passkey: true } });
    expect(first.body.data.token).toBeUndefined();
    const o = await request(app).post('/passkeys/login/options').set('Origin', ORIGIN).send({ mfaToken: first.body.data.mfaToken });
    expect(o.body.data.options.allowCredentials.map((c: { id: string }) => c.id)).toEqual([b64u(phone.credId)]);
    const ok = await request(app).post('/passkeys/login/verify').send({ ticket: o.body.data.ticket, response: phone.get(o.body.data.options) });
    expect(ok.status).toBe(200);
    expect(jwtu.verifyToken(ok.body.data.token).userId).toBe(userId);
    // Le jeton de second facteur d'un compte n'accepte pas la passkey d'un autre.
    const stranger = new SoftAuthenticator();
    expect((await register(stranger, otherId)).status).toBe(200);
    const o2 = await request(app).post('/passkeys/login/options').set('Origin', ORIGIN).send({ mfaToken: first.body.data.mfaToken });
    expect((await request(app).post('/passkeys/login/verify').send({ ticket: o2.body.data.ticket, response: stranger.get(o2.body.data.options) })).status).toBe(401);
  });

  it('exigence satisfaite par une passkey ; dernière passkey protégée ; réinitialisation', async () => {
    await p().query(`UPDATE users SET mfa_required = true WHERE id = $1`, [userId]);
    expect(await mfa.state(userId, ['manager'])).toMatchObject({ required: true, enabled: false, passkeys: 1, protected: true });
    const id = (await p().query(`SELECT id FROM user_passkeys WHERE user_id = $1`, [userId])).rows[0].id;
    expect((await request(app).delete(`/passkeys/${id}`).set('x-test-user', userId)).status).toBe(409);
    await mfa.resetAll(userId);
    expect((await p().query(`SELECT count(*)::int AS n FROM user_passkeys WHERE user_id = $1`, [userId])).rows[0].n).toBe(0);
    expect(await mfa.state(userId, ['manager'])).toMatchObject({ protected: false, passkeys: 0 });
  });
});
