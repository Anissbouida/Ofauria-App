import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
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
import { z } from 'zod';

const manualHoldSchema = z.object({ note: z.string().trim().min(3, 'Précisez la raison du blocage').max(1000) });
import { authorize } from '../middleware/role.middleware.js';
import { ROLES, ROLE_GROUPS } from '@ofauria/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const invoiceStorage = multer.diskStorage({
  destination: path.resolve(__dirname, '../../../uploads/invoices'),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `facture-${Date.now()}-${Math.round(Math.random() * 1000)}${ext}`);
  },
});
const invoiceUpload = multer({
  storage: invoiceStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

export const caisseRouter = Router();
caisseRouter.get('/register', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), caisseController.register);
// Ajustement du report mois précédent : admin uniquement
caisseRouter.put('/report-override', authenticate, authorize(ROLES.ADMIN), caisseController.saveReportOverride);
caisseRouter.delete('/report-override', authenticate, authorize(ROLES.ADMIN), caisseController.deleteReportOverride);

export const suppliersRouter = Router();
// Lecture ouverte aux rôles de production et au magasinier (choix du fournisseur sur une DA / réception).
const SUPPLIER_READERS = Array.from(new Set([...ROLE_GROUPS.PRODUCTION, ...ROLE_GROUPS.WAREHOUSE]));
suppliersRouter.get('/', authenticate, authorize(...SUPPLIER_READERS), asyncHandler(supplierController.list));
suppliersRouter.get('/identifier-types', authenticate, authorize(...SUPPLIER_READERS), asyncHandler(supplierController.identifierTypes));
suppliersRouter.get('/board', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(supplierController.board));
suppliersRouter.get('/board-summary', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(supplierController.boardSummary));
suppliersRouter.get('/check', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(supplierController.check));
suppliersRouter.get('/:id', authenticate, authorize(...SUPPLIER_READERS), validateUuidParams('id'), asyncHandler(supplierController.getById));
suppliersRouter.get('/:id/history', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(supplierController.history));
suppliersRouter.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(createSupplierSchema), asyncHandler(supplierController.create));
suppliersRouter.put('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), validate(updateSupplierSchema), asyncHandler(supplierController.update));
suppliersRouter.delete('/:id', authenticate, authorize(ROLES.ADMIN), validateUuidParams('id'), asyncHandler(supplierController.remove));

export const expenseCategoriesRouter = Router();
expenseCategoriesRouter.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), expenseCategoryController.list);
expenseCategoriesRouter.get('/:id/children', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), expenseCategoryController.children);
expenseCategoriesRouter.post('/', authenticate, authorize(ROLES.ADMIN), expenseCategoryController.create);
expenseCategoriesRouter.put('/:id', authenticate, authorize(ROLES.ADMIN), expenseCategoryController.update);
expenseCategoriesRouter.delete('/:id', authenticate, authorize(ROLES.ADMIN), expenseCategoryController.remove);

export const revenueCategoriesRouter = Router();
revenueCategoriesRouter.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), revenueCategoryController.list);
revenueCategoriesRouter.get('/:id/children', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), revenueCategoryController.children);
revenueCategoriesRouter.post('/', authenticate, authorize(ROLES.ADMIN), revenueCategoryController.create);
revenueCategoriesRouter.put('/:id', authenticate, authorize(ROLES.ADMIN), revenueCategoryController.update);
revenueCategoriesRouter.delete('/:id', authenticate, authorize(ROLES.ADMIN), revenueCategoryController.remove);

export const invoicesRouter = Router();
// F-008 : tous les handlers sont async et plusieurs recoivent un :id. Sans
// asyncHandler, une erreur (ex. UUID malforme -> 22P02 Postgres) devient une
// « unhandled rejection » et la requete reste pendante ; validateUuidParams
// refuse en 400 un :id non-UUID avant d'atteindre la base. Meme convention que
// le routeur fournisseurs et les routes factures deja durcies (control, holds).
invoicesRouter.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(invoiceController.list));
invoicesRouter.get('/received-board', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(invoiceController.receivedBoard));
invoicesRouter.get('/received-pipeline', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(invoiceController.receivedPipeline));
invoicesRouter.get('/tax-codes', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(invoiceController.taxCodes));
invoicesRouter.get('/line-expenses', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(invoiceController.lineExpenses));
invoicesRouter.get('/payment-alerts', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(invoiceController.paymentAlerts));
invoicesRouter.get('/debts', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(invoiceController.debts));
invoicesRouter.get('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(invoiceController.getById));
invoicesRouter.put('/line/:id/category', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(invoiceController.updateLineCategory));
invoicesRouter.put('/:id/category', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(invoiceController.updateCategory));
invoicesRouter.put('/:id/items', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(invoiceController.replaceItems));
invoicesRouter.put('/:id/payment-terms', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(invoiceController.updatePaymentTerms));
invoicesRouter.put('/:id/status', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(invoiceController.updateStatusManual));
// PUT /:id : modification complete (admin + gerant) — montants, dates, fournisseur, etc.
invoicesRouter.put('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(invoiceController.update));
invoicesRouter.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(invoiceController.create));
invoicesRouter.post('/from-order/:orderId', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('orderId'), asyncHandler(invoiceController.createFromOrder));
invoicesRouter.post('/merge', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(invoiceController.merge));
// Echelonnement d'une facture en N echeances (materiel achete a credit) — mig 258.
invoicesRouter.post('/:id/schedule', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(paymentScheduleController.createInvoiceSchedule));
invoicesRouter.post('/:id/cancel', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(invoiceController.cancel));
// Contrôle et blocages (mig 309).
invoicesRouter.get('/:id/control', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(invoiceController.control));
invoicesRouter.post('/:id/holds', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), validate(manualHoldSchema), asyncHandler(invoiceController.addHold));
invoicesRouter.post('/holds/:holdId/release', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('holdId'), validate(reasonCodeSchema), asyncHandler(invoiceController.releaseHold));
// DELETE /:id : suppression physique (admin + gerant). ?force=true cascade les paiements.
invoicesRouter.delete('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(invoiceController.remove));
invoicesRouter.post('/:id/attachment', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), invoiceUpload.single('attachment'), asyncHandler(invoiceController.uploadAttachment));
invoicesRouter.delete('/:id/attachment', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(invoiceController.removeAttachment));
invoicesRouter.get('/:id/download-docx', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(invoiceController.downloadDocx));
invoicesRouter.get('/:id/download-pdf', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(invoiceController.downloadDocx));

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
caisseImportRouter.post('/preview', authenticate, authorize(ROLES.ADMIN), caisseImportUpload.single('file'), caisseImportController.preview);
caisseImportRouter.post('/commit', authenticate, authorize(ROLES.ADMIN), caisseImportUpload.single('file'), caisseImportController.commit);

export const paymentsRouter = Router();
paymentsRouter.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(paymentController.list));
paymentsRouter.get('/summary', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(paymentController.summary));
// Gestion cheques : liste + confirmation/annulation encaissement
paymentsRouter.get('/checks', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(paymentController.listChecks));
// asyncHandler : un paiement refusé par la base (facture bloquée, mig 309) remonte en 409 lisible.
paymentsRouter.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(createPaymentSchema), asyncHandler(paymentController.create));
// Mig 310 (D7) : modes typés, plafond espèces, annulation par contre-pièce, virements internes.
paymentsRouter.get('/modes', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(paymentController.modes));
paymentsRouter.get('/cash-cumul', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER),
  (req, res, next) => { if (!cashCumulQuerySchema.safeParse(req.query).success) { res.status(400).json({ success: false, error: { message: 'Paramètres invalides' } }); return; } next(); },
  asyncHandler(paymentController.cashCumul));
paymentsRouter.get('/cash-limit-breaches', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(paymentController.cashLimitBreaches));
paymentsRouter.post('/internal-transfer', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(internalTransferSchema), asyncHandler(paymentController.internalTransfer));
paymentsRouter.post('/:id/void', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), validate(voidPaymentSchema), asyncHandler(paymentController.voidPayment));
paymentsRouter.post('/:id/reissue', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), validate(reissuePaymentSchema), asyncHandler(paymentController.reissue));
paymentsRouter.get('/:id/actions', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'),
  asyncHandler(async (req, res) => { res.json({ success: true, data: await listActions('payment', req.params.id) }); }));
paymentsRouter.put('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), validate(updatePaymentSchema), asyncHandler(paymentController.update));
paymentsRouter.post('/:id/mark-cashed', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(paymentController.markCashed));
// Annulation : admin uniquement (rollback ne dois pas etre routine)
paymentsRouter.post('/:id/unmark-cashed', authenticate, authorize(ROLES.ADMIN), validateUuidParams('id'), asyncHandler(paymentController.unmarkCashed));
// Annulation paiement : elargi a ADMIN_MANAGER (cas d'usage courant
// pour corriger erreurs de saisie : mauvais montant, faux N° cheque, doublon).
// updatePaidAmount() est rejoue dans le delete() -> facture revient au bon statut.
// Mig 310 : suppression réservée aux brouillons ; un paiement exécuté s'annule (POST /:id/void).
paymentsRouter.delete('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(paymentController.remove));
