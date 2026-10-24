import { Response } from 'express';
import { db } from '../config/database.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { checkStoreOwnership } from '../middleware/tenant.middleware.js';
import { bonSortieRepository } from '../repositories/bon-sortie.repository.js';
import { notificationRepository } from '../repositories/notification.repository.js';
import {
  generateBonSchema, regenerateBonSchema, updateLigneSchema, weighLignesSchema, markReadySchema,
  chefRejectSchema, cancelBonSchema, transferLineSchema,
} from '../validators/bon-sortie.validator.js';

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

// Les messages metier (refus de transition, stock, tolerance) sont renvoyes tels
// quels ; les erreurs techniques sont loguees et remplacees par le libelle generique
// (un message pg n'aide pas le magasinier et expose la structure de la base).
const BUSINESS_PREFIXES = [
  'Stock', 'Bon', 'Ce bon', 'Aucun', 'Impossible', 'Ligne', 'Cette ligne',
  'Le lot', 'Lot ', 'Quantite', 'Les lignes', 'Statut invalide',
];
function safeErrorMessage(err: unknown, fallback: string): string {
  console.error(`[bon-sortie] ${fallback}:`, err);
  if (err instanceof Error) {
    const msg = err.message;
    if (BUSINESS_PREFIXES.some(p => msg.startsWith(p))) return msg;
    // Refus de transition (trigger mig 299) : le message est deja metier.
    if (msg.includes('TRANSITION_INVALIDE') || msg.includes('Transition')) return msg;
    // Messages prefixes par le nom de l'ingredient ("Farine : le lot ...").
    if (/^[^:]{2,60} : /.test(msg)) return msg;
  }
  return fallback;
}
function fail(res: Response, err: unknown, fallback: string, status = 400) {
  res.status(status).json({ success: false, error: { message: safeErrorMessage(err, fallback) } });
}
function badRequest(res: Response, message: string) {
  res.status(400).json({ success: false, error: { message } });
}

// ─── Controle d'appartenance au magasin (audit pesage W6) ───
// Un magasinier du magasin A ne doit pas agir sur un bon du magasin B meme s'il
// en connait l'UUID : l'ouverture d'un contenant deplace du stock reel.
async function bonStoreId(bonId: string): Promise<string | null | undefined> {
  const r = await db.query(`SELECT store_id FROM production_bons_sortie WHERE id = $1`, [bonId]);
  return r.rows[0] ? (r.rows[0].store_id as string | null) : undefined;
}
async function ligneStoreId(ligneId: string): Promise<string | null | undefined> {
  const r = await db.query(
    `SELECT bs.store_id FROM production_bons_sortie_lignes bsl
       JOIN production_bons_sortie bs ON bs.id = bsl.bon_id WHERE bsl.id = $1`, [ligneId]);
  return r.rows[0] ? (r.rows[0].store_id as string | null) : undefined;
}
async function planStoreId(planId: string): Promise<string | null | undefined> {
  const r = await db.query(`SELECT store_id FROM production_plans WHERE id = $1`, [planId]);
  return r.rows[0] ? (r.rows[0].store_id as string | null) : undefined;
}
/** Renvoie false (et repond 404/403) si la ressource n'existe pas ou n'est pas accessible. */
function guardStore(req: AuthRequest, res: Response, storeId: string | null | undefined, label: string): boolean {
  if (storeId === undefined) {
    res.status(404).json({ success: false, error: { message: `${label} introuvable` } });
    return false;
  }
  if (!checkStoreOwnership(storeId, req.user?.storeId)) {
    res.status(403).json({ success: false, error: { message: `${label} d'un autre magasin` } });
    return false;
  }
  return true;
}

export const bonSortieController = {

  async generate(req: AuthRequest, res: Response) {
    try {
      const parsed = generateBonSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error.issues.map(i => i.message).join(', '));
      const userId = req.user!.userId;
      // Le magasin du bon est celui du PLAN : le body ne peut pas le detourner.
      const storeId = await planStoreId(parsed.data.planId);
      if (!guardStore(req, res, storeId, 'Plan')) return;
      if (!storeId) return badRequest(res, 'Le plan n\'est rattache a aucun magasin');
      const data = await bonSortieRepository.generate(parsed.data.planId, storeId, userId, { derogationDlc: parsed.data.derogationDlc });
      if (data?.id) {
        await notifySafe({
          targetRole: 'magasinier',
          storeId,
          type: 'bsi_generated',
          title: 'Nouvelle demande d\'ingredients',
          message: `Bon ${data.numero || ''} a preparer au pesage`,
          referenceType: 'bon_sortie',
          referenceId: data.id as string,
          createdBy: userId,
        });
      }
      res.status(201).json({ success: true, data });
    } catch (err: unknown) {
      // Etat metier legitime : plan sans recettes/besoins ou bon deja existant.
      // On renvoie 200 avec data:null pour que l'UI n'affiche pas d'erreur.
      if (err instanceof Error && (
        err.message.startsWith('Aucun besoin') ||
        err.message.startsWith('Bon deja') ||
        err.message.startsWith('Ce bon')
      )) {
        res.status(200).json({ success: true, data: null, reason: err.message });
        return;
      }
      fail(res, err, 'Erreur lors de la generation du bon de sortie', 500);
    }
  },

  /** GET /bons-sortie/warehouse/queue — File d'attente du magasinier pour son magasin. */
  async getWarehouseQueue(req: AuthRequest, res: Response) {
    try {
      const storeId = req.user?.storeId;
      if (!storeId) return badRequest(res, 'Aucun magasin associe');
      const data = await bonSortieRepository.findActiveForWarehouse(storeId);
      res.json({ success: true, data });
    } catch (err: unknown) {
      fail(res, err, 'Erreur lors de la recuperation de la file', 500);
    }
  },

  /** GET /bons-sortie/warehouse/rupture-requests — Lignes BSI actives en rupture totale (vue multi-BSI). */
  async getRuptureRequests(req: AuthRequest, res: Response) {
    try {
      const queryStoreId = typeof req.query.storeId === 'string' ? req.query.storeId : undefined;
      // Un utilisateur rattache a un magasin ne voit que le sien ; ?storeId ne sert
      // qu'a l'admin global.
      const storeId = req.user?.storeId || queryStoreId;
      const data = await bonSortieRepository.findRuptureRequests(storeId || null);
      res.json({ success: true, data });
    } catch (err: unknown) {
      fail(res, err, 'Erreur lors de la recuperation des ruptures', 500);
    }
  },

  /** GET /bons-sortie/warehouse/transfer-requests — Lignes BSI a ouvrir depuis l'economat (vue multi-BSI). */
  async getTransferRequests(req: AuthRequest, res: Response) {
    try {
      const queryStoreId = typeof req.query.storeId === 'string' ? req.query.storeId : undefined;
      const storeId = req.user?.storeId || queryStoreId;
      const data = await bonSortieRepository.findEconomatTransferRequests(storeId || null);
      res.json({ success: true, data });
    } catch (err: unknown) {
      fail(res, err, 'Erreur lors de la recuperation des demandes de transfert', 500);
    }
  },

  /** GET /bons-sortie/warehouse/history — Historique des BSI traites pour son magasin. */
  async getWarehouseHistory(req: AuthRequest, res: Response) {
    try {
      const storeId = req.user?.storeId;
      if (!storeId) return badRequest(res, 'Aucun magasin associe');
      const limit = Math.min(Math.max(parseInt((req.query.limit as string) || '50', 10) || 50, 1), 200);
      const offset = Math.max(parseInt((req.query.offset as string) || '0', 10) || 0, 0);
      const q = req.query as Record<string, string>;
      const isDate = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
      const { rows, total } = await bonSortieRepository.findHistoryForWarehouse(storeId, limit, offset, {
        status: ['prelevement', 'verifie', 'cloture', 'annule'].includes(q.status) ? q.status : undefined,
        search: q.search?.trim() || undefined,
        dateFrom: isDate(q.dateFrom),
        dateTo: isDate(q.dateTo),
      });
      res.json({ success: true, data: rows, total, limit, offset });
    } catch (err: unknown) {
      fail(res, err, 'Erreur lors de la recuperation de l\'historique', 500);
    }
  },

  async getByPlan(req: AuthRequest, res: Response) {
    try {
      const planId = req.params.planId as string;
      if (!guardStore(req, res, await planStoreId(planId), 'Plan')) return;
      const data = await bonSortieRepository.findByPlan(planId);
      res.json({ success: true, data });
    } catch (err: unknown) {
      fail(res, err, 'Erreur lors de la recuperation des bons', 500);
    }
  },

  async getById(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;
      if (!guardStore(req, res, await bonStoreId(id), 'Bon de sortie')) return;
      const data = await bonSortieRepository.findById(id);
      if (!data) return res.status(404).json({ success: false, error: { message: 'Bon de sortie introuvable' } });
      res.json({ success: true, data });
    } catch (err: unknown) {
      fail(res, err, 'Erreur lors de la recuperation du bon', 500);
    }
  },

  /** PUT /bons-sortie/ligne/:ligneId — pesee d'une ligne (+ ouverture / choix du lot). */
  async updateLigne(req: AuthRequest, res: Response) {
    try {
      const ligneId = req.params.ligneId as string;
      if (!guardStore(req, res, await ligneStoreId(ligneId), 'Ligne')) return;
      const parsed = updateLigneSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error.issues.map(i => i.message).join(', '));
      const { actualQuantity, ...options } = parsed.data;
      const data = await bonSortieRepository.updateLigne(ligneId, actualQuantity, req.user!.userId, options);
      res.json({ success: true, data });
    } catch (err: unknown) {
      fail(res, err, 'Erreur lors de l\'enregistrement de la pesee');
    }
  },

  /** PUT /bons-sortie/:id/peser — enregistre plusieurs pesees en une transaction. */
  async weighLignes(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;
      if (!guardStore(req, res, await bonStoreId(id), 'Bon de sortie')) return;
      const parsed = weighLignesSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error.issues.map(i => i.message).join(', '));
      const data = await bonSortieRepository.weighLignes(id, req.user!.userId, parsed.data.lines);
      res.json({ success: true, data });
    } catch (err: unknown) {
      fail(res, err, 'Erreur lors de l\'enregistrement des pesees');
    }
  },

  /** GET /bons-sortie/ligne/:ligneId/lots — lots utilisables (pesage + economat), selecteur « Autre lot ». */
  async listLotsForLigne(req: AuthRequest, res: Response) {
    try {
      const ligneId = req.params.ligneId as string;
      if (!guardStore(req, res, await ligneStoreId(ligneId), 'Ligne')) return;
      const data = await bonSortieRepository.listLotsForLigne(ligneId);
      res.json({ success: true, data });
    } catch (err: unknown) {
      fail(res, err, 'Erreur lors de la recuperation des lots');
    }
  },

  /** PUT /bons-sortie/:id/accept-reception — chef : pret -> prelevement -> verifie -> cloture. */
  async acceptReception(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;
      if (!guardStore(req, res, await bonStoreId(id), 'Bon de sortie')) return;
      const data = await bonSortieRepository.acceptReception(id, req.user!.userId);
      res.json({ success: true, data });
    } catch (err: unknown) {
      fail(res, err, 'Erreur lors de l\'acceptation de la reception');
    }
  },

  async commitPartial(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;
      if (!guardStore(req, res, await bonStoreId(id), 'Bon de sortie')) return;
      const data = await bonSortieRepository.commitPartial(id, req.user!.userId);
      res.json({ success: true, data });
    } catch (err: unknown) {
      fail(res, err, 'Erreur lors de la validation partielle');
    }
  },

  async completePending(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;
      if (!guardStore(req, res, await bonStoreId(id), 'Bon de sortie')) return;
      const data = await bonSortieRepository.completePending(id, req.user!.userId);
      res.json({ success: true, data });
    } catch (err: unknown) {
      fail(res, err, 'Erreur lors de l\'actualisation du stock');
    }
  },

  async cancel(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;
      if (!guardStore(req, res, await bonStoreId(id), 'Bon de sortie')) return;
      const parsed = cancelBonSchema.safeParse(req.body || {});
      if (!parsed.success) return badRequest(res, parsed.error.issues.map(i => i.message).join(', '));
      const data = await bonSortieRepository.cancel(id, req.user!.userId, parsed.data.reason);
      res.json({ success: true, data });
    } catch (err: unknown) {
      fail(res, err, 'Erreur lors de l\'annulation');
    }
  },

  async markPreparation(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;
      if (!guardStore(req, res, await bonStoreId(id), 'Bon de sortie')) return;
      const data = await bonSortieRepository.markAsPreparation(id, req.user!.userId);
      if (data?.generated_by && data.plan_id) {
        // Notification au chef demandeur : elle renvoie vers SON plan.
        await notifySafe({
          targetRole: '',
          targetUserId: data.generated_by as string,
          storeId: data.store_id as string,
          type: 'bsi_preparation_started',
          title: 'Preparation des ingredients en cours',
          message: `Bon ${data.numero} pris en charge au pesage`,
          referenceType: 'production_plan',
          referenceId: data.plan_id as string,
          createdBy: req.user!.userId,
        });
      }
      res.json({ success: true, data });
    } catch (err: unknown) {
      fail(res, err, 'Erreur lors de la prise en charge');
    }
  },

  async markReady(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;
      if (!guardStore(req, res, await bonStoreId(id), 'Bon de sortie')) return;
      const parsed = markReadySchema.safeParse(req.body || {});
      if (!parsed.success) return badRequest(res, parsed.error.issues.map(i => i.message).join(', '));
      const data = await bonSortieRepository.markAsReady(id, req.user!.userId, { withMissing: parsed.data.withMissing });
      if (data?.generated_by && data.plan_id) {
        await notifySafe({
          targetRole: '',
          targetUserId: data.generated_by as string,
          storeId: data.store_id as string,
          type: 'bsi_ready',
          title: 'Ingredients prets',
          message: `Bon ${data.numero} pret a recuperer au pesage`,
          referenceType: 'production_plan',
          referenceId: data.plan_id as string,
          createdBy: req.user!.userId,
        });
      }
      res.json({ success: true, data });
    } catch (err: unknown) {
      fail(res, err, 'Erreur lors de la remise au chef');
    }
  },

  async chefReject(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;
      if (!guardStore(req, res, await bonStoreId(id), 'Bon de sortie')) return;
      const parsed = chefRejectSchema.safeParse(req.body || {});
      if (!parsed.success) return badRequest(res, parsed.error.issues.map(i => i.message).join(', '));
      const reason = parsed.data.reason;
      const data = await bonSortieRepository.chefReject(id, req.user!.userId, reason);
      const magasinierId = (data?.ready_by || data?.preparation_by) as string | null;
      await notifySafe({
        targetRole: magasinierId ? '' : 'magasinier',
        targetUserId: magasinierId || undefined,
        storeId: data.store_id as string,
        type: 'bsi_chef_rejected',
        title: 'Bon refuse par le chef',
        message: `Bon ${data.numero} — motif : ${reason}`,
        referenceType: 'bon_sortie',
        referenceId: id,
        createdBy: req.user!.userId,
      });
      res.json({ success: true, data });
    } catch (err: unknown) {
      fail(res, err, 'Erreur lors du refus de reception');
    }
  },

  async listEconomatLotsForLigne(req: AuthRequest, res: Response) {
    try {
      const ligneId = req.params.ligneId as string;
      if (!guardStore(req, res, await ligneStoreId(ligneId), 'Ligne')) return;
      const data = await bonSortieRepository.listEconomatLotsForLigne(ligneId);
      res.json({ success: true, data });
    } catch (err: unknown) {
      fail(res, err, 'Erreur lors de la recuperation des lots Economat');
    }
  },

  async transferLineFromEconomat(req: AuthRequest, res: Response) {
    try {
      const ligneId = req.params.ligneId as string;
      if (!guardStore(req, res, await ligneStoreId(ligneId), 'Ligne')) return;
      const parsed = transferLineSchema.safeParse(req.body || {});
      if (!parsed.success) return badRequest(res, parsed.error.issues.map(i => i.message).join(', '));
      const data = await bonSortieRepository.transferLineFromEconomat(ligneId, req.user!.userId, parsed.data);
      res.json({ success: true, data });
    } catch (err: unknown) {
      fail(res, err, 'Erreur lors de l\'ouverture du contenant');
    }
  },

  async regenerate(req: AuthRequest, res: Response) {
    try {
      const planId = req.params.planId as string;
      // Derogation DLC (mig 339) : motif obligatoire, trace sur le bon regenere.
      const parsed = regenerateBonSchema.safeParse(req.body ?? {});
      if (!parsed.success) return badRequest(res, parsed.error.issues.map(i => i.message).join(', '));
      const storeId = await planStoreId(planId);
      if (!guardStore(req, res, storeId, 'Plan')) return;
      if (!storeId) return badRequest(res, 'Le plan n\'est rattache a aucun magasin');
      const data = await bonSortieRepository.regenerate(planId, storeId, req.user!.userId, { derogationDlc: parsed.data.derogationDlc });
      res.status(201).json({ success: true, data });
    } catch (err: unknown) {
      fail(res, err, 'Erreur lors de la regeneration du bon', 500);
    }
  },
};
