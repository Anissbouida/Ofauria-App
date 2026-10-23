import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { supplierRepository } from '../repositories/supplier.repository.js';

/**
 * Fournisseurs (refonte Achats D1, lot 1). Toutes les méthodes sont enveloppées
 * par asyncHandler côté routes : une erreur (y compris 409/400 traduites par le
 * dépôt) remonte au gestionnaire d'erreurs central.
 */
export const supplierController = {
  /** Écran Fournisseurs : liste paginée par situation (actifs) ou inactifs (historique). */
  async board(req: AuthRequest, res: Response) {
    const q = req.query as Record<string, string>;
    const STAGES = ['incomplete', 'ordering', 'due', 'ok', 'inactive'];
    const FLAGS = ['missing_id', 'open_po', 'late_po', 'due', 'overdue', 'never_ordered', 'dormant'];
    const isDate = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
    const pageSize = Math.min(Math.max(parseInt(q.pageSize || '25', 10) || 25, 1), 100);
    const page = Math.max(parseInt(q.page || '1', 10) || 1, 1);
    // Activité : même périmètre que les BC (admin = tous les magasins).
    const storeId = req.user!.role === 'admin' ? undefined : req.user!.storeId;
    const data = await supplierRepository.findBoard({
      storeId,
      view: q.view === 'history' ? 'history' : 'open',
      stage: STAGES.includes(q.stage) ? q.stage : undefined,
      flag: FLAGS.includes(q.flag) ? q.flag : undefined,
      city: q.city?.trim() || undefined,
      search: q.search?.trim() || undefined,
      activeFrom: isDate(q.dateFrom),
      activeTo: isDate(q.dateTo),
      sort: q.sort || 'urgency',
      dir: q.dir === 'asc' ? 'asc' : 'desc',
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    res.json({ success: true, data: { ...data, page, pageSize } });
  },

  async boardSummary(req: AuthRequest, res: Response) {
    const storeId = req.user!.role === 'admin' ? undefined : req.user!.storeId;
    res.json({ success: true, data: await supplierRepository.boardSummary(storeId) });
  },

  async list(req: AuthRequest, res: Response) {
    const activeOnly = req.query.active === 'true';
    const suppliers = await supplierRepository.findAll({ activeOnly });
    res.json({ success: true, data: suppliers });
  },

  async getById(req: AuthRequest, res: Response) {
    const supplier = await supplierRepository.findById(req.params.id);
    if (!supplier) { res.status(404).json({ success: false, error: { message: 'Fournisseur non trouvé' } }); return; }
    res.json({ success: true, data: supplier });
  },

  /** GET /suppliers/check?name=…&typeCode=MA_ICE&value=…&excludeId=… : doublons probables. */
  async check(req: AuthRequest, res: Response) {
    const q = req.query as Record<string, string | undefined>;
    const matches = await supplierRepository.findDuplicates({
      name: q.name, typeCode: q.typeCode, value: q.value, excludeId: q.excludeId,
    });
    res.json({ success: true, data: matches });
  },

  async identifierTypes(req: AuthRequest, res: Response) {
    const country = typeof req.query.country === 'string' ? req.query.country.toUpperCase() : undefined;
    res.json({ success: true, data: await supplierRepository.identifierTypes(country) });
  },

  async history(req: AuthRequest, res: Response) {
    const supplier = await supplierRepository.findById(req.params.id);
    if (!supplier) { res.status(404).json({ success: false, error: { message: 'Fournisseur non trouvé' } }); return; }
    res.json({ success: true, data: await supplierRepository.history(req.params.id) });
  },

  async create(req: AuthRequest, res: Response) {
    const supplier = await supplierRepository.create(req.body, req.user?.userId ?? null);
    res.status(201).json({ success: true, data: supplier });
  },

  async update(req: AuthRequest, res: Response) {
    const supplier = await supplierRepository.update(req.params.id, req.body, req.user?.userId ?? null);
    if (!supplier) { res.status(404).json({ success: false, error: { message: 'Fournisseur non trouvé' } }); return; }
    res.json({ success: true, data: supplier });
  },

  async remove(req: AuthRequest, res: Response) {
    await supplierRepository.deactivate(req.params.id, req.user?.userId ?? null);
    res.json({ success: true, data: null });
  },
};
