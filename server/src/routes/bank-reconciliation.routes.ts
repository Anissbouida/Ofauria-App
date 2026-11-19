import express, { Router, type Response } from 'express';
import { z } from 'zod';
import { bankReconciliationController } from '../controllers/bank-reconciliation.controller.js';
import { bankImportRepository, bankRuleRepository } from '../repositories/bank-reconciliation.repository.js';
import { bankMatching } from '../services/bank-matching.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { emptyBody } from '../validators/common.validator.js';
import * as PF from '../validators/payments-flow.validator.js';

// Rapprochement bancaire : reserve a l'admin.
const router = Router();

router.get('/statements', authenticate, can('accounting.bank_reconciliation.view'), bankReconciliationController.listStatements);
router.post('/statements', authenticate, can('accounting.bank_reconciliation.statements'), validate(PF.bankStatementSchema), bankReconciliationController.createStatement);
router.get('/statements/:id', authenticate, can('accounting.bank_reconciliation.view'), bankReconciliationController.getReconciliation);
router.post('/statements/:id/auto-match', authenticate, can('accounting.bank_reconciliation.auto_match'), validateUuidParams('id'), validate(emptyBody), bankReconciliationController.autoMatch);
router.delete('/statements/:id', authenticate, can('accounting.bank_reconciliation.delete'), bankReconciliationController.deleteStatement);
router.post('/lines/:id/match', authenticate, can('accounting.bank_reconciliation.match'), validateUuidParams('id'), validate(PF.bankMatchSchema), bankReconciliationController.matchLine);
router.post('/lines/:id/unmatch', authenticate, can('accounting.bank_reconciliation.unmatch'), validateUuidParams('id'), validate(emptyBody), bankReconciliationController.unmatchLine);


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
  profileId: z.string().guid().nullish(),
  profile: z.object(profileShape).nullish(),
  treasuryAccountId: z.string().guid().nullish(),
});
const toInput = (b: z.infer<typeof fileBody>) => ({
  content: Buffer.from(b.contentBase64, 'base64'), fileName: b.fileName, format: b.format, encoding: b.encoding,
  profileId: b.profileId, profile: b.profile ?? null, treasuryAccountId: b.treasuryAccountId,
});

router.post('/import/preview', authenticate, can('accounting.bank_reconciliation.preview'), bigJson, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = fileBody.safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message ?? 'Fichier invalide'); return; }
  res.json({ success: true, data: await bankImportRepository.preview(toInput(r.data)) });
}));
router.post('/import', authenticate, can('accounting.bank_reconciliation.import'), bigJson, asyncHandler(async (req: AuthRequest, res: Response) => {
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
const profileBody = z.object({ name: z.string().trim().min(1).max(100), treasuryAccountId: z.string().guid().nullish(), ...profileShape });
router.get('/import/profiles', authenticate, can('accounting.bank_reconciliation.view'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await bankImportRepository.listProfiles() });
}));
router.post('/import/profiles', authenticate, can('accounting.bank_reconciliation.profiles'), smallJson, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = profileBody.safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message ?? 'Profil invalide'); return; }
  res.status(201).json({ success: true, data: await bankImportRepository.saveProfile(r.data, req.user!.userId) });
}));
router.put('/import/profiles/:id', authenticate, can('accounting.bank_reconciliation.profiles'), smallJson, validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = profileBody.safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message ?? 'Profil invalide'); return; }
  res.json({ success: true, data: await bankImportRepository.saveProfile(r.data, req.user!.userId, req.params.id) });
}));
router.delete('/import/profiles/:id', authenticate, can('accounting.bank_reconciliation.delete'), validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  await bankImportRepository.deleteProfile(req.params.id);
  res.json({ success: true, data: null });
}));

// ─── G4-02 : moteur à règles — propositions, validation en masse, règles ───
const ruleSchema = z.object({
  priority: z.coerce.number().int().min(0).max(10_000).optional(),
  label: z.string().trim().min(2, 'Nom de la règle requis').max(120),
  isActive: z.boolean().optional(),
  labelContains: z.string().trim().max(120).nullish(),
  labelRegex: z.string().trim().max(200).nullish(),
  direction: z.enum(['in', 'out']).nullish(),
  amountMin: z.coerce.number().min(0).nullish(),
  amountMax: z.coerce.number().min(0).nullish(),
  action: z.enum(['match', 'post_entry', 'match_fee']),
  counterAccountId: z.string().guid().nullish(),
  entryLabel: z.string().trim().max(120).nullish(),
  amountTolerance: z.coerce.number().min(0).max(1_000_000).optional(),
  dateToleranceDays: z.coerce.number().int().min(0).max(60).optional(),
  feePctMin: z.coerce.number().min(0).max(50).nullish(),
  feePctMax: z.coerce.number().min(0).max(50).nullish(),
  candidateSource: z.enum(['card']).nullish(),
});
const applySchema = z.object({ bankLineIds: z.array(z.string().guid()).max(2000).optional(), minConfidence: z.coerce.number().min(0).max(100).optional() });
const id = validateUuidParams('id');
router.get('/statements/:id/proposals', authenticate, can('accounting.bank_reconciliation.view'), id, asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await bankMatching.propose(req.params.id as string) });
}));
router.post('/statements/:id/apply', authenticate, can('accounting.bank_reconciliation.apply'), id, smallJson, validate(applySchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await bankMatching.apply(req.params.id as string, { userId: req.user!.userId, storeId: req.user!.storeId ?? null, ...req.body }) });
}));
router.get('/rules', authenticate, can('accounting.bank_reconciliation.view'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await bankRuleRepository.list() });
}));
router.post('/rules', authenticate, can('accounting.bank_reconciliation.rules'), smallJson, validate(ruleSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(201).json({ success: true, data: await bankRuleRepository.save(req.body, req.user!.userId) });
}));
router.put('/rules/:id', authenticate, can('accounting.bank_reconciliation.rules'), id, smallJson, validate(ruleSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await bankRuleRepository.save(req.body, req.user!.userId, req.params.id as string) });
}));
router.delete('/rules/:id', authenticate, can('accounting.bank_reconciliation.delete'), id, asyncHandler(async (req: AuthRequest, res: Response) => {
  await bankRuleRepository.remove(req.params.id as string);
  res.json({ success: true, data: null });
}));

export default router;
