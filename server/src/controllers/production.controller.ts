import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { productionRepository } from '../repositories/production.repository.js';

export const productionController = {
  async list(req: AuthRequest, res: Response) {
    const { status, type, dateFrom, dateTo, page = '1', limit = '20' } = req.query as Record<string, string>;
    const p = parseInt(page); const l = parseInt(limit);
    const result = await productionRepository.findAll({
      status, type, dateFrom, dateTo, limit: l, offset: (p - 1) * l,
    });
    res.json({ success: true, data: result.rows, total: result.total, page: p, limit: l, totalPages: Math.ceil(result.total / l) });
  },

  async getById(req: AuthRequest, res: Response) {
    const plan = await productionRepository.findById(req.params.id);
    if (!plan) { res.status(404).json({ success: false, error: { message: 'Plan non trouve' } }); return; }
    res.json({ success: true, data: plan });
  },

  async create(req: AuthRequest, res: Response) {
    const { planDate, type, notes, items } = req.body;
    if (!planDate || !items || items.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Date et articles requis' } });
      return;
    }
    const plan = await productionRepository.create({
      planDate, type: type || 'daily', notes, createdBy: req.user!.userId, items,
    });
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
