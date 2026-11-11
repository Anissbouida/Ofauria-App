/**
 * Phase 9.2 (mig 496) — accueil et rapports par secteur.
 * Le pack générique ouvre sur les ventes et propose ses rapports.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { hasTestDb, closeTestPool } from './helpers.js';
import { sectorRepository } from '../../repositories/sector.repository.js';

describe.skipIf(!hasTestDb)('Accueil par secteur', () => {
  afterAll(async () => { await closeTestPool(); });

  it('le secteur générique ouvre sur /sales et propose des rapports', async () => {
    const packs = await sectorRepository.list();
    const gen = packs.find(p => p.code === 'generique');
    expect(gen?.home_route).toBe('/sales');
    expect(gen?.report_keys).toContain('sales');
    const boul = packs.find(p => p.code === 'boulangerie');
    expect(boul?.home_route ?? null).toBeNull(); // accueil adaptatif conservé
  });
});
