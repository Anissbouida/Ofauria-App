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
} from '../controllers/ledger.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLES } from '@ofauria/shared';

// Phase 1 : tout est en lecture seule et reserve a l'admin. L'admin pourra
// etendre l'acces (gerant en lecture, etc.) via le module Utilisateurs lorsque
// le besoin se confirme.

export const ledgerRouter = Router();

// Plan comptable
ledgerRouter.get('/accounts',         authenticate, authorize(ROLES.ADMIN), planComptableController.list);
ledgerRouter.get('/accounts/:code',   authenticate, authorize(ROLES.ADMIN), planComptableController.getByCode);

// Sous-comptes tiers (auxiliaires)
ledgerRouter.get('/auxiliaries',      authenticate, authorize(ROLES.ADMIN), accountAuxiliaryController.list);

// Journaux
ledgerRouter.get('/journals',         authenticate, authorize(ROLES.ADMIN), journalController.list);

// Periodes fiscales
ledgerRouter.get('/fiscal-periods',   authenticate, authorize(ROLES.ADMIN), fiscalPeriodController.list);

// Ecritures comptables
ledgerRouter.get('/entries',          authenticate, authorize(ROLES.ADMIN), journalEntryController.list);
ledgerRouter.get('/entries/:id',      authenticate, authorize(ROLES.ADMIN), journalEntryController.getById);

// Reconciliation legacy <-> ledger
ledgerRouter.get('/reconciliation',   authenticate, authorize(ROLES.ADMIN), reconciliationController.check);

// Etats comptables (grand livre, balance, CPC)
ledgerRouter.get('/general-ledger',   authenticate, authorize(ROLES.ADMIN), financialStatementsController.generalLedger);
ledgerRouter.get('/balance',          authenticate, authorize(ROLES.ADMIN), financialStatementsController.balance);
ledgerRouter.get('/income-statement', authenticate, authorize(ROLES.ADMIN), financialStatementsController.incomeStatement);

// Declaration TVA (CA20 Maroc)
ledgerRouter.get('/tva-declaration',  authenticate, authorize(ROLES.ADMIN), tvaDeclarationController.declaration);
