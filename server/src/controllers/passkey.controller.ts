import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type AuthenticatorTransportFuture, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { env } from '../config/env.js';
import { userRepository } from '../repositories/user.repository.js';
import { passkeyRepository, passkeyView } from '../repositories/passkey.repository.js';
import { mfaRepository } from '../repositories/mfa.repository.js';
import { revokedTokenRepository } from '../repositories/revoked-token.repository.js';
import { authEventRepository, clientIp, clientUserAgent } from '../repositories/auth-event.repository.js';
import { loginRoleContext } from '../services/access-rights.js';
import { deviceLabel, issueSession, readDeviceTokens, readMfaToken, roleCodesOf, setDeviceCookie } from './auth.controller.js';

/**
 * Passkeys (WebAuthn, mig 705). Le navigateur crée une paire de clés liée au domaine ; Kalum
 * garde la clé publique et vérifie, à chaque connexion, la signature d'un défi aléatoire.
 * Vérification de l'utilisateur exigée (Face ID, empreinte, code de l'appareil) : une passkey
 * vaut à elle seule une double authentification.
 *
 * Le défi voyage dans un « ticket » signé (5 min, clé distincte) et ne sert qu'une fois
 * (jti consommé dans revoked_tokens) : rien à garder en mémoire côté serveur, plusieurs
 * instances Cloud Run possibles.
 */

const IS_PROD = env.NODE_ENV === 'production';
const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:4173', 'http://localhost:4176', 'http://localhost:4180', 'http://localhost:4190'];
const TICKET_TTL_S = 5 * 60;
const ticketKey = () => `${env.JWT_SECRET}:webauthn`;

/** Adresses d'où l'on peut créer / utiliser une passkey (jamais l'application mobile). */
function allowedOrigins(): string[] {
  const list = process.env.WEBAUTHN_ORIGINS || (IS_PROD ? process.env.ALLOWED_ORIGINS || '' : DEV_ORIGINS.join(','));
  return list.split(',').map(s => s.trim().replace(/\/$/, '')).filter(o => /^https?:\/\//.test(o));
}

/** Origine de la page et domaine de la passkey (rpID), ou null si l'adresse n'est pas autorisée. */
function relyingParty(req: AuthRequest): { origin: string; rpID: string } | null {
  const origin = String(req.get('origin') ?? '').replace(/\/$/, '');
  if (!origin || !allowedOrigins().includes(origin)) return null;
  return { origin, rpID: process.env.WEBAUTHN_RP_ID || new URL(origin).hostname };
}

type Ticket = { purpose: 'webauthn-reg' | 'webauthn-auth'; ch: string; origin: string; rp: string; uid?: string; mc?: boolean; jti: string; exp: number };

function signTicket(t: Omit<Ticket, 'jti' | 'exp'>): string {
  return jwt.sign(t, ticketKey(), { expiresIn: TICKET_TTL_S, jwtid: randomUUID() });
}
function readTicket(token: unknown, purpose: Ticket['purpose']): Ticket | null {
  try {
    const p = jwt.verify(String(token ?? ''), ticketKey()) as Ticket;
    return p.purpose === purpose ? p : null;
  } catch { return null; }
}

const fail = (res: Response, status: number, message: string) => { res.status(status).json({ success: false, error: { message } }); };
const unavailable = (res: Response) => fail(res, 400, 'Passkeys indisponibles depuis cette adresse');

export const passkeyController = {
  /* ── Mes passkeys (connecté) ── */

  async list(req: AuthRequest, res: Response) {
    res.json({ success: true, data: (await passkeyRepository.listForUser(req.user!.userId)).map(passkeyView) });
  },

  /** Étape 1 de l'ajout : options à passer à navigator.credentials.create(). */
  async registerOptions(req: AuthRequest, res: Response) {
    const rp = relyingParty(req);
    if (!rp) { unavailable(res); return; }
    const user = await userRepository.findById(req.user!.userId);
    if (!user) { fail(res, 404, 'Utilisateur non trouvé'); return; }
    const existing = await passkeyRepository.listForUser(user.id);
    const options = await generateRegistrationOptions({
      rpName: 'Kalum',
      rpID: rp.rpID,
      userName: user.email,
      userDisplayName: `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.email,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      // Une passkey par appareil : celles déjà enregistrées ne sont pas recréées.
      excludeCredentials: existing.filter(p => p.rp_id === rp.rpID)
        .map(p => ({ id: p.credential_id, transports: p.transports as AuthenticatorTransportFuture[] })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    res.json({ success: true, data: { options, ticket: signTicket({ purpose: 'webauthn-reg', ch: options.challenge, origin: rp.origin, rp: rp.rpID, uid: user.id }) } });
  },

  /** Étape 2 : vérifie la réponse de l'appareil et enregistre la clé publique. */
  async registerVerify(req: AuthRequest, res: Response) {
    const userId = req.user!.userId;
    const { ticket, response, label } = req.body as { ticket: string; response: RegistrationResponseJSON; label?: string };
    const t = readTicket(ticket, 'webauthn-reg');
    if (!t || t.uid !== userId) { fail(res, 400, 'Demande expirée, recommencez'); return; }
    let info;
    try {
      const v = await verifyRegistrationResponse({
        response, expectedChallenge: t.ch, expectedOrigin: t.origin, expectedRPID: t.rp, requireUserVerification: true,
      });
      if (!v.verified) throw new Error('non vérifiée');
      info = v.registrationInfo;
    } catch (err) {
      // Raison exacte journalisée (origine, domaine, vérification de l'utilisateur…) pour le support.
      await authEventRepository.recordFromRequest(req, {
        eventType: 'passkey_failed', userId, success: false,
        details: { step: 'register', reason: String((err as Error)?.message ?? err).slice(0, 300), origin: t.origin, rpId: t.rp },
      });
      fail(res, 400, 'La passkey n\'a pas pu être vérifiée'); return;
    }
    if (!(await revokedTokenRepository.consume(t.jti, userId, t.exp))) { fail(res, 400, 'Demande déjà utilisée, recommencez'); return; }
    if (await passkeyRepository.findByCredentialId(info.credential.id)) { fail(res, 409, 'Cette passkey est déjà enregistrée'); return; }
    const row = await passkeyRepository.insert({
      userId, credentialId: info.credential.id, publicKey: info.credential.publicKey, counter: info.credential.counter,
      transports: info.credential.transports ?? response.response.transports ?? [], rpId: t.rp,
      deviceType: info.credentialDeviceType, backedUp: info.credentialBackedUp,
      label: String(label ?? '').trim() || deviceLabel(clientUserAgent(req)) || 'Passkey',
    });
    const user = await userRepository.findById(userId);
    await authEventRepository.recordFromRequest(req, {
      eventType: 'passkey_added', userId, email: user?.email, success: true, details: { label: row.label, synced: row.backed_up },
    });
    res.json({ success: true, data: passkeyView(row) });
  },

  async rename(req: AuthRequest, res: Response) {
    const row = await passkeyRepository.rename(req.user!.userId, req.params.id, String(req.body.label ?? '').trim());
    if (!row) { fail(res, 404, 'Passkey introuvable'); return; }
    res.json({ success: true, data: passkeyView(row) });
  },

  /** Suppression ; refusée si c'est le dernier second facteur d'un compte qui en exige un. */
  async remove(req: AuthRequest, res: Response) {
    const userId = req.user!.userId;
    const st = await mfaRepository.state(userId, roleCodesOf(await loginRoleContext(userId)));
    if (st.required && !st.enabled && st.passkeys <= 1) {
      fail(res, 409, 'La double authentification est exigée pour votre compte : ajoutez une autre passkey ou l\'application d\'authentification avant de supprimer celle-ci');
      return;
    }
    if (!(await passkeyRepository.remove(userId, req.params.id))) { fail(res, 404, 'Passkey introuvable'); return; }
    await authEventRepository.recordFromRequest(req, { eventType: 'passkey_removed', userId, success: true, details: { passkeyId: req.params.id } });
    res.json({ success: true, data: null });
  },

  /* ── Connexion (public) ── */

  /**
   * Options de connexion. Sans mfaToken : connexion sans mot de passe, l'appareil propose ses
   * passkeys Kalum. Avec mfaToken (après le mot de passe) : seules les passkeys de ce compte.
   */
  async loginOptions(req: AuthRequest, res: Response) {
    const rp = relyingParty(req);
    if (!rp) { unavailable(res); return; }
    const mfaToken = (req.body as { mfaToken?: string }).mfaToken;
    let uid: string | undefined; let mc: boolean | undefined;
    let allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] | undefined;
    if (mfaToken) {
      const claim = readMfaToken(mfaToken);
      if (!claim) { fail(res, 401, 'Session de connexion expirée, recommencez'); return; }
      uid = claim.uid; mc = claim.mc;
      allowCredentials = (await passkeyRepository.listForUser(uid)).filter(p => p.rp_id === rp.rpID)
        .map(p => ({ id: p.credential_id, transports: p.transports as AuthenticatorTransportFuture[] }));
      if (!allowCredentials.length) { fail(res, 400, 'Aucune passkey enregistrée pour ce compte sur cette adresse'); return; }
    }
    const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: 'required', allowCredentials });
    res.json({ success: true, data: { options, ticket: signTicket({ purpose: 'webauthn-auth', ch: options.challenge, origin: rp.origin, rp: rp.rpID, uid, mc }) } });
  },

  /** Vérifie la signature de l'appareil et ouvre la session. */
  async loginVerify(req: AuthRequest, res: Response) {
    const { ticket, response, rememberDevice } = req.body as { ticket: string; response: AuthenticationResponseJSON; rememberDevice?: boolean };
    const t = readTicket(ticket, 'webauthn-auth');
    if (!t) { fail(res, 401, 'Demande expirée, recommencez'); return; }
    const cred = await passkeyRepository.findByCredentialId(String(response?.id ?? ''));
    if (!cred || cred.rp_id !== t.rp || (t.uid && cred.user_id !== t.uid)) {
      await authEventRepository.recordFromRequest(req, { eventType: 'passkey_failed', userId: t.uid, success: false, details: { reason: 'unknown_passkey' } });
      fail(res, 401, 'Passkey inconnue : elle a peut-être été supprimée de votre compte'); return;
    }
    const user = await userRepository.findById(cred.user_id);
    if (!user || !user.is_active) { fail(res, 401, 'Compte indisponible'); return; }
    if (await userRepository.isLocked(user.id)) { fail(res, 423, 'Compte temporairement verrouillé'); return; }
    let newCounter: number;
    try {
      const v = await verifyAuthenticationResponse({
        response, expectedChallenge: t.ch, expectedOrigin: t.origin, expectedRPID: t.rp, requireUserVerification: true,
        credential: { id: cred.credential_id, publicKey: new Uint8Array(cred.public_key), counter: Number(cred.counter), transports: cred.transports as AuthenticatorTransportFuture[] },
      });
      if (!v.verified) throw new Error('non vérifiée');
      newCounter = v.authenticationInfo.newCounter;
    } catch (err) {
      await authEventRepository.recordFromRequest(req, { eventType: 'passkey_failed', userId: user.id, email: user.email, success: false, details: { reason: 'bad_signature', error: String((err as Error)?.message ?? err).slice(0, 300) } });
      fail(res, 401, 'La passkey n\'a pas pu être vérifiée'); return;
    }
    if (!(await revokedTokenRepository.consume(t.jti, user.id, t.exp))) { fail(res, 401, 'Demande déjà utilisée, recommencez'); return; }
    await passkeyRepository.touch(cred.id, newCounter);
    await userRepository.resetFailedLogins(user.id);
    const secondFactor = !!t.uid;
    await authEventRepository.recordFromRequest(req, {
      eventType: secondFactor ? 'mfa_success' : 'login_success', userId: user.id, email: user.email, success: true,
      details: { via: 'passkey', passkey: cred.label },
    });
    if (rememberDevice === true) {
      const remembered = await mfaRepository.rememberDevice(user.id, deviceLabel(clientUserAgent(req)), clientIp(req));
      if (remembered) setDeviceCookie(res, [remembered.token, ...readDeviceTokens(req)], remembered.days);
    }
    await issueSession(res, user, secondFactor ? !!t.mc : !!user.must_change_password);
  },
};
