import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { customerController } from '../controllers/customer.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate } from '../middleware/validate.middleware.js';
import { customerActionSchema, customerAddressSchema, customerConsentSchema, customerSchema, customerTaxExemptionSchema, portalTokenSchema } from '../validators/customers.validator.js';

// Rate limit strict pour endpoints de lecture agregee / stats
// (evite enumeration d'IDs clients et scraping de donnees).
const statsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Trop de requetes sur les stats clients' } },
});

// Rate limit sur creation / modification (anti-spam).
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Trop d\'operations d\'ecriture sur les clients' } },
});

const router = Router();

router.get('/', authenticate, can('customers.view'), asyncHandler(customerController.list));
router.get('/global-stats', authenticate, can('customers.global_stats.view'), statsLimiter, asyncHandler(customerController.globalStats));
// Doublons probables (phase 4.3) — avant /:id pour ne pas être capturé comme id.
router.get('/check', authenticate, can('customers.check.view'), asyncHandler(customerController.check));
router.get('/:id/situation', authenticate, can('customers.situation.view'), asyncHandler(customerController.situation));
router.get('/:id/statement', authenticate, can('customers.statement.view'), asyncHandler(customerController.statement));
router.get('/:id', authenticate, can('customers.view'), asyncHandler(customerController.getById));
router.get('/:id/stats', authenticate, can('customers.stats.view'), statsLimiter, asyncHandler(customerController.stats));
// Adresses multiples (phase 4.1)
router.get('/:id/addresses', authenticate, can('customers.addresses.view'), asyncHandler(customerController.listAddresses));
router.post('/:id/addresses', authenticate, can('customers.addresses'), writeLimiter, validate(customerAddressSchema), asyncHandler(customerController.createAddress));
router.put('/:id/addresses/:addressId', authenticate, can('customers.addresses'), writeLimiter, validate(customerAddressSchema), asyncHandler(customerController.updateAddress));
router.delete('/:id/addresses/:addressId', authenticate, can('customers.addresses.delete'), writeLimiter, asyncHandler(customerController.removeAddress));
// Attestations d'exonération de TVA (phase 5.7).
router.get('/:id/tax-exemptions', authenticate, can('customers.tax_exemptions.view'), asyncHandler(customerController.listExemptions));
router.post('/:id/tax-exemptions', authenticate, can('customers.tax_exemptions'), writeLimiter, validate(customerTaxExemptionSchema), asyncHandler(customerController.createExemption));
router.delete('/:id/tax-exemptions/:exemptionId', authenticate, can('customers.tax_exemptions.delete'), writeLimiter, asyncHandler(customerController.removeExemption));
// Portail client (phase 10.3) : émettre / consulter / révoquer le jeton d'accès.
router.get('/:id/portal-token', authenticate, can('customers.portal_token.view'), asyncHandler(customerController.portalStatus));
router.post('/:id/portal-token', authenticate, can('customers.portal_token'), writeLimiter, validate(portalTokenSchema), asyncHandler(customerController.issuePortalToken));
router.delete('/:id/portal-token', authenticate, can('customers.portal_token.delete'), writeLimiter, asyncHandler(customerController.revokePortalToken));
router.post('/', authenticate, can('customers.create'), writeLimiter, validate(customerSchema), asyncHandler(customerController.create));
router.put('/:id', authenticate, can('customers.edit'), writeLimiter, validate(customerSchema), asyncHandler(customerController.update));
router.delete('/:id', authenticate, can('customers.delete'), writeLimiter, asyncHandler(customerController.remove));
// Archivage + audit (phase 4.4)
router.get('/:id/history', authenticate, can('customers.history.view'), asyncHandler(customerController.history));
router.post('/:id/restore', authenticate, can('customers.restore'), writeLimiter, validate(customerActionSchema), asyncHandler(customerController.restore));
// Protection des données — loi 09-08 (phase 4.6)
router.put('/:id/consent', authenticate, can('customers.consent'), writeLimiter, validate(customerConsentSchema), asyncHandler(customerController.consent));
router.get('/:id/export', authenticate, can('customers.export.view'), asyncHandler(customerController.exportData));
router.post('/:id/anonymize', authenticate, can('customers.anonymize'), writeLimiter, validate(customerActionSchema), asyncHandler(customerController.anonymize));

export default router;
