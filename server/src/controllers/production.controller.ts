import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { productionRepository } from '../repositories/production.repository.js';
import { orderRepository } from '../repositories/order.repository.js';
import { createNotification } from '../utils/notify.js';

const CHEF_ROLES = ['baker', 'pastry_chef', 'viennoiserie', 'beldi_sale'];

export const productionController = {
  async list(req: AuthRequest, res: Response) {
    const { status, type, dateFrom, dateTo, targetRole, page = '1', limit = '20' } = req.query as Record<string, string>;
    const p = parseInt(page); const l = parseInt(limit);
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
    // Validate UUID format to prevent DB crash
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(req.params.id)) {
      res.status(400).json({ success: false, error: { message: 'ID invalide' } });
      return;
    }
    const plan = await productionRepository.findById(req.params.id);
    if (!plan) { res.status(404).json({ success: false, error: { message: 'Plan non trouve' } }); return; }
    res.json({ success: true, data: plan });
  },

  async create(req: AuthRequest, res: Response) {
    const { planDate, type, notes, items, targetRole } = req.body;
    if (!planDate || !items || items.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Date et articles requis' } });
      return;
    }
    const userRole = req.user!.role;
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
    const plan = await productionRepository.findById(req.params.id);
    if (!plan) { res.status(404).json({ success: false, error: { message: 'Plan non trouve' } }); return; }
    if (plan.status !== 'draft') {
      res.status(409).json({ success: false, error: { message: 'Seuls les brouillons peuvent etre modifies' } });
      return;
    }
    await productionRepository.updateItems(req.params.id, req.body.items);
    const updated = await productionRepository.findById(req.params.id);
    res.json({ success: true, data: updated });
  },

  async confirm(req: AuthRequest, res: Response) {
    const plan = await productionRepository.findById(req.params.id);
    if (!plan) { res.status(404).json({ success: false, error: { message: 'Plan non trouve' } }); return; }
    if (plan.status !== 'draft') {
      res.status(409).json({ success: false, error: { message: 'Le plan doit etre en brouillon pour etre confirme' } });
      return;
    }
    const { warnings } = await productionRepository.confirm(req.params.id);
    const updated = await productionRepository.findById(req.params.id);

    res.json({ success: true, data: updated, warnings });
  },

  async start(req: AuthRequest, res: Response) {
    const plan = await productionRepository.findById(req.params.id);
    if (!plan) { res.status(404).json({ success: false, error: { message: 'Plan non trouve' } }); return; }
    if (plan.status !== 'confirmed') {
      res.status(409).json({ success: false, error: { message: 'Le plan doit etre confirme pour demarrer' } });
      return;
    }
    await productionRepository.start(req.params.id);
    const updated = await productionRepository.findById(req.params.id);
    res.json({ success: true, data: updated });
  },

  // ═══ Partial Production: produce selected items ═══
  async produceItems(req: AuthRequest, res: Response) {
    const plan = await productionRepository.findById(req.params.id);
    if (!plan) { res.status(404).json({ success: false, error: { message: 'Plan non trouve' } }); return; }
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
      const message = err instanceof Error ? err.message : 'Erreur lors de la production';
      res.status(409).json({ success: false, error: { message } });
    }
  },

  // ═══ Partial Transfer: transfer produced items to store ═══
  async transferItems(req: AuthRequest, res: Response) {
    const plan = await productionRepository.findById(req.params.id);
    if (!plan) { res.status(404).json({ success: false, error: { message: 'Plan non trouve' } }); return; }
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
    const plan = await productionRepository.findById(req.params.id);
    if (!plan) { res.status(404).json({ success: false, error: { message: 'Plan non trouve' } }); return; }
    const { itemIds } = req.body;
    if (!itemIds || itemIds.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Aucun article a restaurer' } });
      return;
    }
    try {
      const { warnings } = await productionRepository.restoreFromWaiting(req.params.id, itemIds);
      const updated = await productionRepository.findById(req.params.id);
      res.json({ success: true, data: updated, warnings });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la restauration';
      res.status(409).json({ success: false, error: { message } });
    }
  },

  async complete(req: AuthRequest, res: Response) {
    const plan = await productionRepository.findById(req.params.id);
    if (!plan) { res.status(404).json({ success: false, error: { message: 'Plan non trouve' } }); return; }
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
    const { warnings } = await productionRepository.complete(req.params.id, bodyItems || req.body.items, req.user!.userId, req.user!.storeId, completionType);
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

    res.json({ success: true, data: updated, warnings });
  },

  // ═══ Point 8: Cancel individual production items ═══
  async cancelItems(req: AuthRequest, res: Response) {
    const plan = await productionRepository.findById(req.params.id);
    if (!plan) { res.status(404).json({ success: false, error: { message: 'Plan non trouve' } }); return; }
    if (!['confirmed', 'in_progress'].includes(plan.status)) {
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
      const message = err instanceof Error ? err.message : 'Erreur lors de l\'annulation';
      res.status(409).json({ success: false, error: { message } });
    }
  },

  async remove(req: AuthRequest, res: Response) {
    const plan = await productionRepository.findById(req.params.id);
    if (!plan) { res.status(404).json({ success: false, error: { message: 'Plan non trouve' } }); return; }
    if (plan.status !== 'draft') {
      res.status(409).json({ success: false, error: { message: 'Seuls les brouillons peuvent etre supprimes' } });
      return;
    }
    await productionRepository.remove(req.params.id);
    res.json({ success: true, data: null });
  },
};
