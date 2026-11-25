import { ACTIVATABLE_MODULES, CORE_MODULES, missingDependencies, MODULE_LABELS, type AppModule } from '@ofauria/shared';

export type WizardMode = 'quick' | 'advanced';
export type WizardData = Record<string, string | string[] | boolean>;
export type WizardAnswer = { reviewed?: boolean; note?: string; data?: WizardData };
export type WizardAnswers = Record<string, WizardAnswer>;
export type WizardIssue = { step: string; severity: 'blocking' | 'warning' | 'info'; message: string };

// Les étapes sont un catalogue, pas des opérations de configuration active.
export const WIZARD_STEPS = [
  { key: 'company', phase: 'Votre entreprise', label: 'Entreprise', description: 'L\'identité qui figure sur vos documents, et les lieux où vous travaillez.', advanced: false },
  { key: 'sector', phase: 'Votre métier', label: 'Secteur d\'activité', description: 'Choisissez le secteur principal. Kalum adapte les étapes suivantes à votre métier.', advanced: false },
  { key: 'specialties', phase: 'Votre métier', label: 'Spécialités', description: 'Vous pouvez en combiner plusieurs. Chacune apporte ses ateliers, ses étapes et ses rôles.', advanced: false },
  { key: 'modules', phase: 'Votre métier', label: 'Modules', description: 'Le préréglage vient du secteur et des spécialités ; vous l\'ajustez.', advanced: false },
  { key: 'operations', phase: 'Votre fonctionnement', label: 'Modèle opérationnel', description: 'Comment votre entreprise produit, stocke et vend réellement.', advanced: true },
  { key: 'vocabulary', phase: 'Votre fonctionnement', label: 'Vocabulaire', description: 'Les mots affichés dans les menus, les documents et les rapports. Les identifiants techniques ne changent pas.', advanced: false },
  { key: 'rules', phase: 'Votre fonctionnement', label: 'Processus et règles', description: 'Les étapes obligatoires, les approbations et la numérotation.', advanced: true },
  { key: 'interfaces', phase: 'Votre fonctionnement', label: 'Interfaces', description: 'L\'accueil, les raccourcis et les indicateurs de chaque rôle.', advanced: true },
  { key: 'finance', phase: 'Mise en service', label: 'Comptabilité et fiscalité', description: 'Posées par le pays et le secteur ; les obligations légales ne se désactivent pas.', advanced: false },
  { key: 'roles', phase: 'Mise en service', label: 'Rôles et accès', description: 'Les rôles proposés pour vos activités, chacun avec le moins de droits nécessaire.', advanced: false },
  { key: 'data', phase: 'Mise en service', label: 'Données de départ', description: 'Importez vos fichiers ou partez des modèles du profil.', advanced: false },
  { key: 'review', phase: 'Mise en service', label: 'Révision et activation', description: 'Vérifiez l\'ensemble avant d\'appliquer. Rien n\'a encore été modifié.', advanced: false },
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
