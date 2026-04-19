import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { userRepository } from '../repositories/user.repository.js';
import { permissionRepository } from '../repositories/permission.repository.js';
import { authEventRepository } from '../repositories/auth-event.repository.js';
import { hashPassword, hashPin } from '../utils/hash.js';

export const userController = {
  async list(_req: AuthRequest, res: Response) {
    const users = await userRepository.findAll();
    const safe = users.map(u => ({
      id: u.id, email: u.email, firstName: u.first_name, lastName: u.last_name,
      role: u.role, isActive: u.is_active, hasPin: !!u.pin_code, storeId: u.store_id, createdAt: u.created_at,
    }));
    res.json({ success: true, data: safe });
  },

  async create(req: AuthRequest, res: Response) {
    const { email, password, firstName, lastName, role, pinCode } = req.body;
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
    const user = await userRepository.create({ email, passwordHash, firstName, lastName, role });
    if (pinCode) {
      const pinHash = await hashPin(pinCode);
      await userRepository.update(user.id, { pinCode: pinHash });
    }
    const updated = pinCode ? await userRepository.findById(user.id) : user;

    // OWASP A09-2 : audit trail creation compte.
    await authEventRepository.recordFromRequest(req, {
      eventType: 'user_created',
      userId: req.user?.userId,
      targetUserId: updated!.id,
      email: updated!.email,
      success: true,
      details: { role: updated!.role, hasPin: !!updated!.pin_code },
    });

    res.status(201).json({
      success: true, data: {
        id: updated!.id, email: updated!.email, firstName: updated!.first_name, lastName: updated!.last_name,
        role: updated!.role, isActive: updated!.is_active, hasPin: !!updated!.pin_code, storeId: updated!.store_id,
      },
    });
  },

  async update(req: AuthRequest, res: Response) {
    const { email, password, firstName, lastName, role, isActive, pinCode, storeId } = req.body;
    const updateData: Record<string, unknown> = {};

    // Defense en profondeur : seul un admin peut modifier role/storeId.
    // La route doit egalement etre protegee par authorize('admin'),
    // mais on re-verifie ici contre le token pour eviter toute escalade.
    if (req.user?.role !== 'admin' && (role !== undefined || storeId !== undefined)) {
      res.status(403).json({
        success: false,
        error: { message: 'Modification de role ou magasin reservee aux administrateurs' },
      });
      return;
    }

    if (email !== undefined) updateData.email = email;
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (role !== undefined) updateData.role = role;
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

    const user = await userRepository.update(req.params.id, updateData as Parameters<typeof userRepository.update>[1]);
    if (!user) { res.status(404).json({ success: false, error: { message: 'Utilisateur non trouvé' } }); return; }

    // OWASP A07-5 : si les privileges ont change, invalider les tokens
    // existants de l'utilisateur cible en bumpant sa token_version.
    const privilegeChange = role !== undefined || storeId !== undefined || isActive === false || !!password;
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
        changed: Object.keys(updateData),
        privilegeChange,
      },
    });

    res.json({
      success: true, data: {
        id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name,
        role: user.role, isActive: user.is_active, hasPin: !!user.pin_code, storeId: user.store_id,
      },
    });
  },

  async remove(req: AuthRequest, res: Response) {
    // A07-5 : bump avant desactivation pour invalider les sessions actives.
    await userRepository.bumpTokenVersion(req.params.id);
    await userRepository.delete(req.params.id);
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
    const data = perms.map(p => ({
      module: p.module,
      canView: p.can_view,
      canCreate: p.can_create,
      canEdit: p.can_edit,
      canDelete: p.can_delete,
      config: p.config,
    }));
    res.json({ success: true, data });
  },

  async setPermissions(req: AuthRequest, res: Response) {
    const { permissions } = req.body;
    await permissionRepository.setPermissions(req.params.id, permissions);
    // OWASP A07-5 : un changement de permissions invalide les tokens actifs.
    await userRepository.bumpTokenVersion(req.params.id);
    const perms = await permissionRepository.findByUserId(req.params.id);
    const data = perms.map(p => ({
      module: p.module,
      canView: p.can_view,
      canCreate: p.can_create,
      canEdit: p.can_edit,
      canDelete: p.can_delete,
      config: p.config,
    }));
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
    const perms = await permissionRepository.findByUserId(req.user!.userId);
    const data = perms.map(p => ({
      module: p.module,
      canView: p.can_view,
      canCreate: p.can_create,
      canEdit: p.can_edit,
      canDelete: p.can_delete,
      config: p.config,
    }));
    res.json({ success: true, data });
  },
};
