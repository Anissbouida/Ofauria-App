import { Router } from 'express';
import { bonSortieController } from '../controllers/bon-sortie.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

// Generate a bon de sortie from plan needs
router.post('/generate', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(bonSortieController.generate));

// File d'attente du magasinier (BSI en 'genere' / 'preparation' / 'pret' pour son store)
router.get('/warehouse/queue', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), asyncHandler(bonSortieController.getWarehouseQueue));
// Historique magasinier (BSI 'prelevement' / 'verifie' / 'cloture' / 'annule')
router.get('/warehouse/history', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), asyncHandler(bonSortieController.getWarehouseHistory));
// Lignes BSI en attente de transfert Economat -> Pesage (module Economat / InventoryPage)
router.get('/warehouse/transfer-requests', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), asyncHandler(bonSortieController.getTransferRequests));
// Lignes BSI en rupture totale, vue cross-BSI pour onglet "Ingredients a commander" (module Economat)
router.get('/warehouse/rupture-requests', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), asyncHandler(bonSortieController.getRuptureRequests));

// Get bon(s) for a plan
router.get('/plan/:planId', authenticate, asyncHandler(bonSortieController.getByPlan));

// Get single bon by id
router.get('/:id', authenticate, asyncHandler(bonSortieController.getById));

// Workflow actions
router.put('/:id/prelevement', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(bonSortieController.startPrelevement));
router.put('/ligne/:ligneId', authenticate, authorize(...ROLE_GROUPS.PRODUCTION, 'magasinier'), asyncHandler(bonSortieController.updateLigne));
router.put('/:id/verify', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(bonSortieController.verify));
router.put('/:id/close', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(bonSortieController.close));
router.put('/:id/cancel', authenticate, authorize(...ROLE_GROUPS.PRODUCTION, 'magasinier'), asyncHandler(bonSortieController.cancel));

// ─── Workflow Magasinier (nouveau) ───
// Le magasinier prend en charge un BSI (genere -> preparation)
router.put('/:id/preparation', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), asyncHandler(bonSortieController.markPreparation));
// Le magasinier marque le BSI comme pret a remettre (preparation -> pret)
router.put('/:id/ready', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), asyncHandler(bonSortieController.markReady));
// Le chef refuse la reception avec motif (pret -> preparation)
router.put('/:id/chef-reject', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(bonSortieController.chefReject));

// Magasinier : lister les lots Economat disponibles pour une ligne BSI (FEFO),
// pour permettre la confirmation ou substitution du lot suggere avant transfert.
router.get('/ligne/:ligneId/economat-lots', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), asyncHandler(bonSortieController.listEconomatLotsForLigne));
// Magasinier : transferer une ligne BSI Economat -> Pesage (ouverture contenant)
router.post('/ligne/:ligneId/transfer-from-economat', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), asyncHandler(bonSortieController.transferLineFromEconomat));

// BSI partiel : commit ce qui est preleve, garde le reste en attente d'approvisionnement
router.put('/:id/commit-partial', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), asyncHandler(bonSortieController.commitPartial));
// Apres reapprovisionnement : refait le FEFO sur les lignes en attente
router.put('/:id/complete-pending', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), asyncHandler(bonSortieController.completePending));

// Ecart handling
router.put('/:id/ecart/:ligneId', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(bonSortieController.handleEcart));

// Regenerate bon for a plan
router.post('/plan/:planId/regenerate', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(bonSortieController.regenerate));

export default router;
