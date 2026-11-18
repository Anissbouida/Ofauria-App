/**
 * M8-02 — une seule source de statuts : chaque statut de la machine à états du serveur
 * (ordre de fabrication, bon de sortie) a son libellé dans le paquet partagé, et réciproquement.
 * Échoue si un statut est ajouté d'un côté sans l'autre.
 */
import { describe, it, expect } from 'vitest';
import { PRODUCTION_STATUS_LABELS, BON_SORTIE_STATUS_LABELS } from '@ofauria/shared';
import { PLAN_TRANSITIONS, BON_TRANSITIONS } from '../services/production-state.js';

describe('Garde : libellés de statut (M8-02)', () => {
  it('ordre de fabrication', () => {
    expect(Object.keys(PLAN_TRANSITIONS).sort()).toEqual(Object.keys(PRODUCTION_STATUS_LABELS).sort());
  });
  it('bon de sortie', () => {
    expect(Object.keys(BON_TRANSITIONS).sort()).toEqual(Object.keys(BON_SORTIE_STATUS_LABELS).sort());
  });
});
