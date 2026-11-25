import { z } from 'zod';
import { uuid } from './common.validator.js';
import { body, txt, numish, bool, strList, any } from './route-body.validator.js';
import { strongPassword } from './auth.validator.js';

/**
 * G0-07 — Utilisateurs, rôles et gouvernance (users.routes). user.controller, role.controller et
 * governance.controller gardent leurs contrôles (rôle assignable, séparation des tâches, PIN,
 * codes) ; ces schémas n'imposent que les types.
 * Mot de passe saisi par un administrateur (création ou nouveau mot de passe) : même politique que
 * pour un nouveau compte (auth.validator : 12 caractères, majuscule, minuscule, chiffre, caractère
 * spécial). Décision de la refonte Utilisateurs (2026-11-25) ; le générateur de l'écran la respecte.
 */

const roleCodes = strList(50);
const pin = z.union([z.string().max(20), z.number()]).nullish();

/* Création d'un compte — user.controller.create (le mot de passe est haché : il doit exister). */
export const createUserSchema = body({
  email: z.string().trim().min(1, 'Email requis').max(255),
  // Absent quand le compte est invité (invite: true) : la personne choisit son mot de passe.
  password: strongPassword.optional(), invite: z.boolean().optional(),
  firstName: txt(100), lastName: txt(100),
  role: z.string().max(40).optional(), roles: roleCodes.optional(), primaryRole: z.string().max(40).nullish(),
  pinCode: pin, storeId: z.string().max(60).nullish(), storeIds: z.array(z.string().max(60)).max(100).optional(), employeeId: z.string().max(60).nullish(),
  mustChangePassword: z.boolean().optional(), mfaRequired: z.boolean().optional(),
});
/* Modification — user.controller.update (tout est facultatif ; PIN null = retiré). */
export const updateUserSchema = body({
  email: z.string().trim().min(1).max(255).optional(),
  password: z.union([z.literal(''), strongPassword]).nullish(),
  firstName: txt(100), lastName: txt(100),
  role: z.string().max(40).optional(), roles: roleCodes.optional(), primaryRole: z.string().max(40).nullish(),
  isActive: bool, pinCode: pin, storeId: z.string().max(60).nullish(), storeIds: z.array(z.string().max(60)).max(100).optional(), employeeId: z.string().max(60).nullish(),
});
/* Droits d'un utilisateur / d'un rôle — normalizePermissions vérifie la forme. */
export const permissionsSchema = body({
  permissions: any,
  // Lot 4 : permissions détaillées enregistrées avec les niveaux d'accès (remplace celles du rôle).
  keys: z.array(z.string().min(3).max(120)).max(2000).optional(),
});

/* Rôles éditables — role.controller.create / update. */
export const createRoleSchema = body({
  label: z.string().max(200), code: z.string().max(60).nullish(), baseRole: z.string().max(40),
  copyFrom: z.string().max(60).nullish(), description: txt(2000),
  // Lot 4 : partir d'un modèle du secteur, ou d'un rôle vide.
  template: z.string().max(30).nullish(), empty: z.boolean().optional(),
});
export const updateRoleSchema = body({
  label: z.string().max(200).optional(), description: txt(2000), baseRole: z.string().max(40).optional(), isActive: bool,
  homeRoute: z.string().max(80).nullish(),
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
  // Lot 5 : « role » (rôle complet, défaut) ou « approvals » (approbations seulement, sans rôle).
  kind: z.enum(['role', 'approvals']).optional(),
  fromUserId: uuid, toUserId: uuid, roleCode: z.string().max(60).optional(),
  startsAt: txt(40), endsAt: z.string().max(40), reason: txt(2000),
});
export const extendDelegationSchema = body({ endsAt: z.string().min(8).max(40) });
export const documentSodModeSchema = body({ mode: z.enum(['off', 'warn', 'block', 'block_except_admin'], { message: 'Mode invalide' }) });
export const documentSodRuleSchema = body({ isActive: z.boolean() });

/* Exceptions individuelles (lot 6, mig 706) — user-exceptions.ts vérifie le reste. */
const exceptionReason = z.string().trim().min(3, 'Motif requis (3 caractères au moins)').max(500);
const exceptionEndsOn = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date de fin invalide').nullish();
export const moduleExceptionSchema = z.object({
  canView: z.boolean(), canCreate: z.boolean(), canEdit: z.boolean(), canDelete: z.boolean(),
  verbs: z.array(z.string().max(40)).max(30).optional(),
  scope: z.enum(['own', 'store', 'all']).optional(),
  sections: z.array(z.string().max(60)).max(100).optional(),
  reason: exceptionReason, endsOn: exceptionEndsOn,
}).strict();
export const actionExceptionSchema = z.object({ granted: z.boolean(), reason: exceptionReason, endsOn: exceptionEndsOn }).strict();
