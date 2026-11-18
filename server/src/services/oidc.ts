import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';

/**
 * Connexion d'entreprise par OpenID Connect (G6-02) : flux « code d'autorisation » avec PKCE.
 * Fournisseurs actifs seulement si leurs identifiants sont dans l'environnement :
 *   OIDC_GOOGLE_CLIENT_ID / OIDC_GOOGLE_CLIENT_SECRET
 *   OIDC_MICROSOFT_CLIENT_ID / OIDC_MICROSOFT_CLIENT_SECRET / OIDC_MICROSOFT_TENANT (défaut « organizations »)
 *   OIDC_REDIRECT_BASE (ex. https://app.exemple.ma) : base de l'URL de retour.
 * L'id_token est vérifié : signature (clés JWKS du fournisseur), émetteur, audience, nonce,
 * expiration, e-mail vérifié.
 */
export type Provider = 'google' | 'microsoft';
type Config = { provider: Provider; label: string; issuer: string; clientId: string; clientSecret: string };
type Discovery = { authorization_endpoint: string; token_endpoint: string; jwks_uri: string; issuer: string };
type Fetcher = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

let fetcher: Fetcher = (url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<Fetcher>;
/** Pour les tests : remplace l'accès réseau. */
export function setOidcFetcher(f: Fetcher | null) { fetcher = f ?? ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<Fetcher>); discoveryCache.clear(); jwksCache.clear(); }

export function providerConfig(p: string, e: NodeJS.ProcessEnv = process.env): Config | null {
  if (p === 'google' && e.OIDC_GOOGLE_CLIENT_ID && e.OIDC_GOOGLE_CLIENT_SECRET) {
    return { provider: 'google', label: 'Google', issuer: 'https://accounts.google.com', clientId: e.OIDC_GOOGLE_CLIENT_ID, clientSecret: e.OIDC_GOOGLE_CLIENT_SECRET };
  }
  if (p === 'microsoft' && e.OIDC_MICROSOFT_CLIENT_ID && e.OIDC_MICROSOFT_CLIENT_SECRET) {
    const tenant = e.OIDC_MICROSOFT_TENANT || 'organizations';
    return { provider: 'microsoft', label: 'Microsoft', issuer: `https://login.microsoftonline.com/${tenant}/v2.0`, clientId: e.OIDC_MICROSOFT_CLIENT_ID, clientSecret: e.OIDC_MICROSOFT_CLIENT_SECRET };
  }
  return null;
}
export const enabledProviders = (e: NodeJS.ProcessEnv = process.env) =>
  (['google', 'microsoft'] as const).map(p => providerConfig(p, e)).filter((c): c is Config => !!c).map(c => ({ provider: c.provider, label: c.label }));
export const redirectUri = (p: Provider, e: NodeJS.ProcessEnv = process.env) =>
  `${(e.OIDC_REDIRECT_BASE || 'http://localhost:3001').replace(/\/$/, '')}/api/v1/auth/oidc/${p}/callback`;

const discoveryCache = new Map<string, Discovery>();
async function discover(cfg: Config): Promise<Discovery> {
  const hit = discoveryCache.get(cfg.issuer);
  if (hit) return hit;
  const r = await fetcher(`${cfg.issuer}/.well-known/openid-configuration`);
  if (!r.ok) throw new Error(`Découverte OIDC impossible (${r.status})`);
  const d = await r.json() as Discovery;
  discoveryCache.set(cfg.issuer, d);
  return d;
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** Paramètres d'une tentative : state, nonce, vérificateur PKCE (gardés côté serveur, cookie signé). */
export const newAttempt = () => ({ state: b64url(randomBytes(24)), nonce: b64url(randomBytes(24)), verifier: b64url(randomBytes(48)) });

export async function authorizationUrl(cfg: Config, a: { state: string; nonce: string; verifier: string }) {
  const d = await discover(cfg);
  const q = new URLSearchParams({
    client_id: cfg.clientId, response_type: 'code', scope: 'openid email profile', redirect_uri: redirectUri(cfg.provider),
    state: a.state, nonce: a.nonce, code_challenge: b64url(createHash('sha256').update(a.verifier).digest()), code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${d.authorization_endpoint}?${q.toString()}`;
}

const jwksCache = new Map<string, { at: number; keys: any[] }>();
async function signingKey(jwksUri: string, kid: string) {
  let entry = jwksCache.get(jwksUri);
  if (!entry || Date.now() - entry.at > 3600_000 || !entry.keys.some(k => k.kid === kid)) {
    const r = await fetcher(jwksUri);
    if (!r.ok) throw new Error(`Clés du fournisseur indisponibles (${r.status})`);
    entry = { at: Date.now(), keys: (await r.json()).keys ?? [] };
    jwksCache.set(jwksUri, entry);
  }
  const jwk = entry.keys.find(k => k.kid === kid);
  if (!jwk) throw new Error('Clé de signature inconnue');
  return createPublicKey({ key: jwk, format: 'jwk' });
}

/** Échange le code, vérifie l'id_token et rend l'identité (sujet + e-mail vérifié). */
export async function completeLogin(cfg: Config, code: string, a: { nonce: string; verifier: string }) {
  const d = await discover(cfg);
  const r = await fetcher(d.token_endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(cfg.provider), client_id: cfg.clientId, client_secret: cfg.clientSecret, code_verifier: a.verifier }).toString(),
  });
  if (!r.ok) throw new Error(`Échange du code refusé (${r.status})`);
  const idToken = (await r.json()).id_token as string | undefined;
  if (!idToken) throw new Error('Réponse sans id_token');
  const header = JSON.parse(Buffer.from(idToken.split('.')[0], 'base64url').toString('utf8')) as { kid?: string; alg?: string };
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Algorithme de signature non accepté');
  const key = await signingKey(d.jwks_uri, header.kid);
  // Microsoft « organizations / common » : l'émetteur porte le locataire réel ({tenantid}).
  const issuerCheck = cfg.provider === 'microsoft' ? undefined : d.issuer;
  const claims = jwt.verify(idToken, key, { algorithms: ['RS256'], audience: cfg.clientId, issuer: issuerCheck }) as Record<string, any>;
  if (cfg.provider === 'microsoft' && !/^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/.test(String(claims.iss))) throw new Error('Émetteur Microsoft inattendu');
  if (claims.nonce !== a.nonce) throw new Error('Nonce invalide');
  const email = String(claims.email ?? claims.preferred_username ?? '').toLowerCase();
  const verified = cfg.provider === 'google' ? claims.email_verified === true : !!email;
  if (!email || !verified) throw new Error('E-mail non vérifié par le fournisseur');
  return { subject: String(claims.sub), email };
}
