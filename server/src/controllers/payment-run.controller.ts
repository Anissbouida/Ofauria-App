import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { paymentRunRepository } from '../repositories/payment-run.repository.js';
import { generateTransferOrderPdf } from '../services/hr-documents-pdf.service.js';
import { loadCompanyLegal } from '../utils/company-legal.js';

/** Paiements fournisseurs en lot (G4-01). La logique est dans le dépôt de données. */
const today = () => new Date().toISOString().slice(0, 10);
const isDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

export const paymentRunController = {
  async candidates(req: AuthRequest, res: Response) {
    const dueBefore = isDate(req.query.dueBefore) ? req.query.dueBefore : today();
    res.json({ success: true, data: await paymentRunRepository.candidates({ dueBefore, storeId: req.user!.storeId ?? null }) });
  },
  async list(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await paymentRunRepository.list() });
  },
  async get(req: AuthRequest, res: Response) {
    const run = await paymentRunRepository.get(req.params.id as string);
    if (!run) { res.status(404).json({ success: false, error: { message: 'Campagne introuvable' } }); return; }
    res.json({ success: true, data: run });
  },
  async create(req: AuthRequest, res: Response) {
    const b = req.body as { paymentDate: string; treasuryAccountId: string; lines: { invoiceId: string; amount: number }[]; notes?: string | null };
    const id = await paymentRunRepository.create({ ...b, userId: req.user!.userId, storeId: req.user!.storeId ?? null });
    res.status(201).json({ success: true, data: await paymentRunRepository.get(id) });
  },
  async submit(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await paymentRunRepository.submit(req.params.id as string, req.user!.userId) });
  },
  async transferFile(req: AuthRequest, res: Response) {
    const { filename, csv } = await paymentRunRepository.transferFile(req.params.id as string);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  },
  /** Lettre d'ordre au banquier (PDF), reprise de l'ordre de virement des salaires. */
  async orderLetter(req: AuthRequest, res: Response) {
    const d = await paymentRunRepository.orderLetter(req.params.id as string);
    if (!d.employerRib) {
      res.status(400).json({ success: false, error: { message: 'Renseignez le RIB (IBAN) du compte de trésorerie de la campagne avant d\'éditer la lettre d\'ordre.' } });
      return;
    }
    const legal = await loadCompanyLegal();
    const day = String(d.run.payment_date).split('-').reverse().join('/');
    const buffer = await generateTransferOrderPdf({
      company: { ...legal, cnss: null }, employerRib: d.employerRib, employerBank: d.employerBank,
      periodLabel: day, purpose: `des factures fournisseurs, campagne ${d.run.run_number} du ${day}`,
      lines: d.lines, total: d.total, place: legal.city ?? null, issuedOn: new Date().toLocaleDateString('fr-FR'),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ordre_virement_${String(d.run.run_number).replace(/[^\w.-]/g, '_')}.pdf"`);
    res.send(buffer);
  },
  async execute(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await paymentRunRepository.execute(req.params.id as string, { userId: req.user!.userId, storeId: req.user!.storeId ?? null }) });
  },
  async rejectLine(req: AuthRequest, res: Response) {
    const b = req.body as { reasonCodeId: string; note?: string | null };
    res.json({ success: true, data: await paymentRunRepository.rejectLine(req.params.lineId as string, { ...b, userId: req.user!.userId }) });
  },
  async cancel(req: AuthRequest, res: Response) {
    await paymentRunRepository.cancel(req.params.id as string, req.user!.userId);
    res.json({ success: true, data: await paymentRunRepository.get(req.params.id as string) });
  },
};
