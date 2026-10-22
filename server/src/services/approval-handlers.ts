import { registerApprovalHandler } from './approval.service.js';
import { purchaseOrderRepository } from '../repositories/purchase-order.repository.js';
import { invoiceRepository } from '../repositories/accounting.repository.js';
import { openingInventoryCheckRepository } from '../repositories/opening-inventory-check.repository.js';

/**
 * Effets des approbations par type de pièce (lot 8). Importé une fois par
 * routes/index.ts : le moteur reste indépendant des modules, les modules
 * déclarent ici ce qu'une approbation déclenche.
 */

registerApprovalHandler('purchase_order', {
  async onApproved(request) {
    const po = await purchaseOrderRepository.findById(request.doc_id);
    if (!po) throw new Error('Bon de commande introuvable');
    if (po.status !== 'en_attente') throw new Error(`Le bon n'est plus en attente (statut ${po.status})`);
    await purchaseOrderRepository.updateStatus(request.doc_id, 'envoye');
  },
});

registerApprovalHandler('invoice_cancel', {
  async onApproved(request) {
    const inv = await invoiceRepository.findById(request.doc_id);
    if (!inv) throw new Error('Facture introuvable');
    if (inv.status === 'cancelled') return;
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
