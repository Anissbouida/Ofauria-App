import { registerApprovalHandler } from './approval.service.js';
import { purchaseOrderRepository } from '../repositories/purchase-order.repository.js';
import { purchaseOrderActionsRepository } from '../repositories/purchase-order-actions.repository.js';
import { purchaseRequestRepository } from '../repositories/purchase-request.repository.js';
import { invoiceRepository } from '../repositories/accounting.repository.js';
import { creditNoteRepository } from '../repositories/credit-note.repository.js';
import { openingInventoryCheckRepository } from '../repositories/opening-inventory-check.repository.js';

/**
 * Effets des approbations par type de pièce (lot 8). Importé une fois par
 * routes/index.ts : le moteur reste indépendant des modules, les modules
 * déclarent ici ce qu'une approbation déclenche.
 */

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
