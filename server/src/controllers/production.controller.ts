import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { productionRepository } from '../repositories/production.repository.js';
import { orderRepository } from '../repositories/order.repository.js';
import { bonSortieRepository } from '../repositories/bon-sortie.repository.js';
import { createNotification } from '../utils/notify.js';
import { productionCoutRepository } from '../repositories/production-cout.repository.js';
import { isTransitionError, listPlanEvents } from '../services/production-state.js';
import { db } from '../config/database.js';
import { getCategoryRole, ASSIGNED_ROLE_LABELS } from '@ofauria/shared';

/** Charge le plan et vérifie qu'il appartient au magasin de l'utilisateur
 *  (admin sans magasin = accès global). Répond 404 / 403 et renvoie null sinon. */
async function loadOwnedPlan(req: AuthRequest, res: Response) {
  const plan = await productionRepository.findById(req.params.id);
  if (!plan) { res.status(404).json({ success: false, error: { message: 'Plan non trouve' } }); return null; }
  if (req.user!.storeId && plan.store_id && plan.store_id !== req.user!.storeId) {
    res.status(403).json({ success: false, error: { message: 'Acces refuse' } }); return null;
  }
  return plan;
}

/** Erreur métier -> 409 (transition refusée, garde de statut), autre -> 500 via asyncHandler. */
function conflictOrThrow(res: Response, err: unknown, fallback: string) {
  const message = err instanceof Error ? err.message : fallback;
  if (isTransitionError(err)) {
    res.status(409).json({ success: false, error: { code: 'TRANSITION_INVALIDE', message: message.replace(/^.*TRANSITION_INVALIDE:\s*/, 'Transition refusée : ') } });
    return;
  }
  res.status(409).json({ success: false, error: { message } });
}

const CHEF_ROLES = ['baker', 'pastry_chef', 'viennoiserie', 'beldi_sale'];

export const productionController = {
  async list(req: AuthRequest, res: Response) {
    const q = ((req as any).validatedQuery || req.query) as Record<string, any>;
    const { status, type, dateFrom, dateTo, targetRole } = q;
    const p = Number(q.page) || 1; const l = Number(q.limit) || 20;
    const userRole = req.user!.role;

    // Chefs only see plans targeting their role
    const effectiveTargetRole = CHEF_ROLES.includes(userRole) ? userRole : targetRole;

    const result = await productionRepository.findAll({
      status, type, dateFrom, dateTo, targetRole: effectiveTargetRole, storeId: req.user!.storeId,
      limit: l, offset: (p - 1) * l,
    });
    res.json({ success: true, data: result.rows, total: result.total, page: p, limit: l, totalPages: Math.ceil(result.total / l) });
  },

  async getById(req: AuthRequest, res: Response) {
    const plan = await loadOwnedPlan(req, res);
    if (!plan) return;
    if (req.user!.storeId && plan.store_id && plan.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } }); return;
    }
    res.json({ success: true, data: plan });
  },

  async create(req: AuthRequest, res: Response) {
    const { planDate, type, notes, items, targetRole } = req.body;
    if (!planDate || !items || items.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Date et articles requis' } });
      return;
    }
    const userRole = req.user!.role;

    // F-015 — Garde role <-> categorie : un chef ne peut pas creer un plan pour
    // un produit relevant d'un AUTRE atelier (ex. le patissier pour une baguette).
    // On rejette seulement si la categorie du produit est rattachee a un role
    // chef different ; les produits sans categorie / 'general' restent permis.
    if (CHEF_ROLES.includes(userRole)) {
      const ids = [...new Set((items as { productId?: string }[]).map((i) => i.productId).filter(Boolean))] as string[];
      if (ids.length > 0) {
        const cats = await db.query(
          `SELECT p.id, p.name, c.slug
             FROM products p LEFT JOIN categories c ON c.id = p.category_id
            WHERE p.id = ANY($1::uuid[])`,
          [ids]
        );
        const foreign = cats.rows.find((r) => {
          const catRole = getCategoryRole(r.slug || '');
          return CHEF_ROLES.includes(catRole) && catRole !== userRole;
        });
        if (foreign) {
          const catRole = getCategoryRole(foreign.slug || '');
          res.status(403).json({
            success: false,
            error: {
              code: 'ROLE_CATEGORY_MISMATCH',
              message: `« ${foreign.name} » releve de l'atelier ${ASSIGNED_ROLE_LABELS[catRole] || catRole} : vous ne pouvez pas creer de plan pour ce produit.`,
            },
          });
          return;
        }
      }
    }

    // If chef creates plan, auto-assign their role; otherwise use provided targetRole
    const effectiveTargetRole = CHEF_ROLES.includes(userRole) ? userRole : (targetRole || null);

    const plan = await productionRepository.create({
      planDate, type: type || 'daily', notes, createdBy: req.user!.userId,
      targetRole: effectiveTargetRole, storeId: req.user!.storeId, items,
    });

    // Notify the target chef role about new production plan
    if (effectiveTargetRole && !CHEF_ROLES.includes(userRole)) {
      await createNotification({
        targetRole: effectiveTargetRole,
        storeId: req.user!.storeId,
        type: 'production_plan_created',
        title: 'Nouveau plan de production',
        message: `Un plan de production du ${planDate} vous a ete assigne avec ${items.length} produit(s)`,
        referenceType: 'production_plan',
        referenceId: plan.id,
        createdBy: req.user!.userId,
      });
    }

    res.status(201).json({ success: true, data: plan });
  },

  async updateItems(req: AuthRequest, res: Response) {
    const plan = await loadOwnedPlan(req, res);
    if (!plan) return;
    if (plan.status !== 'draft') {
      res.status(409).json({ success: false, error: { message: 'Seuls les brouillons peuvent etre modifies' } });
      return;
    }
    await productionRepository.updateItems(req.params.id, req.body.items);
    const updated = await productionRepository.findById(req.params.id);
    res.json({ success: true, data: updated });
  },

  async confirm(req: AuthRequest, res: Response) {
    const plan = await loadOwnedPlan(req, res);
    if (!plan) return;
    if (plan.status !== 'draft') {
      res.status(409).json({ success: false, error: { message: 'Le plan doit etre en brouillon pour etre confirme' } });
      return;
    }
    // Le repository reverifie le statut sous verrou : un confirm concurrent
    // (double clic) est refuse en 409 comme pour start/revertToDraft.
    let warnings: string[];
    try {
      ({ warnings } = await productionRepository.confirm(req.params.id, req.user!.userId));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la confirmation';
      res.status(409).json({ success: false, error: { message } });
      return;
    }

    // Auto-detect semi-finished needs: reserve available stock, create production
    // plans for any deficit. Skip semi-finished plans themselves to avoid recursion.
    let semiFinished: { dependencies: { subRecipeName: string; needed: number; fromStock: number; toProduce: number }[]; dependencyPlanIds: string[] } = { dependencies: [], dependencyPlanIds: [] };
    if (!(plan as any).is_semi_finished_plan) {
      try {
        semiFinished = await productionRepository.detectAndCreateSemiFinishedPlans(req.params.id, req.user!.userId);
        for (const depPlanId of semiFinished.dependencyPlanIds) {
          await createNotification({
            targetRole: plan.target_role || 'manager',
            storeId: req.user!.storeId,
            type: 'semi_finished_plan_created',
            title: 'Semi-fini a produire',
            message: `Un plan de production de semi-fini a ete cree automatiquement. Produisez-le avant le plan principal.`,
            referenceType: 'production_plan',
            referenceId: depPlanId,
            createdBy: req.user!.userId,
          });
        }
      } catch (err) {
        console.error('Auto-detection semi-finis echouee:', err);
      }
    }

    // Le bon de sortie est genere par productionRepository.confirm() (avec le
    // passage du plan en 'awaiting_ingredients' et la notification au magasinier).
    // Une seconde generation ici echouait toujours en « Bon deja genere » et, pour
    // un admin sans magasin, produisait une fausse alerte « Magasin requis ».
    const updated = await productionRepository.findById(req.params.id);
    const finalWarnings = [...(warnings || [])];
    res.json({
      success: true,
      data: updated,
      warnings: finalWarnings,
      semiFinished: {
        dependencies: semiFinished.dependencies,
        dependencyPlanIds: semiFinished.dependencyPlanIds,
      },
    });
  },

  // Revert un plan confirme -> draft pour permettre des modifications.
  // Pre-condition : status='confirmed' ET aucun item demarre/produit ET BSI non preleve.
  async revertToDraft(req: AuthRequest, res: Response) {
    const plan = await loadOwnedPlan(req, res);
    if (!plan) return;
    try {
      const result = await productionRepository.revertToDraft(req.params.id, req.user!.userId);
      const updated = await productionRepository.findById(req.params.id);
      res.json({ success: true, data: updated, info: result });
    } catch (err) {
      conflictOrThrow(res, err, 'Erreur lors de la repasse en brouillon');
    }
  },

  /** Relance un plan bloque sans en creer un nouveau : reactive les articles annules /
   *  en attente et, si la preparation n'est pas engagee, recalcule les besoins et
   *  regenere le bon de sortie depuis les recettes actuelles. */
  async relaunch(req: AuthRequest, res: Response) {
    const plan = await loadOwnedPlan(req, res);
    if (!plan) return;
    if (req.user!.storeId && plan.store_id && plan.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } }); return;
    }
    const { itemIds } = req.body || {};
    try {
      const result = await productionRepository.relaunch(req.params.id, req.user!.userId, itemIds);
      const updated = await productionRepository.findById(req.params.id);

      // Le magasinier doit savoir que la preparation repart : BSI regenere ou
      // articles remis en production, dans les deux cas il y a des prelevements a prevoir.
      if (result.newStatus === 'awaiting_ingredients' || result.newStatus === 'ready_to_produce') {
        const quoi = result.relaunchedCount > 0
          ? `${result.relaunchedCount} article(s) remis en production`
          : 'bon de sortie regenere';
        await createNotification({
          targetRole: 'magasinier',
          storeId: req.user!.storeId,
          type: 'production_plan_relaunched',
          title: 'Plan de production relance',
          message: `${quoi} sur le plan du ${String(plan.plan_date).slice(0, 10)}`,
          referenceType: 'production_plan',
          referenceId: req.params.id,
          createdBy: req.user!.userId,
        });
      }

      res.json({ success: true, data: updated, meta: result, warnings: result.warnings });
    } catch (err) {
      conflictOrThrow(res, err, 'Erreur lors de la relance du plan');
    }
  },

  async start(req: AuthRequest, res: Response) {
    const plan = await loadOwnedPlan(req, res);
    if (!plan) return;
    // Delta v1 point 1 : depuis l'introduction du cycle awaiting_ingredients ->
    // ready_to_produce, le plan peut etre dans n'importe lequel de ces statuts
    // au moment du demarrage. 'confirmed' couvre les plans sans BSI (aucun
    // ingredient a prelever), 'ready_to_produce' couvre le cas standard avec
    // BSI clôture. La verification BSI=cloture reste effectuee dans repository.start().
    if (!['confirmed', 'awaiting_ingredients', 'ready_to_produce'].includes(plan.status)) {
      res.status(409).json({ success: false, error: { message: 'Le plan doit etre confirme ou pret a produire pour demarrer' } });
      return;
    }
    try {
      await productionRepository.start(req.params.id, req.user!.userId);
      const updated = await productionRepository.findById(req.params.id);
      res.json({ success: true, data: updated });
    } catch (err) {
      conflictOrThrow(res, err, 'Erreur lors du demarrage');
    }
  },

  // ═══ Start items: pending → in_progress ═══
  async startItems(req: AuthRequest, res: Response) {
    const plan = await loadOwnedPlan(req, res);
    if (!plan) return;
    if (plan.status !== 'in_progress') {
      res.status(409).json({ success: false, error: { message: 'Le plan doit etre en cours pour lancer des productions' } });
      return;
    }
    const { itemIds, startedAt } = req.body;
    if (!itemIds || itemIds.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Aucun article a lancer' } });
      return;
    }
    const result = await productionRepository.startItems(req.params.id, itemIds, req.user!.userId, startedAt);
    const updated = await productionRepository.findById(req.params.id);
    res.json({ success: true, data: updated, meta: result });
  },

  // ═══ Partial Production: produce selected items ═══
  async produceItems(req: AuthRequest, res: Response) {
    const plan = await loadOwnedPlan(req, res);
    if (!plan) return;
    if (plan.status !== 'in_progress') {
      res.status(409).json({ success: false, error: { message: 'Le plan doit etre en cours pour produire des articles' } });
      return;
    }
    const { items, producedAt } = req.body;
    if (!items || items.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Aucun article a produire' } });
      return;
    }
    try {
      const { warnings, autoCompleted } = await productionRepository.produceItems(req.params.id, items, req.user!.userId, req.user!.storeId, producedAt);
      const updated = await productionRepository.findById(req.params.id);

      // If plan auto-completed, notify manager
      if (autoCompleted) {
        await createNotification({
          targetRole: 'manager',
          storeId: req.user!.storeId,
          type: 'production_completed',
          title: 'Production terminee',
          message: `Le plan de production a ete automatiquement termine — tous les articles ont ete produits.`,
          referenceType: 'production_plan',
          referenceId: req.params.id,
          createdBy: req.user!.userId,
        });
      }

      res.json({ success: true, data: updated, warnings, autoCompleted });
    } catch (err) {
      conflictOrThrow(res, err, 'Erreur lors de la production');
    }
  },

  // ═══ Partial Transfer: transfer produced items to store ═══
  async transferItems(req: AuthRequest, res: Response) {
    const plan = await loadOwnedPlan(req, res);
    if (!plan) return;
    if (plan.status !== 'in_progress') {
      res.status(409).json({ success: false, error: { message: 'Le plan doit etre en cours pour transferer' } });
      return;
    }
    const { itemIds } = req.body;
    if (!itemIds || itemIds.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Aucun article a transferer' } });
      return;
    }
    try {
      const transfer = await productionRepository.createTransfer(req.params.id, itemIds, req.user!.userId, req.user!.storeId);

      // Notify cashier
      await createNotification({
        targetRole: 'cashier',
        storeId: req.user!.storeId,
        type: 'production_transfer',
        title: 'Transfert de production',
        message: `${itemIds.length} article(s) produit(s) transfere(s) au magasin. Confirmez la reception.`,
        referenceType: 'production_transfer',
        referenceId: transfer.id,
        createdBy: req.user!.userId,
      });

      const updated = await productionRepository.findById(req.params.id);
      res.json({ success: true, data: updated });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du transfert';
      res.status(409).json({ success: false, error: { message } });
    }
  },

  // ═══ Confirm production transfer reception (cashier) ═══
  async confirmProductionTransfer(req: AuthRequest, res: Response) {
    const { items } = req.body;
    if (!items || items.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Confirmez les quantites recues' } });
      return;
    }
    try {
      const result = await productionRepository.confirmTransferReception(req.params.transferId, items, req.user!.userId);

      if (result.planCompleted) {
        // Notify manager that production is complete
        await createNotification({
          targetRole: 'manager',
          storeId: req.user!.storeId,
          type: 'production_completed',
          title: 'Production terminee',
          message: `Le plan de production a ete complete — tous les articles ont ete recus.`,
          referenceType: 'production_plan',
          referenceId: result.planId,
          createdBy: req.user!.userId,
        });
      }

      res.json({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la confirmation';
      res.status(409).json({ success: false, error: { message } });
    }
  },

  // ═══ Get pending production transfers for cashier ═══
  async pendingProductionTransfers(req: AuthRequest, res: Response) {
    if (!req.user!.storeId) {
      res.json({ success: true, data: [] });
      return;
    }
    const transfers = await productionRepository.getPendingProductionTransfers(req.user!.storeId);
    res.json({ success: true, data: transfers });
  },

  // ═══ Modification 2: Restore items from waiting list ═══
  async restoreItems(req: AuthRequest, res: Response) {
    const plan = await loadOwnedPlan(req, res);
    if (!plan) return;
    const { itemIds } = req.body;
    if (!itemIds || itemIds.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Aucun article a restaurer' } });
      return;
    }
    try {
      const { warnings } = await productionRepository.restoreFromWaiting(req.params.id, itemIds);

      // Auto-gestion du BSI : 3 cas a gerer apres restore
      //   1. BSI absent + besoins existent -> on le genere et on notifie le magasinier
      //   2. BSI en 'preparation_partielle' -> on re-FEFO les lignes en rupture
      //   3. BSI en autre statut -> rien a faire (le magasinier suit son flow)
      // Erreurs silencieuses : le restore reste valide meme si le BSI echoue.
      const bsiInfo: { completed?: boolean; generated?: boolean; message?: string } = {};
      try {
        const bons = await bonSortieRepository.findByPlan(req.params.id);
        if (!bons || bons.length === 0) {
          // Cas 1 : aucun BSI, on tente la generation
          if (plan.store_id) {
            const generated = await bonSortieRepository.generate(req.params.id, plan.store_id as string, req.user!.userId);
            if (generated?.id) {
              bsiInfo.generated = true;
              bsiInfo.message = `Bon de sortie ${generated.numero || ''} genere et envoye au magasinier`;
              // Notif au magasinier
              try {
                const { createNotification: notify } = await import('../utils/notify.js');
                await notify({
                  targetRole: 'magasinier',
                  storeId: plan.store_id as string,
                  type: 'bsi_generated',
                  title: 'Nouvelle demande d\'ingredients',
                  message: `BSI ${generated.numero || ''} a preparer en economat`,
                  referenceType: 'bon_sortie',
                  referenceId: generated.id as string,
                  createdBy: req.user!.userId,
                });
              } catch { /* non-blocking */ }
            }
          }
        } else {
          // Cas 2 : BSI en preparation partielle -> re-FEFO
          const partialBon = bons.find((b: Record<string, unknown>) => b.status === 'preparation_partielle');
          if (partialBon) {
            const result = await bonSortieRepository.completePending(partialBon.id as string, req.user!.userId);
            bsiInfo.completed = true;
            bsiInfo.message = `Bon de sortie complete (${(result as Record<string, unknown>)?.resolved || 0} ligne(s) re-allouee(s))`;
          }
        }
      } catch (bsiErr) {
        bsiInfo.completed = false;
        bsiInfo.message = bsiErr instanceof Error ? bsiErr.message : 'BSI non traite (verifier manuellement)';
      }

      const updated = await productionRepository.findById(req.params.id);
      res.json({ success: true, data: updated, warnings, bsi: bsiInfo });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la restauration';
      res.status(409).json({ success: false, error: { message } });
    }
  },

  async analyzeSubRecipes(req: AuthRequest, res: Response) {
    const plan = await loadOwnedPlan(req, res);
    if (!plan) return;
    const analysis = await productionRepository.analyzeSubRecipes(req.params.id);
    res.json({ success: true, data: analysis });
  },

  async complete(req: AuthRequest, res: Response) {
    const plan = await loadOwnedPlan(req, res);
    if (!plan) return;
    if (plan.status !== 'in_progress') {
      res.status(409).json({ success: false, error: { message: 'Le plan doit etre en cours pour etre termine' } });
      return;
    }

    // ═══ Modification 3 + Point 8: Block completion if waiting items remain (unless partial closure) ═══
    const { items: bodyItems, completionType } = req.body;
    const waitingItems = (plan.items || []).filter((it: Record<string, unknown>) => it.waiting_status === 'waiting');
    const pendingItems = (plan.items || []).filter((it: Record<string, unknown>) => it.status === 'pending');
    if (waitingItems.length > 0 && completionType !== 'partial') {
      const names = waitingItems.map((it: Record<string, unknown>) => it.product_name).join(', ');
      res.status(409).json({
        success: false,
        error: {
          code: 'WAITING_ITEMS_REMAIN',
          message: `Impossible de terminer : ${waitingItems.length} article(s) en liste d'attente (${names}). Restaurez-les ou utilisez la cloture partielle.`,
          waitingCount: waitingItems.length,
          pendingCount: pendingItems.length,
        },
      });
      return;
    }
    // Le repository reverifie le statut sous verrou : un complete concurrent
    // (double clic) est refuse en 409 au lieu de deduire le stock deux fois.
    let warnings: string[];
    try {
      ({ warnings } = await productionRepository.complete(req.params.id, bodyItems || [], req.user!.userId, req.user!.storeId, completionType));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la cloture';
      res.status(409).json({ success: false, error: { message } });
      return;
    }
    const updated = await productionRepository.findById(req.params.id);

    // If linked to an order, mark order as 'ready'
    if (updated?.order_id) {
      try {
        await orderRepository.updateStatus(updated.order_id, 'ready');
      } catch (err) {
        console.error('Failed to update linked order status:', err);
      }

      // Notify cashier/saleswoman that order is ready for pickup
      for (const role of ['cashier', 'saleswoman', 'manager']) {
        await createNotification({
          targetRole: role,
          storeId: req.user!.storeId,
          type: 'order_ready',
          title: 'Commande prete',
          message: `La commande ${updated.order_number} est prete pour le retrait`,
          referenceType: 'order',
          referenceId: updated.order_id,
          createdBy: req.user!.userId,
        });
      }
    }

    // Notify manager/admin that production is complete
    await createNotification({
      targetRole: 'manager',
      storeId: req.user!.storeId,
      type: 'production_completed',
      title: 'Production terminee',
      message: `Le plan de production du ${updated?.plan_date?.toString().slice(0, 10)} a ete termine${updated?.order_number ? ` (Commande ${updated.order_number})` : ''}`,
      referenceType: 'production_plan',
      referenceId: req.params.id,
      createdBy: req.user!.userId,
    });
    await createNotification({
      targetRole: 'admin',
      storeId: req.user!.storeId,
      type: 'production_completed',
      title: 'Production terminee',
      message: `Le plan de production du ${updated?.plan_date?.toString().slice(0, 10)} a ete termine${updated?.order_number ? ` (Commande ${updated.order_number})` : ''}`,
      referenceType: 'production_plan',
      referenceId: req.params.id,
      createdBy: req.user!.userId,
    });

    // If linked to a replenishment request, notify chef that preparation is unblocked
    if (updated?.replenishment_request_id) {
      await createNotification({
        targetRole: updated.target_role || 'manager',
        storeId: req.user!.storeId,
        type: 'production_completed_for_replenishment',
        title: 'Production terminee — approvisionnement debloque',
        message: `La production est terminee. Vous pouvez maintenant preparer les articles pour l'approvisionnement.`,
        referenceType: 'replenishment_request',
        referenceId: updated.replenishment_request_id,
        createdBy: req.user!.userId,
      });
    }

    try {
      await productionCoutRepository.calculateAndSave(req.params.id, req.user!.userId);
    } catch (err) {
      console.error('Auto-calculate cost failed (non-blocking):', err);
    }

    res.json({ success: true, data: updated, warnings });
  },

  // ═══ Point 8: Cancel individual production items ═══
  async cancelItems(req: AuthRequest, res: Response) {
    const plan = await loadOwnedPlan(req, res);
    if (!plan) return;
    if (!['confirmed', 'awaiting_ingredients', 'ready_to_produce', 'in_progress'].includes(plan.status)) {
      res.status(409).json({ success: false, error: { message: 'Le plan doit etre confirme ou en cours' } });
      return;
    }
    const { itemIds, reason } = req.body;
    if (!itemIds || itemIds.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Aucun article a annuler' } });
      return;
    }
    try {
      await productionRepository.cancelItems(req.params.id, itemIds, reason);
      const updated = await productionRepository.findById(req.params.id);
      res.json({ success: true, data: updated });
    } catch (err) {
      conflictOrThrow(res, err, 'Erreur lors de l\'annulation');
    }
  },

  async remove(req: AuthRequest, res: Response) {
    const plan = await loadOwnedPlan(req, res);
    if (!plan) return;
    if (plan.status !== 'draft') {
      res.status(409).json({ success: false, error: { message: 'Seuls les brouillons peuvent etre supprimes' } });
      return;
    }
    await productionRepository.remove(req.params.id);
    res.json({ success: true, data: null });
  },

  // ═══ Demande de verification stock pour un ingredient en rupture ═══
  // Le chef declenche depuis la page plan, le magasinier/economat recoit
  // une notification pour aller verifier physiquement le stock.
  async requestStockVerification(req: AuthRequest, res: Response) {
    const { id, ingredientId } = req.params as { id: string; ingredientId: string };
    const { note } = (req.body || {}) as { note?: string };

    const plan = await productionRepository.findById(id);
    if (!plan) { res.status(404).json({ success: false, error: { message: 'Plan non trouve' } }); return; }
    if (req.user!.storeId && plan.store_id && plan.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } }); return;
    }

    const need = (plan.ingredient_needs as Record<string, unknown>[] || [])
      .find(n => n.ingredient_id === ingredientId);
    if (!need) {
      res.status(404).json({ success: false, error: { message: 'Besoin ingredient non trouve' } });
      return;
    }

    const ingredientName = need.ingredient_name as string;
    const needed = parseFloat(need.needed_quantity as string) || 0;
    const available = parseFloat(need.available_quantity as string) || 0;
    const deficit = Math.max(0, needed - available);
    const unit = (need.unit as string) || '';
    const planDate = plan.plan_date instanceof Date
      ? plan.plan_date.toISOString().slice(0, 10)
      : (plan.plan_date?.toString().slice(0, 10) || '');

    // Notification au magasinier (et a tous les responsables stock)
    await createNotification({
      targetRole: 'magasinier',
      storeId: req.user!.storeId,
      type: 'stock_verification_requested',
      title: 'Verification stock demandee',
      message: `Plan du ${planDate} : verifier la dispo de ${ingredientName} — manque ${deficit.toFixed(2)} ${unit}${note ? ` — Note : ${note}` : ''}`,
      referenceType: 'production_plan',
      referenceId: id,
      createdBy: req.user!.userId,
    });
    // Egalement aux managers/admins pour visibilite
    await createNotification({
      targetRole: 'manager',
      storeId: req.user!.storeId,
      type: 'stock_verification_requested',
      title: 'Verification stock demandee',
      message: `Plan du ${planDate} : verifier la dispo de ${ingredientName} — manque ${deficit.toFixed(2)} ${unit}${note ? ` — Note : ${note}` : ''}`,
      referenceType: 'production_plan',
      referenceId: id,
      createdBy: req.user!.userId,
    });

    res.json({
      success: true,
      data: {
        ingredientName,
        deficit,
        unit,
        message: `Demande envoyee au responsable stock pour ${ingredientName}`,
      },
    });
  },

  // ═══ Semi-finished detection ═══

  async detectSemiFinished(req: AuthRequest, res: Response) {
    const plan = await loadOwnedPlan(req, res);
    if (!plan) return;
    if (!['draft', 'confirmed'].includes(plan.status)) {
      res.status(409).json({ success: false, error: { message: 'Detection possible uniquement sur les plans brouillon ou confirmes' } });
      return;
    }
    try {
      const result = await productionRepository.detectAndCreateSemiFinishedPlans(req.params.id, req.user!.userId);

      // Notify chef about semi-finished plans created
      for (const depPlanId of result.dependencyPlanIds) {
        await createNotification({
          targetRole: plan.target_role || 'manager',
          storeId: req.user!.storeId,
          type: 'semi_finished_plan_created',
          title: 'Semi-fini a produire',
          message: `Un plan de production de semi-fini a ete cree automatiquement. Produisez-le avant le plan principal.`,
          referenceType: 'production_plan',
          referenceId: depPlanId,
          createdBy: req.user!.userId,
        });
      }

      const updated = await productionRepository.findById(req.params.id);
      res.json({ success: true, data: updated, dependencies: result.dependencies, semiFinishedPlanIds: result.dependencyPlanIds });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la detection des semi-finis';
      res.status(500).json({ success: false, error: { message } });
    }
  },

  async getPlanDependencies(req: AuthRequest, res: Response) {
    const result = await productionRepository.getPlanDependencies(req.params.id);
    res.json({ success: true, data: result });
  },

  /** GET /production/:id/events — journal des transitions plan + bons (mig 299). */
  async getEvents(req: AuthRequest, res: Response) {
    const plan = await loadOwnedPlan(req, res);
    if (!plan) return;
    res.json({ success: true, data: await listPlanEvents(req.params.id) });
  },

  async getActivities(req: AuthRequest, res: Response) {
    const activities = await productionRepository.getActivities(req.params.id);
    res.json({ success: true, data: activities });
  },

  async addActivity(req: AuthRequest, res: Response) {
    const { message } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({ success: false, error: { message: 'Message requis' } });
      return;
    }
    const activity = await productionRepository.addActivity(
      req.params.id, 'note_added', message.trim(), req.user!.userId
    );
    res.status(201).json({ success: true, data: activity });
  },
};
