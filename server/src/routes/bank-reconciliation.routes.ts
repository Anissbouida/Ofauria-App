import express, { Router, type Response } from 'express';
import { z } from 'zod';
import { bankReconciliationController } from '../controllers/bank-reconciliation.controller.js';
import { bankImportRepository } from '../repositories/bank-reconciliation.repository.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validateUuidParams } from '../middleware/validate.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

// Rapprochement bancaire : reserve a l'admin.
const router = Router();

router.get('/statements', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), bankReconciliationController.listStatements);
router.post('/statements', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), bankReconciliationController.createStatement);
router.get('/statements/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), bankReconciliationController.getReconciliation);
router.post('/statements/:id/auto-match', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), bankReconciliationController.autoMatch);
router.delete('/statements/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), bankReconciliationController.deleteStatement);
router.post('/lines/:id/match', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), bankReconciliationController.matchLine);
router.post('/lines/:id/unmatch', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), bankReconciliationController.unmatchLine);

// ─── Import de fichiers de banque (mig 426) : CSV, Excel, OFX, MT940, CFONB ───
// Le fichier arrive en base64 : parser JSON local élargi (route exclue du parser
// global de 10 Ko dans app.ts), posé APRÈS l'authentification pour qu'un appel
// anonyme ne fasse pas lire 8 Mo.
const AM = [authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER)];
const bigJson = express.json({ limit: '8mb' });
const smallJson = express.json({ limit: '20kb' });   // profils : même préfixe /import, donc hors parser global
const bad = (res: Response, m: string) => res.status(400).json({ success: false, error: { message: m } });

const col = z.coerce.number().int().min(0).max(60);
const DATE_FORMATS = ['DD/MM/YYYY', 'DD-MM-YYYY', 'DD.MM.YYYY', 'DD/MM/YY', 'YYYY-MM-DD', 'MM/DD/YYYY'] as const;
const profileShape = {
  delimiter: z.string().max(5).nullish(),
  decimalSep: z.enum([',', '.']),
  dateFormat: z.enum(DATE_FORMATS),
  skipRows: z.coerce.number().int().min(0).max(50),
  hasHeader: z.boolean(),
  colDate: col, colValueDate: col.nullish(), colLabel: col, colLabel2: col.nullish(), colReference: col.nullish(),
  colDebit: col.nullish(), colCredit: col.nullish(), colAmount: col.nullish(),
  negativeIsOut: z.boolean().optional(),
};
const fileBody = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentBase64: z.string().min(1).max(11_000_000),
  format: z.enum(['auto', 'csv', 'xlsx', 'ofx', 'mt940', 'cfonb']).default('auto'),
  encoding: z.enum(['auto', 'utf-8', 'windows-1252']).default('auto'),
  profileId: z.string().uuid().nullish(),
  profile: z.object(profileShape).nullish(),
  treasuryAccountId: z.string().uuid().nullish(),
});
const toInput = (b: z.infer<typeof fileBody>) => ({
  content: Buffer.from(b.contentBase64, 'base64'), fileName: b.fileName, format: b.format, encoding: b.encoding,
  profileId: b.profileId, profile: b.profile ?? null, treasuryAccountId: b.treasuryAccountId,
});

router.post('/import/preview', ...AM, bigJson, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = fileBody.safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message ?? 'Fichier invalide'); return; }
  res.json({ success: true, data: await bankImportRepository.preview(toInput(r.data)) });
}));
router.post('/import', ...AM, bigJson, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = fileBody.extend({
    label: z.string().trim().max(200).nullish(),
    statementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    openingBalance: z.coerce.number().nullish(),
    closingBalance: z.coerce.number().nullish(),
  }).safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message ?? 'Fichier invalide'); return; }
  res.status(201).json({ success: true, data: await bankImportRepository.importStatement({
    ...toInput(r.data), label: r.data.label, statementDate: r.data.statementDate,
    openingBalance: r.data.openingBalance, closingBalance: r.data.closingBalance,
    storeId: req.user!.storeId ?? null, userId: req.user!.userId,
  }) });
}));

// Profils d'import (correspondance de colonnes réutilisable).
const profileBody = z.object({ name: z.string().trim().min(1).max(100), treasuryAccountId: z.string().uuid().nullish(), ...profileShape });
router.get('/import/profiles', ...AM, asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await bankImportRepository.listProfiles() });
}));
router.post('/import/profiles', ...AM, smallJson, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = profileBody.safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message ?? 'Profil invalide'); return; }
  res.status(201).json({ success: true, data: await bankImportRepository.saveProfile(r.data, req.user!.userId) });
}));
router.put('/import/profiles/:id', ...AM, smallJson, validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = profileBody.safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message ?? 'Profil invalide'); return; }
  res.json({ success: true, data: await bankImportRepository.saveProfile(r.data, req.user!.userId, req.params.id) });
}));
router.delete('/import/profiles/:id', ...AM, validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  await bankImportRepository.deleteProfile(req.params.id);
  res.json({ success: true, data: null });
}));

export default router;
