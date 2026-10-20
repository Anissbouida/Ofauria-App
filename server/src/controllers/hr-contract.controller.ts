import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { db } from '../config/database.js';
import { checkStoreOwnership } from '../middleware/tenant.middleware.js';
import { contractRepository, employeeDocumentRepository, hrAlerts } from '../repositories/contract.repository.js';
import { hrAnalytics } from '../repositories/hr-analytics.repository.js';

/** Contrats, avenants, documents et alertes RH (lot 4, mig 322). */

async function inScope(employeeId: string, userStoreId?: string) {
  const r = await db.query('SELECT id, store_id FROM employees WHERE id = $1', [employeeId]);
  const row = r.rows[0];
  if (!row) return null;
  if (row.store_id !== null && !checkStoreOwnership(row.store_id, userStoreId)) return null;
  return row;
}
const notFound = (res: Response) => res.status(404).json({ success: false, error: { message: 'Employe non trouve' } });
const fail = (res: Response, err: unknown) => {
  const status = (err as { statusCode?: number }).statusCode
    ?? ((err as { code?: string }).code === '23505' ? 409 : (err as { code?: string }).code === '23514' ? 400 : 500);
  if (status === 500) throw err;
  res.status(status).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
};

export const hrContractController = {
  async list(req: AuthRequest, res: Response) {
    if (!(await inScope(req.params.employeeId, req.user!.storeId))) return notFound(res);
    res.json({ success: true, data: await contractRepository.list(req.params.employeeId) });
  },
  async create(req: AuthRequest, res: Response) {
    if (!(await inScope(req.params.employeeId, req.user!.storeId))) return notFound(res);
    try { res.status(201).json({ success: true, data: await contractRepository.create(req.params.employeeId, req.body, req.user!.userId) }); }
    catch (err) { fail(res, err); }
  },
  async avenant(req: AuthRequest, res: Response) {
    if (!(await inScope(req.params.employeeId, req.user!.storeId))) return notFound(res);
    const { effectiveDate, ...changes } = req.body;
    try { res.status(201).json({ success: true, data: await contractRepository.addAvenant(req.params.employeeId, effectiveDate, changes, req.user!.userId) }); }
    catch (err) { fail(res, err); }
  },
  async renew(req: AuthRequest, res: Response) {
    if (!(await inScope(req.params.employeeId, req.user!.storeId))) return notFound(res);
    try {
      const out = await contractRepository.renew(req.params.employeeId, req.body.endDate, req.body.notes ?? null, req.user!.userId);
      res.status(201).json({ success: true, data: out.contract, warnings: out.warnings });
    } catch (err) { fail(res, err); }
  },
  async renewTrial(req: AuthRequest, res: Response) {
    if (!(await inScope(req.params.employeeId, req.user!.storeId))) return notFound(res);
    try { res.json({ success: true, data: await contractRepository.renewTrial(req.params.employeeId) }); }
    catch (err) {
      if (err instanceof Error && /qu'une fois/.test(err.message)) { res.status(409).json({ success: false, error: { message: err.message } }); return; }
      fail(res, err);
    }
  },
  async end(req: AuthRequest, res: Response) {
    if (!(await inScope(req.params.employeeId, req.user!.storeId))) return notFound(res);
    try { res.json({ success: true, data: await contractRepository.end(req.params.employeeId, req.body.endDate, req.body.reason, req.user!.userId) }); }
    catch (err) { fail(res, err); }
  },

  // ─── Documents ───
  async documents(req: AuthRequest, res: Response) {
    if (!(await inScope(req.params.employeeId, req.user!.storeId))) return notFound(res);
    res.json({ success: true, data: await employeeDocumentRepository.list(req.params.employeeId) });
  },
  async upload(req: AuthRequest, res: Response) {
    if (!(await inScope(req.params.employeeId, req.user!.storeId))) return notFound(res);
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file;
    if (!file) { res.status(400).json({ success: false, error: { message: 'Fichier requis (PDF, PNG, JPG ou WebP, 5 Mo max)' } }); return; }
    const { docType, title, expiresOn, contractId } = req.body as Record<string, string>;
    const allowed = ['cin', 'contrat', 'avenant', 'cnss', 'diplome', 'certificat_medical', 'visite_medicale', 'rib', 'attestation', 'photo', 'autre'];
    if (!allowed.includes(docType)) { res.status(400).json({ success: false, error: { message: 'Type de document invalide' } }); return; }
    if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) { res.status(400).json({ success: false, error: { message: 'Échéance YYYY-MM-DD' } }); return; }
    try {
      const row = await employeeDocumentRepository.create({
        employeeId: req.params.employeeId, contractId: contractId || null, docType,
        title: (title || file.originalname).slice(0, 150), expiresOn: expiresOn || null,
        fileName: file.originalname, mimeType: file.mimetype, content: file.buffer,
      }, req.user!.userId);
      res.status(201).json({ success: true, data: row });
    } catch (err) { fail(res, err); }
  },
  async download(req: AuthRequest, res: Response) {
    const doc = await employeeDocumentRepository.findWithContent(req.params.docId);
    if (!doc || !(await inScope(doc.employee_id, req.user!.storeId))) { res.status(404).json({ success: false, error: { message: 'Document introuvable' } }); return; }
    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Content-Disposition', `${req.query.inline === 'true' ? 'inline' : 'attachment'}; filename="${String(doc.file_name).replace(/[^\w.\- ]/g, '_')}"`);
    res.setHeader('Content-Length', doc.size_bytes);
    // Donnees personnelles (loi 09-08) : pas de cache navigateur partage.
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(doc.content);
  },
  async removeDocument(req: AuthRequest, res: Response) {
    const doc = await employeeDocumentRepository.findWithContent(req.params.docId);
    if (!doc || !(await inScope(doc.employee_id, req.user!.storeId))) { res.status(404).json({ success: false, error: { message: 'Document introuvable' } }); return; }
    await employeeDocumentRepository.remove(req.params.docId);
    res.json({ success: true, data: null });
  },

  // ─── Pilotage RH (lot 7) ───
  async analytics(req: AuthRequest, res: Response) {
    const year = parseInt(String(req.query.year ?? new Date().getFullYear()), 10);
    if (!(year >= 2000 && year <= 2100)) { res.status(400).json({ success: false, error: { message: 'Année invalide' } }); return; }
    res.json({ success: true, data: await hrAnalytics(year, req.user!.storeId) });
  },

  // ─── Alertes ───
  async alerts(req: AuthRequest, res: Response) {
    const days = Math.min(180, Math.max(1, parseInt(String(req.query.days ?? '30'), 10) || 30));
    res.json({ success: true, data: await hrAlerts(req.user!.storeId, days) });
  },
};
