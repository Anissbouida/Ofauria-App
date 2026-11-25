import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { userRepository } from '../repositories/user.repository.js';
import { listExceptions, setModuleException, setActionException, removeException, ExceptionError } from '../services/user-exceptions.js';
import { authEventRepository } from '../repositories/auth-event.repository.js';
import { hashPassword, hashPin } from '../utils/hash.js';
import { NEW_PIN_RE, NEW_PIN_MIN_LENGTH } from '../validators/auth.validator.js';

/** G0-06 : PIN à renouveler — moins de 6 chiffres, ou antérieur (longueur inconnue). */
const pinIsWeak = (u: { pin_code: string | null; pin_length?: number | null }) =>
  !!u.pin_code && (u.pin_length == null || u.pin_length < NEW_PIN_MIN_LENGTH);
const NEW_PIN_MESSAGE = 'Le code PIN doit compter 6 à 10 chiffres';
import { roleRepository } from '../repositories/role.repository.js';
import { effectiveRights } from '../services/access-rights.js';
import { permissionView } from '../services/permission-input.js';
import { sodEnforcementMode, evaluateRoleCodesSod } from '../services/governance.js';
import { logger } from '../utils/logger.js';
import { mfaRepository } from '../repositories/mfa.repository.js';
import { passkeyRepository } from '../repositories/passkey.repository.js';
import { accountAttachments } from '../services/account-profile.js';
import { invitationRepository } from '../repositories/invitation.repository.js';
import { enqueueEmail, mailStatus } from '../services/mailer.js';
import crypto from 'crypto';

/**
 * Invitation (refonte Utilisateurs, lot 3) : jeton de 72 h, e-mail mis en file quand l'envoi est
 * configuré. Le lien est aussi rendu à l'administrateur pour qu'il puisse le transmettre lui-même.
 */
async function sendInvitation(req: AuthRequest, user: { id: string; email: string; first_name?: string | null }) {
  const { token, expiresAt } = await invitationRepository.create(user.id, req.user?.userId);
  const origin = (req.get('origin') || process.env.APP_URL || '').replace(/\/+$/, '');
  const path = `/invitation/${token}`;
  const status = await mailStatus();
  let queued = false;
  if (status.configured && origin) {
    const until = new Date(expiresAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Africa/Casablanca' });
    await enqueueEmail({
      to: user.email, toName: user.first_name ?? null, userId: user.id, createdBy: req.user?.userId ?? null,
      type: 'invitation', referenceType: 'user', referenceId: user.id,
      subject: 'Votre accès à Kalum',
      text: `Bonjour${user.first_name ? ` ${user.first_name}` : ''},\n\nUn compte Kalum a été créé pour vous. Choisissez votre mot de passe en ouvrant ce lien :\n\n${origin}${path}\n\nLe lien est valable jusqu'au ${until}. Si vous n'attendiez pas ce message, ignorez-le.`,
    });
    queued = true;
  }
  await authEventRepository.recordFromRequest(req, {
    eventType: 'invitation_sent', userId: req.user?.userId, targetUserId: user.id, email: user.email, success: true,
    details: { emailQueued: queued, expiresAt },
  });
  return { token, path, expiresAt, emailQueued: queued, mailConfigured: status.configured };
}
import { readInterfacePreferences, setPersonalInterfacePreferences } from '../services/interface-preferences.js';

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

/**
 * Établissements choisis pour un compte (lot 7). `raw` absent : rien à changer (null). Sinon liste
 * dédoublonnée d'établissements existants et actifs ; le défaut est `wanted` s'il en fait partie,
 * puis l'actuel, puis le premier ; liste vide = aucun établissement.
 */
async function storeSelection(raw: unknown, wanted: unknown, current: string | null): Promise<{ ids: string[]; defaultId: string | null } | null | string> {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return 'Liste d\'établissements attendue';
  const ids = [...new Set(raw.map(String))];
  const known = await userRepository.activeStoreIdsAmong(ids);
  const unknown = ids.filter(id => !known.includes(id));
  if (unknown.length) return 'Établissement inconnu ou désactivé';
  const w = typeof wanted === 'string' && wanted ? wanted : null;
  const defaultId = (w && ids.includes(w)) ? w : (current && ids.includes(current)) ? current : ids[0] ?? null;
  return { ids, defaultId };
}

/**
 * Écriture d'une exception individuelle (lot 6) : refus métier rendus tels quels (400, 409 avec
 * les conflits de séparation des tâches), puis sessions du compte fermées et événement journalisé.
 */
async function exceptionWrite(req: AuthRequest, res: Response, kind: 'module' | 'action', ref: string, write: () => Promise<{ effect: string; sodWarnings?: unknown[] }>) {
  try {
    const out = await write();
    await afterExceptionChange(req, {
      kind, ref, action: 'set', effect: out.effect, reason: req.body?.reason, endsOn: req.body?.endsOn ?? null,
      ...(kind === 'action' ? { granted: !!req.body?.granted } : {}),
    });
    res.json({ success: true, data: out });
  } catch (e) {
    if (e instanceof ExceptionError) {
      res.status(e.status).json({ success: false, error: { message: e.message, violations: e.violations } });
      return;
    }
    throw e;
  }
}

async function afterExceptionChange(req: AuthRequest, details: Record<string, unknown>) {
  // OWASP A07-5 : un changement de droits invalide les jetons actifs du compte.
  await userRepository.bumpTokenVersion(req.params.id);
  // OWASP A09-2 : trace du changement.
  await authEventRepository.recordFromRequest(req, {
    eventType: 'permission_changed', userId: req.user?.userId, targetUserId: req.params.id, success: true, details,
  });
}

export const userController = {
  async list(_req: AuthRequest, res: Response) {
    const [users, allRoles, lastLogins, mfaRoles, invitations, trustedDevices, passkeys, storeIds] = await Promise.all([
      userRepository.findAll(), userRepository.allUserRoles(), userRepository.lastLogins(), mfaRepository.requiredRoles(),
      invitationRepository.openByUser(), mfaRepository.trustedDeviceCounts(), passkeyRepository.countsByUser(),
      userRepository.storeIdsByUser(),
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
        // Établissements du compte, le défaut en tête (lot 7).
        storeIds: storeIds.get(u.id) ?? (u.store_id ? [u.store_id] : []),
        // Sécurité du compte (double authentification, verrouillage, dernière connexion).
        // Activée = application d'authentification OU au moins une passkey (mig 705).
        mfaEnabled: !!u.totp_enabled || (passkeys.get(u.id) ?? 0) > 0, mfaApp: !!u.totp_enabled, mfaPasskeys: passkeys.get(u.id) ?? 0,
        mfaRequired: mfaRequiredByRole || mfaRequiredForUser, mfaRequiredByRole, mfaRequiredForUser,
        // Postes de confiance encore valables : code non redemandé (mig 702).
        mfaTrustedDevices: trustedDevices.get(u.id) ?? 0,
        lockedUntil: lockedUntil && new Date(lockedUntil).getTime() > now ? lockedUntil : null,
        failedLoginCount: (u as { failed_login_count?: number }).failed_login_count ?? 0,
        lastLoginAt: lastLogins.get(u.id) ?? null,
        locale: (u as { locale?: string | null }).locale ?? null,
        // Invitation encore ouverte (lot 3) : date de fin, passée si le lien a expiré.
        invitationExpiresAt: invitations.get(u.id) ?? null,
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
    // Invitation : un mot de passe aléatoire que personne ne connaît, remplacé à l'acceptation.
    const invite = req.body.invite === true;
    if (!invite && !password) {
      res.status(400).json({ success: false, error: { message: 'Mot de passe requis, ou invitation par e-mail' } });
      return;
    }
    const passwordHash = await hashPassword(invite ? crypto.randomBytes(32).toString('base64url') : password);
    // Lot 7 : plusieurs établissements ; `storeId` = établissement par défaut (sinon le premier).
    const stores = await storeSelection(req.body.storeIds, storeId ?? null, null);
    if (typeof stores === 'string') { res.status(400).json({ success: false, error: { message: stores } }); return; }
    const user = await userRepository.create({ email, passwordHash, firstName, lastName, role: primaryRole, storeId: stores ? stores.defaultId : storeId }, req.user?.userId);
    if (stores) await userRepository.setStores(user.id, stores.ids, stores.defaultId, req.user?.userId);
    if (pinCode) {
      const pinHash = await hashPin(String(pinCode));
      await userRepository.update(user.id, { pinCode: pinHash, pinLength: String(pinCode).length }, req.user?.userId);
    }
    await userRepository.setRoleCodes(user.id, roleCodes, primaryRole, req.user?.userId);
    // Options de création : mot de passe provisoire à changer, double authentification exigée.
    if (req.body.mustChangePassword === true && !invite) await userRepository.setMustChangePassword(user.id, true);
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

    const invitation = invite ? await sendInvitation(req, updated!) : null;
    res.status(201).json({
      success: true, data: {
        id: updated!.id, email: updated!.email, firstName: updated!.first_name, lastName: updated!.last_name,
        role: updated!.role, roles: roleCodes, isActive: updated!.is_active, hasPin: !!updated!.pin_code, storeId: updated!.store_id,
        invitation,
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
    const storeIdsInput: unknown = req.body.storeIds;
    if (req.user?.role !== 'admin' && (role !== undefined || rolesInput !== undefined || storeId !== undefined || storeIdsInput !== undefined)) {
      res.status(403).json({
        success: false,
        error: { message: 'Modification de rôle ou magasin réservée aux administrateurs' },
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
    // Lot 7 : établissements du compte ; `storeId` = établissement par défaut.
    let stores: { ids: string[]; defaultId: string | null } | null = null;
    if (storeIdsInput !== undefined) {
      const current = (await userRepository.findById(req.params.id))?.store_id ?? null;
      const sel = await storeSelection(storeIdsInput, storeId, current);
      if (typeof sel === 'string') { res.status(400).json({ success: false, error: { message: sel } }); return; }
      stores = sel;
    } else if (storeId !== undefined) updateData.storeId = storeId;
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

    // Lot 6 : les exceptions individuelles s'ajoutent aux rôles et sont conservées au changement
    // de rôle principal.

    // OWASP A07-5 : si les privileges ont change, invalider les tokens
    // existants de l'utilisateur cible en bumpant sa token_version.
    if (stores) await userRepository.setStores(user.id, stores.ids, stores.defaultId, req.user?.userId);
    const privilegeChange = role !== undefined || rolesInput !== undefined || storeId !== undefined || stores !== null || isActive === false || !!password;
    if (privilegeChange) {
      await userRepository.bumpTokenVersion(user.id);
    }
    // Mot de passe remplacé ou compte désactivé → postes de confiance oubliés (mig 702).
    if (isActive === false || !!password) await mfaRepository.forgetDevices(user.id);

    // OWASP A09-2 : audit trail.
    await authEventRepository.recordFromRequest(req, {
      eventType: 'user_updated',
      userId: req.user?.userId,
      targetUserId: user.id,
      email: user.email,
      success: true,
      details: {
        changed: [...Object.keys(updateData), ...(rolesInput !== undefined ? ['roles'] : []), ...(stores ? ['stores'] : [])],
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
    await mfaRepository.forgetDevices(req.params.id);
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
    await mfaRepository.resetAll(target.id);
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
    // Fermer les sessions oublie aussi les postes de confiance (appareil perdu ou volé, mig 702).
    const forgottenDevices = await mfaRepository.forgetDevices(target.id);
    await authEventRepository.recordFromRequest(req, {
      eventType: 'token_revoked', userId: req.user?.userId, targetUserId: target.id, email: target.email, success: true,
      details: { action: 'all_sessions', forgottenDevices },
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

  /** Exceptions individuelles d'un compte (lot 6), avec leur effet et les droits de ses rôles. */
  async exceptions(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await listExceptions(req.params.id) });
  },

  async setModuleException(req: AuthRequest, res: Response) {
    await exceptionWrite(req, res, 'module', req.params.module, () =>
      setModuleException(req.params.id, req.params.module, req.body, req.user?.userId));
  },

  async setActionException(req: AuthRequest, res: Response) {
    await exceptionWrite(req, res, 'action', req.params.key, () =>
      setActionException(req.params.id, req.params.key, req.body, req.user?.userId));
  },

  async removeException(req: AuthRequest, res: Response) {
    const kind = req.params.kind === 'actions' ? 'action' : req.params.kind === 'modules' ? 'module' : null;
    if (!kind) { res.status(404).json({ success: false, error: { message: 'Exception introuvable' } }); return; }
    const ref = req.params.ref;
    if (!(await removeException(req.params.id, kind, ref, req.user?.userId))) {
      res.status(404).json({ success: false, error: { message: 'Exception introuvable' } });
      return;
    }
    await afterExceptionChange(req, { kind, ref, action: 'removed' });
    res.json({ success: true });
  },

  /** Fiches salariés actives (sélecteur de lien espace employé). Admin. */
  async employeesForLink(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await userRepository.employeesForLink() });
  },

  /**
   * Vérification avant création (lot 3) : conflits de séparation des tâches entre les rôles
   * choisis, et mode de contrôle (en mode Bloquer, la création serait refusée). N'écrit rien.
   */
  async sodCheck(req: AuthRequest, res: Response) {
    const roles = Array.isArray(req.body?.roles) ? (req.body.roles as unknown[]).map(String) : [];
    const mode = await sodEnforcementMode();
    const violations = mode === 'off' || roles.length < 2 ? [] : await evaluateRoleCodesSod(roles);
    res.json({ success: true, data: { mode, violations } });
  },

  /** (Ré)envoi d'une invitation : annule la précédente et en crée une nouvelle de 72 h. */
  async invite(req: AuthRequest, res: Response) {
    const user = await userRepository.findById(req.params.id);
    if (!user) { res.status(404).json({ success: false, error: { message: 'Utilisateur non trouvé' } }); return; }
    if (!user.is_active || (user as { is_system?: boolean }).is_system) {
      res.status(400).json({ success: false, error: { message: 'Réactivez d\'abord le compte pour l\'inviter' } });
      return;
    }
    res.json({ success: true, data: await sendInvitation(req, user) });
  },

  /**
   * Fiche d'un compte (refonte Utilisateurs, lot 2) : rattachements réglés dans les autres modules
   * (ateliers, modules en essai, circuits d'approbation, délégations, connexions externes) et
   * préférences (langue, espace de travail).
   */
  async profile(req: AuthRequest, res: Response) {
    const user = await userRepository.findById(req.params.id);
    if (!user) { res.status(404).json({ success: false, error: { message: 'Utilisateur non trouvé' } }); return; }
    const [attachments, prefs] = await Promise.all([accountAttachments(user.id), readInterfacePreferences(user.id)]);
    res.json({
      success: true,
      data: {
        ...attachments,
        preferences: {
          locale: (user as { locale?: string | null }).locale ?? null,
          workspace: prefs.personal.workspace ?? null,
          workspaceResolved: prefs.values.workspace,
          available: prefs.available,
        },
      },
    });
  },

  /** Langue et espace de travail d'un compte, réglés par l'administrateur (null = valeur de la société). */
  async setPreferences(req: AuthRequest, res: Response) {
    const user = await userRepository.findById(req.params.id);
    if (!user) { res.status(404).json({ success: false, error: { message: 'Utilisateur non trouvé' } }); return; }
    const { locale, workspace } = req.body as { locale?: 'fr' | 'ar' | 'en' | null; workspace?: string | null };
    const changed: string[] = [];
    if (locale !== undefined) { await userRepository.setLocale(user.id, locale); changed.push('locale'); }
    if (workspace !== undefined) { await setPersonalInterfacePreferences(user.id, { workspace }, req.user!.userId); changed.push('workspace'); }
    if (changed.length) {
      await authEventRepository.recordFromRequest(req, {
        eventType: 'user_updated', userId: req.user?.userId, targetUserId: user.id, email: user.email, success: true,
        details: { changed },
      });
    }
    const prefs = await readInterfacePreferences(user.id);
    const fresh = await userRepository.findById(user.id);
    res.json({ success: true, data: { locale: (fresh as { locale?: string | null } | null)?.locale ?? null, workspace: prefs.personal.workspace ?? null, workspaceResolved: prefs.values.workspace } });
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
