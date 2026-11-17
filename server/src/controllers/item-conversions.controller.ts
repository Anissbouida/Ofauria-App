import type { Response } from 'express';
import { z } from 'zod';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { itemConversionsRepository, type ItemKind } from '../repositories/item-conversions.repository.js';

/** Conversions propres à l'article (M3-02) : mêmes actions pour un ingrédient et un produit. */
export const createConversionSchema = z.object({
  fromUnit: z.string().min(1).max(20), toUnit: z.string().min(1).max(20),
  factor: z.number().finite().positive(), notes: z.string().max(300).nullable().optional(),
});
export const updateConversionSchema = z.object({ factor: z.number().finite().positive(), notes: z.string().max(300).nullable().optional() });

const fail = (res: Response, err: unknown) => {
  const msg = err instanceof Error ? err.message : 'Erreur';
  res.status(400).json({ success: false, error: { message: msg.replace(/^.*CONVERSION_INCOHERENTE:\s*/, 'Conversion incohérente : ') } });
};

export function conversionHandlers(kind: ItemKind) {
  return {
    async list(req: AuthRequest, res: Response) {
      res.json({ success: true, data: await itemConversionsRepository.list(kind, req.params.id as string) });
    },
    async create(req: AuthRequest, res: Response) {
      try { res.status(201).json({ success: true, data: await itemConversionsRepository.create(kind, req.params.id as string, req.body, req.user!.userId) }); }
      catch (err) { fail(res, err); }
    },
    async update(req: AuthRequest, res: Response) {
      try { res.json({ success: true, data: await itemConversionsRepository.update(kind, req.params.id as string, req.params.convId as string, req.body, req.user!.userId) }); }
      catch (err) { fail(res, err); }
    },
    async remove(req: AuthRequest, res: Response) {
      try { res.json({ success: true, data: await itemConversionsRepository.remove(kind, req.params.id as string, req.params.convId as string) }); }
      catch (err) { fail(res, err); }
    },
  };
}
