import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import {
  refTableRepository,
  refEntryRepository,
  nativeAdapters,
  refAuditRepository,
  refDashboardRepository,
} from '../repositories/referentiel.repository.js';

/* ═══ Dashboard ═══ */
export const refDashboardController = {
  async stats(_req: AuthRequest, res: Response) {
    const data = await refDashboardRepository.getStats();
    res.json({ success: true, data });
  },
};

/* ═══ Ref Tables (registry) ═══ */
export const refTableController = {
  async list(_req: AuthRequest, res: Response) {
    const tables = await refTableRepository.findAll();
    res.json({ success: true, data: tables });
  },
};

/* ═══ Generic CRUD for any parameterized table ═══ */
export const refEntryController = {
  /** GET /params/:tableName — list entries */
  async list(req: AuthRequest, res: Response) {
    const tableName = req.params.tableName as string;
    const includeInactive = req.query.includeInactive === 'true';

    const table = await refTableRepository.findById(tableName);
    if (!table) {
      res.status(404).json({ success: false, error: { message: `Table "${tableName}" non trouvee` } });
      return;
    }

    let entries;
    if (table.source === 'native' && nativeAdapters[tableName]) {
      entries = await nativeAdapters[tableName].findAll(includeInactive);
    } else {
      entries = await refEntryRepository.findAll(tableName, includeInactive);
    }

    res.json({ success: true, data: { table, entries } });
  },

  /** POST /params/:tableName — create entry */
  async create(req: AuthRequest, res: Response) {
    const tableName = req.params.tableName as string;
    const table = await refTableRepository.findById(tableName);
    if (!table) {
      res.status(404).json({ success: false, error: { message: `Table "${tableName}" non trouvee` } });
      return;
    }
    if (!table.editable) {
      res.status(403).json({ success: false, error: { message: 'Cette table n\'est pas modifiable' } });
      return;
    }

    let entry;
    if (table.source === 'native' && nativeAdapters[tableName]) {
      entry = await nativeAdapters[tableName].create(req.body);
    } else {
      entry = await refEntryRepository.create(tableName, req.body);
    }

    // Audit
    await refAuditRepository.log(tableName, String(entry.id), 'create', { after: entry }, req.user?.userId);

    res.status(201).json({ success: true, data: entry });
  },

  /** PUT /params/:tableName/:id — update entry */
  async update(req: AuthRequest, res: Response) {
    const tableName = req.params.tableName as string;
    const id = req.params.id as string;
    const table = await refTableRepository.findById(tableName);
    if (!table) {
      res.status(404).json({ success: false, error: { message: `Table "${tableName}" non trouvee` } });
      return;
    }
    if (!table.editable) {
      res.status(403).json({ success: false, error: { message: 'Cette table n\'est pas modifiable' } });
      return;
    }

    let entry;
    if (table.source === 'native' && nativeAdapters[tableName]) {
      entry = await nativeAdapters[tableName].update(id, req.body);
    } else {
      entry = await refEntryRepository.update(tableName, id, req.body);
    }

    await refAuditRepository.log(tableName, id, 'update', { after: entry }, req.user?.userId);

    res.json({ success: true, data: entry });
  },

  /** DELETE /params/:tableName/:id — soft delete / deactivate */
  async remove(req: AuthRequest, res: Response) {
    const tableName = req.params.tableName as string;
    const id = req.params.id as string;
    const table = await refTableRepository.findById(tableName);
    if (!table) {
      res.status(404).json({ success: false, error: { message: `Table "${tableName}" non trouvee` } });
      return;
    }

    // Check usage before allowing deletion
    if (table.source === 'native' && nativeAdapters[tableName]) {
      const usageCount = await nativeAdapters[tableName].checkUsage(id);
      if (usageCount > 0) {
        res.status(409).json({
          success: false,
          error: {
            message: `Impossible de supprimer : cette entree est utilisee dans ${usageCount} enregistrement(s).`,
            usageCount,
          },
        });
        return;
      }
      await nativeAdapters[tableName].delete(id);
    } else {
      // For generic entries, soft-delete (deactivate)
      await refEntryRepository.deactivate(tableName, id);
    }

    await refAuditRepository.log(tableName, id, 'deactivate', null, req.user?.userId);
    res.json({ success: true, data: null });
  },

  /** PUT /params/:tableName/:id/reactivate — reactivate a soft-deleted entry */
  async reactivate(req: AuthRequest, res: Response) {
    const tableName = req.params.tableName as string;
    const id = req.params.id as string;
    const entry = await refEntryRepository.reactivate(tableName, id);
    await refAuditRepository.log(tableName, id, 'reactivate', null, req.user?.userId);
    res.json({ success: true, data: entry });
  },

  /** PUT /params/:tableName/reorder — reorder entries */
  async reorder(req: AuthRequest, res: Response) {
    const tableName = req.params.tableName as string;
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) {
      res.status(400).json({ success: false, error: { message: 'orderedIds requis (tableau)' } });
      return;
    }
    await refEntryRepository.reorder(tableName, orderedIds);
    res.json({ success: true, data: null });
  },

  /** GET /params/:tableName/audit — audit log */
  async audit(req: AuthRequest, res: Response) {
    const tableName = req.params.tableName as string;
    const limit = parseInt(req.query.limit as string) || 50;
    const logs = await refAuditRepository.findByTable(tableName, limit);
    res.json({ success: true, data: logs });
  },
};
