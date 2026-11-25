import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { authorizationUrl, completeLogin, enabledProviders, newAttempt, providerConfig } from '../services/oidc.js';
import { userIdentityRepository } from '../repositories/user-identity.repository.js';
import { authEventRepository } from '../repositories/auth-event.repository.js';
import { loginRoleContext } from '../services/access-rights.js';
import { generateToken } from '../utils/jwt.js';
import { readDeviceTokens, setAuthCookie, signMfaToken } from './auth.controller.js';
import { mfaRepository } from '../repositories/mfa.repository.js';
import { logger } from '../utils/logger.js';

/**
 * Connexion d'entreprise (G6-02). La tentative (state, nonce, vérificateur PKCE) est gardée
 * dans un cookie HttpOnly signé, valable 10 minutes. Au retour : identité vérifiée, compte
 * rattaché par e-mail ; la double authentification (G6-01) reste exigée si elle est activée.
 */
const COOKIE = 'kalum_oidc';
const attemptKey = () => `${env.JWT_SECRET}:oidc`;
const front = () => (process.env.OIDC_FRONT_URL || process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
const fail = (res: Response, code: string) => res.redirect(`${front()}/login?sso_error=${encodeURIComponent(code)}`);

export const oidcController = {
  providers(_req: Request, res: Response) {
    res.json({ success: true, data: enabledProviders() });
  },

  async start(req: Request, res: Response) {
    const cfg = providerConfig(String(req.params.provider));
    if (!cfg) { res.status(404).json({ success: false, error: { message: 'Fournisseur non configuré' } }); return; }
    const a = newAttempt();
    const signed = jwt.sign({ ...a, p: cfg.provider }, attemptKey(), { expiresIn: '10m' });
    res.cookie(COOKIE, signed, { httpOnly: true, sameSite: 'lax', secure: env.NODE_ENV === 'production', maxAge: 10 * 60_000, path: '/api/v1/auth/oidc' });
    res.redirect(await authorizationUrl(cfg, a));
  },

  async callback(req: Request, res: Response) {
    const cfg = providerConfig(String(req.params.provider));
    if (!cfg) { fail(res, 'fournisseur'); return; }
    const raw = (req as Request & { cookies?: Record<string, string> }).cookies?.[COOKIE];
    res.clearCookie(COOKIE, { path: '/api/v1/auth/oidc' });
    let a: { state: string; nonce: string; verifier: string; p: string };
    try { a = jwt.verify(String(raw ?? ''), attemptKey()) as typeof a; } catch { fail(res, 'session_expiree'); return; }
    if (a.p !== cfg.provider || req.query.state !== a.state || typeof req.query.code !== 'string') { fail(res, 'etat_invalide'); return; }
    let identity: { subject: string; email: string };
    try { identity = await completeLogin(cfg, req.query.code, a); }
    catch (err) { logger.error({ err: err instanceof Error ? err.message : err }, '[oidc]'); fail(res, 'verification'); return; }
    const user = await userIdentityRepository.resolve(cfg.provider, identity.subject, identity.email);
    await authEventRepository.recordFromRequest(req as never, {
      eventType: user ? 'login_success' : 'login_failed', userId: user?.id, email: identity.email, success: !!user,
      details: { via: `oidc:${cfg.provider}`, ...(user ? {} : { reason: 'compte_inconnu' }) },
    });
    if (!user) { fail(res, 'compte_inconnu'); return; }
    // Poste de confiance encore valable (mig 702) → pas de code sur ce poste.
    if (user.totp_enabled && !(await mfaRepository.isTrustedDevice(user.id, readDeviceTokens(req)))) {
      res.redirect(`${front()}/login?mfa=${encodeURIComponent(signMfaToken(user.id, !!user.must_change_password))}`); return;
    }
    const roleCtx = await loginRoleContext(user.id);
    setAuthCookie(res, generateToken({ userId: user.id, role: roleCtx.primaryBaseRole, baseRoles: roleCtx.baseRoles, storeId: user.store_id || undefined, tokenVersion: user.token_version ?? 0 }));
    res.redirect(`${front()}/`);
  },
};
