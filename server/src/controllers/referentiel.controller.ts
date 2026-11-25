import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import {
  refTableRepository,
  refEntryRepository,
  nativeAdapters,
  refAuditRepository,
  refDashboardRepository,
} from '../repositories/referentiel.repository.js';
import {
  refScopeContext, orderedLineage, resolveTableLabels, tableRelevant, tierOf,
  refScopePreview, syncRefScope, refSyncHistory, invalidateRefCaches,
} from '../services/referential-scope.js';

/** Table telle que la voit la société : libellés du profil, pertinence (module, secteur). */
async function scopedTables(tables: Record<string, any>[]) {
  const [ctx, ordered] = await Promise.all([refScopeContext(), orderedLineage()]);
  return tables.map(t => ({ ...t, ...resolveTableLabels(t as any, ordered), base_label: t.label, relevant: tableRelevant(t, ctx) }));
}

/* ═══ Dashboard ═══ */
export const refDashboardController = {
  async stats(_req: AuthRequest, res: Response) {
    const data = await refDashboardRepository.getStats();
    res.json({ success: true, data: { ...data, tables: await scopedTables(data.tables) } });
  },
};

/* ═══ Ref Tables (registry) ═══ */
export const refTableController = {
  async list(_req: AuthRequest, res: Response) {
    const tables = await refTableRepository.findAll();
    res.json({ success: true, data: await scopedTables(tables) });
  },
};

/* ═══ Portée sectorielle (mig 698) ═══ */
const codeList = (v: unknown): string[] =>
  String(v ?? '').split(',').map(x => x.trim()).filter(x => /^[a-z0-9_]{1,40}$/.test(x));

export const refScopeController = {
  /** GET /params/scope — secteurs, spécialités et modules qui pilotent les référentiels. */
  async context(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: { ...(await refScopeContext()), history: await refSyncHistory(10) } });
  },

  /** GET /params/scope/preview?sectors=a,b&specializations=c — effet d'un choix, sans écrire. */
  async preview(req: AuthRequest, res: Response) {
    const sectors = codeList(req.query.sectors);
    if (!sectors.length) {
      res.status(400).json({ success: false, error: { message: 'Indiquez au moins un secteur' } });
      return;
    }
    res.json({ success: true, data: await refScopePreview(sectors, codeList(req.query.specializations)) });
  },

  /** POST /params/scope/sync — réaligne les référentiels sur le secteur configuré. */
  async sync(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await syncRefScope(req.user?.userId) });
  },

  /** PUT /params/:tableName/:id/follow-sector — rend la valeur au réglage du secteur. */
  async followSector(req: AuthRequest, res: Response) {
    const tableName = req.params.tableName as string;
    const id = req.params.id as string;
    const entry = await refEntryRepository.followSector(tableName, id);
    if (!entry) {
      res.status(404).json({ success: false, error: { message: 'Valeur introuvable ou personnalisée (elle ne dépend pas du secteur)' } });
      return;
    }
    await refAuditRepository.log(tableName, id, 'follow_sector', { after: entry }, req.user?.userId);
    invalidateRefCaches();
    res.json({ success: true, data: entry });
  },

  /** PUT /params/:tableName/:id/restore-label — annule la surcharge du libellé. */
  async restoreLabel(req: AuthRequest, res: Response) {
    const tableName = req.params.tableName as string;
    const id = req.params.id as string;
    const entry = await refEntryRepository.restoreLabel(tableName, id);
    if (!entry) {
      res.status(404).json({ success: false, error: { message: 'Valeur introuvable ou sans libellé d\'origine' } });
      return;
    }
    await refAuditRepository.log(tableName, id, 'restore_label', { after: entry }, req.user?.userId);
    invalidateRefCaches();
    res.json({ success: true, data: entry });
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
      res.status(404).json({ success: false, error: { message: `Table "${tableName}" non trouvée` } });
      return;
    }

    let entries;
    if (table.source === 'native' && nativeAdapters[tableName]) {
      entries = await nativeAdapters[tableName].findAll(includeInactive);
    } else {
      entries = await refEntryRepository.findAll(tableName, includeInactive);
    }
    // Mig 698 : niveau de chaque valeur (commun, sectoriel, personnalisé) et libellés du profil.
    entries = entries.map((e: Record<string, any>) => ({
      ...e, tier: tierOf(e),
      overridden: !!e.system_label && e.system_label !== e.label,
    }));
    const [scoped] = await scopedTables([table]);

    res.json({ success: true, data: { table: scoped, entries } });
  },

  /** POST /params/:tableName — create entry */
  async create(req: AuthRequest, res: Response) {
    const tableName = req.params.tableName as string;
    const table = await refTableRepository.findById(tableName);
    if (!table) {
      res.status(404).json({ success: false, error: { message: `Table "${tableName}" non trouvée` } });
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
      res.status(404).json({ success: false, error: { message: `Table "${tableName}" non trouvée` } });
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
      res.status(404).json({ success: false, error: { message: `Table "${tableName}" non trouvée` } });
      return;
    }

    // Check usage before allowing deletion
    if (table.source === 'native' && nativeAdapters[tableName]) {
      const usageCount = await nativeAdapters[tableName].checkUsage(id);
      if (usageCount > 0) {
        res.status(409).json({
          success: false,
          error: {
            message: `Impossible de supprimer : cette entrée est utilisée dans ${usageCount} enregistrement(s).`,
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
