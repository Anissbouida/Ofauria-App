import { registerApprovalHandler } from './approval.service.js';
import { paymentRunRepository } from '../repositories/payment-run.repository.js';
import { purchaseOrderRepository } from '../repositories/purchase-order.repository.js';
import { purchaseOrderActionsRepository } from '../repositories/purchase-order-actions.repository.js';
import { purchaseRequestRepository } from '../repositories/purchase-request.repository.js';
import { invoiceRepository } from '../repositories/accounting.repository.js';
import { creditNoteRepository } from '../repositories/credit-note.repository.js';
import { openingInventoryCheckRepository } from '../repositories/opening-inventory-check.repository.js';
import { bomVersionRepository } from '../repositories/bom-version.repository.js';

/**
 * Effets des approbations par type de pièce (lot 8). Importé une fois par
 * routes/index.ts : le moteur reste indépendant des modules, les modules
 * déclarent ici ce qu'une approbation déclenche.
 */

// G4-01 : campagne de paiement fournisseurs approuvée → le fichier de virement peut être édité ;
// refusée → retour en brouillon.
registerApprovalHandler('payment_run', {
  async onApproved(request, actorId) { await paymentRunRepository.decide(request.doc_id, true, actorId); },
  async onRejected(request, actorId) { await paymentRunRepository.decide(request.doc_id, false, actorId); },
});

registerApprovalHandler('purchase_request', {
  // Flux procure-to-pay (mig 456) : la décision pose approval_status sur la DA,
  // dimension distincte du statut de couverture. Approuvée → commandable ;
  // refusée → non commandable. Aucune action BC ici : le BC est créé plus tard,
  // explicitement, depuis l'onglet Demande d'achat.
  async onApproved(request) {
    await purchaseRequestRepository.setApprovalStatus(request.doc_id, 'approved');
  },
  async onRejected(request) {
    await purchaseRequestRepository.setApprovalStatus(request.doc_id, 'rejected');
  },
});

registerApprovalHandler('purchase_order', {
  async onApproved(request, actorId) {
    const po = await purchaseOrderRepository.findById(request.doc_id);
    if (!po) throw new Error('Bon de commande introuvable');
    if (po.status !== 'en_attente') throw new Error(`Le bon n'est plus en attente (statut ${po.status})`);
    // Même envoi qu'un envoi direct (mig 306/307) : verrou, version 0 figée,
    // action « envoyé » journalisée au nom de l'approbateur.
    await purchaseOrderActionsRepository.send(request.doc_id, actorId);
  },
});

registerApprovalHandler('invoice_cancel', {
  async onApproved(request, actorId) {
    const inv = await invoiceRepository.findById(request.doc_id);
    if (!inv) throw new Error('Facture introuvable');
    if (inv.status === 'cancelled') return;
    // Facture client : avoir d'annulation AV (O2C L4) ; reçue : statut annulé comme avant.
    if (inv.invoice_type === 'emitted') {
      await creditNoteRepository.create({ invoiceId: request.doc_id, reason: 'cancellation', userId: actorId });
      return;
    }
    await invoiceRepository.updateStatus(request.doc_id, 'cancelled');
  },
});

registerApprovalHandler('inventory_count', {
  async onApproved(request, actorId) {
    await openingInventoryCheckRepository.validateOpeningCheck({ checkId: request.doc_id, validatedBy: actorId, action: 'approve' });
  },
  async onRejected(request, actorId, reason) {
    await openingInventoryCheckRepository.validateOpeningCheck({ checkId: request.doc_id, validatedBy: actorId, action: 'reject', rejectionReason: reason });
  },
});

// M4-03 : modification de nomenclature approuvée → la version brouillon devient active ;
// refusée → le brouillon est retiré (la fiche garde ses modifications non activées).
registerApprovalHandler('bom_change', {
  async onApproved(request, actorId) { await bomVersionRepository.promote(request.doc_id, actorId); },
  async onRejected(request) { await bomVersionRepository.discardDraft(request.doc_id); },
});

// Étape 6 multi-industries — approbations de production.
registerApprovalHandler('production_order', {
  async onApproved(request, actorId) {
    const { productionRepository } = await import('../repositories/production.repository.js');
    await productionRepository.confirm(request.doc_id, actorId);
  },
});
registerApprovalHandler('production_start', {
  async onApproved(request, actorId) {
    const { productionRepository } = await import('../repositories/production.repository.js');
    await productionRepository.start(request.doc_id, actorId);
  },
});
// Clôture : la déclaration porte les quantités saisies ; l'approbation la laisse passer à la tentative suivante.
registerApprovalHandler('production_closure', { async onApproved() { /* rien à appliquer */ } });
registerApprovalHandler('lot_release', {
  async onApproved(request, actorId) {
    const { lotReleaseRepository } = await import('../repositories/lot-release.repository.js');
    await lotReleaseRepository.releaseProductLot(request.doc_id, actorId, 'Libéré sur approbation');
  },
});
registerApprovalHandler('nonconformity', {
  async onApproved(request) {
    const { qualityRepository } = await import('../repositories/quality.repository.js');
    await qualityRepository.updateNonConformity(request.doc_id, { status: 'closed' });
  },
});
