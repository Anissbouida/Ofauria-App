/**
 * G6-02 — OpenID Connect, avec un faux fournisseur (clé RSA, découverte, jeton, JWKS simulés) :
 *  - fournisseurs actifs seulement s'ils sont configurés ;
 *  - URL d'autorisation avec PKCE S256, state et nonce ;
 *  - id_token valide → identité ; nonce, audience, e-mail non vérifié, algorithme : refusés.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateKeyPairSync, createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { providerConfig, enabledProviders, newAttempt, authorizationUrl, completeLogin, setOidcFetcher } from '../services/oidc.js';

const ENV = { OIDC_GOOGLE_CLIENT_ID: 'client-123', OIDC_GOOGLE_CLIENT_SECRET: 's3cret', OIDC_REDIRECT_BASE: 'https://app.test' } as NodeJS.ProcessEnv;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
let idToken = '';
const sign = (claims: Record<string, unknown>, opts: { alg?: 'RS256' | 'HS256'; aud?: string } = {}) =>
  jwt.sign({ iss: 'https://accounts.google.com', aud: opts.aud ?? 'client-123', sub: 'google-sub-1', email: 'Chef@Exemple.ma', email_verified: true, ...claims },
    opts.alg === 'HS256' ? 'x' : privateKey, { algorithm: opts.alg ?? 'RS256', keyid: 'k1', expiresIn: '5m' });

describe('OpenID Connect (G6-02)', () => {
  const cfg = providerConfig('google', ENV)!;
  beforeAll(() => {
    setOidcFetcher(async (url) => {
      const body = url.endsWith('/.well-known/openid-configuration')
        ? { issuer: 'https://accounts.google.com', authorization_endpoint: 'https://idp.test/auth', token_endpoint: 'https://idp.test/token', jwks_uri: 'https://idp.test/jwks' }
        : url === 'https://idp.test/jwks' ? { keys: [jwk] } : { id_token: idToken };
      return { ok: true, status: 200, json: async () => body };
    });
  });
  afterAll(() => setOidcFetcher(null));

  it('fournisseurs configurés seulement', () => {
    expect(enabledProviders(ENV)).toEqual([{ provider: 'google', label: 'Google' }]);
    expect(providerConfig('microsoft', ENV)).toBeNull();
    expect(enabledProviders({} as NodeJS.ProcessEnv)).toEqual([]);
  });

  it('URL d\'autorisation avec PKCE', async () => {
    const a = newAttempt();
    const u = new URL(await authorizationUrl(cfg, a));
    expect(u.origin + u.pathname).toBe('https://idp.test/auth');
    expect(u.searchParams.get('code_challenge')).toBe(createHash('sha256').update(a.verifier).digest('base64url'));
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('state')).toBe(a.state);
  });

  it('id_token valide → identité ; refus sur nonce, audience, e-mail, algorithme', async () => {
    const a = newAttempt();
    idToken = sign({ nonce: a.nonce });
    expect(await completeLogin(cfg, 'code', a)).toEqual({ subject: 'google-sub-1', email: 'chef@exemple.ma' });
    idToken = sign({ nonce: 'autre' });
    await expect(completeLogin(cfg, 'code', a)).rejects.toThrow(/Nonce/);
    idToken = sign({ nonce: a.nonce }, { aud: 'pirate' });
    await expect(completeLogin(cfg, 'code', a)).rejects.toThrow(/audience/);
    idToken = sign({ nonce: a.nonce, email_verified: false });
    await expect(completeLogin(cfg, 'code', a)).rejects.toThrow(/non vérifié/);
    idToken = sign({ nonce: a.nonce }, { alg: 'HS256' });
    await expect(completeLogin(cfg, 'code', a)).rejects.toThrow(/Algorithme/);
  });
});
