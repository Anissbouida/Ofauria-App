import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { productionContenantRepository } from '../repositories/production-contenant.repository.js';
import { createContenantSchema, updateContenantSchema, upsertProfileSchema } from '../validators/production-contenant.validator.js';

export const productionContenantController = {
  // ───────── CONTENANTS ─────────

  async listContenants(req: AuthRequest, res: Response) {
    const includeInactive = req.query.includeInactive === 'true';
    const contenants = await productionContenantRepository.findAllContenants(includeInactive);
    res.json({ success: true, data: contenants });
  },

  async getContenant(req: AuthRequest, res: Response) {
    const contenant = await productionContenantRepository.findContenantById(req.params.id);
    if (!contenant) {
      res.status(404).json({ success: false, error: { message: 'Contenant introuvable' } });
      return;
    }
    // Include products using this contenant
    const products = await productionContenantRepository.findProductsByContenantId(req.params.id);
    res.json({ success: true, data: { ...contenant, products } });
  },

  async createContenant(req: AuthRequest, res: Response) {
    const parsed = createContenantSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: { message: parsed.error.errors[0].message } });
      return;
    }
    const contenant = await productionContenantRepository.createContenant(parsed.data);
    res.status(201).json({ success: true, data: contenant });
  },

  async updateContenant(req: AuthRequest, res: Response) {
    const parsed = updateContenantSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: { message: parsed.error.errors[0].message } });
      return;
    }
    const contenant = await productionContenantRepository.updateContenant(req.params.id, parsed.data);
    if (!contenant) {
      res.status(404).json({ success: false, error: { message: 'Contenant introuvable' } });
      return;
    }
    res.json({ success: true, data: contenant });
  },

  async deactivateContenant(req: AuthRequest, res: Response) {
    try {
      const contenant = await productionContenantRepository.deactivateContenant(req.params.id);
      res.json({ success: true, data: contenant });
    } catch (err) {
      res.status(409).json({ success: false, error: { message: (err as Error).message } });
    }
  },

  // ───────── PROFILS PRODUIT ─────────

  async getProfile(req: AuthRequest, res: Response) {
    const profile = await productionContenantRepository.findProfileByProductId(req.params.productId);
    res.json({ success: true, data: profile });
  },

  async upsertProfile(req: AuthRequest, res: Response) {
    const parsed = upsertProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: { message: parsed.error.errors[0].message } });
      return;
    }
    // Verify contenant exists
    const contenant = await productionContenantRepository.findContenantById(parsed.data.contenant_id);
    if (!contenant) {
      res.status(404).json({ success: false, error: { message: 'Contenant introuvable' } });
      return;
    }
    const profile = await productionContenantRepository.upsertProfile(req.params.productId, parsed.data);
    res.json({ success: true, data: profile });
  },

  async deleteProfile(req: AuthRequest, res: Response) {
    await productionContenantRepository.deleteProfile(req.params.productId);
    res.json({ success: true, data: null });
  },
};
