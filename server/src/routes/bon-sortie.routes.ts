import { Router } from 'express';
import { bonSortieController } from '../controllers/bon-sortie.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { z } from 'zod';
import { emptyBody } from '../validators/common.validator.js';
import {
  generateBonBody, regenerateBonBody, updateLigneBody, weighLignesBody, markReadyBody, chefRejectBody, cancelBonBody, transferLineBody,
} from '../validators/production-flow.validator.js';

const substituteSchema = z.object({
  substitutionId: z.string().guid(),
  reason: z.string().trim().min(3, 'Motif requis').max(500),
});

// Audit 2026-11 C-28 : retour de matière au magasin, ligne par ligne et lot par lot.
const returnSchema = z.object({
  reason: z.string().trim().min(3, 'Motif requis').max(500),
  lines: z.array(z.object({
    ligneId: z.string().guid(), lotId: z.string().guid(),
    quantity: z.number().positive().max(1e6), planItemId: z.string().guid().nullable().optional(),
  })).min(1).max(200),
});

const router = Router();
const id = validateUuidParams('id');
const ligneId = validateUuidParams('ligneId');
const planId = validateUuidParams('planId');

// Chaque action par id verifie, dans le controleur, que le bon appartient au
// magasin de l'utilisateur (admin sans magasin = acces global).

// Generation manuelle (filet de securite : la confirmation du plan genere le bon)
router.post('/generate', authenticate, can('stock.bons_sortie.generate'), validate(generateBonBody), asyncHandler(bonSortieController.generate));

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
router.put('/:id/preparation', authenticate, id, can('stock.bons_sortie.preparation'), validate(emptyBody), asyncHandler(bonSortieController.markPreparation));
// Pesee d'une ligne : mesure + (ouverture du contenant / choix du lot) en une action
router.put('/ligne/:ligneId', authenticate, ligneId, can('stock.bons_sortie.ligne'), validate(updateLigneBody), asyncHandler(bonSortieController.updateLigne));
// Pesee groupee : toutes les lignes saisies en une seule transaction (tout ou rien)
router.put('/:id/peser', authenticate, id, can('stock.bons_sortie.peser'), validate(weighLignesBody), asyncHandler(bonSortieController.weighLignes));
// Lots utilisables pour une ligne (toutes zones) — selecteur « Autre lot »
router.get('/ligne/:ligneId/lots', authenticate, ligneId, can('stock.bons_sortie.ligne_lots.view'), asyncHandler(bonSortieController.listLotsForLigne));
// Lots economat pour une ligne a ouvrir (vue groupee du module Economat)
router.get('/ligne/:ligneId/economat-lots', authenticate, ligneId, can('stock.bons_sortie.ligne_economat_lots.view'), asyncHandler(bonSortieController.listEconomatLotsForLigne));
// Substituts d'article (M4-05) : proposés sur une ligne non pesée, bascule tracée
router.get('/ligne/:ligneId/substitutes', authenticate, ligneId, can('stock.bons_sortie.ligne_lots.view'), asyncHandler(bonSortieController.listSubstitutesForLigne));
router.post('/ligne/:ligneId/substitute', authenticate, ligneId, can('stock.bons_sortie.ligne'), validate(substituteSchema), asyncHandler(bonSortieController.substituteLigne));
router.get('/plan/:planId/allergens', authenticate, planId, can('stock.bons_sortie.plan.view'), asyncHandler(bonSortieController.actualAllergens));
// Ouvrir un contenant pour une ligne (vue groupee du module Economat)
router.post('/ligne/:ligneId/transfer-from-economat', authenticate, ligneId, can('stock.bons_sortie.transfer_from_economat'), validate(transferLineBody), asyncHandler(bonSortieController.transferLineFromEconomat));
// Apres reapprovisionnement : refait le FEFO sur les lignes en attente / rupture
router.put('/:id/complete-pending', authenticate, id, can('stock.bons_sortie.complete_pending'), validate(emptyBody), asyncHandler(bonSortieController.completePending));
// Valider en partiel (reste en attente d'approvisionnement)
router.put('/:id/commit-partial', authenticate, id, can('stock.bons_sortie.commit_partial'), validate(emptyBody), asyncHandler(bonSortieController.commitPartial));
// Remettre au chef (preparation -> pret), avec ou sans manquants signales
router.put('/:id/ready', authenticate, id, can('stock.bons_sortie.ready'), validate(markReadyBody), asyncHandler(bonSortieController.markReady));

// ─── Chef : reception ───
// Accepter la reception = prelevement + verification + cloture en une transaction
router.put('/:id/accept-reception', authenticate, id, can('stock.bons_sortie.accept_reception'), validate(emptyBody), asyncHandler(bonSortieController.acceptReception));
// Refuser la reception avec motif (pret -> preparation)
router.put('/:id/chef-reject', authenticate, id, can('stock.bons_sortie.chef_reject'), validate(chefRejectBody), asyncHandler(bonSortieController.chefReject));

// Annulation (avant prelevement) et regeneration
router.get('/:id/returns', authenticate, id, can('stock.bons_sortie.view'), asyncHandler(bonSortieController.returnable));
router.post('/:id/returns', authenticate, id, can('stock.bons_sortie.return'), validate(returnSchema), asyncHandler(bonSortieController.returnMaterial));
router.put('/:id/cancel', authenticate, id, can('stock.bons_sortie.cancel'), validate(cancelBonBody), asyncHandler(bonSortieController.cancel));
router.post('/plan/:planId/regenerate', authenticate, planId, can('stock.bons_sortie.regenerate'), validate(regenerateBonBody), asyncHandler(bonSortieController.regenerate));

export default router;
