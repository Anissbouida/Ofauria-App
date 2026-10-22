import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { userRepository } from '../repositories/user.repository.js';
import { permissionRepository } from '../repositories/permission.repository.js';
import { authEventRepository } from '../repositories/auth-event.repository.js';
import { hashPassword, hashPin } from '../utils/hash.js';
import { roleRepository } from '../repositories/role.repository.js';
import { effectiveRights } from '../services/access-rights.js';
import { normalizePermissions, permissionView } from '../services/permission-input.js';
import { sodEnforcementMode, evaluateRoleCodesSod } from '../services/governance.js';

export const userController = {
  async list(_req: AuthRequest, res: Response) {
    const [users, allRoles] = await Promise.all([userRepository.findAll(), userRepository.allUserRoles()]);
    const rolesByUser = new Map<string, string[]>();
    for (const r of allRoles) {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role_code);
      rolesByUser.set(r.user_id, arr);
    }
    const safe = users.map(u => ({
      id: u.id, email: u.email, firstName: u.first_name, lastName: u.last_name,
      role: u.role, roles: rolesByUser.get(u.id) ?? (u.role ? [u.role] : []),
      isActive: u.is_active, hasPin: !!u.pin_code, storeId: u.store_id, createdAt: u.created_at,
    }));
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
    if (pinCode) {
      // With hashed PINs we can't check uniqueness via SQL — check by comparing
      const existingPin = await userRepository.findByPinCode(pinCode);
      if (existingPin) {
        res.status(409).json({ success: false, error: { message: 'Ce code PIN est déjà utilisé' } });
        return;
      }
    }
    const passwordHash = await hashPassword(password);
    const user = await userRepository.create({ email, passwordHash, firstName, lastName, role: primaryRole, storeId }, req.user?.userId);
    if (pinCode) {
      const pinHash = await hashPin(pinCode);
      await userRepository.update(user.id, { pinCode: pinHash }, req.user?.userId);
    }
    await userRepository.setRoleCodes(user.id, roleCodes, primaryRole, req.user?.userId);
    const updated = await userRepository.findById(user.id);

    // OWASP A09-2 : audit trail creation compte.
    await authEventRepository.recordFromRequest(req, {
      eventType: 'user_created',
      userId: req.user?.userId,
      targetUserId: updated!.id,
      email: updated!.email,
      success: true,
      details: { role: updated!.role, roles: roleCodes, hasPin: !!updated!.pin_code, ...(sodViolations.length ? { sodViolations: sodViolations.map(v => v.code) } : {}) },
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
        const existingPin = await userRepository.findByPinCode(pinCode);
        if (existingPin && existingPin.id !== req.params.id) {
          res.status(409).json({ success: false, error: { message: 'Ce code PIN est déjà utilisé' } });
          return;
        }
        updateData.pinCode = await hashPin(pinCode);
      } else {
        updateData.pinCode = null;
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

    // Snapshot de l'ancien role pour detecter un changement de role
    const oldUser = await userRepository.findById(req.params.id);
    const oldRole = (oldUser as { role?: string } | null)?.role;

    const user = await userRepository.update(req.params.id, updateData as Parameters<typeof userRepository.update>[1], req.user?.userId);
    if (!user) { res.status(404).json({ success: false, error: { message: 'Utilisateur non trouvé' } }); return; }

    // Rôles multiples : synchronise user_roles et users.role (= principal).
    if (rolesInput !== undefined && newPrimaryRole) {
      await userRepository.setRoleCodes(user.id, rolesInput, newPrimaryRole, req.user?.userId);
    }

    // Si le rôle principal a change, purger les permissions custom pour que les
    // droits des nouveaux roles s'appliquent (sinon les permissions configurees
    // sous l'ancien role masquent les modules des nouveaux roles).
    if (newPrimaryRole !== undefined && oldRole && newPrimaryRole !== oldRole) {
      try {
        await permissionRepository.clearByUserId(user.id, req.user?.userId);
      } catch (err) {
        console.error('[user.update] clearPermissions echec (non-bloquant):', err);
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

  /** Return permissions for the currently authenticated user */
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
