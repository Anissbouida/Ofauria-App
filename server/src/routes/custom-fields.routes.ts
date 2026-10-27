import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorizeSettings } from '../middleware/settings-access.middleware.js';
import { authorizeModule } from '../middleware/module.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { db } from '../config/database.js';
import { auditedQuery } from '../utils/audit-context.js';
import { CF_ENTITIES, isCfEntity, listDefs, codeFromLabel, saveValues, readValues, type CfEntity } from '../services/custom-fields.js';

/**
 * Champs personnalisés (mig 369). Définitions : Paramètres › Champs personnalisés
 * (section custom_fields). Valeurs : droit de modifier le module de la fiche.
 */
export const customFieldsRouter = Router();
function bad(res: Response, message = 'Paramètres invalides', status = 400, extra?: unknown) {
  res.status(status).json({ success: false, error: { message, ...(extra ? { details: extra } : {}) } });
}
const FIELD_TYPES = ['text', 'number', 'date', 'select', 'boolean'] as const;

/** Droit du module de la fiche, résolu d'après :entity. */
const moduleRight = (action: 'view' | 'edit') => (req: AuthRequest, res: Response, next: NextFunction) => {
  const entity = req.params.entity;
  if (!isCfEntity(entity)) { bad(res, 'Type de fiche inconnu', 404); return; }
  return authorizeModule(CF_ENTITIES[entity].module, action)(req, res, next);
};

/** Types de fiche et leurs champs (lu par tous les formulaires). */
customFieldsRouter.get('/defs', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const entity = req.query.entity;
  if (entity !== undefined && !isCfEntity(entity)) { bad(res, 'Type de fiche inconnu'); return; }
  res.json({ success: true, data: await listDefs((entity as CfEntity) ?? null, req.query.all === 'true'),
    entities: Object.entries(CF_ENTITIES).map(([key, e]) => ({ key, label: e.label })) });
}));

const defBody = z.object({
  label: z.string().trim().min(2).max(80),
  fieldType: z.enum(FIELD_TYPES),
  options: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
  required: z.boolean().default(false),
  showInList: z.boolean().default(false),
  help: z.string().trim().max(200).nullish(),
  displayOrder: z.coerce.number().int().min(0).max(999).optional(),
});

customFieldsRouter.post('/defs', authenticate, authorizeSettings('custom_fields', 'create'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = defBody.extend({ entity: z.string(), code: z.string().trim().max(40).optional() }).safeParse(req.body);
  if (!b.success) { bad(res, b.error.issues[0]?.message); return; }
  if (!isCfEntity(b.data.entity)) { bad(res, 'Type de fiche inconnu'); return; }
  const options = [...new Set(b.data.options)];
  if (b.data.fieldType === 'select' && !options.length) { bad(res, 'Une liste de choix a besoin d\'au moins une valeur'); return; }
  const code = b.data.code ? codeFromLabel(b.data.code) : codeFromLabel(b.data.label);
  const dup = await db.query(`SELECT 1 FROM custom_field_defs WHERE entity = $1 AND code = $2`, [b.data.entity, code]);
  if (dup.rowCount) { bad(res, `Un champ « ${code} » existe déjà sur cette fiche`, 409); return; }
  const order = b.data.displayOrder ?? Number((await db.query(`SELECT COALESCE(MAX(display_order), 0) + 10 AS n FROM custom_field_defs WHERE entity = $1`, [b.data.entity])).rows[0].n);
  const r = await auditedQuery(req.user!.userId,
    `INSERT INTO custom_field_defs (entity, code, label, field_type, options, required, show_in_list, help, display_order, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10) RETURNING *`,
    [b.data.entity, code, b.data.label, b.data.fieldType, JSON.stringify(b.data.fieldType === 'select' ? options : []),
     b.data.required, b.data.showInList, b.data.help || null, order, req.user!.userId]);
  res.status(201).json({ success: true, data: r.rows[0] });
}));

/** Modification : le type et le code sont figés (les valeurs existantes en dépendent). */
customFieldsRouter.put('/defs/:id', authenticate, authorizeSettings('custom_fields', 'edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = defBody.omit({ fieldType: true }).partial().extend({ isActive: z.boolean().optional() }).safeParse(req.body);
  if (!b.success) { bad(res, b.error.issues[0]?.message); return; }
  const cur = (await db.query(`SELECT * FROM custom_field_defs WHERE id = $1`, [req.params.id])).rows[0];
  if (!cur) { bad(res, 'Champ introuvable', 404); return; }
  const options = b.data.options ? [...new Set(b.data.options)] : null;
  if (cur.field_type === 'select' && options && !options.length) { bad(res, 'Une liste de choix a besoin d\'au moins une valeur'); return; }
  const r = await auditedQuery(req.user!.userId,
    `UPDATE custom_field_defs SET label = COALESCE($2, label), options = COALESCE($3::jsonb, options), required = COALESCE($4, required),
            show_in_list = COALESCE($5, show_in_list), help = CASE WHEN $6::boolean THEN $7 ELSE help END,
            display_order = COALESCE($8, display_order), is_active = COALESCE($9, is_active)
      WHERE id = $1 RETURNING *`,
    [req.params.id, b.data.label ?? null, cur.field_type === 'select' && options ? JSON.stringify(options) : null, b.data.required ?? null,
     b.data.showInList ?? null, b.data.help !== undefined, b.data.help || null, b.data.displayOrder ?? null, b.data.isActive ?? null]);
  res.json({ success: true, data: r.rows[0] });
}));

/** Nombre de fiches renseignées : affiché avant de désactiver un champ. */
customFieldsRouter.get('/defs/:id/usage', authenticate, authorizeSettings('custom_fields'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const d = (await db.query(`SELECT entity, code FROM custom_field_defs WHERE id = $1`, [req.params.id])).rows[0];
  if (!d || !isCfEntity(d.entity)) { bad(res, 'Champ introuvable', 404); return; }
  const n = await db.query(`SELECT COUNT(*)::int AS n FROM ${CF_ENTITIES[d.entity as CfEntity].table} WHERE custom_fields ? $1`, [d.code]);
  res.json({ success: true, data: { filled: n.rows[0].n } });
}));

customFieldsRouter.get('/values/:entity/:id', authenticate, moduleRight('view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const v = await readValues(req.params.entity as CfEntity, req.params.id);
  if (v === null) { bad(res, 'Fiche introuvable', 404); return; }
  res.json({ success: true, data: v });
}));

customFieldsRouter.put('/values/:entity/:id', authenticate, moduleRight('edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = z.record(z.string().max(40), z.unknown()).safeParse(req.body?.values ?? req.body);
  if (!b.success) { bad(res); return; }
  const r = await saveValues(req.params.entity as CfEntity, req.params.id, b.data);
  if ('error' in r) {
    if (r.error === 'not_found') { bad(res, 'Fiche introuvable', 404); return; }
    bad(res, Object.values(r.errors!).join(' · '), 400, r.errors); return;
  }
  res.json({ success: true, data: r.data });
}));
