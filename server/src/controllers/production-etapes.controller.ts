import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { productionEtapesRepository } from '../repositories/production-etapes.repository.js';
import { productionRendementRepository } from '../repositories/production-rendement.repository.js';
import { updateEtapeStatusSchema, completeRepetitionSchema, recordRendementSchema } from '../validators/production-etapes.validator.js';

export const productionEtapesController = {

  // ─── Get all steps for a plan ───
  async listByPlan(req: AuthRequest, res: Response) {
    const etapes = await productionEtapesRepository.findByPlan(req.params.planId as string);
    res.json({ success: true, data: etapes });
  },

  // ─── Get steps for a specific item ───
  async listByItem(req: AuthRequest, res: Response) {
    const etapes = await productionEtapesRepository.findByPlanItem(req.params.itemId as string);
    res.json({ success: true, data: etapes });
  },

  // ─── Initialize steps for a plan item (manual trigger if auto-init missed) ───
  async initialize(req: AuthRequest, res: Response) {
    const etapes = await productionEtapesRepository.initializeForItem(req.params.itemId as string);
    res.json({ success: true, data: etapes });
  },

  // ─── Update step status ───
  async updateStatus(req: AuthRequest, res: Response) {
    const parsed = updateEtapeStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: { message: parsed.error.issues.map(i => i.message).join(', ') } });
      return;
    }
    const etape = await productionEtapesRepository.updateStatus(
      req.params.etapeId as string, parsed.data.status, req.user!.userId,
      { checklist_resultats: parsed.data.checklist_resultats, notes: parsed.data.notes, duree_reelle_min: parsed.data.duree_reelle_min }
    );
    if (!etape) {
      res.status(404).json({ success: false, error: { message: 'Etape non trouvee' } });
      return;
    }
    res.json({ success: true, data: etape });
  },

  // ─── Start auto-timer ───
  async startTimer(req: AuthRequest, res: Response) {
    const etape = await productionEtapesRepository.setTimer(req.params.etapeId as string);
    if (!etape) {
      res.status(400).json({ success: false, error: { message: 'Timer non applicable (pas de duree ou pas timer_auto)' } });
      return;
    }
    res.json({ success: true, data: etape });
  },

  // ─── Complete one repetition ───
  async completeRepetition(req: AuthRequest, res: Response) {
    const parsed = completeRepetitionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: { message: parsed.error.issues.map(i => i.message).join(', ') } });
      return;
    }
    const etape = await productionEtapesRepository.completeRepetition(
      req.params.etapeId as string, req.user!.userId, parsed.data.notes
    );
    if (!etape) {
      res.status(404).json({ success: false, error: { message: 'Etape non trouvee' } });
      return;
    }
    res.json({ success: true, data: etape });
  },

  // ─── Check blocking steps ───
  async checkBlocking(req: AuthRequest, res: Response) {
    const allDone = await productionEtapesRepository.areBlockingStepsComplete(req.params.itemId as string);
    res.json({ success: true, data: { allBlockingComplete: allDone } });
  },

  // ─── Plan progress summary ───
  async planProgress(req: AuthRequest, res: Response) {
    const progress = await productionEtapesRepository.getPlanProgress(req.params.planId as string);
    res.json({ success: true, data: progress });
  },

  // ═══ Rendement ═══

  // ─── Record yield for an item ───
  async recordRendement(req: AuthRequest, res: Response) {
    const parsed = recordRendementSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: { message: parsed.error.issues.map(i => i.message).join(', ') } });
      return;
    }

    const itemId = req.params.itemId as string;
    const target = await productionRendementRepository.getTargetForItem(itemId);

    const { db } = await import('../config/database.js');
    const planResult = await db.query(
      `SELECT plan_id FROM production_plan_items WHERE id = $1`, [itemId]
    );
    const planId = planResult.rows[0]?.plan_id;
    if (!planId) {
      res.status(404).json({ success: false, error: { message: 'Item non trouve' } });
      return;
    }

    const rendement = await productionRendementRepository.record({
      planItemId: itemId,
      planId,
      quantiteBrute: parsed.data.quantite_brute,
      quantiteNetteCible: target?.quantiteNetteCible,
      seuilRendement: target?.seuilRendement,
      quantiteNetteReelle: parsed.data.quantite_nette_reelle,
      versMagasin: parsed.data.vers_magasin,
      versFrigo: parsed.data.vers_frigo,
      pertesDetail: parsed.data.pertes_detail,
      recordedBy: req.user!.userId,
      notes: parsed.data.notes,
    });
    res.json({ success: true, data: rendement });
  },

  // ─── Get rendement for a plan ───
  async planRendement(req: AuthRequest, res: Response) {
    const rendements = await productionRendementRepository.findByPlan(req.params.planId as string);
    res.json({ success: true, data: rendements });
  },

  // ─── Get rendement target for an item ───
  async getRendementTarget(req: AuthRequest, res: Response) {
    const target = await productionRendementRepository.getTargetForItem(req.params.itemId as string);
    res.json({ success: true, data: target });
  },

  // ─── Dashboard: rendement stats ───
  async rendementStats(req: AuthRequest, res: Response) {
    const storeId = (req.query.storeId as string) || req.user!.storeId!;
    const stats = await productionRendementRepository.getStats(
      storeId, req.query.dateFrom as string | undefined, req.query.dateTo as string | undefined
    );
    res.json({ success: true, data: stats });
  },

  // ─── Dashboard: rendement by product ───
  async rendementByProduct(req: AuthRequest, res: Response) {
    const storeId = (req.query.storeId as string) || req.user!.storeId!;
    const data = await productionRendementRepository.getByProduct(
      storeId, req.query.dateFrom as string | undefined, req.query.dateTo as string | undefined
    );
    res.json({ success: true, data });
  },
};
