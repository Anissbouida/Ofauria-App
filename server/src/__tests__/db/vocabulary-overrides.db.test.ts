/**
 * M8-03 — vocabulaire de la société (mig 583) : un terme renommé passe devant celui du
 * secteur ; le retour arrière rend le terme du secteur ; le préréglage n'est pas touché.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool } from './helpers.js';

describe.skipIf(!hasTestDb)('Vocabulaire de la société (M8-03)', () => {
  let sector: typeof import('../../repositories/sector.repository.js')['sectorRepository'];
  let userId = '';
  let saved: string | null = null;

  beforeAll(async () => {
    sector = (await import('../../repositories/sector.repository.js')).sectorRepository;
    userId = (await testPool().query(`SELECT id FROM users ORDER BY created_at LIMIT 1`)).rows[0].id;
    saved = (await testPool().query(`SELECT label_value FROM company_label_overrides WHERE label_key = 'batch'`)).rows[0]?.label_value ?? null;
  });

  afterAll(async () => {
    if (saved) await sector.setLabelOverride('batch', saved, userId).catch(() => undefined);
    else await sector.resetLabelOverride('batch').catch(() => undefined);
    await closeTestPool();
  });

  it('renommage puis retour au terme du secteur', async () => {
    await sector.resetLabelOverride('batch');
    expect((await sector.labels('fabrication')).batch).toBe('Lot de fabrication');

    await sector.setLabelOverride('batch', '  Série  ', userId);
    expect((await sector.labels('fabrication')).batch).toBe('Série');
    expect((await sector.sectorLabels('fabrication')).batch).toBe('Lot de fabrication'); // préréglage intact

    expect(await sector.resetLabelOverride('batch')).toBe(true);
    expect((await sector.labels('fabrication')).batch).toBe('Lot de fabrication');
  });
});
