import { Router } from 'express';
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

// Reconciliation legacy <-> ledger
ledgerRouter.get('/reconciliation',   authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), reconciliationController.check);

// Etats comptables (grand livre, balance, CPC)
ledgerRouter.get('/general-ledger',      authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), financialStatementsController.generalLedger);
ledgerRouter.get('/general-ledger-full', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), financialStatementsController.generalLedgerFull);
ledgerRouter.get('/balance',          authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), financialStatementsController.balance);
ledgerRouter.get('/income-statement', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), financialStatementsController.incomeStatement);

// Declaration TVA (CA20 Maroc)
ledgerRouter.get('/tva-declaration',  authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), tvaDeclarationController.declaration);

// Bilan (actif / passif)
ledgerRouter.get('/balance-sheet',    authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), balanceSheetController.balanceSheet);

// Backfill des ecritures (admin) — generation depuis l'historique existant
ledgerRouter.post('/backfill',        authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), backfillController.run);
