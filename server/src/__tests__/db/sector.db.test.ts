/**
 * Phase 1 multi-secteur (mig 468) — packs secteur et secteur de la société.
 * Vérifie la liste, le secteur courant, le changement, et que « generique »
 * exclut les modules de fabrication (production, recipes) que « boulangerie » inclut.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories } from './helpers.js';

describe.skipIf(!hasTestDb)("Secteur d'activité (packs secteur)", () => {
  let sectors: typeof import('../../repositories/sector.repository.js').sectorRepository;
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let initial = 'boulangerie';

  beforeAll(async () => {
    repos = await importRepositories();
    sectors = (await import('../../repositories/sector.repository.js')).sectorRepository;
    initial = (await sectors.current()).code;
  });

  afterAll(async () => {
    await testPool().query(`UPDATE company_settings SET sector_pack = $1 WHERE id = 1`, [initial]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('liste les secteurs et expose leurs modules', async () => {
    const list = await sectors.list();
    const codes = list.map(s => s.code);
    expect(codes).toContain('boulangerie');
    expect(codes).toContain('generique');
    const boul = list.find(s => s.code === 'boulangerie')!;
    const gen = list.find(s => s.code === 'generique')!;
    // Boulangerie = miroir : contient la fabrication ; générique ne l'a pas.
    expect(boul.modules).toContain('production');
    expect(boul.modules).toContain('recipes');
    expect(gen.modules).not.toContain('production');
    expect(gen.modules).not.toContain('recipes');
    // Transverse présent partout.
    for (const m of ['sales', 'customers', 'accounting', 'settings']) {
      expect(gen.modules).toContain(m);
      expect(boul.modules).toContain(m);
    }
  });

  it('change le secteur de la société et le relit ; code inconnu refusé', async () => {
    const after = await sectors.setSector('generique');
    expect(after?.code).toBe('generique');
    expect((await sectors.current()).code).toBe('generique');
    expect((await sectors.current()).modules).not.toContain('production');

    expect(await sectors.setSector('secteur-bidon')).toBeNull();
    // inchangé après un code invalide.
    expect((await sectors.current()).code).toBe('generique');

    await sectors.setSector('boulangerie');
    expect((await sectors.current()).modules).toContain('production');
  });
});
