import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { userRepository } from '../repositories/user.repository.js';
import { hashPassword, comparePassword } from '../utils/hash.js';
import { generateToken } from '../utils/jwt.js';

export const authController = {
  async login(req: AuthRequest, res: Response) {
    const { email, password } = req.body;

    const user = await userRepository.findByEmail(email);
    if (!user || !user.is_active) {
      res.status(401).json({ success: false, error: { message: 'Email ou mot de passe incorrect' } });
      return;
    }

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ success: false, error: { message: 'Email ou mot de passe incorrect' } });
      return;
    }

    const token = generateToken({ userId: user.id, role: user.role });
    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role,
          isActive: user.is_active,
        },
      },
    });
  },

  async register(req: AuthRequest, res: Response) {
    const { email, password, firstName, lastName, role } = req.body;

    const existing = await userRepository.findByEmail(email);
    if (existing) {
      res.status(409).json({ success: false, error: { message: 'Cet email est déjà utilisé' } });
      return;
    }

    const passwordHash = await hashPassword(password);
    const user = await userRepository.create({ email, passwordHash, firstName, lastName, role });

    res.status(201).json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        isActive: user.is_active,
      },
    });
  },

  async me(req: AuthRequest, res: Response) {
    const user = await userRepository.findById(req.user!.userId);
    if (!user) {
      res.status(404).json({ success: false, error: { message: 'Utilisateur non trouvé' } });
      return;
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        isActive: user.is_active,
      },
    });
  },
};
