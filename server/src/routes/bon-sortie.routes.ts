import { Router } from 'express';
import { bonSortieController } from '../controllers/bon-sortie.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validateUuidParams } from '../middleware/validate.middleware.js';

const router = Router();
const id = validateUuidParams('id');
const ligneId = validateUuidParams('ligneId');
const planId = validateUuidParams('planId');

// Chaque action par id verifie, dans le controleur, que le bon appartient au
// magasin de l'utilisateur (admin sans magasin = acces global).

// Generation manuelle (filet de securite : la confirmation du plan genere le bon)
router.post('/generate', authenticate, can('stock.bons_sortie.generate'), asyncHandler(bonSortieController.generate));

// File d'attente du magasinier (BSI a preparer / en cours / prets pour son magasin)
router.get('/warehouse/queue', authenticate, can('stock.bons_sortie.warehouse_queue.view'), asyncHandler(bonSortieController.getWarehouseQueue));
// Historique magasinier (BSI remis / livres / annules)
router.get('/warehouse/history', authenticate, can('stock.bons_sortie.warehouse_history.view'), asyncHandler(bonSortieController.getWarehouseHistory));
// Lignes BSI a ouvrir depuis l'economat, vue groupee multi-BSI (module Economat)
router.get('/warehouse/transfer-requests', authenticate, can('stock.bons_sortie.warehouse_transfer_requests.view'), asyncHandler(bonSortieController.getTransferRequests));
// Lignes BSI en rupture totale, vue groupee multi-BSI « Ingredients a commander »
router.get('/warehouse/rupture-requests', authenticate, can('stock.bons_sortie.warehouse_rupture_requests.view'), asyncHandler(bonSortieController.getRuptureRequests));

// Lecture
router.get('/plan/:planId', authenticate, planId, can('stock.bons_sortie.plan.view'), asyncHandler(bonSortieController.getByPlan));
router.get('/:id', authenticate, id, can('stock.bons_sortie.view'), asyncHandler(bonSortieController.getById));

// ─── Magasinier : preparation ───
// Prendre en charge (genere -> preparation)
router.put('/:id/preparation', authenticate, id, can('stock.bons_sortie.preparation'), asyncHandler(bonSortieController.markPreparation));
// Pesee d'une ligne : mesure + (ouverture du contenant / choix du lot) en une action
router.put('/ligne/:ligneId', authenticate, ligneId, can('stock.bons_sortie.ligne'), asyncHandler(bonSortieController.updateLigne));
// Pesee groupee : toutes les lignes saisies en une seule transaction (tout ou rien)
router.put('/:id/peser', authenticate, id, can('stock.bons_sortie.peser'), asyncHandler(bonSortieController.weighLignes));
// Lots utilisables pour une ligne (toutes zones) — selecteur « Autre lot »
router.get('/ligne/:ligneId/lots', authenticate, ligneId, can('stock.bons_sortie.ligne_lots.view'), asyncHandler(bonSortieController.listLotsForLigne));
// Lots economat pour une ligne a ouvrir (vue groupee du module Economat)
router.get('/ligne/:ligneId/economat-lots', authenticate, ligneId, can('stock.bons_sortie.ligne_economat_lots.view'), asyncHandler(bonSortieController.listEconomatLotsForLigne));
// Ouvrir un contenant pour une ligne (vue groupee du module Economat)
router.post('/ligne/:ligneId/transfer-from-economat', authenticate, ligneId, can('stock.bons_sortie.transfer_from_economat'), asyncHandler(bonSortieController.transferLineFromEconomat));
// Apres reapprovisionnement : refait le FEFO sur les lignes en attente / rupture
router.put('/:id/complete-pending', authenticate, id, can('stock.bons_sortie.complete_pending'), asyncHandler(bonSortieController.completePending));
// Valider en partiel (reste en attente d'approvisionnement)
router.put('/:id/commit-partial', authenticate, id, can('stock.bons_sortie.commit_partial'), asyncHandler(bonSortieController.commitPartial));
// Remettre au chef (preparation -> pret), avec ou sans manquants signales
router.put('/:id/ready', authenticate, id, can('stock.bons_sortie.ready'), asyncHandler(bonSortieController.markReady));

// ─── Chef : reception ───
// Accepter la reception = prelevement + verification + cloture en une transaction
router.put('/:id/accept-reception', authenticate, id, can('stock.bons_sortie.accept_reception'), asyncHandler(bonSortieController.acceptReception));
// Refuser la reception avec motif (pret -> preparation)
router.put('/:id/chef-reject', authenticate, id, can('stock.bons_sortie.chef_reject'), asyncHandler(bonSortieController.chefReject));

// Annulation (avant prelevement) et regeneration
router.put('/:id/cancel', authenticate, id, can('stock.bons_sortie.cancel'), asyncHandler(bonSortieController.cancel));
router.post('/plan/:planId/regenerate', authenticate, planId, can('stock.bons_sortie.regenerate'), asyncHandler(bonSortieController.regenerate));

export default router;
