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
} from '../controllers/ledger.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
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
ledgerRouter.patch('/fiscal-periods/:id/status', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), fiscalPeriodController.updateStatus);

// Ecritures comptables
ledgerRouter.get('/entries',          authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), journalEntryController.list);
ledgerRouter.get('/entries/:id',      authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), journalEntryController.getById);

// Reconciliation legacy <-> ledger
ledgerRouter.get('/reconciliation',   authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), reconciliationController.check);

// Etats comptables (grand livre, balance, CPC)
ledgerRouter.get('/general-ledger',   authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), financialStatementsController.generalLedger);
ledgerRouter.get('/balance',          authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), financialStatementsController.balance);
ledgerRouter.get('/income-statement', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), financialStatementsController.incomeStatement);

// Declaration TVA (CA20 Maroc)
ledgerRouter.get('/tva-declaration',  authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), tvaDeclarationController.declaration);

// Bilan (actif / passif)
ledgerRouter.get('/balance-sheet',    authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), balanceSheetController.balanceSheet);

// Backfill des ecritures (admin) — generation depuis l'historique existant
ledgerRouter.post('/backfill',        authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), backfillController.run);
