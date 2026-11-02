import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { journalTemplateRepository as tplRepo } from '../repositories/journal-template.repository.js';
import { ledgerIntegrityRepository as integrityRepo } from '../repositories/ledger-integrity.repository.js';
import { fiscalYearRepository } from '../repositories/ledger.repository.js';
import { buildFec } from '../services/fec.service.js';
import { manualEntryRepository } from '../repositories/manual-entry.repository.js';
import { lettrageRepository } from '../repositories/lettrage.repository.js';
import { agedBalanceRepository } from '../repositories/aged-balance.repository.js';
import {
  planComptableController,
  accountAuxiliaryController,
  journalController,
  fiscalPeriodController,
  journalEntryController,
  reconciliationController,
  financialStatementsController,
  tvaDeclarationController,
  balanceSheetController,
  backfillController,
  purchaseLedgerController,
} from '../controllers/ledger.controller.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validateUuidParams } from '../middleware/validate.middleware.js';
import { ROLES } from '@ofauria/shared';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { requireVerb } from '../middleware/module.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

// Acces : admin + gerant (ROLE_GROUPS.ADMIN_MANAGER). La gerante dispose des
// memes droits que l'admin sur la comptabilite. Les autres routes du noyau
// suivent la meme regle (fixed-asset.routes, bank-reconciliation.routes).

export const ledgerRouter = Router();

// Plan comptable
ledgerRouter.get('/accounts',         authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), planComptableController.list);
ledgerRouter.get('/accounts/:code',   authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), planComptableController.getByCode);

// Sous-comptes tiers (auxiliaires)
ledgerRouter.get('/auxiliaries',      authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), accountAuxiliaryController.list);

// Journaux
ledgerRouter.get('/journals',         authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), journalController.list);

// Periodes fiscales
ledgerRouter.get('/fiscal-periods',   authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), fiscalPeriodController.list);
ledgerRouter.patch('/fiscal-periods/:id/status', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), requireVerb('accounting', 'close'), fiscalPeriodController.updateStatus);
// Mig 311 (D8) : checklist de clôture, historique, file de comptabilisation, GR/IR, relevé TVA, paramétrage.
ledgerRouter.get('/fiscal-periods/:id/checklist', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(fiscalPeriodController.checklist));
ledgerRouter.get('/fiscal-periods/:id/events', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(fiscalPeriodController.events));
// Exercices (mig 416) : contrôles et clôture définitive avec à-nouveaux (admin).
ledgerRouter.get('/fiscal-years', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await fiscalYearRepository.findAll() });
}));
const yearParam = (req: AuthRequest, res: Response): number | null => {
  const y = Number(req.params.year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) { res.status(400).json({ success: false, error: { message: 'Exercice invalide' } }); return null; }
  return y;
};
ledgerRouter.get('/fiscal-years/:year/checklist', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(async (req: AuthRequest, res: Response) => {
  const y = yearParam(req, res); if (y === null) return;
  res.json({ success: true, data: await fiscalYearRepository.checklist(y) });
}));
ledgerRouter.post('/fiscal-years/:year/close', authenticate, authorize(ROLES.ADMIN), requireVerb('accounting', 'close'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const y = yearParam(req, res); if (y === null) return;
  res.json({ success: true, data: await fiscalYearRepository.close(y, req.user!.userId) });
}));
// FEC (avis CNC n° 24, art. 210 CGI) : fichier + attestation d'intégrité d'une même génération.
ledgerRouter.get('/fec', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), requireVerb('accounting', 'export'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).refine(q => q.year || (q.startDate && q.endDate), { message: 'year, ou startDate et endDate, requis' }).safeParse(req.query);
  if (!r.success) { tplBad(res, r.error.issues[0]?.message); return; }
  res.json({ success: true, data: await buildFec({ year: r.data.year, start: r.data.startDate, end: r.data.endDate }, actorOf(req)) });
}));
// Balance âgée comptable : lignes non lettrées des comptes de tiers, par échéance.
ledgerRouter.get('/aged-balance', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({
    side: z.enum(['suppliers', 'customers']).default('suppliers'),
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).safeParse(req.query);
  if (!r.success) { tplBad(res, r.error.issues[0]?.message); return; }
  const asOf = r.data.asOf ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Casablanca' });
  res.json({ success: true, data: await agedBalanceRepository.compute({ side: r.data.side, asOf }) });
}));
ledgerRouter.get('/outbox',authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(purchaseLedgerController.outbox));
ledgerRouter.post('/outbox/replay', authenticate, authorize(ROLES.ADMIN), asyncHandler(purchaseLedgerController.replay));
ledgerRouter.post('/outbox/:id/replay', authenticate, authorize(ROLES.ADMIN), validateUuidParams('id'), asyncHandler(purchaseLedgerController.replay));
ledgerRouter.get('/grir/open-items', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(purchaseLedgerController.grirOpenItems));
ledgerRouter.get('/vat-deduction-statement', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(purchaseLedgerController.vatStatement));
ledgerRouter.get('/posting-profiles', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(purchaseLedgerController.postingProfiles));

// Ecritures comptables
ledgerRouter.get('/entries',          authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), journalEntryController.list);
ledgerRouter.get('/entries/:id',      authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), journalEntryController.getById);

// Modèles d'écritures (mig 391) : structure réutilisable + instanciation en OD.
const AM = [authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER)];

// Saisie libre (mig 418) : brouillon modifiable, comptabilisation (droit « post »),
// extourne motivée des écritures manuelles.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const manualBody = z.object({
  journalCode: z.string().trim().min(1).max(10),
  date: z.string().regex(DATE_RE),
  description: z.string().trim().min(1).max(2000),
  pieceRef: z.string().trim().max(60).nullish(),
  pieceDate: z.string().regex(DATE_RE).nullish(),
  lines: z.array(z.object({
    accountId: z.string().uuid(),
    auxiliaryId: z.string().uuid().nullish(),
    debit: z.coerce.number().min(0),
    credit: z.coerce.number().min(0),
    label: z.string().trim().max(200).nullish(),
  })).min(2).max(500),
});
const manualActor = (req: AuthRequest) => ({ userId: req.user!.userId, storeId: req.user!.storeId ?? null });
const parseManual = (req: AuthRequest, res: Response) => {
  const r = manualBody.safeParse(req.body);
  if (!r.success) { res.status(400).json({ success: false, error: { message: r.error.issues[0]?.message ?? 'Saisie invalide' } }); return null; }
  return r.data;
};
ledgerRouter.post('/entries', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const input = parseManual(req, res); if (!input) return;
  res.status(201).json({ success: true, data: await manualEntryRepository.createDraft(input, manualActor(req)) });
}));
ledgerRouter.post('/entries/post', ...AM, requireVerb('accounting', 'post'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const input = parseManual(req, res); if (!input) return;
  res.status(201).json({ success: true, data: await manualEntryRepository.createAndPost(input, manualActor(req)) });
}));
ledgerRouter.put('/entries/:id', ...AM, validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const input = parseManual(req, res); if (!input) return;
  res.json({ success: true, data: await manualEntryRepository.updateDraft(req.params.id, input, manualActor(req)) });
}));
ledgerRouter.delete('/entries/:id', ...AM, validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await manualEntryRepository.deleteDraft(req.params.id, manualActor(req)) });
}));
ledgerRouter.post('/entries/:id/post', ...AM, requireVerb('accounting', 'post'), validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await manualEntryRepository.post(req.params.id, manualActor(req)) });
}));
ledgerRouter.post('/entries/:id/reverse', ...AM, requireVerb('accounting', 'post'), validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ date: z.string().regex(DATE_RE).nullish(), reason: z.string().trim().min(3).max(500) }).safeParse(req.body);
  if (!r.success) { res.status(400).json({ success: false, error: { message: 'Motif de l\'extourne obligatoire (3 caractères au moins)' } }); return; }
  res.json({ success: true, data: await manualEntryRepository.reverse(req.params.id, r.data, manualActor(req)) });
}));

// Lettrage manuel (mig 420) : consultation libre, lettrer/délettrer avec le droit « validate ».
ledgerRouter.get('/lettrage/accounts', ...AM, asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await lettrageRepository.accounts() });
}));
ledgerRouter.get('/lettrage/accounts/:id/tiers', ...AM, validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await lettrageRepository.tiers(req.params.id) });
}));
ledgerRouter.get('/lettrage/lines', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({
    accountId: z.string().uuid(),
    auxiliaryId: z.string().uuid().optional(),
    status: z.enum(['open', 'lettered', 'all']).default('open'),
    from: z.string().regex(DATE_RE).optional(),
    to: z.string().regex(DATE_RE).optional(),
  }).safeParse(req.query);
  if (!r.success) { tplBad(res, r.error.issues[0]?.message); return; }
  res.json({ success: true, data: await lettrageRepository.lines(r.data) });
}));
const autoScope = z.object({ accountId: z.string().uuid().optional(), auxiliaryId: z.string().uuid().optional() });
ledgerRouter.get('/lettrage/auto', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = autoScope.safeParse(req.query);
  if (!r.success) { tplBad(res, r.error.issues[0]?.message); return; }
  res.json({ success: true, data: await lettrageRepository.autoLetter({ ...r.data, dryRun: true }, { userId: req.user!.userId }) });
}));
ledgerRouter.post('/lettrage/auto', ...AM, requireVerb('accounting', 'validate'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = autoScope.safeParse(req.body ?? {});
  if (!r.success) { tplBad(res, r.error.issues[0]?.message); return; }
  res.json({ success: true, data: await lettrageRepository.autoLetter(r.data, { userId: req.user!.userId }) });
}));
ledgerRouter.post('/lettrage', ...AM, requireVerb('accounting', 'validate'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ lineIds: z.array(z.string().uuid()).min(2).max(1000) }).safeParse(req.body);
  if (!r.success) { tplBad(res, 'Sélectionnez au moins deux lignes à lettrer'); return; }
  res.status(201).json({ success: true, data: await lettrageRepository.letter(r.data.lineIds, { userId: req.user!.userId }) });
}));
ledgerRouter.delete('/lettrage/:id', ...AM, requireVerb('accounting', 'validate'), validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await lettrageRepository.unletter(req.params.id, { userId: req.user!.userId }) });
}));

const tplLine = z.object({
  accountId: z.string().uuid(),
  side: z.enum(['debit', 'credit']),
  amount: z.coerce.number().min(0),
  label: z.string().trim().max(200).nullish(),
});
const tplBody = z.object({
  name: z.string().trim().min(1).max(160),
  journalCode: z.string().trim().max(10).optional(),
  description: z.string().trim().max(2000).nullish(),
  lines: z.array(tplLine).min(2),
});
const tplBad = (res: Response, m = 'Paramètres invalides') => res.status(400).json({ success: false, error: { message: m } });

ledgerRouter.get('/entry-templates', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const storeId = req.user!.role === 'admin' ? undefined : req.user!.storeId;
  res.json({ success: true, data: await tplRepo.list(storeId ?? null) });
}));
ledgerRouter.get('/entry-templates/:id', ...AM, validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const t = await tplRepo.getById(req.params.id);
  if (!t) { res.status(404).json({ success: false, error: { message: 'Modèle introuvable' } }); return; }
  res.json({ success: true, data: t });
}));
ledgerRouter.post('/entry-templates', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = tplBody.safeParse(req.body);
  if (!r.success) { tplBad(res, r.error.issues[0]?.message); return; }
  const out = await tplRepo.create(r.data, { userId: req.user!.userId, storeId: req.user!.storeId ?? null });
  if ('error' in out) { tplBad(res, out.error); return; }
  res.status(201).json({ success: true, data: out });
}));
ledgerRouter.put('/entry-templates/:id', ...AM, validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = tplBody.safeParse(req.body);
  if (!r.success) { tplBad(res, r.error.issues[0]?.message); return; }
  const out = await tplRepo.update(req.params.id, r.data);
  if ('error' in out) { res.status(out.error === 'Modèle introuvable' ? 404 : 400).json({ success: false, error: { message: out.error } }); return; }
  res.json({ success: true, data: out });
}));
ledgerRouter.post('/entry-templates/:id/active', ...AM, validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const out = await tplRepo.setActive(req.params.id, Boolean((req.body as { active?: boolean }).active));
  if (!out) { res.status(404).json({ success: false, error: { message: 'Modèle introuvable' } }); return; }
  res.json({ success: true, data: out });
}));
ledgerRouter.delete('/entry-templates/:id', ...AM, validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  await tplRepo.remove(req.params.id);
  res.json({ success: true, data: null });
}));
ledgerRouter.post('/entry-templates/:id/instantiate', ...AM, validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    label: z.string().trim().max(200).nullish(),
    amounts: z.record(z.string().uuid(), z.coerce.number().min(0)).optional(),
  }).safeParse(req.body);
  if (!r.success) { tplBad(res, r.error.issues[0]?.message); return; }
  const out = await tplRepo.instantiate(req.params.id, { ...r.data, storeId: req.user!.storeId ?? null, userId: req.user!.userId });
  if ('error' in out) { res.status(400).json({ success: false, error: { message: out.error } }); return; }
  res.status(201).json({ success: true, data: out });
}));

// Inaltérabilité (mig 413) : état de la chaîne et des gardes, scellement,
// vérification, journal d'audit des actions comptables.
const actorOf = (req: AuthRequest) => ({ userId: req.user!.userId, ip: req.ip ?? null });
ledgerRouter.get('/integrity', ...AM, asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await integrityRepo.status() });
}));
ledgerRouter.post('/integrity/seal', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await integrityRepo.seal(actorOf(req)) });
}));
ledgerRouter.post('/integrity/verify', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await integrityRepo.verify(actorOf(req)) });
}));
ledgerRouter.get('/audit-log', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({
    event: z.enum(['post', 'reverse', 'draft_delete', 'letter', 'unletter', 'reletter', 'seal', 'verify', 'outbox_replay', 'year_close', 'fec_export']).optional(),
    entryId: z.string().uuid().optional(),
    before: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  }).safeParse(req.query);
  if (!r.success) { tplBad(res, r.error.issues[0]?.message); return; }
  res.json({ success: true, data: await integrityRepo.auditLog(r.data) });
}));

// Reconciliation legacy <-> ledger
ledgerRouter.get('/reconciliation',   authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), reconciliationController.check);

// Etats comptables (grand livre, balance, CPC)
ledgerRouter.get('/general-ledger',      authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), financialStatementsController.generalLedger);
ledgerRouter.get('/general-ledger-full', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), financialStatementsController.generalLedgerFull);
ledgerRouter.get('/balance',          authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), financialStatementsController.balance);
ledgerRouter.get('/income-statement', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), financialStatementsController.incomeStatement);
ledgerRouter.get('/cash-flow',        authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), financialStatementsController.cashFlow);

// Declaration TVA (CA20 Maroc)
ledgerRouter.get('/tva-declaration',  authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), tvaDeclarationController.declaration);

// Bilan (actif / passif)
ledgerRouter.get('/balance-sheet',    authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), balanceSheetController.balanceSheet);

// Backfill des ecritures (admin) — generation depuis l'historique existant
ledgerRouter.post('/backfill',        authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), backfillController.run);
