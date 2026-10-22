import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { authEventRepository } from '../repositories/auth-event.repository.js';
import { IMPORT_ENTITIES, entityByKey, buildTemplate, previewImport, commitImport } from '../services/data-import.js';
import { exportConfiguration, exportBaseData, dataStatus } from '../services/data-export.js';

/** Paramètres › Données : import guidé, exports, état de la base (lot 7). */
const stamp = () => new Date().toISOString().slice(0, 10);
const bad = (res: Response, message: string, status = 400) => res.status(status).json({ success: false, error: { message } });

export const dataController = {
  async status(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: { ...(await dataStatus()), entities: IMPORT_ENTITIES.map(e => ({ key: e.key, label: e.label })) } });
  },

  async template(req: AuthRequest, res: Response) {
    const def = entityByKey(req.params.entity);
    if (!def) { bad(res, 'Type de données inconnu', 404); return; }
    const buf = await buildTemplate(def);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="modele-import-${def.key}.xlsx"`);
    res.send(buf);
  },

  async preview(req: AuthRequest, res: Response) {
    const def = entityByKey(req.params.entity);
    if (!def) { bad(res, 'Type de données inconnu', 404); return; }
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file;
    if (!file) { bad(res, 'Fichier Excel ou CSV requis'); return; }
    try {
      const p = await previewImport(def, file.buffer);
      const by = (a: string) => p.rows.filter(r => r.action === a).length;
      res.json({ success: true, data: { ...p, summary: { create: by('create'), update: by('update'), error: by('error'), skip: by('skip') } } });
    } catch {
      bad(res, 'Fichier illisible : enregistrez-le au format Excel (.xlsx) ou CSV');
    }
  },

  async commit(req: AuthRequest, res: Response) {
    const def = entityByKey(req.params.entity);
    if (!def) { bad(res, 'Type de données inconnu', 404); return; }
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file;
    if (!file) { bad(res, 'Fichier Excel ou CSV requis'); return; }
    const r = await commitImport(def, file.buffer, req.user?.userId);
    if (!r.ok) { bad(res, `${r.errors} ligne(s) en erreur : corrigez le fichier, rien n'a été importé`, 409); return; }
    await authEventRepository.recordFromRequest(req, {
      eventType: 'data_import', userId: req.user?.userId, success: true,
      details: { entity: def.key, file: file.originalname, created: r.created, updated: r.updated },
    });
    res.json({ success: true, data: r });
  },

  async exportConfiguration(req: AuthRequest, res: Response) {
    const data = await exportConfiguration();
    await authEventRepository.recordFromRequest(req, { eventType: 'config_export', userId: req.user?.userId, success: true });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="kalum-configuration-${stamp()}.json"`);
    res.send(JSON.stringify(data, null, 2));
  },

  async exportData(req: AuthRequest, res: Response) {
    const { buffer, counts } = await exportBaseData();
    await authEventRepository.recordFromRequest(req, { eventType: 'data_export', userId: req.user?.userId, success: true, details: { counts } });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="kalum-donnees-${stamp()}.xlsx"`);
    res.send(buffer);
  },
};
