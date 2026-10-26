import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { deliveryNoteRepository } from '../repositories/delivery-note.repository.js';
import { generateDeliveryNotePdf } from '../services/delivery-note-pdf.service.js';

/** Ventes aux professionnels (mig 352) : bons de livraison clients et facturation groupée. */
export const deliveryNoteController = {
  async list(req: AuthRequest, res: Response) {
    const q = req.query as Record<string, string | undefined>;
    res.json({ success: true, data: await deliveryNoteRepository.list({
      storeId: req.user!.storeId, status: q.status, customerId: q.customerId, dateFrom: q.dateFrom, dateTo: q.dateTo,
    }) });
  },
  async getById(req: AuthRequest, res: Response) {
    const note = await deliveryNoteRepository.findById(req.params.id);
    if (!note) { res.status(404).json({ success: false, error: { message: 'Bon de livraison introuvable' } }); return; }
    res.json({ success: true, data: note });
  },
  /** Bon de livraison imprimable (mig 354) : remis avec la marchandise, signé par le client. */
  async pdf(req: AuthRequest, res: Response) {
    const note = await deliveryNoteRepository.findById(req.params.id);
    if (!note) { res.status(404).json({ success: false, error: { message: 'Bon de livraison introuvable' } }); return; }
    const buffer = await generateDeliveryNotePdf(note);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${String(note.number).replace(/[/\\"]/g, '-')}.pdf"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  },
  async lineDefaults(req: AuthRequest, res: Response) {
    const q = req.query as Record<string, string | undefined>;
    const ids = (q.productIds ?? '').split(',').filter(Boolean);
    res.json({ success: true, data: await deliveryNoteRepository.lineDefaults(q.customerId ?? null, ids) });
  },
  async eligibleOrders(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await deliveryNoteRepository.eligibleOrders(req.params.customerId) });
  },
  async orderLines(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await deliveryNoteRepository.orderLines(req.params.orderId) });
  },
  async create(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, any>;
    const note = await deliveryNoteRepository.create({
      customerId: b.customerId, deliveryDate: b.deliveryDate ?? null, orderId: b.orderId ?? null, notes: b.notes ?? null,
      items: Array.isArray(b.items) ? b.items.map((i: Record<string, any>) => ({
        productId: i.productId ?? null, description: i.description ?? null,
        quantity: Number(i.quantity), unitPrice: Number(i.unitPrice),
        tvaRate: i.tvaRate === null || i.tvaRate === undefined || i.tvaRate === '' ? null : Number(i.tvaRate),
      })) : [],
      createdBy: req.user!.userId, storeId: req.user!.storeId ?? null, receivedByName: b.receivedByName ?? null,
    });
    res.status(201).json({ success: true, data: note });
  },
  async createFromOrder(req: AuthRequest, res: Response) {
    const b = (req.body ?? {}) as { quantities?: Record<string, number>; receivedByName?: string; deliveryDate?: string; notes?: string };
    const note = await deliveryNoteRepository.createFromOrder(req.params.orderId, req.user!.userId, req.user!.storeId ?? null, {
      quantities: b.quantities && typeof b.quantities === 'object' ? b.quantities : undefined,
      receivedByName: b.receivedByName ?? null, deliveryDate: b.deliveryDate ?? null, notes: b.notes ?? null,
    });
    res.status(201).json({ success: true, data: note });
  },
  async cancel(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await deliveryNoteRepository.cancel(req.params.id, req.user!.userId) });
  },
  async toInvoice(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await deliveryNoteRepository.toInvoice({ storeId: req.user!.storeId, until: (req.query.until as string) || undefined }) });
  },
  async invoice(req: AuthRequest, res: Response) {
    const b = req.body as { deliveryNoteIds?: string[]; invoiceDate?: string };
    const invoice = await deliveryNoteRepository.invoice({
      deliveryNoteIds: Array.isArray(b.deliveryNoteIds) ? b.deliveryNoteIds : [], invoiceDate: b.invoiceDate ?? null,
      createdBy: req.user!.userId, storeId: req.user!.storeId ?? null,
    });
    res.status(201).json({ success: true, data: invoice });
  },
};
