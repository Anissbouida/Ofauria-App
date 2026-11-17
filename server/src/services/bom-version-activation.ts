import { bomVersionRepository } from '../repositories/bom-version.repository.js';
import { approvalService } from './approval.service.js';

/**
 * Activation d'une version de nomenclature (M4-01 / M4-03). La demande fige le contenu en
 * brouillon puis passe par le moteur d'approbation (type bom_change). Sans règle
 * applicable, la version devient active tout de suite (comportement d'avant M4-03) ;
 * sinon elle attend l'approbation (approval-handlers.ts).
 */
export async function activateBomVersion(recipeId: string, input: { reason: string; validFrom?: string }, userId: string) {
  const draft = await bomVersionRepository.createDraft(recipeId, input, userId);
  try {
    const impact = await bomVersionRepository.impact(draft.id);
    const approval = await approvalService.submit({
      docType: 'bom_change', docId: draft.id,
      docLabel: `${impact.recipe_name} — version ${draft.version_no} (${input.reason})`,
      amount: null,
      values: { cost_change_pct: impact.cost_change_pct, open_orders: impact.open_orders, allergens_added: impact.allergens_added.length },
      requestedBy: userId, storeId: null,
    });
    if (approval.outcome === 'not_required') return { ...(await bomVersionRepository.promote(draft.id, userId)), impact };
    return { pending: true, version_no: draft.version_no, impact };
  } catch (err) {
    await bomVersionRepository.discardDraft(draft.id);
    throw err;
  }
}
