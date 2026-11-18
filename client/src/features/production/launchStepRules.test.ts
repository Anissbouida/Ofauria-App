/**
 * M8-01 — registre de la fenêtre de lancement : étape « sous-ensembles » seulement s'il y a
 * des bases partagées ; navigation qui saute les étapes masquées ; rubrique coupe.
 */
import { describe, it, expect } from 'vitest';
import { visibleLaunchSteps, nextLaunchStep, prevLaunchStep, showCutSection } from './launchStepRules';

describe('Fenêtre de lancement (M8-01)', () => {
  it('étape des sous-ensembles selon les bases partagées', () => {
    expect(visibleLaunchSteps({ loadingBases: false, basesCount: 2 })).toEqual([1, 2, 3, 4]);
    expect(visibleLaunchSteps({ loadingBases: true, basesCount: 0 })).toEqual([1, 2, 3, 4]);
    expect(visibleLaunchSteps({ loadingBases: false, basesCount: 0 })).toEqual([2, 3, 4]);
  });
  it('navigation sur les seules étapes visibles', () => {
    const v = [2, 3, 4];
    expect(nextLaunchStep(2, v)).toBe(3);
    expect(nextLaunchStep(4, v)).toBe(4);
    expect(prevLaunchStep(2, v)).toBe(2);
    expect(prevLaunchStep(3, v)).toBe(2);
  });
  it('coupe : option fournée ou sorties déclarées', () => {
    expect(showCutSection(true, null)).toBe(true);
    expect(showCutSection(false, [])).toBe(false);
    expect(showCutSection(false, [{ id: 'x' }])).toBe(true);
  });
});
