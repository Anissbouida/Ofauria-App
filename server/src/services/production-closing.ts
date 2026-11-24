/**
 * Suites d'un plan terminé : coût réel puis écriture de production.
 *
 * Avant, ces deux appels vivaient dans le contrôleur de la clôture manuelle. Or le chemin
 * normal est la clôture automatique (dernier article déclaré) : 88 % des plans terminés
 * n'avaient ni coût réel ni écriture (audit 2026-11, C-01). Tout chemin qui termine un plan
 * passe désormais ici, après la validation de sa transaction.
 *
 * Non bloquant : une production enregistrée ne doit pas être refusée parce que le chiffrage
 * échoue. L'échec est journalisé ; le rattrapage se fait par « calculer les plans non chiffrés ».
 */
import { productionCoutRepository } from '../repositories/production-cout.repository.js';
import { postProductionEntry } from './production-ledger.js';
import { logger } from '../utils/logger.js';

export async function finalizeCompletedPlan(planId: string, userId: string): Promise<{ costed: boolean }> {
  try {
    await productionCoutRepository.calculateAndSave(planId, userId);
    // Écriture en inventaire permanent : politique éteinte par défaut, sans effet sinon.
    await postProductionEntry(planId, userId);
    return { costed: true };
  } catch (err) {
    logger.error({ err, planId }, 'Coût réel non calculé à la clôture du plan (non bloquant)');
    return { costed: false };
  }
}
