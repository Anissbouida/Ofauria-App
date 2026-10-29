import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { journalTemplateRepository as tplRepo } from '../repositories/journal-template.repository.js';
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
ledgerRouter.get('/outbox', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(purchaseLedgerController.outbox));
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
