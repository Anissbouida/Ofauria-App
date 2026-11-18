/**
 * M8-03 — vocabulaire des écrans de fabrication (mig 580).
 *  - fabrication / générique : termes neutres (nomenclatures produits finis, sous-ensembles,
 *    conditionnements, quantité de base, lot de fabrication) ;
 *  - boulangerie : aucune de ces clés (l'écran garde ses termes actuels) et option
 *    « saisie par fournée » active ; absente ailleurs ;
 *  - un secteur personnalisé hérite des libellés de son secteur de base et peut les surcharger.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Vocabulaire des écrans de fabrication (M8-03)', () => {
  let sector: typeof import('../../repositories/sector.repository.js')['sectorRepository'];
  const custom = `m803_${RUN}`.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 30);
  const p = () => testPool();

  beforeAll(async () => {
    sector = (await import('../../repositories/sector.repository.js')).sectorRepository;
    await p().query(`INSERT INTO sector_packs (code, label, enabled_modules, is_custom, base_sector) VALUES ($1, 'Test M8', '{}', true, 'fabrication')`, [custom]);
    await p().query(`INSERT INTO sector_labels (sector_pack, label_key, label_value) VALUES ($1, 'base_preps', 'Modules')`, [custom]);
  });

  afterAll(async () => {
    await p().query(`DELETE FROM sector_labels WHERE sector_pack = $1`, [custom]).catch(() => undefined);
    await p().query(`DELETE FROM sector_packs WHERE code = $1`, [custom]).catch(() => undefined);
    await closeTestPool();
  });

  it('termes neutres hors boulangerie, termes actuels en boulangerie', async () => {
    const fab = await sector.labels('fabrication');
    expect(fab).toMatchObject({ finished_products_tab: 'Nomenclatures produits finis', base_preps: 'Sous-ensembles', formats_tab: 'Conditionnements', yield: 'Quantité de base', batch: 'Lot de fabrication' });
    expect((await sector.labels('generique')).base_prep).toBe('Sous-ensemble');
    const boul = await sector.labels('boulangerie');
    for (const k of ['finished_products_tab', 'base_preps', 'formats_tab', 'yield', 'batch']) expect(boul[k]).toBeUndefined();
  });

  it('option « saisie par fournée » : boulangerie seulement', async () => {
    const f = (await p().query(`SELECT code, 'mode_fournee' = ANY (features) AS on FROM sector_packs WHERE code IN ('boulangerie', 'fabrication', 'generique')`)).rows;
    expect(Object.fromEntries(f.map(r => [r.code, r.on]))).toEqual({ boulangerie: true, fabrication: false, generique: false });
  });

  it('secteur personnalisé : hérite de son secteur de base, surcharge gagnante', async () => {
    const l = await sector.labels(custom);
    expect(l.formats_tab).toBe('Conditionnements');
    expect(l.base_preps).toBe('Modules');
  });
});
