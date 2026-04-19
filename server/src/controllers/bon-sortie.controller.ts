import { Request, Response } from 'express';
import { bonSortieRepository } from '../repositories/bon-sortie.repository.js';
import { generateBonSchema, updateLigneSchema, handleEcartSchema } from '../validators/bon-sortie.validator.js';

function safeErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && (err.message.startsWith('Stock') || err.message.startsWith('Bon') || err.message.startsWith('Ce bon') || err.message.startsWith('Aucun'))) {
    return err.message;
  }
  console.error(`[bon-sortie] ${fallback}:`, err);
  return fallback;
}

export const bonSortieController = {

  async generate(req: Request, res: Response) {
    try {
      const parsed = generateBonSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(', ') });
      const userId = (req as any).user?.userId;
      const data = await bonSortieRepository.generate(parsed.data.planId, parsed.data.storeId, userId);
      res.status(201).json({ data });
    } catch (err: any) {
      const msg = safeErrorMessage(err, 'Erreur lors de la generation du bon de sortie');
      res.status(500).json({ error: msg });
    }
  },

  async getByPlan(req: Request, res: Response) {
    try {
      const planId = req.params.planId as string;
      const data = await bonSortieRepository.findByPlan(planId);
      res.json({ data });
    } catch (err: any) {
      console.error('[bon-sortie] getByPlan:', err);
      res.status(500).json({ error: 'Erreur lors de la recuperation des bons' });
    }
  },

  async getById(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const data = await bonSortieRepository.findById(id);
      if (!data) return res.status(404).json({ error: 'Bon de sortie introuvable' });
      res.json({ data });
    } catch (err: any) {
      console.error('[bon-sortie] getById:', err);
      res.status(500).json({ error: 'Erreur lors de la recuperation du bon' });
    }
  },

  async startPrelevement(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const userId = (req as any).user?.userId;
      const data = await bonSortieRepository.startPrelevement(id, userId);
      res.json({ data });
    } catch (err: any) {
      const msg = safeErrorMessage(err, 'Erreur lors du demarrage du prelevement');
      res.status(400).json({ error: msg });
    }
  },

  async updateLigne(req: Request, res: Response) {
    try {
      const ligneId = req.params.ligneId as string;
      const parsed = updateLigneSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(', ') });
      const data = await bonSortieRepository.updateLigne(ligneId, parsed.data.actualQuantity, parsed.data.notes);
      res.json({ data });
    } catch (err: any) {
      const msg = safeErrorMessage(err, 'Erreur lors de la mise a jour de la ligne');
      res.status(400).json({ error: msg });
    }
  },

  async verify(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const userId = (req as any).user?.userId;
      const data = await bonSortieRepository.verify(id, userId);
      res.json({ data });
    } catch (err: any) {
      const msg = safeErrorMessage(err, 'Erreur lors de la verification');
      res.status(400).json({ error: msg });
    }
  },

  async close(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const userId = (req as any).user?.userId;
      const data = await bonSortieRepository.close(id, userId);
      res.json({ data });
    } catch (err: any) {
      const msg = safeErrorMessage(err, 'Erreur lors de la cloture');
      res.status(400).json({ error: msg });
    }
  },

  async cancel(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const userId = (req as any).user?.userId;
      const data = await bonSortieRepository.cancel(id, userId);
      res.json({ data });
    } catch (err: any) {
      const msg = safeErrorMessage(err, 'Erreur lors de l\'annulation');
      res.status(400).json({ error: msg });
    }
  },

  async handleEcart(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const ligneId = req.params.ligneId as string;
      const parsed = handleEcartSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(', ') });
      const data = await bonSortieRepository.handleEcart(id, ligneId, parsed.data.substituteLotId, parsed.data.newQuantity);
      res.json({ data });
    } catch (err: any) {
      const msg = safeErrorMessage(err, 'Erreur lors du traitement de l\'ecart');
      res.status(400).json({ error: msg });
    }
  },

  async regenerate(req: Request, res: Response) {
    try {
      const planId = req.params.planId as string;
      const storeId = req.body.storeId || (req as any).user?.storeId;
      if (!storeId) return res.status(400).json({ error: 'storeId requis' });
      const userId = (req as any).user?.userId;
      const data = await bonSortieRepository.regenerate(planId, storeId, userId);
      res.status(201).json({ data });
    } catch (err: any) {
      const msg = safeErrorMessage(err, 'Erreur lors de la regeneration du bon');
      res.status(500).json({ error: msg });
    }
  },
};
