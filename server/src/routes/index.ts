import { Router } from 'express';
import authRoutes from './auth.routes.js';
import categoriesRoutes from './categories.routes.js';
import productsRoutes from './products.routes.js';
import ordersRoutes from './orders.routes.js';
import customersRoutes from './customers.routes.js';
import inventoryRoutes, { ingredientsRouter } from './inventory.routes.js';
import recipesRoutes from './recipes.routes.js';
import employeesRoutes, { schedulesRouter } from './employees.routes.js';
import reportsRoutes from './reports.routes.js';
import productionRoutes from './production.routes.js';
import salesRoutes from './sales.routes.js';
import usersRoutes from './users.routes.js';
import settingsRoutes from './settings.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/categories', categoriesRoutes);
router.use('/products', productsRoutes);
router.use('/orders', ordersRoutes);
router.use('/customers', customersRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/ingredients', ingredientsRouter);
router.use('/recipes', recipesRoutes);
router.use('/employees', employeesRoutes);
router.use('/schedules', schedulesRouter);
router.use('/reports', reportsRoutes);
router.use('/production', productionRoutes);
router.use('/sales', salesRoutes);
router.use('/settings', settingsRoutes);

export default router;
