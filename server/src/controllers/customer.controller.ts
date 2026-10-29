import type { Response } from 'express';
import { receivablesRepository } from '../repositories/receivables.repository.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { customerRepository } from '../repositories/customer.repository.js';

export const customerController = {
  async list(req: AuthRequest, res: Response) {
    const { search, customerType, page = '1', limit = '20' } = req.query as Record<string, string>;
    const p = parseInt(page); const l = parseInt(limit);
    const validType = ['particulier', 'professionnel', 'association', 'revendeur'].includes(customerType) ? customerType : undefined;
    const result = await customerRepository.findAll({ search, customerType: validType, limit: l, offset: (p - 1) * l });
    res.json({ success: true, data: result.rows, total: result.total, page: p, limit: l, totalPages: Math.ceil(result.total / l) });
  },
  async getById(req: AuthRequest, res: Response) {
    const customer = await customerRepository.findById(req.params.id);
    if (!customer) { res.status(404).json({ success: false, error: { message: 'Client non trouvé' } }); return; }
    res.json({ success: true, data: customer });
  },
  async stats(req: AuthRequest, res: Response) {
    const customer = await customerRepository.findById(req.params.id);
    if (!customer) { res.status(404).json({ success: false, error: { message: 'Client non trouvé' } }); return; }
    const stats = await customerRepository.stats(req.params.id);
    res.json({ success: true, data: { customer, ...stats } });
  },
  async globalStats(_req: AuthRequest, res: Response) {
    const stats = await customerRepository.globalStats();
    res.json({ success: true, data: stats });
  },
  async create(req: AuthRequest, res: Response) {
    const customer = await customerRepository.create(req.body);
    res.status(201).json({ success: true, data: customer });
  },
  async update(req: AuthRequest, res: Response) {
    const customer = await customerRepository.update(req.params.id, req.body);
    res.json({ success: true, data: customer });
  },
  /** Situation du client : dû, échu, plafond de crédit, disponible (mig 351). */
  async situation(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await receivablesRepository.customerSituation(req.params.id) });
  },
  /**
   * Relevé de compte du client sur une période (factures + règlements, solde
   * glissant). ?from=YYYY-MM-DD&to=YYYY-MM-DD — défaut : année civile en cours.
   */
  async statement(req: AuthRequest, res: Response) {
    const today = new Date();
    const y = today.getFullYear();
    const from = (req.query.from as string) || `${y}-01-01`;
    const to = (req.query.to as string) || `${y}-12-31`;
    const data = await receivablesRepository.customerStatement(req.params.id, from, to);
    if (!data) { res.status(404).json({ success: false, error: { message: 'Client introuvable' } }); return; }
    res.json({ success: true, data });
  },
  async remove(req: AuthRequest, res: Response) {
    await customerRepository.delete(req.params.id);
    res.json({ success: true, data: null });
  },
};
