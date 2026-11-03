import { Router } from 'express';
import { z } from 'zod';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate } from '../middleware/validate.middleware.js';
import { ROLES, ROLE_GROUPS } from '@ofauria/shared';
import { getParameter, listParameters, setParameter, type ExpenseRequiresPo } from '../services/module-parameters.service.js';
import { db } from '../config/database.js';

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

/**
 * Séparation des tâches (lot L2 P2P, mig 442) : règles en vigueur et manquements
 * journalisés (mode « Observer »). Sert au panneau de suivi dans Réglages des achats.
 * Tables absentes (migration non appliquée) : on renvoie des listes vides.
 */
router.get('/sod', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(async (_req, res) => {
  const ready = (await db.query(`SELECT to_regclass('public.sod_violations') IS NOT NULL AS ok`)).rows[0]?.ok;
  if (!ready) { res.json({ success: true, data: { rules: [], violations: [] } }); return; }
  const rules = (await db.query(
    `SELECT code, action, forbidden, label, is_active FROM sod_document_rules ORDER BY code`)).rows;
  const violations = (await db.query(
    `SELECT v.rule_code,
            COALESCE(u.first_name || ' ' || u.last_name, u.email, v.actor_id::text) AS actor,
            count(*)::int AS occurrences,
            count(DISTINCT v.doc_id)::int AS documents,
            max(v.occurred_at) AS last_at
       FROM sod_violations v LEFT JOIN users u ON u.id = v.actor_id
      WHERE v.occurred_at >= now() - INTERVAL '90 days'
      GROUP BY v.rule_code, actor
      ORDER BY occurrences DESC LIMIT 50`)).rows;
  res.json({ success: true, data: { rules, violations } });
}));

export default router;
