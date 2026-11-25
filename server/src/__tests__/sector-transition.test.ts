import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppModule } from '@ofauria/shared';
vi.mock('../config/database.js', () => ({ db: { query: vi.fn(), getClient: vi.fn() } }));
vi.mock('../services/capabilities.js', () => ({ capabilityUsage: vi.fn() }));
import { db } from '../config/database.js';
import { capabilityUsage } from '../services/capabilities.js';
import { sectorRepository, type Activation, type SectorPack } from '../repositories/sector.repository.js';

const pack = (code: string, modules: AppModule[], features: string[] = []): SectorPack => ({ code, label: code, modules, features, is_default: false });
const base = pack('base', ['stock'], ['lots']);
const rollout = { pilots: {}, storeDisabled: {} };
const current: Activation = {
  sector: base, packModules: ['stock'], packFeatures: ['lots'], moduleOverrides: {}, featureOverrides: {}, rollout,
  catalog: [{ key: 'lots', module_key: 'stock', label: 'Lots', description: null, sort_order: 1, kind: 'reglementaire', requires: [], default_on: false }],
  modules: new Set(['dashboard', 'settings', 'users', 'stock']), features: new Set(['lots']),
};

describe('Transitions de configuration sectorielle', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

  it('prévisualise les modules et capacités sans écriture', async () => {
    vi.spyOn(sectorRepository, 'pack').mockResolvedValue(pack('distribution', ['stock', 'sales'], ['lots']));
    vi.spyOn(sectorRepository, 'activation').mockResolvedValue(current);
    const plan = await sectorRepository.planSector('distribution');
    expect(plan?.diff.modulesOn).toEqual(['sales']);
    expect(plan?.diff.modulesOff).toEqual([]);
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('refuse une transition retirant un prérequis de la production', async () => {
    vi.spyOn(sectorRepository, 'pack').mockResolvedValue(pack('incomplet', ['production']));
    vi.spyOn(sectorRepository, 'activation').mockResolvedValue(current);
    await expect(sectorRepository.planSector('incomplet')).rejects.toMatchObject({ statusCode: 409 });
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('refuse toute perte de capacité réglementaire utilisée, y compris au commit', async () => {
    vi.mocked(capabilityUsage).mockResolvedValue([{ label: 'lot actif', count: 2 }]);
    const target = { sector: pack('services', ['sales']), modules: {}, features: {}, rollout };
    await expect(sectorRepository.commit(current, target)).rejects.toMatchObject({ statusCode: 409 });
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('hérite des plans de contrôle et laisse le profil enfant surcharger une caractéristique', async () => {
    vi.spyOn(sectorRepository, 'pack').mockResolvedValue({ ...base, inherits: true, lineage: ['parent', 'base'] });
    const hazard = { category: 'Matières', stage: 'final', characteristic: 'Température', max_value: 5 };
    vi.mocked(db.query).mockResolvedValue({ rows: [
      { code: 'parent', profile: { control_plans: [hazard, { ...hazard, characteristic: 'Aspect' }] } },
      { code: 'base', profile: { control_plans: [{ ...hazard, max_value: 4 }] } },
    ] } as Awaited<ReturnType<typeof db.query>>);
    const layers = await sectorRepository.resolvedProfile('base');
    expect(layers?.control_plans).toEqual([{ ...hazard, max_value: 4 }, { ...hazard, characteristic: 'Aspect' }]);
  });
});
