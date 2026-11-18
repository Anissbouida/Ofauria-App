/**
 * M8-02 — chaque statut partagé (ordre de fabrication, bon de sortie) a une couleur et un ton
 * dans la table unique du module (status.ts), et aucune entrée orpheline n'y traîne.
 */
import { describe, it, expect } from 'vitest';
import { PRODUCTION_STATUS_LABELS, BON_SORTIE_STATUS_LABELS } from '@ofauria/shared';
import { PLAN_STATUS_TAG, PLAN_STATUS_TONE, BON_STATUS_TAG, BON_STATUS_TONE, PLAN_STATUS_ORDER } from './status';

const keys = (o: object) => Object.keys(o).sort();

describe('Statuts de production : source unique (M8-02)', () => {
  it('ordre de fabrication', () => {
    const k = keys(PRODUCTION_STATUS_LABELS);
    expect(keys(PLAN_STATUS_TAG)).toEqual(k);
    expect(keys(PLAN_STATUS_TONE)).toEqual(k);
    expect(keys(PLAN_STATUS_ORDER)).toEqual(k);
  });
  it('bon de sortie', () => {
    const k = keys(BON_SORTIE_STATUS_LABELS);
    expect(keys(BON_STATUS_TAG)).toEqual(k);
    expect(keys(BON_STATUS_TONE)).toEqual(k);
  });
});
