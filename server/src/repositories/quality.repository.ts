import { db } from '../config/database.js';

/**
 * Contrôle qualité paramétrable (mig 384) : modèles d'inspection (liste de points
 * à vérifier) et inspections enregistrées. Autonome, à côté des contrôles figés
 * de réception/production.
 */

export type QualityItem = { label: string; kind: 'ok' | 'measure'; unit?: string; min?: number | null; max?: number | null };
export type QualityResult = { label: string; kind: 'ok' | 'measure'; ok: boolean; value?: number | null; note?: string | null };

function sanitizeItems(raw: unknown): QualityItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 50).map((r): QualityItem => {
    const o = r as Record<string, unknown>;
    const kind = o.kind === 'measure' ? 'measure' : 'ok';
    return {
      label: String(o.label ?? '').slice(0, 160),
      kind,
      unit: kind === 'measure' && o.unit ? String(o.unit).slice(0, 16) : undefined,
      min: kind === 'measure' && o.min != null && o.min !== '' ? Number(o.min) : null,
      max: kind === 'measure' && o.max != null && o.max !== '' ? Number(o.max) : null,
    };
  }).filter(i => i.label.length > 0);
}

export const qualityRepository = {
  async listTemplates(storeId?: string | null) {
    const params: unknown[] = [];
    let where = '';
    if (storeId) { params.push(storeId); where = `WHERE (t.store_id IS NULL OR t.store_id = $1)`; }
    const r = await db.query(
      `SELECT t.*, (SELECT COUNT(*) FROM quality_inspections i WHERE i.template_id = t.id)::int AS inspections_count
         FROM quality_templates t ${where} ORDER BY t.is_active DESC, t.name`, params);
    return r.rows;
  },

  async getTemplate(id: string) {
    return (await db.query(`SELECT * FROM quality_templates WHERE id = $1`, [id])).rows[0] || null;
  },

  async createTemplate(input: { name: string; appliesTo: string; items: unknown; storeId?: string | null; userId: string | null }) {
    const items = sanitizeItems(input.items);
    const applies = ['general', 'reception', 'production', 'product'].includes(input.appliesTo) ? input.appliesTo : 'general';
    const r = await db.query(
      `INSERT INTO quality_templates (name, applies_to, items, store_id, created_by)
       VALUES ($1,$2,$3::jsonb,$4,$5) RETURNING *`,
      [input.name.trim().slice(0, 160), applies, JSON.stringify(items), input.storeId ?? null, input.userId]);
    return r.rows[0];
  },

  async updateTemplate(id: string, input: { name?: string; appliesTo?: string; items?: unknown }) {
    const cur = await this.getTemplate(id);
    if (!cur) return null;
    const items = input.items !== undefined ? sanitizeItems(input.items) : cur.items;
    const applies = input.appliesTo && ['general', 'reception', 'production', 'product'].includes(input.appliesTo) ? input.appliesTo : cur.applies_to;
    const r = await db.query(
      `UPDATE quality_templates SET name = $2, applies_to = $3, items = $4::jsonb WHERE id = $1 RETURNING *`,
      [id, (input.name ?? cur.name).trim().slice(0, 160), applies, JSON.stringify(items)]);
    return r.rows[0];
  },

  async setTemplateActive(id: string, active: boolean) {
    const r = await db.query(`UPDATE quality_templates SET is_active = $2 WHERE id = $1 RETURNING *`, [id, active]);
    return r.rows[0] || null;
  },

  async listInspections(p: { storeId?: string | null; conformity?: boolean; limit: number }) {
    const params: unknown[] = [];
    const cond: string[] = ['true'];
    if (p.storeId) { params.push(p.storeId); cond.push(`(i.store_id IS NULL OR i.store_id = $${params.length})`); }
    if (p.conformity !== undefined) { params.push(p.conformity); cond.push(`i.conformity = $${params.length}`); }
    params.push(p.limit);
    const r = await db.query(
      `SELECT i.id, i.template_name, i.title, i.reference_note, i.inspected_on, i.conformity, i.notes,
              u.first_name || ' ' || u.last_name AS inspected_by_name,
              jsonb_array_length(i.results) AS items,
              (SELECT COUNT(*) FROM jsonb_array_elements(i.results) x WHERE (x->>'ok')::boolean IS FALSE)::int AS failed
         FROM quality_inspections i LEFT JOIN users u ON u.id = i.inspected_by
        WHERE ${cond.join(' AND ')}
        ORDER BY i.inspected_on DESC, i.created_at DESC LIMIT $${params.length}`, params);
    return r.rows;
  },

  async getInspection(id: string) {
    return (await db.query(
      `SELECT i.*, u.first_name || ' ' || u.last_name AS inspected_by_name
         FROM quality_inspections i LEFT JOIN users u ON u.id = i.inspected_by WHERE i.id = $1`, [id])).rows[0] || null;
  },

  async createInspection(input: {
    templateId?: string | null; title: string; referenceNote?: string | null; inspectedOn?: string | null;
    results: QualityResult[]; notes?: string | null; storeId?: string | null; userId: string | null;
  }) {
    const tpl = input.templateId ? await this.getTemplate(input.templateId) : null;
    const templateName = tpl?.name ?? 'Inspection libre';
    const results = Array.isArray(input.results) ? input.results : [];
    // Conformité = tous les points conformes.
    const conformity = results.length > 0 && results.every(r => r.ok === true);
    const r = await db.query(
      `INSERT INTO quality_inspections (template_id, template_name, title, reference_note, inspected_on, results, conformity, notes, store_id, inspected_by)
       VALUES ($1,$2,$3,$4,COALESCE($5::date, CURRENT_DATE),$6::jsonb,$7,$8,$9,$10) RETURNING id`,
      [input.templateId ?? null, templateName, input.title.trim().slice(0, 200), input.referenceNote?.trim()?.slice(0, 200) || null,
       input.inspectedOn || null, JSON.stringify(results), conformity, input.notes?.trim() || null, input.storeId ?? null, input.userId]);
    return this.getInspection(r.rows[0].id);
  },

  /* ── Non-conformités & actions correctives (mig 385) ── */
  async listNonConformities(p: { storeId?: string | null; status?: string; limit: number }) {
    const params: unknown[] = [];
    const cond: string[] = ['true'];
    if (p.storeId) { params.push(p.storeId); cond.push(`(nc.store_id IS NULL OR nc.store_id = $${params.length})`); }
    if (p.status) { params.push(p.status); cond.push(`nc.status = $${params.length}`); }
    params.push(p.limit);
    const r = await db.query(
      `SELECT nc.*, ru.first_name || ' ' || ru.last_name AS responsible_name,
              du.first_name || ' ' || du.last_name AS detected_by_name,
              (nc.status <> 'closed' AND nc.due_date IS NOT NULL AND nc.due_date < CURRENT_DATE) AS overdue
         FROM quality_nonconformities nc
         LEFT JOIN users ru ON ru.id = nc.responsible_id
         LEFT JOIN users du ON du.id = nc.detected_by
        WHERE ${cond.join(' AND ')}
        ORDER BY (nc.status <> 'closed') DESC, nc.due_date NULLS LAST, nc.detected_on DESC
        LIMIT $${params.length}`, params);
    return r.rows;
  },

  async createNonConformity(input: {
    title: string; source?: string; referenceNote?: string | null; description?: string | null;
    severity?: string; correctiveAction?: string | null; responsibleId?: string | null; dueDate?: string | null;
    detectedOn?: string | null; storeId?: string | null; userId: string | null;
  }) {
    const source = ['inspection', 'reception', 'production', 'complaint', 'other'].includes(input.source ?? '') ? input.source : 'other';
    const severity = ['low', 'medium', 'high'].includes(input.severity ?? '') ? input.severity : 'medium';
    const r = await db.query(
      `INSERT INTO quality_nonconformities (title, source, reference_note, description, severity, corrective_action, responsible_id, due_date, detected_on, detected_by, store_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::date, CURRENT_DATE),$10,$11) RETURNING id`,
      [input.title.trim().slice(0, 200), source, input.referenceNote?.trim()?.slice(0, 200) || null, input.description?.trim() || null,
       severity, input.correctiveAction?.trim() || null, input.responsibleId || null, input.dueDate || null,
       input.detectedOn || null, input.userId, input.storeId ?? null]);
    return (await this.listNonConformities({ storeId: input.storeId, limit: 1000 })).find((x: { id: string }) => x.id === r.rows[0].id);
  },

  async updateNonConformity(id: string, input: {
    title?: string; severity?: string; correctiveAction?: string | null; responsibleId?: string | null;
    dueDate?: string | null; description?: string | null; status?: string;
  }) {
    const cur = (await db.query(`SELECT * FROM quality_nonconformities WHERE id = $1`, [id])).rows[0];
    if (!cur) return null;
    const status = input.status && ['open', 'in_progress', 'closed'].includes(input.status) ? input.status : cur.status;
    const severity = input.severity && ['low', 'medium', 'high'].includes(input.severity) ? input.severity : cur.severity;
    await db.query(
      `UPDATE quality_nonconformities SET
         title = $2, severity = $3, corrective_action = $4, responsible_id = $5, due_date = $6, description = $7,
         status = $8::text,
         closed_at = CASE WHEN $8::text = 'closed' AND closed_at IS NULL THEN now()
                          WHEN $8::text <> 'closed' THEN NULL ELSE closed_at END
       WHERE id = $1`,
      [id, (input.title ?? cur.title).trim().slice(0, 200), severity,
       input.correctiveAction !== undefined ? (input.correctiveAction?.trim() || null) : cur.corrective_action,
       input.responsibleId !== undefined ? (input.responsibleId || null) : cur.responsible_id,
       input.dueDate !== undefined ? (input.dueDate || null) : cur.due_date,
       input.description !== undefined ? (input.description?.trim() || null) : cur.description, status]);
    return (await this.listNonConformities({ storeId: cur.store_id, limit: 1000 })).find((x: { id: string }) => x.id === id);
  },
};
