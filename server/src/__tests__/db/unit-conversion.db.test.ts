/**
 * Phase 3.3 (mig 470) — conversions pilotées par le référentiel des unités.
 * On charge les entrées `units` (ref_entries) seedées avec metadata
 * { category, to_base }, on construit le registre et on vérifie que la
 * conversion lit le référentiel (kg↔g, l↔ml) et signale `uncertain` quand
 * elle n'est pas déterministe (famille différente, unité inconnue).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool } from './helpers.js';
import { buildUnitRegistry, convertByRegistry, type UnitRegistry } from '../../utils/units.js';

describe.skipIf(!hasTestDb)('Conversions unités via référentiel', () => {
  let registry: UnitRegistry;
  const p = () => testPool();

  beforeAll(async () => {
    const rows = (await p().query(
      `SELECT code, metadata FROM ref_entries WHERE table_id = 'units'`
    )).rows;
    registry = buildUnitRegistry(rows);
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('charge les 5 unités de base seedées avec leur famille', () => {
    expect(registry.get('kg')).toEqual({ category: 'mass', toBase: 1000 });
    expect(registry.get('g')).toEqual({ category: 'mass', toBase: 1 });
    expect(registry.get('l')).toEqual({ category: 'volume', toBase: 1000 });
    expect(registry.get('ml')).toEqual({ category: 'volume', toBase: 1 });
    expect(registry.get('unit')).toEqual({ category: 'count', toBase: 1 });
  });

  it('convertit dans une même famille depuis le référentiel', () => {
    expect(convertByRegistry(2, 'kg', 'g', registry)).toEqual({ value: 2000, uncertain: false });
    expect(convertByRegistry(500, 'g', 'kg', registry)).toEqual({ value: 0.5, uncertain: false });
    expect(convertByRegistry(1.5, 'l', 'ml', registry)).toEqual({ value: 1500, uncertain: false });
    // Même unité : identité, jamais incertain.
    expect(convertByRegistry(7, 'kg', 'kg', registry)).toEqual({ value: 7, uncertain: false });
  });

  it('signale uncertain pour une conversion inter-familles (densité requise)', () => {
    const r = convertByRegistry(3, 'kg', 'l', registry);
    expect(r.uncertain).toBe(true);
    expect(r.value).toBe(3); // valeur AS-IS, l'appelant doit avertir
  });

  it('signale uncertain pour une unité inconnue du référentiel', () => {
    expect(convertByRegistry(1, 'kg', 'sachet', registry).uncertain).toBe(true);
    expect(convertByRegistry(1, 'sachet', 'kg', registry).uncertain).toBe(true);
  });
});
