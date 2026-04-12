import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { caisseController, supplierController, expenseCategoryController, revenueCategoryController, invoiceController, paymentController } from '../controllers/accounting.controller.js';
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

export const suppliersRouter = Router();
suppliersRouter.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), supplierController.list);
suppliersRouter.get('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), supplierController.getById);
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
invoicesRouter.get('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.getById);
invoicesRouter.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.create);
invoicesRouter.post('/from-order/:orderId', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.createFromOrder);
invoicesRouter.post('/:id/cancel', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.cancel);
invoicesRouter.post('/:id/attachment', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceUpload.single('attachment'), invoiceController.uploadAttachment);
invoicesRouter.delete('/:id/attachment', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.removeAttachment);
invoicesRouter.get('/:id/download-docx', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.downloadDocx);
invoicesRouter.get('/:id/download-pdf', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), invoiceController.downloadDocx);

export const paymentsRouter = Router();
paymentsRouter.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), paymentController.list);
paymentsRouter.get('/summary', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), paymentController.summary);
paymentsRouter.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), paymentController.create);
paymentsRouter.put('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), paymentController.update);
paymentsRouter.delete('/:id', authenticate, authorize(ROLES.ADMIN), paymentController.remove);
