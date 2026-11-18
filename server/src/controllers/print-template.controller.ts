import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { printTemplateRepository, isPrintDoc, checkLayout } from '../repositories/print-template.repository.js';

/** Gabarits d'impression du module de fabrication (M8-04, mig 582). */
const bad = (res: Response, message: string, status = 400) => res.status(status).json({ success: false, error: { message } });

export const printTemplateController = {
  /** Gabarits résolus pour un type d'ordre (?orderTypeId=…), lus par les écrans d'impression. */
  async resolved(req: AuthRequest, res: Response) {
    const ot = typeof req.query.orderTypeId === 'string' && /^[0-9a-f-]{36}$/i.test(req.query.orderTypeId) ? req.query.orderTypeId : null;
    res.json({ success: true, data: await printTemplateRepository.resolveAll(ot) });
  },
  async settings(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await printTemplateRepository.listForSettings() });
  },
  async updateBase(req: AuthRequest, res: Response) {
    const d = req.params.docType as string;
    if (!isPrintDoc(d)) { bad(res, 'Document inconnu', 404); return; }
    const err = checkLayout(d, { columns: req.body.columns ?? undefined, signatures: req.body.signatures ?? undefined });
    if (err) { bad(res, err); return; }
    const row = await printTemplateRepository.updateBase(d, req.body, req.user!.userId);
    if (!row) { bad(res, 'Modèle absent : migration 582 non appliquée', 409); return; }
    res.json({ success: true, data: row });
  },
  async upsertVariant(req: AuthRequest, res: Response) {
    const d = req.params.docType as string;
    if (!isPrintDoc(d)) { bad(res, 'Document inconnu', 404); return; }
    const err = checkLayout(d, { columns: req.body.columns ?? undefined, signatures: req.body.signatures ?? undefined });
    if (err) { bad(res, err); return; }
    res.json({ success: true, data: await printTemplateRepository.upsertVariant(d, req.params.orderTypeId as string, req.body, req.user!.userId) });
  },
  async deleteVariant(req: AuthRequest, res: Response) {
    const d = req.params.docType as string;
    if (!isPrintDoc(d)) { bad(res, 'Document inconnu', 404); return; }
    const ok = await printTemplateRepository.deleteVariant(d, req.params.orderTypeId as string);
    if (!ok) { bad(res, 'Aucune variante pour ce type d\'ordre', 404); return; }
    res.json({ success: true, data: { deleted: true } });
  },
};
