import { Router } from 'express';
import { caisseController, supplierController, expenseCategoryController, invoiceController, paymentController } from '../controllers/accounting.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';

const ADMIN_MANAGER = ['admin', 'manager'] as const;

export const caisseRouter = Router();
caisseRouter.get('/register', authenticate, authorize('admin'), caisseController.register);

export const suppliersRouter = Router();
suppliersRouter.get('/', authenticate, authorize(...ADMIN_MANAGER), supplierController.list);
suppliersRouter.get('/:id', authenticate, authorize(...ADMIN_MANAGER), supplierController.getById);
suppliersRouter.post('/', authenticate, authorize(...ADMIN_MANAGER), supplierController.create);
suppliersRouter.put('/:id', authenticate, authorize(...ADMIN_MANAGER), supplierController.update);
suppliersRouter.delete('/:id', authenticate, authorize('admin'), supplierController.remove);

export const expenseCategoriesRouter = Router();
expenseCategoriesRouter.get('/', authenticate, authorize(...ADMIN_MANAGER), expenseCategoryController.list);
expenseCategoriesRouter.post('/', authenticate, authorize('admin'), expenseCategoryController.create);
expenseCategoriesRouter.put('/:id', authenticate, authorize('admin'), expenseCategoryController.update);
expenseCategoriesRouter.delete('/:id', authenticate, authorize('admin'), expenseCategoryController.remove);

export const invoicesRouter = Router();
invoicesRouter.get('/', authenticate, authorize(...ADMIN_MANAGER), invoiceController.list);
invoicesRouter.get('/:id', authenticate, authorize(...ADMIN_MANAGER), invoiceController.getById);
invoicesRouter.post('/', authenticate, authorize(...ADMIN_MANAGER), invoiceController.create);
invoicesRouter.post('/:id/cancel', authenticate, authorize(...ADMIN_MANAGER), invoiceController.cancel);

export const paymentsRouter = Router();
paymentsRouter.get('/', authenticate, authorize(...ADMIN_MANAGER), paymentController.list);
paymentsRouter.get('/summary', authenticate, authorize(...ADMIN_MANAGER), paymentController.summary);
paymentsRouter.post('/', authenticate, authorize(...ADMIN_MANAGER), paymentController.create);
paymentsRouter.delete('/:id', authenticate, authorize('admin'), paymentController.remove);
