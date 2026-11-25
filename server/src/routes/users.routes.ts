import { Router } from 'express';
import { userController } from '../controllers/user.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { roleController } from '../controllers/role.controller.js';
import { governanceController } from '../controllers/governance.controller.js';
import { accessReviewController } from '../controllers/access-review.controller.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { permissionsOfUser } from '../services/permissions.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { z } from 'zod';
import { readInterfacePreferences, setPersonalInterfacePreferences } from '../services/interface-preferences.js';
import { approvalLimitSchema, createRoleSchema, createSodRuleSchema, createUserSchema, delegationSchema, enforcementModeSchema, permissionsSchema, updateRoleSchema, updateSodRuleSchema, updateUserSchema } from '../validators/users.validator.js';

/** G6-05 : langue de l'interface ; null = revenir au défaut de la société. */
export const setLocaleSchema = z.object({ locale: z.enum(['fr', 'ar', 'en']).nullable() }).strict();
/* Préférences d'un compte réglées par l'administrateur (null = valeur de la société). */
const userPreferencesSchema = z.object({
  locale: z.enum(['fr', 'ar', 'en']).nullable().optional(),
  workspace: z.enum(['sector', 'direction', 'production', 'sales', 'accounting']).nullable().optional(),
}).strict();
const setActionPermissionsSchema = z.object({ keys: z.array(z.string().min(3).max(120)).max(2000) });
/** Administration de la sécurité d'un compte (2FA exigée, changement de mot de passe imposé). */
const requiredFlagSchema = z.object({ required: z.boolean() }).strict();
const valueFlagSchema = z.object({ value: z.boolean() }).strict();
const emptySchema = z.object({}).strict();
const mfaPolicySchema = z.object({ requiredRoles: z.array(z.string().min(1).max(60)).max(100) }).strict();

const router = Router();

// Roles editables et mode de controle des droits (mig 330) : declares avant /:id.
router.get('/roles', authenticate, can('users.view'), asyncHandler(roleController.list));
router.post('/roles', authenticate, can('users.roles'), validate(createRoleSchema), asyncHandler(roleController.create));
router.get('/roles/templates', authenticate, can('users.view'), asyncHandler(roleController.templates));
router.get('/roles/:code/permissions', authenticate, can('users.view'), asyncHandler(roleController.permissions));
router.get('/roles/:code/profile', authenticate, can('users.view'), asyncHandler(roleController.profile));
router.put('/roles/:code/permissions', authenticate, can('users.permissions'), validate(permissionsSchema), asyncHandler(roleController.setPermissions));
router.put('/roles/:code', authenticate, can('users.roles'), validate(updateRoleSchema), asyncHandler(roleController.update));
router.delete('/roles/:code', authenticate, can('users.delete'), asyncHandler(roleController.remove));
// Permissions par action (M2-07) : matrice rôle × permission, aperçu d'un utilisateur.
router.get('/roles/action-permissions', authenticate, can('users.view'), asyncHandler(roleController.actionMatrix));
router.put('/roles/:code/action-permissions', authenticate, can('users.permissions'), validate(setActionPermissionsSchema), asyncHandler(roleController.setActionPermissions));
// Mes droits par action (clés effectives) : l'écran masque ce que l'utilisateur ne peut pas
// faire au lieu de montrer un bouton qui répond 403 (scénario 1, constat 111).
// Avant /:id/action-permissions, qui prendrait « me » pour un identifiant.
router.get('/me/action-permissions', authenticate, asyncHandler(async (req, res) => {
  const user = (req as AuthRequest).user!;
  res.json({ success: true, data: { keys: await permissionsOfUser(user.userId) } });
}));
router.get('/:id/action-permissions', authenticate, validateUuidParams('id'), can('users.view'), asyncHandler(roleController.userActionPermissions));
router.get('/security', authenticate, can('users.view'), asyncHandler(roleController.security));
router.put('/security', authenticate, can('users.edit'), validate(enforcementModeSchema), asyncHandler(roleController.setSecurityMode));
// Politique de double authentification par rôle (paramètre security.mfa).
router.get('/security/mfa-policy', authenticate, can('users.view'), asyncHandler(userController.mfaPolicy));
router.put('/security/mfa-policy', authenticate, can('users.edit'), validate(mfaPolicySchema), asyncHandler(userController.setMfaPolicy));

// Gouvernance (mig 336) : separation des taches (SoD), plafonds d'approbation,
// delegations temporaires. Litteraux specifiques declares avant /sod/:code.
router.get('/sod/violations', authenticate, can('users.view'), asyncHandler(governanceController.sodViolations));
router.get('/sod/mode', authenticate, can('users.view'), asyncHandler(governanceController.sodMode));
router.put('/sod/mode', authenticate, can('users.edit'), validate(enforcementModeSchema), asyncHandler(governanceController.setSodMode));
router.get('/sod', authenticate, can('users.view'), asyncHandler(governanceController.sodList));
router.post('/sod', authenticate, can('users.sod'), validate(createSodRuleSchema), asyncHandler(governanceController.sodCreate));
router.put('/sod/:code', authenticate, can('users.sod'), validate(updateSodRuleSchema), asyncHandler(governanceController.sodUpdate));
router.delete('/sod/:code', authenticate, can('users.delete'), asyncHandler(governanceController.sodRemove));

router.get('/approval-limits', authenticate, can('users.view'), asyncHandler(governanceController.limitsList));
router.post('/approval-limits', authenticate, can('users.approval_limits'), validate(approvalLimitSchema), asyncHandler(governanceController.limitsSet));
router.delete('/approval-limits/:id', authenticate, can('users.delete'), asyncHandler(governanceController.limitsRemove));

router.get('/delegations', authenticate, can('users.view'), asyncHandler(governanceController.delegationsList));
router.post('/delegations', authenticate, can('users.delegations'), validate(delegationSchema), asyncHandler(governanceController.delegationsCreate));
router.delete('/delegations/:id', authenticate, can('users.delete'), asyncHandler(governanceController.delegationsRemove));

router.get('/', authenticate, can('users.view'), userController.list);
router.post('/', authenticate, can('users.create'), validate(createUserSchema), userController.create);
// Vérification des rôles d'un futur compte (lot 3) : conflits de séparation des tâches, sans écriture.
router.post('/sod-check', authenticate, can('users.view'), validate(z.object({ roles: z.array(z.string().max(40)).max(50) }).strict()), asyncHandler(userController.sodCheck));
router.put('/:id', authenticate, can('users.edit'), validate(updateUserSchema), asyncHandler(userController.update));
router.delete('/:id', authenticate, can('users.delete'), asyncHandler(userController.remove));
// Sécurité d'un compte : 2FA, verrouillage, sessions, mot de passe, suppression définitive.
router.put('/:id/mfa-required', authenticate, validateUuidParams('id'), can('users.edit'), validate(requiredFlagSchema), asyncHandler(userController.setMfaRequired));
router.post('/:id/mfa-reset', authenticate, validateUuidParams('id'), can('users.edit'), validate(emptySchema), asyncHandler(userController.resetMfa));
router.post('/:id/unlock', authenticate, validateUuidParams('id'), can('users.edit'), validate(emptySchema), asyncHandler(userController.unlock));
router.post('/:id/revoke-sessions', authenticate, validateUuidParams('id'), can('users.edit'), validate(emptySchema), asyncHandler(userController.revokeSessions));
router.put('/:id/must-change-password', authenticate, validateUuidParams('id'), can('users.edit'), validate(valueFlagSchema), asyncHandler(userController.setMustChangePassword));
router.delete('/:id/permanent', authenticate, validateUuidParams('id'), can('users.delete'), asyncHandler(userController.hardDelete));
// Fiche du compte (refonte Utilisateurs, lot 2) : rattachements et préférences réglées par l'administrateur.
router.post('/:id/invitations', authenticate, validateUuidParams('id'), can('users.edit'), validate(emptySchema), asyncHandler(userController.invite));
router.get('/:id/profile', authenticate, validateUuidParams('id'), can('users.view'), asyncHandler(userController.profile));
router.put('/:id/preferences', authenticate, validateUuidParams('id'), can('users.edit'), validate(userPreferencesSchema), asyncHandler(userController.setPreferences));

// Profil de l'utilisateur connecté — aucune clé de droit : chacun règle sa propre langue (G6-05).
router.put('/me/locale', authenticate, validate(setLocaleSchema), asyncHandler(userController.setMyLocale));
const interfacePreferencesSchema=z.object({workspace:z.enum(['sector','direction','production','sales','accounting']).nullable().optional(),density:z.enum(['standard','compact']).nullable().optional()}).strict();
router.get('/me/interface-preferences',authenticate,asyncHandler(async(req,res)=>{
  res.json({success:true,data:await readInterfacePreferences((req as AuthRequest).user!.userId)});
}));
router.put('/me/interface-preferences',authenticate,validate(interfacePreferencesSchema),asyncHandler(async(req,res)=>{
  res.json({success:true,data:await setPersonalInterfacePreferences((req as AuthRequest).user!.userId,req.body)});
}));

// Permissions
router.get('/me/permissions', authenticate, userController.myPermissions);
router.get('/:id/permissions', authenticate, can('users.view'), userController.getPermissions);
router.put('/:id/permissions', authenticate, can('users.permissions'), validate(permissionsSchema), userController.setPermissions);

// Lien espace employe : fiches salariees disponibles pour le selecteur.
router.get('/employees-link', authenticate, can('users.view'), asyncHandler(userController.employeesForLink));

// Revue des acces (Phase 3, outils admin, lecture seule).
router.get('/access-overview', authenticate, can('users.view'), asyncHandler(accessReviewController.overview));
router.get('/:id/access-review', authenticate, can('users.view'), asyncHandler(accessReviewController.review));
router.get('/:id/access-history', authenticate, can('users.view'), asyncHandler(accessReviewController.history));

export default router;
