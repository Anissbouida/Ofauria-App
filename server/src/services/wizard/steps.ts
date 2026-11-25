import { ACTIVATABLE_MODULES, CORE_MODULES, missingDependencies, MODULE_LABELS, type AppModule } from '@ofauria/shared';

export type WizardMode = 'quick' | 'advanced';
export type WizardData = Record<string, string | string[] | boolean>;
export type WizardAnswer = { reviewed?: boolean; note?: string; data?: WizardData };
export type WizardAnswers = Record<string, WizardAnswer>;
export type WizardIssue = { step: string; severity: 'blocking' | 'warning' | 'info'; message: string };

// Les étapes sont un catalogue, pas des opérations de configuration active.
export const WIZARD_STEPS = [
  { key: 'company', phase: 'Contexte', label: 'Entreprise', description: 'Identité, pays, devise et établissements.', advanced: false },
  { key: 'sector', phase: 'Contexte', label: 'Secteurs d’activité', description: 'Profil principal et activités complémentaires.', advanced: false },
  { key: 'specialties', phase: 'Contexte', label: 'Spécialités métiers', description: 'Métiers exercés et référentiels associés.', advanced: false },
  { key: 'modules', phase: 'Personnalisation métier', label: 'Modules et fonctionnalités', description: 'Modules, capacités et dépendances.', advanced: false },
  { key: 'operations', phase: 'Personnalisation métier', label: 'Modèle opérationnel', description: 'Flux, sites et organisation des opérations.', advanced: true },
  { key: 'vocabulary', phase: 'Personnalisation métier', label: 'Vocabulaire métier', description: 'Terminologie utilisée dans les écrans et documents.', advanced: true },
  { key: 'rules', phase: 'Personnalisation métier', label: 'Processus et règles', description: 'Validations, étapes et contrôles.', advanced: true },
  { key: 'interfaces', phase: 'Personnalisation métier', label: 'Interfaces et navigation', description: 'Espaces de travail, menus et écrans.', advanced: true },
  { key: 'finance', phase: 'Administration', label: 'Comptabilité et fiscalité', description: 'Référentiels, exercice et exigences réglementaires.', advanced: false },
  { key: 'roles', phase: 'Administration', label: 'Rôles et autorisations', description: 'Responsabilités, périmètres et séparation des tâches.', advanced: false },
  { key: 'data', phase: 'Administration', label: 'Données initiales', description: 'Référentiels et préparation des imports.', advanced: true },
  { key: 'review', phase: 'Mise en service', label: 'Révision et activation', description: 'Récapitulatif avant simulation et publication.', advanced: false },
] as const;

export function visibleSteps(mode: WizardMode) {
  return WIZARD_STEPS.filter(s => mode === 'advanced' || !s.advanced);
}

export function normalizeStep(mode: WizardMode, key: string) {
  const steps = visibleSteps(mode);
  if (steps.some(s => s.key === key)) return key;
  const index = WIZARD_STEPS.findIndex(s => s.key === key);
  return steps.find(s => WIZARD_STEPS.indexOf(s) > index)?.key ?? steps[0].key;
}

export function wizardIssues(mode: WizardMode, answers: WizardAnswers): WizardIssue[] {
  const issues: WizardIssue[] = visibleSteps(mode).filter(s => s.key !== 'review' && !answers[s.key]?.reviewed)
    .map(s => ({ step: s.key, severity: 'info', message: 'Étape à préparer.' }));
  const company = answers.company?.data;
  if (answers.company?.reviewed && (!company || typeof company.name !== 'string' || !company.name.trim())) issues.push({ step: 'company', severity: 'blocking', message: 'Raison sociale requise.' });
  if (answers.sector?.reviewed && (typeof answers.sector.data?.primary !== 'string' || !answers.sector.data.primary.trim())) issues.push({ step: 'sector', severity: 'blocking', message: 'Secteur principal requis.' });
  if (answers.modules?.reviewed) {
    const selected = answers.modules.data?.selected;
    if (!Array.isArray(selected)) issues.push({ step: 'modules', severity: 'blocking', message: 'Sélection des modules requise.' });
    else {
      const active = new Set(selected as AppModule[]);
      if (selected.some(m => !ACTIVATABLE_MODULES.includes(m as AppModule))) issues.push({ step: 'modules', severity: 'blocking', message: 'Module inconnu dans le brouillon.' });
      if ([...CORE_MODULES].some(m => !active.has(m))) issues.push({ step: 'modules', severity: 'blocking', message: 'Les modules du socle sont obligatoires.' });
      for (const m of missingDependencies(active)) issues.push({ step: 'modules', severity: 'blocking', message: `${MODULE_LABELS[m.module]} exige ${m.missing.map(k => MODULE_LABELS[k]).join(', ')}.` });
    }
  }
  return issues;
}
