/**
 * Phase 8.2 — fermeture paramétrable : contrôle des invendus optionnel.
 * Par défaut (aucun paramètre posé), le contrôle des invendus est demandé (boulangerie).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { hasTestDb, closeTestPool } from './helpers.js';
import { requiresUnsoldInventory } from '../../services/module-parameters.service.js';

describe.skipIf(!hasTestDb)('Clôture — contrôle des invendus', () => {
  afterAll(async () => { await closeTestPool(); });
  it('exige l\'inventaire des invendus par défaut', async () => {
    expect(await requiresUnsoldInventory()).toBe(true);
  });
});
