import { Router } from 'express';
import { z } from 'zod';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate } from '../middleware/validate.middleware.js';
import { ROLES, ROLE_GROUPS } from '@ofauria/shared';
import { getParameter, listParameters, setParameter, type ExpenseRequiresPo } from '../services/module-parameters.service.js';

/**
 * Paramètres du module Achats (mig 306). Lecture : gérant/admin (l'écran Charges en a besoin).
 * Écriture : admin, chaque changement est journalisé par l'audit SGBD.
 */
const router = Router();

const expenseRequiresPoSchema = z.object({
  enabled: z.boolean(),
  threshold: z.coerce.number().finite().min(0).max(10_000_000),
  currency: z.string().trim().length(3).toUpperCase().default('MAD'),
});

router.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(async (_req, res) => {
  res.json({ success: true, data: {
    expenseRequiresPo: await getParameter<ExpenseRequiresPo>('purchasing.expense_requires_po'),
    all: await listParameters('purchasing.'),
  } });
}));

router.put('/expense-requires-po', authenticate, authorize(ROLES.ADMIN), validate(expenseRequiresPoSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    const saved = await setParameter('purchasing.expense_requires_po', req.body, req.user!.userId);
    res.json({ success: true, data: saved });
  }));

export default router;
