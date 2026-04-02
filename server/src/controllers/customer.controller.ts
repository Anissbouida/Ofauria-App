import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { customerRepository } from '../repositories/customer.repository.js';

export const customerController = {
  async list(req: AuthRequest, res: Response) {
    const { search, page = '1', limit = '20' } = req.query as Record<string, string>;
    const p = parseInt(page); const l = parseInt(limit);
    const result = await customerRepository.findAll({ search, limit: l, offset: (p - 1) * l });
    res.json({ success: true, data: result.rows, total: result.total, page: p, limit: l, totalPages: Math.ceil(result.total / l) });
  },
  async getById(req: AuthRequest, res: Response) {
    const customer = await customerRepository.findById(req.params.id);
    if (!customer) { res.status(404).json({ success: false, error: { message: 'Client non trouvé' } }); return; }
    res.json({ success: true, data: customer });
  },
  async create(req: AuthRequest, res: Response) {
    const customer = await customerRepository.create(req.body);
    res.status(201).json({ success: true, data: customer });
  },
  async update(req: AuthRequest, res: Response) {
    const customer = await customerRepository.update(req.params.id, req.body);
    res.json({ success: true, data: customer });
  },
};
