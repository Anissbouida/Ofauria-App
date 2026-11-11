/**
 * Phase 9.1 (mig 495) — libellés par secteur.
 * La même clé neutre donne un mot différent selon le secteur.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { hasTestDb, closeTestPool } from './helpers.js';
import { sectorRepository } from '../../repositories/sector.repository.js';

describe.skipIf(!hasTestDb)('Libellés par secteur', () => {
  afterAll(async () => { await closeTestPool(); });

  it('« recipe » = Recette en boulangerie, Nomenclature en générique', async () => {
    const boul = await sectorRepository.labels('boulangerie');
    const gen = await sectorRepository.labels('generique');
    expect(boul.recipe).toBe('Recette');
    expect(gen.recipe).toBe('Nomenclature');
    expect(boul.product).toBe('Produit');
    expect(gen.product).toBe('Article');
  });
});
