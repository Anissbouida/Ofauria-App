import { Request, Response } from 'express';
import { bonSortieRepository } from '../repositories/bon-sortie.repository.js';
import { notificationRepository } from '../repositories/notification.repository.js';
import { generateBonSchema, updateLigneSchema, handleEcartSchema } from '../validators/bon-sortie.validator.js';

/**
 * Emet une notification de maniere non-bloquante : si la creation echoue (ex. table
 * indisponible, id invalide), on logue et on continue. Le workflow BSI reste fonctionnel
 * meme si le systeme de notif est down.
 */
async function notifySafe(data: Parameters<typeof notificationRepository.create>[0]) {
  try {
    await notificationRepository.create(data);
  } catch (err) {
    console.error('[bon-sortie] notification non emise:', err);
  }
}

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
      // Notifier les magasiniers du store qu'un nouveau BSI est a preparer.
      if (data?.id) {
        await notifySafe({
          targetRole: 'magasinier',
          storeId: parsed.data.storeId,
          type: 'bsi_generated',
          title: 'Nouvelle demande d\'ingredients',
          message: `BSI ${data.numero || ''} a preparer en economat`,
          referenceType: 'bon_sortie',
          referenceId: data.id as string,
          createdBy: userId,
        });
      }
      res.status(201).json({ data });
    } catch (err: any) {
      // Etat metier legitime : plan sans recettes/besoins ou bon deja existant.
      // On renvoie 200 avec data:null pour que l'UI n'affiche pas d'erreur et
      // laisse l'utilisateur voir le plan normalement.
      if (err instanceof Error && (
        err.message.startsWith('Aucun besoin') ||
        err.message.startsWith('Bon deja') ||
        err.message.startsWith('Ce bon')
      )) {
        res.status(200).json({ data: null, reason: err.message });
        return;
      }
      const msg = safeErrorMessage(err, 'Erreur lors de la generation du bon de sortie');
      res.status(500).json({ error: msg });
    }
  },

  /** GET /bons-sortie/warehouse/queue — File d'attente du magasinier pour son store. */
  async getWarehouseQueue(req: Request, res: Response) {
    try {
      const storeId = (req as any).user?.storeId;
      if (!storeId) return res.status(400).json({ error: 'Aucun magasin associe' });
      const data = await bonSortieRepository.findActiveForWarehouse(storeId);
      res.json({ data });
    } catch (err: any) {
      console.error('[bon-sortie] getWarehouseQueue:', err);
      res.status(500).json({ error: 'Erreur lors de la recuperation de la file' });
    }
  },

  /** GET /bons-sortie/warehouse/history — Historique des BSI traites pour son store. */
  async getWarehouseHistory(req: Request, res: Response) {
    try {
      const storeId = (req as any).user?.storeId;
      if (!storeId) return res.status(400).json({ error: 'Aucun magasin associe' });
      const limit = Math.min(Math.max(parseInt((req.query.limit as string) || '50', 10) || 50, 1), 200);
      const offset = Math.max(parseInt((req.query.offset as string) || '0', 10) || 0, 0);
      const { rows, total } = await bonSortieRepository.findHistoryForWarehouse(storeId, limit, offset);
      res.json({ data: rows, total, limit, offset });
    } catch (err: any) {
      console.error('[bon-sortie] getWarehouseHistory:', err);
      res.status(500).json({ error: 'Erreur lors de la recuperation de l\'historique' });
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

  // BSI partiel : valide ce qui est preleve, garde le reste en attente d'approvisionnement
  async commitPartial(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const userId = (req as any).user?.userId;
      const data = await bonSortieRepository.commitPartial(id, userId);
      res.json({ data });
    } catch (err: any) {
      const msg = safeErrorMessage(err, 'Erreur lors du commit partiel');
      res.status(400).json({ error: msg });
    }
  },

  // Apres reapprovisionnement : refait le FEFO sur les lignes en attente
  async completePending(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const userId = (req as any).user?.userId;
      const data = await bonSortieRepository.completePending(id, userId);
      res.json({ data });
    } catch (err: any) {
      const msg = safeErrorMessage(err, 'Erreur lors de la completion');
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

  // ─── Magasinier : prendre en charge un BSI en 'genere' ───
  async markPreparation(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const userId = (req as any).user?.userId;
      const data = await bonSortieRepository.markAsPreparation(id, userId);
      // Notifier le chef qui a genere le BSI que la preparation a demarre.
      if (data?.generated_by) {
        await notifySafe({
          targetRole: '', // personnelle
          targetUserId: data.generated_by as string,
          storeId: data.store_id as string,
          type: 'bsi_preparation_started',
          title: 'Preparation BSI en cours',
          message: `BSI ${data.numero} pris en charge par le magasinier`,
          referenceType: 'bon_sortie',
          referenceId: id,
          createdBy: userId,
        });
      }
      res.json({ data });
    } catch (err: any) {
      const msg = safeErrorMessage(err, 'Erreur lors du demarrage de la preparation');
      res.status(400).json({ error: msg });
    }
  },

  // ─── Magasinier : marquer le BSI comme pret a remettre ───
  async markReady(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const userId = (req as any).user?.userId;
      const data = await bonSortieRepository.markAsReady(id, userId);
      // Notifier le chef que les ingredients sont prets a recuperer.
      if (data?.generated_by) {
        await notifySafe({
          targetRole: '',
          targetUserId: data.generated_by as string,
          storeId: data.store_id as string,
          type: 'bsi_ready',
          title: 'Ingredients prets',
          message: `BSI ${data.numero} pret a recuperer en economat`,
          referenceType: 'bon_sortie',
          referenceId: id,
          createdBy: userId,
        });
      }
      res.json({ data });
    } catch (err: any) {
      const msg = safeErrorMessage(err, 'Erreur lors du marquage "pret"');
      res.status(400).json({ error: msg });
    }
  },

  // ─── Chef : refuser la reception avec motif ───
  // Body : { reason: string }
  async chefReject(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const userId = (req as any).user?.userId;
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      if (!reason) {
        return res.status(400).json({ error: 'Un motif est obligatoire pour refuser la reception' });
      }
      const data = await bonSortieRepository.chefReject(id, userId, reason);
      // Notifier le magasinier (celui qui a prepare, sinon tous les magasiniers du store).
      const magasinierId = (data?.ready_by || data?.preparation_by) as string | null;
      if (magasinierId) {
        await notifySafe({
          targetRole: '',
          targetUserId: magasinierId,
          storeId: data.store_id as string,
          type: 'bsi_chef_rejected',
          title: 'BSI refuse par le chef',
          message: `Motif : ${reason}`,
          referenceType: 'bon_sortie',
          referenceId: id,
          createdBy: userId,
        });
      } else {
        await notifySafe({
          targetRole: 'magasinier',
          storeId: data.store_id as string,
          type: 'bsi_chef_rejected',
          title: 'BSI refuse par le chef',
          message: `Motif : ${reason}`,
          referenceType: 'bon_sortie',
          referenceId: id,
          createdBy: userId,
        });
      }
      res.json({ data });
    } catch (err: any) {
      const msg = safeErrorMessage(err, 'Erreur lors du refus de reception');
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
