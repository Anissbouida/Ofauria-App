import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../config/database.js', () => ({ db: { query: vi.fn() } }));
vi.mock('../repositories/sector.repository.js', () => ({ sectorRepository: { previewWizardSelection: vi.fn(), featureLabel: vi.fn() } }));
vi.mock('../services/module-impact.js', () => ({ impactPreview: vi.fn() }));
// Mig 698 : l'aperçu des référentiels a sa propre suite (db/referentiels-sectoriels).
vi.mock('../services/referential-scope.js', () => ({ refScopePreview: vi.fn(async () => ({ lineage: [], tables: [], activated: 0, deactivated: 0 })) }));
vi.mock('../services/wizard/catalog.js', () => ({ wizardCatalog: vi.fn(), validateWizardCatalog: vi.fn(() => []) }));
import { db } from '../config/database.js';
import { sectorRepository } from '../repositories/sector.repository.js';
import { impactPreview } from '../services/module-impact.js';
import { previewWizardSession } from '../services/wizard/preview.js';

describe('Aperçu d’un brouillon sans publication', () => {
  beforeEach(() => vi.clearAllMocks());
  const row = { answers: { sector: { data: { primary: 'profile', secondary: ['other'] }, reviewed: true }, modules: { data: { selected: ['dashboard','settings','users','sales'] }, reviewed: true } }, mode: 'advanced', revision: 3, base_version_id: '7' };
  const setup = () => vi.mocked(db.query).mockResolvedValueOnce({ rows: [row] } as Awaited<ReturnType<typeof db.query>>).mockResolvedValueOnce({ rows: [{ id: '8' }] } as Awaited<ReturnType<typeof db.query>>);
  it('calcule l’impact et avertit si la configuration active a changé', async () => {
    setup();
    const diff = { modulesOn: ['sales'], modulesOff: [], featuresOn: [], featuresOff: [] } as const;
    vi.mocked(sectorRepository.previewWizardSelection).mockResolvedValue({ current: {}, diff } as unknown as Awaited<ReturnType<typeof sectorRepository.previewWizardSelection>>);
    vi.mocked(impactPreview).mockResolvedValue({ ...diff, roles: [], hidden: [] } as unknown as Awaited<ReturnType<typeof impactPreview>>);
    const result = await previewWizardSession('draft');
    expect(result.impact?.modulesOn).toEqual(['sales']);
    expect(result.issues.some(i => i.severity === 'warning')).toBe(true);
    expect(sectorRepository.previewWizardSelection).toHaveBeenCalledWith('profile',['other'],row.answers.modules.data.selected,undefined);
    expect(vi.mocked(db.query).mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
  });
  it('affiche le refus d’un contrôle réglementaire sans appliquer ni simuler', async () => {
    setup(); vi.mocked(sectorRepository.previewWizardSelection).mockRejectedValue(Object.assign(new Error('Capacité réglementaire utilisée'),{ statusCode: 409 }));
    const result = await previewWizardSession('draft');
    expect(result.impact).toBeNull();
    expect(result.issues).toContainEqual({ step:'modules',severity:'blocking',message:'Capacité réglementaire utilisée' });
    expect(impactPreview).not.toHaveBeenCalled();
  });
});
