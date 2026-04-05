import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { productionRepository } from '../repositories/production.repository.js';
import { orderRepository } from '../repositories/order.repository.js';
import { createNotification } from '../utils/notify.js';

const CHEF_ROLES = ['baker', 'pastry_chef', 'viennoiserie'];

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

  async complete(req: AuthRequest, res: Response) {
    const plan = await productionRepository.findById(req.params.id);
    if (!plan) { res.status(404).json({ success: false, error: { message: 'Plan non trouve' } }); return; }
    if (plan.status !== 'in_progress') {
      res.status(409).json({ success: false, error: { message: 'Le plan doit etre en cours pour etre termine' } });
      return;
    }
    await productionRepository.complete(req.params.id, req.body.items, req.user!.userId);
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

    res.json({ success: true, data: updated });
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
