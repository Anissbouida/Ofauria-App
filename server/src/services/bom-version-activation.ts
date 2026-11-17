import { bomVersionRepository } from '../repositories/bom-version.repository.js';

/**
 * Activation d'une version de nomenclature (M4-01). Point d'entrée unique : le circuit
 * d'approbation (M4-03) s'y branche.
 */
export async function activateBomVersion(recipeId: string, input: { reason: string; validFrom?: string }, userId: string) {
  return bomVersionRepository.activate(recipeId, input, userId);
}
