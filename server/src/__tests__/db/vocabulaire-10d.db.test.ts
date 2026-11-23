/**
 * Vocabulaire complet (plan d'exécution multi-industries, étape 10, pas 10d ; mig 647).
 *
 * Bilan de santé : aucun terme de boulangerie hors boulangerie — le profil « fabrication »
 * résout tout son vocabulaire sans terme boulanger ; un terme renommé par la société avec un
 * mot de boulangerie est signalé ; la boulangerie garde « Ingrédient ».
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe.skipIf(!hasTestDb)('Étape 10d — vocabulaire', () => {
  let health: any; let sectors: any;
  const p = () => testPool();
  const KEY = 'batch';

  beforeAll(async () => {
    health = await import('../../services/config-health.js');
    sectors = (await import('../../repositories/sector.repository.js')).sectorRepository;
    await p().query(`DELETE FROM company_label_overrides WHERE label_key = $1`, [KEY]);
  });
  afterAll(async () => {
    await p().query(`DELETE FROM company_label_overrides WHERE label_key = $1`, [KEY]).catch(() => undefined);
    await closeTestPool();
  });

  it('profil « fabrication » : aucun terme de boulangerie, « Matière » au lieu d\'« Ingrédient »', async () => {
    const labels = await sectors.labels('fabrication');
    expect(labels.ingredient).toBe('Matière');
    expect(labels.doc_bon_sortie).toBe('Bon de sortie des matières');
    expect(await health.bakeryTermsOutsideBakery('fabrication')).toEqual([]);
  });

  it('un profil enfant hérite du vocabulaire (discret → fabrication)', async () => {
    expect((await sectors.labels('discret')).ingredient).toBe('Matière');
    expect((await sectors.labels('process')).ingredient).toBe('Matière première');
  });

  it('un terme renommé par la société avec un mot de boulangerie est signalé', async () => {
    await p().query(`INSERT INTO company_label_overrides (label_key, label_value) VALUES ($1, 'Fournée du jour')`, [KEY]);
    const found = await health.bakeryTermsOutsideBakery('fabrication');
    expect(found).toEqual([expect.objectContaining({ source: 'vocabulaire', key: KEY, value: 'Fournée du jour' })]);
  });

  it('la boulangerie garde son vocabulaire (repli)', async () => {
    const labels = await sectors.labels('boulangerie');
    expect(labels.ingredient ?? 'Ingrédient').toBe('Ingrédient');
  });
});
