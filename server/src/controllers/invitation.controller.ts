import type { Request, Response } from 'express';
import { invitationRepository } from '../repositories/invitation.repository.js';
import { authEventRepository } from '../repositories/auth-event.repository.js';
import { hashPassword } from '../utils/hash.js';
import { passwordPolicyError } from '../services/security-policy.js';

/**
 * Invitation d'un nouveau compte (refonte Utilisateurs, lot 3) — routes PUBLIQUES : la personne
 * invitée n'a pas encore de mot de passe. Le jeton, long et aléatoire, tient lieu d'accès ; les
 * routes sont limitées en fréquence (auth.routes).
 */
const STATUS_MESSAGE: Record<string, string> = {
  expired: 'Ce lien a expiré. Demandez une nouvelle invitation à votre administrateur.',
  used: 'Ce lien a déjà servi : connectez-vous avec le mot de passe choisi.',
  revoked: 'Ce lien a été remplacé par une invitation plus récente.',
  unknown: 'Ce lien n\'est pas valable.',
};

export const invitationController = {
  async peek(req: Request, res: Response) {
    const info = await invitationRepository.peek(String(req.params.token ?? ''));
    res.json({ success: true, data: info.status === 'valid' ? info : { status: info.status, message: STATUS_MESSAGE[info.status] } });
  },

  async accept(req: Request, res: Response) {
    const token = String(req.params.token ?? '');
    // Lot 8 : longueur minimale du mot de passe selon la politique de sécurité.
    const tooShort = await passwordPolicyError(String(req.body.password ?? ''));
    if (tooShort) { res.status(400).json({ success: false, error: { message: tooShort } }); return; }
    const done = await invitationRepository.accept(token, await hashPassword(String(req.body.password)));
    if (!done) {
      const info = await invitationRepository.peek(token);
      res.status(410).json({ success: false, error: { message: STATUS_MESSAGE[info.status] ?? STATUS_MESSAGE.unknown } });
      return;
    }
    await authEventRepository.recordFromRequest(req, {
      eventType: 'invitation_accepted', userId: done.userId, targetUserId: done.userId, email: done.email, success: true,
    });
    res.json({ success: true, data: { email: done.email } });
  },
};
