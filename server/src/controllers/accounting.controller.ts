import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { caisseRepository, supplierRepository, expenseCategoryRepository, invoiceRepository, paymentRepository } from '../repositories/accounting.repository.js';

export const caisseController = {
  async register(req: AuthRequest, res: Response) {
    const year = parseInt(req.query.year as string);
    const month = parseInt(req.query.month as string);
    if (!year || !month) { res.status(400).json({ success: false, error: { message: 'year et month requis' } }); return; }
    const data = await caisseRepository.getRegister(year, month);
    res.json({ success: true, data });
  },
};

export const supplierController = {
  async list(_req: AuthRequest, res: Response) {
    const suppliers = await supplierRepository.findAll();
    res.json({ success: true, data: suppliers });
  },
  async getById(req: AuthRequest, res: Response) {
    const supplier = await supplierRepository.findById(req.params.id);
    if (!supplier) { res.status(404).json({ success: false, error: { message: 'Fournisseur non trouve' } }); return; }
    res.json({ success: true, data: supplier });
  },
  async create(req: AuthRequest, res: Response) {
    const supplier = await supplierRepository.create(req.body);
    res.status(201).json({ success: true, data: supplier });
  },
  async update(req: AuthRequest, res: Response) {
    const supplier = await supplierRepository.update(req.params.id, req.body);
    res.json({ success: true, data: supplier });
  },
  async remove(req: AuthRequest, res: Response) {
    await supplierRepository.delete(req.params.id);
    res.json({ success: true, data: null });
  },
};

export const expenseCategoryController = {
  async list(_req: AuthRequest, res: Response) {
    const categories = await expenseCategoryRepository.findAll();
    res.json({ success: true, data: categories });
  },
  async create(req: AuthRequest, res: Response) {
    const category = await expenseCategoryRepository.create(req.body);
    res.status(201).json({ success: true, data: category });
  },
  async update(req: AuthRequest, res: Response) {
    const category = await expenseCategoryRepository.update(req.params.id, req.body);
    res.json({ success: true, data: category });
  },
  async remove(req: AuthRequest, res: Response) {
    await expenseCategoryRepository.delete(req.params.id);
    res.json({ success: true, data: null });
  },
};

export const invoiceController = {
  async list(req: AuthRequest, res: Response) {
    const { supplierId, status, dateFrom, dateTo } = req.query as Record<string, string>;
    const invoices = await invoiceRepository.findAll({ supplierId, status, dateFrom, dateTo });
    res.json({ success: true, data: invoices });
  },
  async getById(req: AuthRequest, res: Response) {
    const invoice = await invoiceRepository.findById(req.params.id);
    if (!invoice) { res.status(404).json({ success: false, error: { message: 'Facture non trouvee' } }); return; }
    res.json({ success: true, data: invoice });
  },
  async create(req: AuthRequest, res: Response) {
    const data = { ...req.body, createdBy: req.user!.userId };
    if (!data.totalAmount) data.totalAmount = (parseFloat(data.amount) || 0) + (parseFloat(data.taxAmount) || 0);
    const invoice = await invoiceRepository.create(data);
    res.status(201).json({ success: true, data: invoice });
  },
  async cancel(req: AuthRequest, res: Response) {
    const invoice = await invoiceRepository.updateStatus(req.params.id, 'cancelled');
    res.json({ success: true, data: invoice });
  },
};

export const paymentController = {
  async list(req: AuthRequest, res: Response) {
    const { type, dateFrom, dateTo, supplierId } = req.query as Record<string, string>;
    const payments = await paymentRepository.findAll({ type, dateFrom, dateTo, supplierId });
    res.json({ success: true, data: payments });
  },
  async create(req: AuthRequest, res: Response) {
    const data = { ...req.body, createdBy: req.user!.userId };
    const payment = await paymentRepository.create(data);
    res.status(201).json({ success: true, data: payment });
  },
  async remove(req: AuthRequest, res: Response) {
    await paymentRepository.delete(req.params.id);
    res.json({ success: true, data: null });
  },
  async summary(req: AuthRequest, res: Response) {
    const { dateFrom, dateTo } = req.query as Record<string, string>;
    if (!dateFrom || !dateTo) { res.status(400).json({ success: false, error: { message: 'dateFrom et dateTo requis' } }); return; }
    const summary = await paymentRepository.summary({ dateFrom, dateTo });
    const byCategory = await paymentRepository.summaryByCategory({ dateFrom, dateTo });
    res.json({ success: true, data: { summary, byCategory } });
  },
};
