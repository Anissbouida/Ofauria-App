import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { supplierItemRepository } from '../repositories/supplier-item.repository.js';

const num = (v: unknown): number | null => v != null && v !== '' ? Number(v) : null;

export const supplierItemController = {
  async list(req: AuthRequest, res: Response) {
    const { kind, purchasableId, supplierId } = req.query as Record<string, string>;
    if (supplierId) { res.json({ success: true, data: await supplierItemRepository.listBySupplier(supplierId) }); return; }
    if (kind && purchasableId) {
      if (!['ingredient', 'packaging'].includes(kind)) { res.status(400).json({ success: false, error: { message: 'kind invalide' } }); return; }
      res.json({ success: true, data: await supplierItemRepository.listByPurchasable(kind, purchasableId) }); return;
    }
    res.status(400).json({ success: false, error: { message: 'Préciser supplierId, ou kind + purchasableId' } });
  },

  async create(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    if (!b.supplierId || !b.purchasableId || !['ingredient', 'packaging'].includes(String(b.kind))) {
      res.status(400).json({ success: false, error: { message: 'supplierId, kind (ingredient|packaging) et purchasableId requis' } }); return;
    }
    try {
      const data = await supplierItemRepository.create({
        supplierId: String(b.supplierId), kind: b.kind as 'ingredient' | 'packaging', purchasableId: String(b.purchasableId),
        supplierReference: b.supplierReference ? String(b.supplierReference) : null,
        containerTypeId: b.containerTypeId ? String(b.containerTypeId) : null,
        qtyPerContainer: num(b.qtyPerContainer), leadTimeDays: num(b.leadTimeDays), moq: num(b.moq),
        isBlocked: b.isBlocked === true, notes: b.notes ? String(b.notes) : null,
      }, req.user!.userId, req.user!.storeId ?? null);
      res.status(201).json({ success: true, data });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') { res.status(409).json({ success: false, error: { message: 'Ce fournisseur est déjà associé à cet article' } }); return; }
      throw e;
    }
  },

  async update(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (b.supplierReference !== undefined) patch.supplierReference = b.supplierReference ? String(b.supplierReference) : null;
    if (b.containerTypeId !== undefined) patch.containerTypeId = b.containerTypeId ? String(b.containerTypeId) : null;
    if (b.qtyPerContainer !== undefined) patch.qtyPerContainer = num(b.qtyPerContainer);
    if (b.leadTimeDays !== undefined) patch.leadTimeDays = num(b.leadTimeDays);
    if (b.moq !== undefined) patch.moq = num(b.moq);
    if (b.isBlocked !== undefined) patch.isBlocked = b.isBlocked === true;
    if (b.notes !== undefined) patch.notes = b.notes ? String(b.notes) : null;
    const d = await supplierItemRepository.update(req.params.id as string, patch);
    if (!d) { res.status(404).json({ success: false, error: { message: 'Introuvable' } }); return; }
    res.json({ success: true, data: d });
  },

  async prefer(req: AuthRequest, res: Response) {
    const d = await supplierItemRepository.setPreferred(req.params.id as string);
    if (!d) { res.status(404).json({ success: false, error: { message: 'Introuvable' } }); return; }
    if ((d as { error?: string }).error === 'blocked') { res.status(409).json({ success: false, error: { message: 'Fournisseur bloqué : impossible de le préférer' } }); return; }
    res.json({ success: true, data: d });
  },

  async archive(req: AuthRequest, res: Response) {
    const d = await supplierItemRepository.archive(req.params.id as string);
    if (!d) { res.status(404).json({ success: false, error: { message: 'Introuvable' } }); return; }
    res.json({ success: true, data: d });
  },
};
