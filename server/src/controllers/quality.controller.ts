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
    const q = req.query as Record<string, string | undefined>;
    const uuidOrUndef = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
    res.json({ success: true, data: await qualityRepository.listInspections({
      storeId: req.user!.storeId ?? null,
      conformity: conf === 'true' ? true : conf === 'false' ? false : undefined,
      limit: Math.min(Number(req.query.limit) || 100, 300),
      // M7-01 : filtres de rattachement.
      planId: uuidOrUndef(q.planId), productLotId: uuidOrUndef(q.productLotId), ingredientLotId: uuidOrUndef(q.ingredientLotId),
      receptionVoucherId: uuidOrUndef(q.receptionVoucherId), etapeId: uuidOrUndef(q.etapeId),
      status: q.status === 'a_faire' || q.status === 'faite' ? q.status : undefined,
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
      // M7-01 : rattachements ; M7-02 : réalisation d'une inspection à faire.
      planId: (b.planId as string) || null, planItemId: (b.planItemId as string) || null, etapeId: (b.etapeId as string) || null,
      ingredientLotId: (b.ingredientLotId as string) || null, productLotId: (b.productLotId as string) || null,
      receptionVoucherId: (b.receptionVoucherId as string) || null, pendingId: (b.pendingId as string) || null,
    }) });
  },

  /* ── Non-conformités (mig 385) ── */
  async listNonConformities(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await qualityRepository.listNonConformities({
      storeId: req.user!.storeId ?? null,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      limit: Math.min(Number(req.query.limit) || 200, 500),
    }) });
  },
  async createNonConformity(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    if (!b.title) { res.status(400).json({ success: false, error: { message: 'Titre requis' } }); return; }
    res.status(201).json({ success: true, data: await qualityRepository.createNonConformity({
      title: String(b.title), source: b.source ? String(b.source) : undefined,
      referenceNote: b.referenceNote ? String(b.referenceNote) : null, description: b.description ? String(b.description) : null,
      severity: b.severity ? String(b.severity) : undefined, correctiveAction: b.correctiveAction ? String(b.correctiveAction) : null,
      responsibleId: b.responsibleId ? String(b.responsibleId) : null, dueDate: b.dueDate ? String(b.dueDate) : null,
      detectedOn: b.detectedOn ? String(b.detectedOn) : null, storeId: req.user!.storeId ?? null, userId: req.user!.userId,
    }) });
  },
  async updateNonConformity(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    const nc = await qualityRepository.updateNonConformity(req.params.id, {
      title: b.title !== undefined ? String(b.title) : undefined,
      severity: b.severity !== undefined ? String(b.severity) : undefined,
      correctiveAction: b.correctiveAction !== undefined ? (b.correctiveAction ? String(b.correctiveAction) : null) : undefined,
      responsibleId: b.responsibleId !== undefined ? (b.responsibleId ? String(b.responsibleId) : null) : undefined,
      dueDate: b.dueDate !== undefined ? (b.dueDate ? String(b.dueDate) : null) : undefined,
      description: b.description !== undefined ? (b.description ? String(b.description) : null) : undefined,
      status: b.status !== undefined ? String(b.status) : undefined,
    });
    if (!nc) { res.status(404).json({ success: false, error: { message: 'Non-conformité introuvable' } }); return; }
    res.json({ success: true, data: nc });
  },
  /** Utilisateurs pour l'affectation (responsable). */
  async users(_req: AuthRequest, res: Response) {
    const { db } = await import('../config/database.js');
    const r = await db.query(`SELECT id, first_name || ' ' || last_name AS name FROM users WHERE is_active IS NOT FALSE ORDER BY first_name, last_name`);
    res.json({ success: true, data: r.rows });
  },
};
