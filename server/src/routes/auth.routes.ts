import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController } from '../controllers/auth.controller.js';
import { oidcController } from '../controllers/oidc.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { loginSchema, registerSchema, pinLoginSchema, changePasswordSchema, strongPassword } from '../validators/auth.validator.js';
import { invitationController } from '../controllers/invitation.controller.js';

/** Acceptation d'une invitation : mot de passe choisi, même politique qu'un nouveau compte. */
const acceptInvitationSchema = z.object({ password: strongPassword }).strict();
import { makeLimiter } from '../middleware/rate-limit.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { z } from 'zod';

const mfaCodeSchema = z.object({ code: z.string().trim().min(6).max(12) });
const mfaVerifySchema = mfaCodeSchema.extend({ mfaToken: z.string().min(20).max(2000), rememberDevice: z.boolean().optional() });
const mfaDisableSchema = mfaCodeSchema.extend({ password: z.string().min(1).max(200) });
const mfaEmptySchema = z.object({}).passthrough();
import { ipKeyGenerator } from 'express-rate-limit';
import { emptyBody } from '../validators/common.validator.js';

// G0-06 : la liste des tuiles est publique → 60 lectures / minute par IP.
const pinUsersLimiter = makeLimiter(60, (req) => ipKeyGenerator(req.ip ?? ''), 'Trop de requêtes. Réessayez dans une minute.');

// OWASP A07 : rate limiters par IP.
// DEV : les limites IP sont desactivees en dev/test pour eviter de bloquer
// l'equipe (plusieurs utilisateurs derriere la meme IP WiFi). La defense
// principale reste le lockout par compte (A04-2, 5 echecs => 15 min).
// En PROD, les rate limits IP se rebranchent automatiquement.
const IS_PROD = (process.env.NODE_ENV || 'development') === 'production';

const loginLimiter = IS_PROD
  ? rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      message: { success: false, error: { message: 'Trop de tentatives. Reessayez dans 15 minutes.' } },
      standardHeaders: true,
      legacyHeaders: false,
    })
  : (_req: unknown, _res: unknown, next: () => void) => next();

const pinLimiter = IS_PROD
  ? rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 5,
      message: { success: false, error: { message: 'Trop de tentatives PIN. Reessayez dans 1 heure.' } },
      standardHeaders: true,
      legacyHeaders: false,
    })
  : (_req: unknown, _res: unknown, next: () => void) => next();

const router = Router();

router.post('/login', loginLimiter, validate(loginSchema), authController.login);
// G6-01 : double authentification (second facteur limité comme le mot de passe).
router.post('/mfa/verify', loginLimiter, validate(mfaVerifySchema), asyncHandler(authController.mfaVerify));
// G6-02 : connexion d'entreprise (OpenID Connect) — actifs seulement si configurés.
router.get('/oidc/providers', asyncHandler(async (req, res) => oidcController.providers(req, res)));
router.get('/oidc/:provider/start', loginLimiter, asyncHandler(oidcController.start));
router.get('/oidc/:provider/callback', loginLimiter, asyncHandler(oidcController.callback));
router.get('/mfa/status', authenticate, asyncHandler(authController.mfaStatus));
router.post('/mfa/setup', authenticate, validate(mfaEmptySchema), asyncHandler(authController.mfaSetup));
router.post('/mfa/enable', authenticate, validate(mfaCodeSchema), asyncHandler(authController.mfaEnable));
router.post('/mfa/disable', authenticate, validate(mfaDisableSchema), asyncHandler(authController.mfaDisable));
router.post('/pin-login', pinLimiter, validate(pinLoginSchema), authController.pinLogin);
// G0-06 : tuiles de l'écran PIN. Publique par nécessité (avant connexion), donc
// réduite au strict nécessaire — prénom + initiale du nom des seuls comptes
// dotés d'un PIN, ni e-mail ni rôle — et limitée en débit par IP.
router.get('/pin-users', pinUsersLimiter, authController.pinUsers);
// Liste complète (nom, prénom, rôle) : réservée aux administrateurs et gérants
// connectés (audit Paramètres, lot 1).
router.get('/users-list', authenticate, can('users.auth.view'), authController.activeUsers);
router.post('/change-password', authenticate, validate(changePasswordSchema), authController.changePassword);
// Invitation d'un nouveau compte (refonte Utilisateurs, lot 3) : routes publiques, limitées en fréquence.
router.get('/invitations/:token', pinUsersLimiter, asyncHandler(invitationController.peek));
router.post('/invitations/:token/accept', loginLimiter, validate(acceptInvitationSchema), asyncHandler(invitationController.accept));
router.post('/register', authenticate, can('users.auth.register'), validate(registerSchema), authController.register);
router.post('/logout', authenticate, validate(emptyBody), authController.logout);
router.get('/me', authenticate, authController.me);

export default router;
