import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { productionContenantRepository } from '../repositories/production-contenant.repository.js';
import { bulkIdsSchema, createContenantSchema, updateContenantSchema, upsertProfileSchema } from '../validators/production-contenant.validator.js';

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

  // ───────── Actions en masse ─────────
  // Meme contrat que products.bulkDelete : chaque format est traite
  // individuellement pour qu'un format utilise n'empeche pas les autres
  // d'aboutir. On renvoie le detail des echecs avec leur raison.

  async bulkDeactivate(req: AuthRequest, res: Response) {
    const parsed = bulkIdsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: { message: parsed.error.errors[0].message } });
      return;
    }
    let done = 0;
    const failed: Array<{ id: string; reason: string }> = [];
    for (const id of parsed.data.ids) {
      try {
        await productionContenantRepository.deactivateContenant(id);
        done++;
      } catch (err) {
        failed.push({ id, reason: (err as Error).message || 'Erreur lors de la desactivation' });
      }
    }
    res.json({ success: true, data: { done, failed } });
  },

  /**
   * Supprime ce qui peut l'etre, DESACTIVE automatiquement le reste.
   *
   * Un format encore reference (recette, format de recette, profil produit,
   * plan, stock semi-fini) ne peut pas etre supprime : les FK sont en RESTRICT.
   * Plutot que de renvoyer un echec sur lequel l'utilisateur ne peut rien faire
   * dans l'immediat, on bascule sur la desactivation — l'intention « je ne veux
   * plus voir ce format » est satisfaite, et l'historique reste intact.
   *
   * Seul un format que la desactivation elle-meme refuse (profil produit
   * rattache) finit dans `failed`.
   */
  async bulkDelete(req: AuthRequest, res: Response) {
    const parsed = bulkIdsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: { message: parsed.error.errors[0].message } });
      return;
    }
    let done = 0;
    let deactivated = 0;
    const failed: Array<{ id: string; reason: string }> = [];
    for (const id of parsed.data.ids) {
      try {
        const blockers = await productionContenantRepository.findContenantBlockers(id);
        if (blockers.length === 0) {
          await productionContenantRepository.deleteContenant(id);
          done++;
        } else {
          // Repli : on desactive au lieu d'echouer.
          await productionContenantRepository.deactivateContenant(id);
          deactivated++;
        }
      } catch (err) {
        failed.push({ id, reason: (err as Error).message || 'Erreur lors de la suppression' });
      }
    }
    res.json({ success: true, data: { done, deactivated, failed } });
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
