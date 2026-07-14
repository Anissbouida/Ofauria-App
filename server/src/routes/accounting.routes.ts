import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { caisseController, supplierController, expenseCategoryController, revenueCategoryController, invoiceController, paymentController } from '../controllers/accounting.controller.js';
import { caisseImportController } from '../controllers/caisse-import.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
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
// Read access is granted to PRODUCTION roles too (chefs need to pick a supplier when creating purchase requests).
suppliersRouter.get('/', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), supplierController.list);
suppliersRouter.get('/:id', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), supplierController.getById);
suppliersRouter.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), supplierController.create);
suppliersRouter.put('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), supplierController.update);
suppliersRouter.delete('/:id', authenticate, authorize(ROLES.ADMIN), supplierController.remove);

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
invoicesRouter.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.list);
invoicesRouter.get('/line-expenses', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.lineExpenses);
invoicesRouter.get('/payment-alerts', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.paymentAlerts);
invoicesRouter.get('/debts', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.debts);
invoicesRouter.get('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.getById);
invoicesRouter.put('/line/:id/category', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.updateLineCategory);
invoicesRouter.put('/:id/category', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.updateCategory);
invoicesRouter.put('/:id/items', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.replaceItems);
invoicesRouter.put('/:id/payment-terms', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.updatePaymentTerms);
invoicesRouter.put('/:id/status', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.updateStatusManual);
// PUT /:id : modification complete (admin + gerant) — montants, dates, fournisseur, etc.
invoicesRouter.put('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.update);
invoicesRouter.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.create);
invoicesRouter.post('/from-order/:orderId', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.createFromOrder);
invoicesRouter.post('/merge', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.merge);
invoicesRouter.post('/:id/cancel', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.cancel);
// DELETE /:id : suppression physique (admin + gerant). ?force=true cascade les paiements.
invoicesRouter.delete('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.remove);
invoicesRouter.post('/:id/attachment', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceUpload.single('attachment'), invoiceController.uploadAttachment);
invoicesRouter.delete('/:id/attachment', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.removeAttachment);
invoicesRouter.get('/:id/download-docx', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.downloadDocx);
invoicesRouter.get('/:id/download-pdf', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.downloadDocx);

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
paymentsRouter.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), paymentController.list);
paymentsRouter.get('/summary', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), paymentController.summary);
// Gestion cheques : liste + confirmation/annulation encaissement
paymentsRouter.get('/checks', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), paymentController.listChecks);
paymentsRouter.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), paymentController.create);
paymentsRouter.put('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), paymentController.update);
paymentsRouter.post('/:id/mark-cashed', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), paymentController.markCashed);
// Annulation : admin uniquement (rollback ne dois pas etre routine)
paymentsRouter.post('/:id/unmark-cashed', authenticate, authorize(ROLES.ADMIN), paymentController.unmarkCashed);
// Annulation paiement : elargi a ADMIN_MANAGER (cas d'usage courant
// pour corriger erreurs de saisie : mauvais montant, faux N° cheque, doublon).
// updatePaidAmount() est rejoue dans le delete() -> facture revient au bon statut.
paymentsRouter.delete('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), paymentController.remove);
