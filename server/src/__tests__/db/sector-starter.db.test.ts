/**
 * Phase 9.3 — données de départ par secteur, chargeables, hors migrations.
 *
 * Le secteur générique charge des catégories transverses ; la boulangerie ne charge rien
 * (son référentiel existe déjà). Une société neuve ne reçoit donc pas de données de
 * fabrication (recettes) par simple création.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool } from './helpers.js';
import { loadSectorStarter, sectorStarterPreview } from '../../services/sector-starter.service.js';

describe.skipIf(!hasTestDb)('Données de départ par secteur', () => {
  const p = () => testPool();
  afterAll(async () => {
    await p().query(`DELETE FROM categories WHERE slug LIKE 'starter-%'`).catch(() => undefined);
    await closeTestPool();
  });

  it('boulangerie ne charge aucune donnée de départ', async () => {
    expect(sectorStarterPreview('boulangerie').categories).toHaveLength(0);
    const r = await loadSectorStarter('boulangerie');
    expect(r.categories).toBe(0);
  });

  it('générique charge des catégories transverses, idempotent', async () => {
    const r1 = await loadSectorStarter('generique');
    expect(r1.categories).toBeGreaterThanOrEqual(1);
    const r2 = await loadSectorStarter('generique'); // rejeu
    expect(r2.categories).toBe(0);
    const rows = (await p().query(`SELECT name FROM categories WHERE slug LIKE 'starter-%'`)).rows;
    expect(rows.map((x: { name: string }) => x.name)).toContain('Marchandises');
  });
});
