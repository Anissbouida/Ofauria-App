/**
 * Registre des étapes et rubriques de la fenêtre de lancement (M8-01), séparé du rendu
 * (ProductionLaunchModal.tsx) pour être testé sans navigateur. Ordre du tableau = ordre affiché.
 *  - « Sous-ensembles » : seulement quand l'ordre a des bases partagées (ou pendant leur analyse) ;
 *  - coupe d'un cadre : option « saisie par fournée », ou sorties déclarées sur la fiche (M4-06).
 */
export interface LaunchCtx { loadingBases: boolean; basesCount: number; /** Éléments masqués (Écrans de fabrication, mig 591). */ hidden?: Set<string> }
export type LaunchStepId = 'bases' | 'finished' | 'losses' | 'confirm';

export const LAUNCH_STEP_RULES: { id: LaunchStepId; num: number; when: (c: LaunchCtx) => boolean }[] = [
  { id: 'bases', num: 1, when: c => c.loadingBases || c.basesCount > 0 },
  { id: 'finished', num: 2, when: () => true },
  { id: 'losses', num: 3, when: c => !c.hidden?.has('launch.losses') },
  { id: 'confirm', num: 4, when: () => true },
];

export const visibleLaunchSteps = (c: LaunchCtx) => LAUNCH_STEP_RULES.filter(r => r.when(c)).map(r => r.num);
export const nextLaunchStep = (cur: number, visible: number[]) => visible.find(n => n > cur) ?? cur;
export const prevLaunchStep = (cur: number, visible: number[]) => [...visible].reverse().find(n => n < cur) ?? cur;

/** Rubrique « coupe » d'un article. */
export const showCutSection = (batchMode: boolean, declaredOutputs: unknown) =>
  batchMode || (Array.isArray(declaredOutputs) && declaredOutputs.length > 0);
