import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { caisseController, expenseCategoryController, revenueCategoryController, invoiceController, paymentController } from '../controllers/accounting.controller.js';
import { caisseImportController } from '../controllers/caisse-import.controller.js';
import { paymentScheduleController } from '../controllers/payment-schedule.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { supplierController } from '../controllers/supplier.controller.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { createSupplierSchema, updateSupplierSchema } from '../validators/supplier.validator.js';
import { reasonCodeSchema } from '../validators/purchase-order-action.validator.js';
import { createPaymentSchema, updatePaymentSchema, voidPaymentSchema, reissuePaymentSchema, internalTransferSchema, cashCumulQuerySchema } from '../validators/payment.validator.js';
import { listActions } from '../services/document-actions.service.js';
import { createInvoiceSchema, updateInvoiceSchema, mergeInvoicesSchema } from '../validators/invoice.validator.js';
import { z } from 'zod';

const manualHoldSchema = z.object({ note: z.string().trim().min(3, 'Précisez la raison du blocage').max(1000) });

// Confrontation d'une facture reçue (lot L1 P2P) : pièce du fournisseur. Les
// champs vides sont ramenés à « absent » (le repository ne vide alors rien).
const optionalMoney = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().nonnegative(),
).optional();
const validateInvoiceSchema = z.object({
  supplierInvoiceNumber: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(100),
  ).optional(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue AAAA-MM-JJ').optional(),
  declaredHt: optionalMoney,
  declaredVat: optionalMoney,
  declaredTtc: optionalMoney,
});
import { can } from '../middleware/permission.middleware.js';
import { ROLES, ROLE_GROUPS } from '@ofauria/shared';
import { emptyBody } from '../validators/common.validator.js';
import { reportOverrideSchema } from '../validators/sales-flow.validator.js';
import * as PF from '../validators/payments-flow.validator.js';
import { createAccountingCategorySchema, updateAccountingCategorySchema } from '../validators/accounting-setup.validator.js';

// G0-04 : la pièce jointe est reçue en mémoire puis écrite dans le stockage objet
// (table files) par le contrôleur — plus rien sur le disque du serveur.
const invoiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

export const caisseRouter = Router();
caisseRouter.get('/register', authenticate, can('accounting.caisse.view'), caisseController.register);
// Ajustement du report mois précédent : admin uniquement
caisseRouter.put('/report-override', authenticate, can('accounting.caisse.edit'), validate(reportOverrideSchema), caisseController.saveReportOverride);
caisseRouter.delete('/report-override', authenticate, can('accounting.caisse.delete'), caisseController.deleteReportOverride);

export const suppliersRouter = Router();
// Lecture ouverte aux rôles de production et au magasinier (choix du fournisseur sur une DA / réception).
const SUPPLIER_READERS = Array.from(new Set([...ROLE_GROUPS.PRODUCTION, ...ROLE_GROUPS.WAREHOUSE]));
suppliersRouter.get('/', authenticate, can('purchasing.suppliers.view'), asyncHandler(supplierController.list));
suppliersRouter.get('/identifier-types', authenticate, can('purchasing.suppliers.identifier_types.view'), asyncHandler(supplierController.identifierTypes));
suppliersRouter.get('/board', authenticate, can('purchasing.suppliers.board.view'), asyncHandler(supplierController.board));
suppliersRouter.get('/board-summary', authenticate, can('purchasing.suppliers.board_summary.view'), asyncHandler(supplierController.boardSummary));
suppliersRouter.get('/check', authenticate, can('purchasing.suppliers.check.view'), asyncHandler(supplierController.check));
suppliersRouter.get('/:id', authenticate, can('purchasing.suppliers.view'), validateUuidParams('id'), asyncHandler(supplierController.getById));
suppliersRouter.get('/:id/history', authenticate, can('purchasing.suppliers.history.view'), validateUuidParams('id'), asyncHandler(supplierController.history));
// G3-11 — export des données du fournisseur (loi 09-08).
suppliersRouter.get('/:id/personal-data', authenticate, can('purchasing.suppliers.personal_data.view'), validateUuidParams('id'), asyncHandler(supplierController.personalData));
suppliersRouter.post('/', authenticate, can('purchasing.suppliers.create'), validate(createSupplierSchema), asyncHandler(supplierController.create));
suppliersRouter.put('/:id', authenticate, can('purchasing.suppliers.edit'), validateUuidParams('id'), validate(updateSupplierSchema), asyncHandler(supplierController.update));
suppliersRouter.delete('/:id', authenticate, can('purchasing.suppliers.delete'), validateUuidParams('id'), asyncHandler(supplierController.remove));

export const expenseCategoriesRouter = Router();
expenseCategoriesRouter.get('/', authenticate, can('accounting.expense_categories.view'), expenseCategoryController.list);
expenseCategoriesRouter.get('/:id/children', authenticate, can('accounting.expense_categories.view'), expenseCategoryController.children);
expenseCategoriesRouter.post('/', authenticate, can('accounting.expense_categories.create'), validate(createAccountingCategorySchema), expenseCategoryController.create);
expenseCategoriesRouter.put('/:id', authenticate, can('accounting.expense_categories.edit'), validate(updateAccountingCategorySchema), expenseCategoryController.update);
expenseCategoriesRouter.delete('/:id', authenticate, can('accounting.expense_categories.delete'), expenseCategoryController.remove);

export const revenueCategoriesRouter = Router();
revenueCategoriesRouter.get('/', authenticate, can('accounting.revenue_categories.view'), revenueCategoryController.list);
revenueCategoriesRouter.get('/:id/children', authenticate, can('accounting.revenue_categories.view'), revenueCategoryController.children);
revenueCategoriesRouter.post('/', authenticate, can('accounting.revenue_categories.create'), validate(createAccountingCategorySchema), revenueCategoryController.create);
revenueCategoriesRouter.put('/:id', authenticate, can('accounting.revenue_categories.edit'), validate(updateAccountingCategorySchema), revenueCategoryController.update);
revenueCategoriesRouter.delete('/:id', authenticate, can('accounting.revenue_categories.delete'), revenueCategoryController.remove);

export const invoicesRouter = Router();
// F-008 : tous les handlers sont async et plusieurs recoivent un :id. Sans
// asyncHandler, une erreur (ex. UUID malforme -> 22P02 Postgres) devient une
// « unhandled rejection » et la requete reste pendante ; validateUuidParams
// refuse en 400 un :id non-UUID avant d'atteindre la base. Meme convention que
// le routeur fournisseurs et les routes factures deja durcies (control, holds).
invoicesRouter.get('/', authenticate, can('accounting.view'), asyncHandler(invoiceController.list));
invoicesRouter.get('/received-board', authenticate, can('accounting.view'), asyncHandler(invoiceController.receivedBoard));
invoicesRouter.get('/received-pipeline', authenticate, can('accounting.view'), asyncHandler(invoiceController.receivedPipeline));
invoicesRouter.get('/tax-codes', authenticate, can('accounting.view'), asyncHandler(invoiceController.taxCodes));
invoicesRouter.get('/line-expenses', authenticate, can('accounting.view'), asyncHandler(invoiceController.lineExpenses));
invoicesRouter.get('/payment-alerts', authenticate, can('accounting.view'), asyncHandler(invoiceController.paymentAlerts));
invoicesRouter.get('/debts', authenticate, can('accounting.view'), asyncHandler(invoiceController.debts));
invoicesRouter.get('/:id', authenticate, can('accounting.view'), validateUuidParams('id'), asyncHandler(invoiceController.getById));
invoicesRouter.put('/line/:id/category', authenticate, can('accounting.category'), validateUuidParams('id'), validate(PF.invoiceLineCategorySchema), asyncHandler(invoiceController.updateLineCategory));
invoicesRouter.put('/:id/category', authenticate, can('accounting.category'), validateUuidParams('id'), validate(PF.invoiceCategorySchema), asyncHandler(invoiceController.updateCategory));
invoicesRouter.put('/:id/items', authenticate, can('accounting.items'), validateUuidParams('id'), validate(PF.replaceInvoiceItemsSchema), asyncHandler(invoiceController.replaceItems));
invoicesRouter.put('/:id/payment-terms', authenticate, can('accounting.payment_terms'), validateUuidParams('id'), validate(PF.invoicePaymentTermsSchema), asyncHandler(invoiceController.updatePaymentTerms));
invoicesRouter.put('/:id/status', authenticate, can('accounting.status'), validateUuidParams('id'), validate(PF.invoiceStatusSchema), asyncHandler(invoiceController.updateStatusManual));
// Litiges (phase 11, D5-59) : montant contesté exclu des relances.
invoicesRouter.get('/disputes/open', authenticate, can('accounting.view'), asyncHandler(invoiceController.openDisputes));
invoicesRouter.get('/:id/disputes', authenticate, can('accounting.view'), validateUuidParams('id'), asyncHandler(invoiceController.listDisputes));
invoicesRouter.post('/:id/disputes', authenticate, can('accounting.disputes'), validateUuidParams('id'), validate(PF.openDisputeSchema), asyncHandler(invoiceController.openDispute));
invoicesRouter.put('/disputes/:disputeId/resolve', authenticate, can('accounting.resolve'), validateUuidParams('disputeId'), validate(PF.resolveDisputeSchema), asyncHandler(invoiceController.resolveDispute));
invoicesRouter.put('/disputes/:disputeId/reject', authenticate, can('accounting.reject'), validateUuidParams('disputeId'), validate(PF.rejectDisputeSchema), asyncHandler(invoiceController.rejectDispute));
// Créances douteuses / irrécouvrables (phase 11, D5-45) : l'irrécouvrable sort des relances.
invoicesRouter.get('/bad-debts/open', authenticate, can('accounting.view'), asyncHandler(invoiceController.openBadDebts));
invoicesRouter.get('/:id/bad-debts', authenticate, can('accounting.view'), validateUuidParams('id'), asyncHandler(invoiceController.listBadDebts));
invoicesRouter.post('/:id/bad-debts', authenticate, can('accounting.bad_debts'), validateUuidParams('id'), validate(PF.classifyBadDebtSchema), asyncHandler(invoiceController.classifyBadDebt));
invoicesRouter.put('/bad-debts/:badDebtId/revert', authenticate, can('accounting.revert'), validateUuidParams('badDebtId'), validate(emptyBody), asyncHandler(invoiceController.revertBadDebt));
// PUT /:id : modification complete (admin + gerant) — montants, dates, fournisseur, etc.
invoicesRouter.put('/:id', authenticate, can('accounting.invoices'), validateUuidParams('id'), validate(updateInvoiceSchema), asyncHandler(invoiceController.update));
invoicesRouter.post('/', authenticate, can('accounting.invoices'), validate(createInvoiceSchema), asyncHandler(invoiceController.create));
invoicesRouter.post('/from-order/:orderId', authenticate, can('accounting.from_order'), validateUuidParams('orderId'), validate(emptyBody), asyncHandler(invoiceController.createFromOrder));
invoicesRouter.post('/merge', authenticate, can('accounting.merge'), validate(mergeInvoicesSchema), asyncHandler(invoiceController.merge));
// Echelonnement d'une facture en N echeances (materiel achete a credit) — mig 258.
invoicesRouter.post('/:id/schedule', authenticate, can('accounting.schedule'), validateUuidParams('id'), validate(PF.invoiceScheduleSchema), asyncHandler(paymentScheduleController.createInvoiceSchedule));
invoicesRouter.post('/:id/cancel', authenticate, can('accounting.cancel'), validateUuidParams('id'), validate(PF.cancelInvoiceSchema), asyncHandler(invoiceController.cancel));
// Avoirs clients (O2C L4, mig 450).
invoicesRouter.get('/:id/credit-notes', authenticate, can('accounting.view'), validateUuidParams('id'), asyncHandler(invoiceController.creditNotes));
invoicesRouter.post('/:id/credit-notes', authenticate, can('accounting.credit_notes'), validateUuidParams('id'), validate(PF.createCreditNoteSchema), asyncHandler(invoiceController.createCreditNote));
invoicesRouter.post('/:id/apply-credit', authenticate, can('accounting.apply_credit'), validateUuidParams('id'), validate(PF.applyCreditSchema), asyncHandler(invoiceController.applyCredit));
// Confrontation : valide une facture reçue en brouillon (lot L1 P2P).
invoicesRouter.post('/:id/validate', authenticate, can('accounting.validate'), validateUuidParams('id'), validate(validateInvoiceSchema), asyncHandler(invoiceController.validate));
// Contrôle et blocages (mig 309).
invoicesRouter.get('/:id/control', authenticate, can('accounting.view'), validateUuidParams('id'), asyncHandler(invoiceController.control));
invoicesRouter.post('/:id/holds', authenticate, can('accounting.holds'), validateUuidParams('id'), validate(manualHoldSchema), asyncHandler(invoiceController.addHold));
invoicesRouter.post('/holds/:holdId/release', authenticate, can('accounting.release'), validateUuidParams('holdId'), validate(reasonCodeSchema), asyncHandler(invoiceController.releaseHold));
// DELETE /:id : suppression physique (admin + gerant). ?force=true cascade les paiements.
invoicesRouter.delete('/:id', authenticate, can('accounting.delete'), validateUuidParams('id'), asyncHandler(invoiceController.remove));
invoicesRouter.post('/:id/attachment', authenticate, can('accounting.attachment'), validateUuidParams('id'), invoiceUpload.single('attachment'), validate(emptyBody), asyncHandler(invoiceController.uploadAttachment));
invoicesRouter.delete('/:id/attachment', authenticate, can('accounting.delete'), validateUuidParams('id'), asyncHandler(invoiceController.removeAttachment));
invoicesRouter.get('/:id/download-docx', authenticate, can('accounting.view'), validateUuidParams('id'), asyncHandler(invoiceController.downloadDocx));
invoicesRouter.get('/:id/download-pdf', authenticate, can('accounting.view'), validateUuidParams('id'), asyncHandler(invoiceController.downloadDocx));

// Upload Excel de caisse (in-memory, 5MB max, .xlsx/.xls)
const caisseImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ext === '.xlsx' || ext === '.xls');
  },
});

export const caisseImportRouter = Router();
caisseImportRouter.post('/preview', authenticate, can('accounting.caisse_import.preview'), caisseImportUpload.single('file'), validate(emptyBody), caisseImportController.preview);
caisseImportRouter.post('/commit', authenticate, can('accounting.caisse_import.commit'), caisseImportUpload.single('file'), validate(emptyBody), caisseImportController.commit);

export const paymentsRouter = Router();
paymentsRouter.get('/', authenticate, can('accounting.view'), asyncHandler(paymentController.list));
paymentsRouter.get('/summary', authenticate, can('accounting.view'), asyncHandler(paymentController.summary));
// Gestion cheques : liste + confirmation/annulation encaissement
paymentsRouter.get('/checks', authenticate, can('accounting.view'), asyncHandler(paymentController.listChecks));
// asyncHandler : un paiement refusé par la base (facture bloquée, mig 309) remonte en 409 lisible.
paymentsRouter.post('/', authenticate, can('accounting.payments'), validate(createPaymentSchema), asyncHandler(paymentController.create));
// Encaissements clients répartis sur plusieurs factures, avances (O2C L5, mig 451).
paymentsRouter.get('/customer-receipts', authenticate, can('accounting.view'), asyncHandler(paymentController.customerReceipts));
paymentsRouter.post('/customer-receipts', authenticate, can('accounting.customer_receipts'), validate(PF.customerReceiptSchema), asyncHandler(paymentController.createCustomerReceipt));
paymentsRouter.post('/customer-receipts/:id/allocate', authenticate, can('accounting.allocate'), validateUuidParams('id'), validate(PF.allocateReceiptSchema), asyncHandler(paymentController.allocateCustomerReceipt));
// Mig 310 (D7) : modes typés, plafond espèces, annulation par contre-pièce, virements internes.
paymentsRouter.get('/modes', authenticate, can('accounting.view'), asyncHandler(paymentController.modes));
paymentsRouter.get('/cash-cumul', authenticate, can('accounting.view'),
  (req, res, next) => { if (!cashCumulQuerySchema.safeParse(req.query).success) { res.status(400).json({ success: false, error: { message: 'Paramètres invalides' } }); return; } next(); },
  asyncHandler(paymentController.cashCumul));
paymentsRouter.get('/cash-limit-breaches', authenticate, can('accounting.view'), asyncHandler(paymentController.cashLimitBreaches));
paymentsRouter.post('/internal-transfer', authenticate, can('accounting.internal_transfer'), validate(internalTransferSchema), asyncHandler(paymentController.internalTransfer));
paymentsRouter.post('/:id/void', authenticate, can('accounting.void'), validateUuidParams('id'), validate(voidPaymentSchema), asyncHandler(paymentController.voidPayment));
paymentsRouter.post('/:id/reissue', authenticate, can('accounting.reissue'), validateUuidParams('id'), validate(reissuePaymentSchema), asyncHandler(paymentController.reissue));
paymentsRouter.get('/:id/actions', authenticate, can('accounting.view'), validateUuidParams('id'),
  asyncHandler(async (req, res) => { res.json({ success: true, data: await listActions('payment', req.params.id) }); }));
paymentsRouter.put('/:id', authenticate, can('accounting.payments'), validateUuidParams('id'), validate(updatePaymentSchema), asyncHandler(paymentController.update));
paymentsRouter.post('/:id/mark-cashed', authenticate, can('accounting.mark_cashed'), validateUuidParams('id'), validate(PF.markCashedSchema), asyncHandler(paymentController.markCashed));
// Annulation : admin uniquement (rollback ne dois pas etre routine)
paymentsRouter.post('/:id/unmark-cashed', authenticate, can('accounting.unmark_cashed'), validateUuidParams('id'), validate(emptyBody), asyncHandler(paymentController.unmarkCashed));
// Annulation paiement : elargi a ADMIN_MANAGER (cas d'usage courant
// pour corriger erreurs de saisie : mauvais montant, faux N° cheque, doublon).
// updatePaidAmount() est rejoue dans le delete() -> facture revient au bon statut.
// Mig 310 : suppression réservée aux brouillons ; un paiement exécuté s'annule (POST /:id/void).
paymentsRouter.delete('/:id', authenticate, can('accounting.delete'), validateUuidParams('id'), asyncHandler(paymentController.remove));
