import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { qualityRepository, type QualityResult } from '../repositories/quality.repository.js';

export const qualityController = {
  async listTemplates(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await qualityRepository.listTemplates(req.user!.storeId ?? null) });
  },
  async createTemplate(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    if (!b.name) { res.status(400).json({ success: false, error: { message: 'Nom requis' } }); return; }
    res.status(201).json({ success: true, data: await qualityRepository.createTemplate({
      name: String(b.name), appliesTo: String(b.appliesTo ?? 'general'), items: b.items,
      storeId: req.user!.storeId ?? null, userId: req.user!.userId,
    }) });
  },
  async updateTemplate(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    const t = await qualityRepository.updateTemplate(req.params.id, {
      name: b.name !== undefined ? String(b.name) : undefined,
      appliesTo: b.appliesTo !== undefined ? String(b.appliesTo) : undefined,
      items: b.items,
    });
    if (!t) { res.status(404).json({ success: false, error: { message: 'Modèle introuvable' } }); return; }
    res.json({ success: true, data: t });
  },
  async setTemplateActive(req: AuthRequest, res: Response) {
    const active = Boolean((req.body as Record<string, unknown>).active);
    const t = await qualityRepository.setTemplateActive(req.params.id, active);
    if (!t) { res.status(404).json({ success: false, error: { message: 'Modèle introuvable' } }); return; }
    res.json({ success: true, data: t });
  },
  async listInspections(req: AuthRequest, res: Response) {
    const conf = req.query.conformity;
    res.json({ success: true, data: await qualityRepository.listInspections({
      storeId: req.user!.storeId ?? null,
      conformity: conf === 'true' ? true : conf === 'false' ? false : undefined,
      limit: Math.min(Number(req.query.limit) || 100, 300),
    }) });
  },
  async getInspection(req: AuthRequest, res: Response) {
    const d = await qualityRepository.getInspection(req.params.id);
    if (!d) { res.status(404).json({ success: false, error: { message: 'Inspection introuvable' } }); return; }
    res.json({ success: true, data: d });
  },
  async createInspection(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    if (!b.title || !Array.isArray(b.results)) { res.status(400).json({ success: false, error: { message: 'Titre et résultats requis' } }); return; }
    res.status(201).json({ success: true, data: await qualityRepository.createInspection({
      templateId: b.templateId ? String(b.templateId) : null,
      title: String(b.title), referenceNote: b.referenceNote ? String(b.referenceNote) : null,
      inspectedOn: b.inspectedOn ? String(b.inspectedOn) : null,
      results: b.results as QualityResult[], notes: b.notes ? String(b.notes) : null,
      storeId: req.user!.storeId ?? null, userId: req.user!.userId,
    }) });
  },
};
