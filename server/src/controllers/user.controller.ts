import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { userRepository } from '../repositories/user.repository.js';
import { permissionRepository } from '../repositories/permission.repository.js';
import { authEventRepository } from '../repositories/auth-event.repository.js';
import { hashPassword, hashPin } from '../utils/hash.js';
import { NEW_PIN_RE, NEW_PIN_MIN_LENGTH } from '../validators/auth.validator.js';

/** G0-06 : PIN à renouveler — moins de 6 chiffres, ou antérieur (longueur inconnue). */
const pinIsWeak = (u: { pin_code: string | null; pin_length?: number | null }) =>
  !!u.pin_code && (u.pin_length == null || u.pin_length < NEW_PIN_MIN_LENGTH);
const NEW_PIN_MESSAGE = 'Le code PIN doit compter 6 à 10 chiffres';
import { roleRepository } from '../repositories/role.repository.js';
import { effectiveRights } from '../services/access-rights.js';
import { normalizePermissions, permissionView } from '../services/permission-input.js';
import { sodEnforcementMode, evaluateRoleCodesSod } from '../services/governance.js';
import { logger } from '../utils/logger.js';
import { mfaRepository } from '../repositories/mfa.repository.js';

type Guarded = 'deactivate' | 'delete' | 'demote';
const GUARD_VERB: Record<Guarded, string> = { deactivate: 'désactiver', delete: 'supprimer', demote: 'retirer le rôle administrateur de' };

/**
 * Garde-fous d'administration : on ne se désactive ni ne se supprime soi-même, et l'on
 * ne prive jamais l'application de son dernier administrateur actif. Répond 400 et rend
 * false quand l'action est refusée.
 */
async function guardAccountLoss(req: AuthRequest, res: Response, targetId: string, action: Guarded): Promise<boolean> {
  if (action !== 'demote' && targetId === req.user?.userId) {
    res.status(400).json({ success: false, error: { message: `Vous ne pouvez pas ${GUARD_VERB[action]} votre propre compte` } });
    return false;
  }
  const target = await userRepository.findById(targetId);
  if (!target) { res.status(404).json({ success: false, error: { message: 'Utilisateur non trouvé' } }); return false; }
  if ((target as { is_system?: boolean }).is_system) {
    res.status(400).json({ success: false, error: { message: 'Le compte technique Système ne se modifie pas' } });
    return false;
  }
  if (target.role === 'admin' && target.is_active && (await userRepository.countActiveAdmins(targetId)) === 0) {
    res.status(400).json({ success: false, error: { message: `Impossible de ${GUARD_VERB[action]} le dernier administrateur actif : nommez d'abord un autre administrateur` } });
    return false;
  }
  return true;
}

export const userController = {
  async list(_req: AuthRequest, res: Response) {
    const [users, allRoles, lastLogins, mfaRoles] = await Promise.all([
      userRepository.findAll(), userRepository.allUserRoles(), userRepository.lastLogins(), mfaRepository.requiredRoles(),
    ]);
    const rolesByUser = new Map<string, string[]>();
    for (const r of allRoles) {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role_code);
      rolesByUser.set(r.user_id, arr);
    }
    const now = Date.now();
    const safe = users.map(u => {
      const roles = rolesByUser.get(u.id) ?? (u.role ? [u.role] : []);
      const mfaRequiredByRole = mfaRoles.some(r => roles.includes(r));
      const mfaRequiredForUser = !!(u as { mfa_required?: boolean }).mfa_required;
      const lockedUntil = (u as { locked_until?: Date | null }).locked_until;
      return {
        id: u.id, email: u.email, firstName: u.first_name, lastName: u.last_name,
        role: u.role, roles,
        isActive: u.is_active, hasPin: !!u.pin_code, pinWeak: pinIsWeak(u), mustChangePassword: !!u.must_change_password,
        storeId: u.store_id, createdAt: u.created_at,
        // Sécurité du compte (double authentification, verrouillage, dernière connexion).
        mfaEnabled: !!u.totp_enabled, mfaRequired: mfaRequiredByRole || mfaRequiredForUser, mfaRequiredByRole, mfaRequiredForUser,
        lockedUntil: lockedUntil && new Date(lockedUntil).getTime() > now ? lockedUntil : null,
        failedLoginCount: (u as { failed_login_count?: number }).failed_login_count ?? 0,
        lastLoginAt: lastLogins.get(u.id) ?? null,
      };
    });
    res.json({ success: true, data: safe });
  },

  async create(req: AuthRequest, res: Response) {
    const { email, password, firstName, lastName, role, pinCode, storeId } = req.body;
    // Rôles multiples (mig 335) : `roles` prime, sinon le champ `role` historique.
    const roleCodes: string[] = Array.isArray(req.body.roles) && req.body.roles.length
      ? req.body.roles.map((r: unknown) => String(r))
      : (role ? [String(role)] : []);
    if (roleCodes.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Au moins un rôle est requis' } });
      return;
    }
    const primaryRole = roleCodes.includes(String(req.body.primaryRole)) ? String(req.body.primaryRole) : roleCodes[0];
    for (const c of roleCodes) {
      if (!(await roleRepository.isAssignable(c))) {
        res.status(400).json({ success: false, error: { message: `Rôle inconnu ou désactivé : ${c}` } });
        return;
      }
    }
    // Séparation des tâches (mig 336) : contrôle du cumul de rôles.
    const sodMode = await sodEnforcementMode();
    const sodViolations = sodMode === 'off' ? [] : await evaluateRoleCodesSod(roleCodes);
    if (sodMode === 'enforce' && sodViolations.length > 0) {
      res.status(400).json({ success: false, error: { message: `Cumul de rôles interdit (séparation des tâches) : ${sodViolations.map(v => v.label).join(' ; ')}` } });
      return;
    }
    const existing = await userRepository.findByEmail(email);
    if (existing) {
      res.status(409).json({ success: false, error: { message: 'Cet email est déjà utilisé' } });
      return;
    }
    // G0-06 : tout nouveau PIN compte 6 à 10 chiffres. Le PIN n'a plus à être
    // unique : le compte est désigné par sa tuile avant la saisie du PIN.
    if (pinCode && !NEW_PIN_RE.test(String(pinCode))) {
      res.status(400).json({ success: false, error: { message: NEW_PIN_MESSAGE } });
      return;
    }
    const passwordHash = await hashPassword(password);
    const user = await userRepository.create({ email, passwordHash, firstName, lastName, role: primaryRole, storeId }, req.user?.userId);
    if (pinCode) {
      const pinHash = await hashPin(String(pinCode));
      await userRepository.update(user.id, { pinCode: pinHash, pinLength: String(pinCode).length }, req.user?.userId);
    }
    await userRepository.setRoleCodes(user.id, roleCodes, primaryRole, req.user?.userId);
    // Options de création : mot de passe provisoire à changer, double authentification exigée.
    if (req.body.mustChangePassword === true) await userRepository.setMustChangePassword(user.id, true);
    if (req.body.mfaRequired === true) await mfaRepository.setRequiredForUser(user.id, true);
    // Lien espace employé (employees.user_id) si une fiche est choisie.
    if (req.body.employeeId !== undefined) {
      await userRepository.setLinkedEmployee(user.id, req.body.employeeId ? String(req.body.employeeId) : null, req.user?.userId);
    }
    const updated = await userRepository.findById(user.id);

    // OWASP A09-2 : audit trail creation compte.
    await authEventRepository.recordFromRequest(req, {
      eventType: 'user_created',
      userId: req.user?.userId,
      targetUserId: updated!.id,
      email: updated!.email,
      success: true,
      details: { role: updated!.role, roles: roleCodes, hasPin: !!updated!.pin_code, mustChangePassword: req.body.mustChangePassword === true, mfaRequired: req.body.mfaRequired === true, ...(sodViolations.length ? { sodViolations: sodViolations.map(v => v.code) } : {}) },
    });

    res.status(201).json({
      success: true, data: {
        id: updated!.id, email: updated!.email, firstName: updated!.first_name, lastName: updated!.last_name,
        role: updated!.role, roles: roleCodes, isActive: updated!.is_active, hasPin: !!updated!.pin_code, storeId: updated!.store_id,
      },
    });
  },

  async update(req: AuthRequest, res: Response) {
    const { email, password, firstName, lastName, role, isActive, pinCode, storeId } = req.body;
    const updateData: Record<string, unknown> = {};

    // Rôles multiples (mig 335) : `roles` (tableau) prime sur `role`.
    const rolesInput: string[] | undefined = Array.isArray(req.body.roles)
      ? req.body.roles.map((r: unknown) => String(r))
      : undefined;

    // Defense en profondeur : seul un admin peut modifier role(s)/storeId.
    // La route doit egalement etre protegee par authorize('admin'),
    // mais on re-verifie ici contre le token pour eviter toute escalade.
    if (req.user?.role !== 'admin' && (role !== undefined || rolesInput !== undefined || storeId !== undefined)) {
      res.status(403).json({
        success: false,
        error: { message: 'Modification de role ou magasin reservee aux administrateurs' },
      });
      return;
    }

    if (email !== undefined) updateData.email = email;
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    // Rôle principal effectif après mise à jour (sert à détecter un changement).
    let newPrimaryRole: string | undefined;
    if (rolesInput !== undefined) {
      if (rolesInput.length === 0) {
        res.status(400).json({ success: false, error: { message: 'Au moins un rôle est requis' } });
        return;
      }
      for (const c of rolesInput) {
        if (!(await roleRepository.isAssignable(c))) {
          res.status(400).json({ success: false, error: { message: `Rôle inconnu ou désactivé : ${c}` } });
          return;
        }
      }
      newPrimaryRole = rolesInput.includes(String(req.body.primaryRole)) ? String(req.body.primaryRole) : rolesInput[0];
      // users.role est mis à jour par setRoleCodes (pas via updateData).
    } else if (role !== undefined) {
      if (!(await roleRepository.isAssignable(role))) {
        res.status(400).json({ success: false, error: { message: 'Rôle inconnu ou désactivé' } });
        return;
      }
      updateData.role = role;
      newPrimaryRole = String(role);
    }
    if (isActive !== undefined) updateData.isActive = isActive;
    if (storeId !== undefined) updateData.storeId = storeId;
    if (password) updateData.passwordHash = await hashPassword(password);
    if (pinCode !== undefined) {
      if (pinCode) {
        // G0-06 : nouveau PIN de 6 à 10 chiffres, sans contrainte d'unicité.
        if (!NEW_PIN_RE.test(String(pinCode))) {
          res.status(400).json({ success: false, error: { message: NEW_PIN_MESSAGE } });
          return;
        }
        updateData.pinCode = await hashPin(String(pinCode));
        updateData.pinLength = String(pinCode).length;
      } else {
        updateData.pinCode = null;
        updateData.pinLength = null;
      }
    }

    // Séparation des tâches (mig 336) : contrôle du cumul lors d'un changement de rôles.
    let sodViolations: { code: string; label: string }[] = [];
    if (rolesInput !== undefined) {
      const sodMode = await sodEnforcementMode();
      sodViolations = sodMode === 'off' ? [] : await evaluateRoleCodesSod(rolesInput);
      if (sodMode === 'enforce' && sodViolations.length > 0) {
        res.status(400).json({ success: false, error: { message: `Cumul de rôles interdit (séparation des tâches) : ${sodViolations.map(v => v.label).join(' ; ')}` } });
        return;
      }
    }

    // Garde-fous : ni soi-même ni le dernier administrateur actif.
    if (isActive === false && !(await guardAccountLoss(req, res, req.params.id, 'deactivate'))) return;
    if (newPrimaryRole !== undefined && newPrimaryRole !== 'admin' && !(await guardAccountLoss(req, res, req.params.id, 'demote'))) return;

    // Snapshot de l'ancien role pour detecter un changement de role
    const oldUser = await userRepository.findById(req.params.id);
    const oldRole = (oldUser as { role?: string } | null)?.role;

    const user = await userRepository.update(req.params.id, updateData as Parameters<typeof userRepository.update>[1], req.user?.userId);
    if (!user) { res.status(404).json({ success: false, error: { message: 'Utilisateur non trouvé' } }); return; }

    // Rôles multiples : synchronise user_roles et users.role (= principal).
    if (rolesInput !== undefined && newPrimaryRole) {
      await userRepository.setRoleCodes(user.id, rolesInput, newPrimaryRole, req.user?.userId);
    }
    // Lien espace employé (employees.user_id) — réservé à l'administrateur (route admin).
    if (req.body.employeeId !== undefined) {
      await userRepository.setLinkedEmployee(user.id, req.body.employeeId ? String(req.body.employeeId) : null, req.user?.userId);
    }

    // Si le rôle principal a change, purger les permissions custom pour que les
    // droits des nouveaux roles s'appliquent (sinon les permissions configurees
    // sous l'ancien role masquent les modules des nouveaux roles).
    if (newPrimaryRole !== undefined && oldRole && newPrimaryRole !== oldRole) {
      try {
        await permissionRepository.clearByUserId(user.id, req.user?.userId);
      } catch (err) {
        logger.error({ err: err }, '[user.update] clearPermissions echec (non-bloquant):');
      }
    }

    // OWASP A07-5 : si les privileges ont change, invalider les tokens
    // existants de l'utilisateur cible en bumpant sa token_version.
    const privilegeChange = role !== undefined || rolesInput !== undefined || storeId !== undefined || isActive === false || !!password;
    if (privilegeChange) {
      await userRepository.bumpTokenVersion(user.id);
    }

    // OWASP A09-2 : audit trail.
    await authEventRepository.recordFromRequest(req, {
      eventType: 'user_updated',
      userId: req.user?.userId,
      targetUserId: user.id,
      email: user.email,
      success: true,
      details: {
        changed: [...Object.keys(updateData), ...(rolesInput !== undefined ? ['roles'] : [])],
        privilegeChange,
        ...(sodViolations.length ? { sodViolations: sodViolations.map(v => v.code) } : {}),
      },
    });

    const roles = await userRepository.getRoleCodes(user.id);
    res.json({
      success: true, data: {
        id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name,
        role: newPrimaryRole ?? user.role, roles, isActive: user.is_active, hasPin: !!user.pin_code, storeId: user.store_id,
      },
    });
  },

  async remove(req: AuthRequest, res: Response) {
    if (!(await guardAccountLoss(req, res, req.params.id, 'deactivate'))) return;
    // A07-5 : bump avant desactivation pour invalider les sessions actives.
    await userRepository.bumpTokenVersion(req.params.id);
    await userRepository.delete(req.params.id, req.user?.userId);
    await authEventRepository.recordFromRequest(req, {
      eventType: 'user_updated',
      userId: req.user?.userId,
      targetUserId: req.params.id,
      success: true,
      details: { action: 'deactivated' },
    });
    res.json({ success: true, data: null });
  },

  /**
   * Suppression définitive : seulement pour un compte sans historique (créé par erreur,
   * jamais utilisé). Un compte qui a laissé une trace (document, pointage, validation…)
   * se désactive : la traçabilité des opérations l'exige.
   */
  async hardDelete(req: AuthRequest, res: Response) {
    const id = req.params.id;
    if (!(await guardAccountLoss(req, res, id, 'delete'))) return;
    const target = await userRepository.findById(id);
    const refs = await userRepository.historyReferences(id);
    const hasHistory = () => res.status(409).json({
      success: false,
      error: {
        message: 'Ce compte a déjà servi dans l\'application : le supprimer effacerait la traçabilité de ses opérations. Désactivez-le plutôt.',
        code: 'USER_HAS_HISTORY', details: { tables: refs },
      },
    });
    if (refs.length) { hasHistory(); return; }
    try {
      if (!(await userRepository.hardDelete(id, req.user?.userId))) {
        res.status(404).json({ success: false, error: { message: 'Utilisateur non trouvé' } });
        return;
      }
    } catch (err) {
      // Trace apparue entre-temps, ou référence sans clé étrangère connue : on refuse proprement.
      const e = err as { code?: string; message?: string };
      if (e.code === '23503' || /append-only|ajout seul/i.test(e.message ?? '')) { hasHistory(); return; }
      throw err;
    }
    await authEventRepository.recordFromRequest(req, {
      eventType: 'user_deleted', userId: req.user?.userId, email: target!.email, success: true,
      details: { deletedUserId: id, name: `${target!.first_name} ${target!.last_name}`, role: target!.role },
    });
    res.json({ success: true, data: null });
  },

  /** Double authentification exigée (ou non) pour ce compte, en plus de la politique par rôle. */
  async setMfaRequired(req: AuthRequest, res: Response) {
    const required = req.body.required === true;
    if (!(await mfaRepository.setRequiredForUser(req.params.id, required))) {
      res.status(404).json({ success: false, error: { message: 'Utilisateur non trouvé' } });
      return;
    }
    await authEventRepository.recordFromRequest(req, {
      eventType: 'mfa_requirement_changed', userId: req.user?.userId, targetUserId: req.params.id, success: true, details: { required },
    });
    res.json({ success: true, data: { required } });
  },

  /**
   * Réinitialise la double authentification (téléphone perdu, application supprimée) :
   * secret et codes de secours effacés, sessions fermées. Si elle reste exigée, le compte
   * la reconfigure à sa prochaine connexion.
   */
  async resetMfa(req: AuthRequest, res: Response) {
    // Sur son propre compte, la désactivation passe par /auth/mfa/disable (mot de passe + code) :
    // sinon une session volée suffirait à retirer le second facteur.
    if (req.params.id === req.user?.userId) {
      res.status(403).json({ success: false, error: { message: 'Vous ne pouvez pas réinitialiser votre propre double authentification : demandez-le à un autre administrateur' } });
      return;
    }
    const target = await userRepository.findById(req.params.id);
    if (!target) { res.status(404).json({ success: false, error: { message: 'Utilisateur non trouvé' } }); return; }
    await mfaRepository.disable(target.id);
    await userRepository.bumpTokenVersion(target.id);
    await authEventRepository.recordFromRequest(req, {
      eventType: 'mfa_reset', userId: req.user?.userId, targetUserId: target.id, email: target.email, success: true,
    });
    res.json({ success: true, data: null });
  },

  /** Lève le verrouillage après trop d'échecs de connexion. */
  async unlock(req: AuthRequest, res: Response) {
    const target = await userRepository.findById(req.params.id);
    if (!target) { res.status(404).json({ success: false, error: { message: 'Utilisateur non trouvé' } }); return; }
    await userRepository.resetFailedLogins(target.id);
    await authEventRepository.recordFromRequest(req, {
      eventType: 'account_unlocked', userId: req.user?.userId, targetUserId: target.id, email: target.email, success: true,
    });
    res.json({ success: true, data: null });
  },

  /** Ferme toutes les sessions ouvertes du compte (jetons invalidés). */
  async revokeSessions(req: AuthRequest, res: Response) {
    const target = await userRepository.findById(req.params.id);
    if (!target) { res.status(404).json({ success: false, error: { message: 'Utilisateur non trouvé' } }); return; }
    await userRepository.bumpTokenVersion(target.id);
    await authEventRepository.recordFromRequest(req, {
      eventType: 'token_revoked', userId: req.user?.userId, targetUserId: target.id, email: target.email, success: true,
      details: { action: 'all_sessions' },
    });
    res.json({ success: true, data: null });
  },

  /** Impose (ou lève) le changement de mot de passe à la prochaine connexion. */
  async setMustChangePassword(req: AuthRequest, res: Response) {
    const value = req.body.value === true;
    const target = await userRepository.findById(req.params.id);
    if (!target) { res.status(404).json({ success: false, error: { message: 'Utilisateur non trouvé' } }); return; }
    await userRepository.setMustChangePassword(target.id, value);
    await authEventRepository.recordFromRequest(req, {
      eventType: 'user_updated', userId: req.user?.userId, targetUserId: target.id, email: target.email, success: true,
      details: { changed: ['mustChangePassword'], value },
    });
    res.json({ success: true, data: { value } });
  },

  /** Politique de double authentification : rôles qui doivent l'activer. */
  async mfaPolicy(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: { requiredRoles: await mfaRepository.requiredRoles() } });
  },
  async setMfaPolicy(req: AuthRequest, res: Response) {
    const roles = [...new Set((req.body.requiredRoles as string[]).map(String))];
    for (const c of roles) {
      if (!(await roleRepository.isAssignable(c))) {
        res.status(400).json({ success: false, error: { message: `Rôle inconnu ou désactivé : ${c}` } });
        return;
      }
    }
    await mfaRepository.setRequiredRoles(roles, req.user!.userId);
    await authEventRepository.recordFromRequest(req, {
      eventType: 'mfa_requirement_changed', userId: req.user?.userId, success: true, details: { requiredRoles: roles },
    });
    res.json({ success: true, data: { requiredRoles: roles } });
  },

  async getPermissions(req: AuthRequest, res: Response) {
    const perms = await permissionRepository.findByUserId(req.params.id);
    const data = perms.map(p => permissionView(p));
    res.json({ success: true, data });
  },

  async setPermissions(req: AuthRequest, res: Response) {
    const perms = normalizePermissions(req.body?.permissions);
    if (typeof perms === 'string') {
      res.status(400).json({ success: false, error: { message: perms } });
      return;
    }
    await permissionRepository.setPermissions(req.params.id, perms, req.user?.userId);
    // OWASP A07-5 : un changement de permissions invalide les tokens actifs.
    await userRepository.bumpTokenVersion(req.params.id);
    const saved = await permissionRepository.findByUserId(req.params.id);
    const data = saved.map(p => permissionView(p));
    // OWASP A09-2 : audit trail modif permissions.
    await authEventRepository.recordFromRequest(req, {
      eventType: 'permission_changed',
      userId: req.user?.userId,
      targetUserId: req.params.id,
      success: true,
      details: { modules: data.map(d => d.module) },
    });
    res.json({ success: true, data });
  },

  /** Fiches salariés actives (sélecteur de lien espace employé). Admin. */
  async employeesForLink(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await userRepository.employeesForLink() });
  },

  /** Return permissions for the currently authenticated user */
  /** G6-05 : langue de l'interface de l'utilisateur connecté (corps validé par setLocaleSchema). */
  async setMyLocale(req: AuthRequest, res: Response) {
    const { locale } = req.body as { locale: 'fr' | 'ar' | 'en' | null };
    const ok = await userRepository.setLocale(req.user!.userId, locale);
    if (!ok) {
      res.status(404).json({ success: false, error: { message: 'Utilisateur non trouvé' } });
      return;
    }
    res.json({ success: true, data: { locale } });
  },

  async myPermissions(req: AuthRequest, res: Response) {
    // Droits effectifs (mig 330) : exceptions de l'utilisateur, sinon droits du role.
    // Liste vide pour l'administrateur (tous les droits).
    const rights = await effectiveRights(req.user!.userId);
    // Role sans aucun module : une ligne neutre evite que le client retombe sur les
    // modules par defaut de son role de base (il ne les lit qu'en l'absence de droits).
    const perms = !rights.isAdmin && rights.rows.length === 0
      ? [{ module: 'none', can_view: false, can_create: false, can_edit: false, can_delete: false, config: {} }]
      : rights.rows;
    const data = perms.map(p => permissionView(p));
    res.json({ success: true, data });
  },
};
