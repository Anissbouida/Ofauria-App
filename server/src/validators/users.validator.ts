import { z } from 'zod';
import { uuid } from './common.validator.js';
import { body, txt, numish, bool, strList, any } from './route-body.validator.js';

/**
 * G0-07 — Utilisateurs, rôles et gouvernance (users.routes). user.controller, role.controller et
 * governance.controller gardent leurs contrôles (rôle assignable, séparation des tâches, PIN,
 * codes) ; ces schémas n'imposent que les types.
 * Volontairement NON imposé : la politique de mot de passe fort (auth.validator) à la création
 * par un administrateur — l'écran accepte aujourd'hui 4 caractères, c'est une décision métier.
 */

const roleCodes = strList(50);
const pin = z.union([z.string().max(20), z.number()]).nullish();

/* Création d'un compte — user.controller.create (le mot de passe est haché : il doit exister). */
export const createUserSchema = body({
  email: z.string().trim().min(1, 'Email requis').max(255),
  password: z.string().min(1, 'Mot de passe requis').max(128),
  firstName: txt(100), lastName: txt(100),
  role: z.string().max(40).optional(), roles: roleCodes.optional(), primaryRole: z.string().max(40).nullish(),
  pinCode: pin, storeId: z.string().max(60).nullish(), employeeId: z.string().max(60).nullish(),
  mustChangePassword: z.boolean().optional(), mfaRequired: z.boolean().optional(),
});
/* Modification — user.controller.update (tout est facultatif ; PIN null = retiré). */
export const updateUserSchema = body({
  email: z.string().trim().min(1).max(255).optional(),
  password: z.string().max(128).nullish(),
  firstName: txt(100), lastName: txt(100),
  role: z.string().max(40).optional(), roles: roleCodes.optional(), primaryRole: z.string().max(40).nullish(),
  isActive: bool, pinCode: pin, storeId: z.string().max(60).nullish(), employeeId: z.string().max(60).nullish(),
});
/* Droits d'un utilisateur / d'un rôle — normalizePermissions vérifie la forme. */
export const permissionsSchema = body({ permissions: any });

/* Rôles éditables — role.controller.create / update. */
export const createRoleSchema = body({
  label: z.string().max(200), code: z.string().max(60).nullish(), baseRole: z.string().max(40),
  copyFrom: z.string().max(60).nullish(), description: txt(2000),
});
export const updateRoleSchema = body({
  label: z.string().max(200).optional(), description: txt(2000), baseRole: z.string().max(40).optional(), isActive: bool,
});

/* Modes de contrôle (droits, séparation des tâches) : off / log / enforce. */
export const enforcementModeSchema = body({ mode: z.enum(['off', 'log', 'enforce'], { message: 'Mode invalide' }) });

/* Règles de séparation des tâches — governance.controller.sodCreate / sodUpdate. */
export const createSodRuleSchema = body({
  label: z.string().max(200), code: z.string().max(60).nullish(),
  aModule: z.string().max(60), bModule: z.string().max(60), aRight: z.string().max(40), bRight: z.string().max(40),
  severity: z.string().max(20).optional(), description: txt(2000),
});
export const updateSodRuleSchema = body({
  label: z.string().max(200).optional(), description: txt(2000), severity: z.string().max(20).optional(), isActive: bool,
});

/* Plafond d'approbation — limitsSet (montant ≥ 0 vérifié par le contrôleur). */
export const approvalLimitSchema = body({
  roleCode: z.string().max(60), documentType: z.string().max(60), maxAmount: numish, currency: z.string().max(3).nullish(),
});

/* Délégation — delegationsCreate (dates et utilisateurs vérifiés par le contrôleur). */
export const delegationSchema = body({
  fromUserId: uuid, toUserId: uuid, roleCode: z.string().max(60),
  startsAt: txt(40), endsAt: z.string().max(40), reason: txt(2000),
});
