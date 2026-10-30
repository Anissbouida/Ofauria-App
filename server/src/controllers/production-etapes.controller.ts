import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { productionEtapesRepository } from '../repositories/production-etapes.repository.js';
import { productionRendementRepository } from '../repositories/production-rendement.repository.js';
import { stockFrigoRepository } from '../repositories/stock-frigo.repository.js';
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
      `SELECT ppi.plan_id, ppi.product_id, ppi.contenant_id, pp.store_id AS plan_store_id
       FROM production_plan_items ppi
       JOIN production_plans pp ON pp.id = ppi.plan_id
       WHERE ppi.id = $1`, [itemId]
    );
    const planId = planResult.rows[0]?.plan_id;
    if (!planId) {
      res.status(404).json({ success: false, error: { message: 'Item non trouve' } });
      return;
    }

    // Le rendement est un upsert : on lit le vers_frigo precedent pour ne pousser
    // au frigo que le DELTA (une re-saisie ne doit pas doubler le stock frigo).
    const previous = await productionRendementRepository.findByPlanItem(itemId);
    const previousVersFrigo = previous?.vers_frigo != null ? parseFloat(String(previous.vers_frigo)) : 0;

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

    // Surplus -> frigo AUTOMATIQUE (audit 2026-10-23 §4.2) : jusqu'ici vers_frigo
    // n'etait qu'un nombre de reporting, le stock frigo n'existait que si
    // quelqu'un pensait a le saisir a la main dans /stock-frigo/surplus.
    const frigo: { added?: number; lot_number?: string | null; warning?: string } = {};
    const delta = (parsed.data.vers_frigo || 0) - previousVersFrigo;
    const storeId = planResult.rows[0].plan_store_id || req.user!.storeId;
    if (delta > 0) {
      const productId = planResult.rows[0].product_id as string | null;
      if (!productId) {
        frigo.warning = 'Surplus non pousse au frigo : cet article n\'a pas de produit (semi-fini par recette de base).';
      } else if (!storeId) {
        frigo.warning = 'Surplus non pousse au frigo : magasin inconnu.';
      } else {
        try {
          // Lot de la fournee (cree a la production) et DLC du produit (jour meme par defaut).
          const lotResult = await db.query(
            `SELECT pl.lot_number, pl.expires_at
             FROM product_lots pl
             WHERE pl.production_plan_id = $1 AND pl.product_id = $2
             ORDER BY pl.created_at DESC LIMIT 1`,
            [planId, productId]
          );
          const expiresAt = lotResult.rows[0]?.expires_at
            ? new Date(lotResult.rows[0].expires_at).toISOString()
            : undefined;
          const entry = await stockFrigoRepository.addSurplus({
            productId,
            storeId,
            quantity: delta,
            lotNumber: lotResult.rows[0]?.lot_number ?? undefined,
            expiresAt,
            sourcePlanId: planId,
            sourceContenantId: planResult.rows[0].contenant_id ?? undefined,
            performedBy: req.user!.userId,
            notes: `Surplus de production (rendement) — ${delta} pousse(s) au frigo`,
          });
          frigo.added = delta;
          frigo.lot_number = entry?.lot_number ?? null;
        } catch (err) {
          console.error('[rendement] surplus -> frigo echoue:', err);
          frigo.warning = `Surplus non pousse au frigo : ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    } else if (delta < 0) {
      frigo.warning = `vers_frigo reduit de ${-delta} : ajustez le stock frigo a la main (Stock > Frigo), le retrait n'est pas automatique.`;
    }

    res.json({ success: true, data: rendement, frigo });
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

  // ─── Exécution d'atelier (mig 399) : poste/opérateur, pause, live ───
  async assignEtape(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    const etape = await productionEtapesRepository.assign(req.params.etapeId as string, {
      workCenterId: b.workCenterId !== undefined ? (b.workCenterId ? String(b.workCenterId) : null) : undefined,
      assignedEmployeeId: b.assignedEmployeeId !== undefined ? (b.assignedEmployeeId ? String(b.assignedEmployeeId) : null) : undefined,
    });
    if (!etape) { res.status(404).json({ success: false, error: { message: 'Etape non trouvee' } }); return; }
    res.json({ success: true, data: etape });
  },
  async pauseEtape(req: AuthRequest, res: Response) {
    const etape = await productionEtapesRepository.pause(req.params.etapeId as string);
    if (!etape) { res.status(400).json({ success: false, error: { message: 'Etape non en cours ou deja en pause' } }); return; }
    res.json({ success: true, data: etape });
  },
  async resumeEtape(req: AuthRequest, res: Response) {
    const etape = await productionEtapesRepository.resume(req.params.etapeId as string);
    if (!etape) { res.status(400).json({ success: false, error: { message: 'Etape non en pause' } }); return; }
    res.json({ success: true, data: etape });
  },
  async atelierLive(req: AuthRequest, res: Response) {
    const storeId = (req.query.storeId as string) || req.user!.storeId!;
    const data = await productionEtapesRepository.getAtelierLive(storeId);
    res.json({ success: true, data });
  },
};
