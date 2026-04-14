import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { replenishmentRepository } from '../repositories/replenishment.repository.js';
import { createNotification } from '../utils/notify.js';
import { ROLE_CATEGORY_SLUGS, ASSIGNED_ROLE_LABELS } from '@ofauria/shared';
import { db } from '../config/database.js';

const STORE_ROLES = ['cashier', 'saleswoman'];
const CHEF_ROLES = ['baker', 'pastry_chef', 'viennoiserie', 'beldi_sale'];

export const replenishmentController = {
  // List replenishment requests
  async list(req: AuthRequest, res: Response) {
    const { status, dateFrom, dateTo, page = '1', limit = '20' } = req.query as Record<string, string>;
    const p = parseInt(page); const l = parseInt(limit);
    const userRole = req.user!.role;

    // Store staff see only their store's requests
    const storeId = STORE_ROLES.includes(userRole) ? req.user!.storeId : undefined;

    const result = await replenishmentRepository.findAll({
      status,
      storeId,
      dateFrom,
      dateTo,
      userRole,
      limit: l,
      offset: (p - 1) * l,
    });

    res.json({ success: true, data: result.rows, total: result.total, page: p, limit: l });
  },

  // Get single request with items
  async getById(req: AuthRequest, res: Response) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(req.params.id)) {
      res.status(400).json({ success: false, error: { message: 'ID invalide' } });
      return;
    }
    const request = await replenishmentRepository.findById(req.params.id);
    if (!request) {
      res.status(404).json({ success: false, error: { message: 'Demande non trouvee' } });
      return;
    }
    res.json({ success: true, data: request });
  },

  // ═══ RULE 1: Check which products were already requested today (detailed per-item info) ═══
  async checkToday(req: AuthRequest, res: Response) {
    const productIds = await replenishmentRepository.findTodayRequestedProductIds(req.user!.storeId!);
    const details = await replenishmentRepository.findTodayRequestedDetails(req.user!.storeId!);
    res.json({ success: true, data: { alreadyRequestedProductIds: productIds, alreadyRequestedDetails: details } });
  },

  // ═══ RULE 2: Check unsold items before re-ordering ═══
  async checkItems(req: AuthRequest, res: Response) {
    const { productIds } = req.body;
    if (!productIds?.length) {
      res.json({ success: true, data: { blockedItems: [], eligibleIds: productIds || [] } });
      return;
    }
    const unsoldItems = await replenishmentRepository.checkUnsoldItems(req.user!.storeId!, productIds);
    const blockedProductIds = unsoldItems.map((u: Record<string, unknown>) => u.product_id as string);
    const eligibleIds = productIds.filter((id: string) => !blockedProductIds.includes(id));
    res.json({
      success: true,
      data: {
        blockedItems: unsoldItems.map((u: Record<string, unknown>) => ({
          productId: u.product_id,
          productName: u.product_name,
          deliveredQty: u.delivered_qty,
          soldQty: u.sold_qty,
          unsoldQty: u.unsold_qty,
          message: `${u.product_name} a encore ${u.unsold_qty} unite(s) non vendue(s) depuis le dernier approvisionnement.`,
        })),
        eligibleIds,
      },
    });
  },

  // ═══ RULE 3: Get replenished items for daily closing inventory ═══
  async closingInventory(req: AuthRequest, res: Response) {
    const items = await replenishmentRepository.getReplenishedItemsToday(req.user!.storeId!);
    res.json({ success: true, data: items });
  },

  // ═══ STEP 1: Create new request (cashier) → parent + sub-requests ═══
  async create(req: AuthRequest, res: Response) {
    const { priority, neededBy, notes, items } = req.body;
    if (!items || items.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Ajoutez au moins un produit' } });
      return;
    }

    // Block if there's already an in-progress request for this store
    const pending = await db.query(
      `SELECT id FROM replenishment_requests
       WHERE store_id = $1 AND status NOT IN ('closed', 'closed_with_discrepancy', 'cancelled')
       LIMIT 1`,
      [req.user!.storeId!]
    );
    if (pending.rows.length > 0) {
      res.status(409).json({ success: false, error: { message: 'Une demande d\'approvisionnement est déjà en cours. Veuillez attendre sa clôture avant d\'en créer une nouvelle.' } });
      return;
    }

    const result = await replenishmentRepository.create({
      storeId: req.user!.storeId!,
      requestedBy: req.user!.userId,
      priority,
      neededBy,
      notes,
      items,
    });

    // Notify each chef about their request
    const requestIds = (result as Record<string, unknown>)?._requestIds as Record<string, string> | undefined;
    if (requestIds) {
      for (const [role, reqId] of Object.entries(requestIds)) {
        if (CHEF_ROLES.includes(role)) {
          const roleLabel = ASSIGNED_ROLE_LABELS[role] || role;
          await createNotification({
            targetRole: role,
            type: 'replenishment_request',
            title: 'Nouvelle demande d\'approvisionnement',
            message: `Demande d'approvisionnement — articles ${roleLabel} a preparer`,
            referenceType: 'replenishment_request',
            referenceId: reqId,
            createdBy: req.user!.userId,
          });
        }
      }
    }

    // Notify manager
    await createNotification({
      targetRole: 'manager',
      storeId: req.user!.storeId,
      type: 'replenishment_request',
      title: 'Nouvelle demande d\'approvisionnement',
      message: `${Object.keys(requestIds || {}).length} demande(s) d'approvisionnement creee(s) — ${items.length} produit(s) — Priorite: ${priority || 'normal'}`,
      referenceType: 'replenishment_request',
      referenceId: Object.values(requestIds || {})[0] || (result as Record<string, unknown>)?.id as string,
      createdBy: req.user!.userId,
    });

    res.status(201).json({ success: true, data: result });
  },

  // ═══ STEP 2: Acknowledge request (responsable) ═══
  async acknowledge(req: AuthRequest, res: Response) {
    try {
      // Authorization: chef can only acknowledge their own sub-request
      if (CHEF_ROLES.includes(req.user!.role)) {
        const check = await db.query(
          `SELECT assigned_role FROM replenishment_requests WHERE id = $1`,
          [req.params.id]
        );
        if (check.rows[0]?.assigned_role !== req.user!.role) {
          res.status(403).json({ success: false, error: { message: 'Vous ne pouvez pas prendre en charge cette demande' } });
          return;
        }
      }

      const result = await replenishmentRepository.acknowledge(req.params.id, req.user!.userId);

      // Notify chef about production plan if one was created
      const productionPlanId = (result as Record<string, unknown>)?._productionPlanId as string | undefined;
      if (productionPlanId && result) {
        const role = (result as Record<string, unknown>).assigned_role as string;
        if (CHEF_ROLES.includes(role)) {
          const roleLabel = ASSIGNED_ROLE_LABELS[role] || role;
          await createNotification({
            targetRole: role,
            storeId: req.user!.storeId,
            type: 'production_plan_created',
            title: 'Production requise',
            message: `Des articles ${roleLabel} demandes en approvisionnement necessitent une production.`,
            referenceType: 'production_plan',
            referenceId: productionPlanId,
            createdBy: req.user!.userId,
          });
        }
      }

      res.json({ success: true, data: result });
    } catch {
      res.status(409).json({ success: false, error: { message: 'Cette demande ne peut pas etre prise en charge' } });
    }
  },

  // ═══ STEP 3: Start preparing (responsable) ═══
  async startPreparing(req: AuthRequest, res: Response) {
    const { items } = req.body;
    if (!items || items.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Renseignez les quantites pour chaque article' } });
      return;
    }

    try {
      const result = await replenishmentRepository.startPreparing(req.params.id, items);
      res.json({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error && err.message.includes('production')
        ? err.message
        : 'Cette demande ne peut pas etre preparee';
      res.status(409).json({ success: false, error: { message } });
    }
  },

  // ═══ STEP 4: Transfer to store (responsable) ═══
  async transfer(req: AuthRequest, res: Response) {
    try {
      const result = await replenishmentRepository.transfer(req.params.id, req.user!.userId);

      // Notify cashier that transfer is ready for reception
      await createNotification({
        targetRole: 'cashier',
        storeId: result!.store_id,
        type: 'replenishment_transferred',
        title: 'Transfert pret a recevoir',
        message: `${ASSIGNED_ROLE_LABELS[result!.assigned_role as string] || 'Section'}: demande ${result!.request_number} transferee. Confirmez la reception.`,
        referenceType: 'replenishment_request',
        referenceId: req.params.id,
        createdBy: req.user!.userId,
      });

      res.json({ success: true, data: result });
    } catch {
      res.status(409).json({ success: false, error: { message: 'Cette demande ne peut pas etre transferee' } });
    }
  },

  // ═══ STEP 5: Confirm reception (cashier) ═══
  async confirmReception(req: AuthRequest, res: Response) {
    const { items } = req.body;
    if (!items || items.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Confirmez les quantites recues' } });
      return;
    }

    try {
      const result = await replenishmentRepository.confirmReception(req.params.id, req.user!.userId, items);

      // Notify manager if there's a discrepancy
      if (result!.status === 'closed_with_discrepancy') {
        await createNotification({
          targetRole: 'manager',
          storeId: result!.store_id,
          type: 'replenishment_discrepancy',
          title: 'Ecart de reception signale',
          message: `La demande ${result!.request_number} a ete cloturee avec un ecart. Verification requise.`,
          referenceType: 'replenishment_request',
          referenceId: req.params.id,
          createdBy: req.user!.userId,
        });
      }

      res.json({ success: true, data: result });
    } catch (err) {
      console.error('confirmReception error:', err);
      res.status(409).json({ success: false, error: { message: 'Cette demande ne peut pas etre confirmee' } });
    }
  },

  // Cancel request (only if submitted or acknowledged)
  async cancel(req: AuthRequest, res: Response) {
    const request = await replenishmentRepository.findById(req.params.id);
    if (!request) {
      res.status(404).json({ success: false, error: { message: 'Demande non trouvee' } });
      return;
    }
    if (!['submitted', 'acknowledged'].includes(request.status)) {
      res.status(409).json({ success: false, error: { message: 'Cette demande ne peut plus etre annulee' } });
      return;
    }

    const { cancelledPlanIds } = await replenishmentRepository.cancel(req.params.id);

    // Notify affected production roles about cascade cancellation
    for (const plan of cancelledPlanIds) {
      // Notify the chef/production role
      if (plan.targetRole) {
        await createNotification({
          targetRole: plan.targetRole,
          storeId: plan.storeId,
          type: 'production_cancelled',
          title: 'Plan de production annule',
          message: "Le plan de production a ete annule suite a l'annulation de la demande d'approvisionnement",
          referenceType: 'production_plan',
          referenceId: plan.id,
          createdBy: req.user?.id,
        });
      }

      // Notify manager
      await createNotification({
        targetRole: 'manager',
        storeId: plan.storeId,
        type: 'production_cancelled',
        title: 'Plan de production annule',
        message: "Le plan de production a ete annule suite a l'annulation de la demande d'approvisionnement",
        referenceType: 'production_plan',
        referenceId: plan.id,
        createdBy: req.user?.id,
      });
    }

    res.json({ success: true, data: null });
  },

  // Get pending transfers for cashier
  async pendingTransfers(req: AuthRequest, res: Response) {
    const transfers = await replenishmentRepository.findPendingTransfers(req.user!.storeId!);
    res.json({ success: true, data: transfers });
  },

  // Get product recommendations
  async recommendations(req: AuthRequest, res: Response) {
    const recommendations = await replenishmentRepository.getRecommendations(req.user!.storeId);
    res.json({ success: true, data: recommendations });
  },

  // ═══ RULE 3: Save daily inventory check ═══
  async saveInventoryCheck(req: AuthRequest, res: Response) {
    const { sessionId, items, notes } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Aucun article a verifier' } });
      return;
    }
    const result = await replenishmentRepository.saveInventoryCheck({
      storeId: req.user!.storeId!,
      sessionId,
      checkedBy: req.user!.userId,
      items,
      notes,
    });
    res.json({ success: true, data: result });
  },
};
