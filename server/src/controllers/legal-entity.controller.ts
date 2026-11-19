import type { Response } from 'express';
import { z } from 'zod';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { legalEntityRepository, type LegalEntityInput } from '../repositories/legal-entity.repository.js';
import { clearLegalEntityCache } from '../services/legal-entity.js';
import { baseCurrencyCode } from '../services/currency.js';

/**
 * Paramètres › Société › Entités juridiques (G6-03, mig 608) : liste, création,
 * modification d'une entité, rattachement d'un établissement à une entité.
 * Droit : section « company » des paramètres (le même que la fiche société).
 */
const opt = (max: number) => z.string().trim().max(max).nullable().optional()
  .transform(v => (v === undefined ? undefined : v === null || v === '' ? null : v));

const entityFields = {
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,12}$/, 'Code : 2 à 12 lettres majuscules ou chiffres'),
  legalName: z.string().trim().min(1, 'Raison sociale requise').max(120),
  tradeName: opt(100),
  legalForm: opt(30),
  capital: z.number().nonnegative().nullable().optional(),
  ice: opt(15).refine(v => v == null || /^[0-9]{15}$/.test(v), 'ICE : 15 chiffres'),
  ifNumber: opt(30),
  rc: opt(30),
  patente: opt(30),
  cnss: opt(30),
  address: opt(500),
  city: opt(80),
  communeCode: opt(12).refine(v => v == null || /^[0-9]{3}\.[0-9]{2}\.[0-9]{2}$/.test(v), 'Code commune : 000.00.00'),
  phone: opt(40),
  email: opt(120).refine(v => v == null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'E-mail invalide'),
  website: opt(120),
  currencyCode: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Devise : code ISO à 3 lettres'),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Pays : code ISO à 2 lettres'),
  logoUrl: z.string().max(3_000_000).nullable().optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
};

export const legalEntityCreateSchema = z.object({
  ...entityFields,
  currencyCode: entityFields.currencyCode.optional(),
  countryCode: entityFields.countryCode.optional(),
}).strict();

export const legalEntityUpdateSchema = z.object(entityFields).partial().strict();

export const legalEntityStoreSchema = z.object({ legalEntityId: z.string().uuid() }).strict();

const bad = (res: Response, message: string, status = 400) => res.status(status).json({ success: false, error: { message } });

export const legalEntityController = {
  async list(_req: AuthRequest, res: Response) {
    if (!(await legalEntityRepository.available())) { res.json({ success: true, data: { entities: [], stores: [] } }); return; }
    const [entities, stores] = await Promise.all([legalEntityRepository.list(), legalEntityRepository.stores()]);
    res.json({ success: true, data: { entities, stores } });
  },

  async create(req: AuthRequest, res: Response) {
    const b = req.body as z.infer<typeof legalEntityCreateSchema>;
    if (await legalEntityRepository.codeTaken(b.code)) { bad(res, 'Ce code est déjà utilisé par une autre entité', 409); return; }
    const row = await legalEntityRepository.save(null, {
      ...b, currencyCode: b.currencyCode ?? baseCurrencyCode(), countryCode: b.countryCode ?? 'MA',
    } as LegalEntityInput, req.user!.userId);
    clearLegalEntityCache();
    res.status(201).json({ success: true, data: row });
  },

  async update(req: AuthRequest, res: Response) {
    const id = req.params.id as string;
    const current = await legalEntityRepository.findById(id);
    if (!current) { bad(res, 'Entité introuvable', 404); return; }
    const b = req.body as z.infer<typeof legalEntityUpdateSchema>;
    if (b.code && await legalEntityRepository.codeTaken(b.code, id)) { bad(res, 'Ce code est déjà utilisé par une autre entité', 409); return; }
    if (current.is_default && (b.isDefault === false || b.isActive === false)) {
      bad(res, 'L\'entité par défaut ne peut être ni désactivée ni retirée : désignez d\'abord une autre entité par défaut', 409); return;
    }
    if (b.isActive === false && await legalEntityRepository.activeStoreCount(id) > 0) {
      bad(res, 'Des établissements actifs sont rattachés à cette entité : rattachez-les à une autre entité avant de la désactiver', 409); return;
    }
    const { isDefault, ...rest } = b;
    const row = await legalEntityRepository.save(id, { ...rest, isDefault: isDefault === true ? true : undefined } as LegalEntityInput, req.user!.userId);
    clearLegalEntityCache();
    res.json({ success: true, data: row });
  },

  async assignStore(req: AuthRequest, res: Response) {
    const { legalEntityId } = req.body as z.infer<typeof legalEntityStoreSchema>;
    const entity = await legalEntityRepository.findById(legalEntityId);
    if (!entity) { bad(res, 'Entité introuvable', 404); return; }
    if (!entity.is_active) { bad(res, 'Entité désactivée', 409); return; }
    const ok = await legalEntityRepository.assignStore(req.params.storeId as string, legalEntityId, req.user!.userId);
    if (!ok) { bad(res, 'Établissement introuvable', 404); return; }
    clearLegalEntityCache();
    res.json({ success: true, data: { storeId: req.params.storeId, legalEntityId } });
  },
};
