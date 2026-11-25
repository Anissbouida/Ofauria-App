import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../config/database.js', () => ({ db: { query: vi.fn() } }));
import { db } from '../config/database.js';
import { normalizeStep, visibleSteps, wizardIssues } from '../services/wizard/steps.js';
import { createWizardSession, saveWizardSession, abandonWizardSession } from '../services/wizard/sessions.js';

const draft = { id: 'draft', mode: 'advanced', current_step: 'company', answers: {}, revision: 0, status: 'draft' };
describe('Assistant — registre et verrou optimiste', () => {
  beforeEach(() => vi.resetAllMocks());
  it('12 étapes en avancé, 7 en rapide, révision toujours visible', () => {
    expect(visibleSteps('advanced')).toHaveLength(12);
    expect(visibleSteps('quick')).toHaveLength(7);
    expect(normalizeStep('quick', 'vocabulary')).toBe('finance');
    expect(normalizeStep('advanced', 'vocabulary')).toBe('vocabulary');
    expect(visibleSteps('quick').at(-1)?.key).toBe('review');
  });
  it('le changement de mode conserve les réponses des étapes masquées', async () => {
    const answers = { company: { reviewed: true }, vocabulary: { note: 'Économat', reviewed: true } };
    vi.mocked(db.query).mockResolvedValue({ rows: [{ ...draft, answers, mode: 'quick', current_step: 'finance', revision: 1 }] } as Awaited<ReturnType<typeof db.query>>);
    const result = await saveWizardSession('draft', { mode: 'quick', current_step: 'vocabulary', revision: 0, answers }, 'user');
    expect(result.answers).toEqual(answers);
    expect(result.current_step).toBe('finance');
    expect(vi.mocked(db.query).mock.calls[0][1]).toEqual(expect.arrayContaining([JSON.stringify(answers), 0]));
    expect(wizardIssues('quick', answers).some(i => i.step === 'vocabulary')).toBe(false);
  });
  it('refuse la révision obsolète sans réessayer ni écraser', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as unknown as Awaited<ReturnType<typeof db.query>>);
    await expect(saveWizardSession('draft', { mode: 'advanced', current_step: 'company', revision: 0, answers: {} }, 'user')).rejects.toMatchObject({ statusCode: 409 });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.query).mock.calls[0][0]).toContain('revision=$7');
  });
  it('signale les données métier et les dépendances invalides dans le brouillon', () => {
    const issues = wizardIssues('advanced', { company: { reviewed: true, data: { name: '' } }, sector: { reviewed: true, data: { primary: '' } }, modules: { reviewed: true, data: { selected: ['production'] } } });
    expect(issues.filter(i => i.severity === 'blocking').map(i => i.step)).toEqual(expect.arrayContaining(['company','sector','modules']));
    expect(issues.some(i => i.message.includes('exige'))).toBe(true);
  });
  it('refuse le deuxième brouillon initial et protège l’abandon par révision', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as unknown as Awaited<ReturnType<typeof db.query>>);
    await expect(createWizardSession('initial', 'advanced', 'user')).rejects.toMatchObject({ statusCode: 409 });
    await expect(abandonWizardSession('draft', 0, 'user')).rejects.toMatchObject({ statusCode: 409 });
  });
});
