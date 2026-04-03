import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { userRepository } from '../repositories/user.repository.js';
import { hashPassword } from '../utils/hash.js';

export const userController = {
  async list(_req: AuthRequest, res: Response) {
    const users = await userRepository.findAll();
    const safe = users.map(u => ({
      id: u.id, email: u.email, firstName: u.first_name, lastName: u.last_name,
      role: u.role, isActive: u.is_active, pinCode: u.pin_code, createdAt: u.created_at,
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
      const existingPin = await userRepository.findByPinCode(pinCode);
      if (existingPin) {
        res.status(409).json({ success: false, error: { message: 'Ce code PIN est déjà utilisé' } });
        return;
      }
    }
    const passwordHash = await hashPassword(password);
    const user = await userRepository.create({ email, passwordHash, firstName, lastName, role });
    if (pinCode) {
      await userRepository.update(user.id, { pinCode });
    }
    const updated = pinCode ? await userRepository.findById(user.id) : user;
    res.status(201).json({
      success: true, data: {
        id: updated!.id, email: updated!.email, firstName: updated!.first_name, lastName: updated!.last_name,
        role: updated!.role, isActive: updated!.is_active, pinCode: updated!.pin_code,
      },
    });
  },

  async update(req: AuthRequest, res: Response) {
    const { email, password, firstName, lastName, role, isActive, pinCode } = req.body;
    const updateData: Record<string, unknown> = {};
    if (email !== undefined) updateData.email = email;
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (role !== undefined) updateData.role = role;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (password) updateData.passwordHash = await hashPassword(password);
    if (pinCode !== undefined) {
      if (pinCode) {
        const existingPin = await userRepository.findByPinCode(pinCode);
        if (existingPin && existingPin.id !== req.params.id) {
          res.status(409).json({ success: false, error: { message: 'Ce code PIN est déjà utilisé' } });
          return;
        }
      }
      updateData.pinCode = pinCode || null;
    }

    const user = await userRepository.update(req.params.id, updateData as Parameters<typeof userRepository.update>[1]);
    if (!user) { res.status(404).json({ success: false, error: { message: 'Utilisateur non trouvé' } }); return; }
    res.json({
      success: true, data: {
        id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name,
        role: user.role, isActive: user.is_active, pinCode: user.pin_code,
      },
    });
  },

  async remove(req: AuthRequest, res: Response) {
    await userRepository.delete(req.params.id);
    res.json({ success: true, data: null });
  },
};
