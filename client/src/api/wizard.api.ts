import api from './client';
import type { ModuleImpact } from './settings.api';
import type { InterfacePreferences } from '@ofauria/shared';

export type WizardMode = 'quick' | 'advanced';
export type WizardData = Record<string, string | string[] | boolean>;
export type WizardAnswers = Record<string, { reviewed?: boolean; note?: string; data?: WizardData }>;
export interface WizardParameter { step:string; module:string; key:string; label:string; help:string; value:Record<string,unknown>|null; fields:{name:string;label:string;type:string;unit?:string;min?:number;max?:number;options?:{value:string;label:string}[]}[] }
export interface WizardCatalog {
  profiles: { code: string; label: string; description?: string; status?: string; wizard?: boolean; lineage: string[]; modules: string[]; features: string[]; offFeatures?: string[]; labels?: Record<string,string> }[];
  specialties: { code: string; label: string; description: string | null; sector: string; enabled: boolean }[];
  country: string; currency: string; currentSector: string; modules: string[];
  currentSecondary?: string[];
  company?: { name:string;legalForm:string;locale:string;timezone:string;size:string };
  technicalSimulationAvailable?: boolean;
  parameters?: WizardParameter[];
  interfacePreferences?: {available:boolean;values:InterfacePreferences};
  /** Personnalisation des modules : capacités du catalogue (app_features) et capacités actives. */
  capabilities?: { code: string; module: string; label: string; description: string | null; kind: 'fonction' | 'reglementaire'; requires: string[]; default_on: boolean }[];
  activeCapabilities?: string[];
  /** Règles d'approbation à seuil simple (moteur d'approbation, mig 350). */
  storeNames?: string[];
  finance?: { fiscalYear: { year: number; start: string; end: string } | null; analyticAxes: number };
  approvalRules?: { code: string; label: string; doc_type: string; enabled: boolean; op: string; field: string; value: number; unit: string; approver: string | null }[];
  /** Lot 11 : modèles de rôles (mig 690) ; `sod` = conflits de séparation des tâches du modèle complet. */
  roleTemplates?: { code:string; label:string; description:string|null; base_role:string; sector_code:string|null; specialization_code:string|null;
    requires_modules:string[]; permissions:{module:string;rights:string;scope?:'own'|'store'|'all';verbs?:string[]}[]; home_route:string|null; exists:boolean;
    sod:{code:string;label:string;severity:string}[] }[];
}
export interface WizardChangeSet { id: string; session_id: string; session_revision: number; status: string; operations: { step: string; data: WizardData; execution: 'sector_modules' | 'company_context' | 'vocabulary' | 'specializations' | 'parameters' | 'interface_preferences' | 'roles' | 'pending'; reason?: string }[]; issues: WizardSession['issues']; simulation?: { scope:string[]; rolledBack:boolean; pending:string[]; note:string; parameterImpact?:{key:string;before:Record<string,unknown>;value:Record<string,unknown>;step:string}[]; interfaceImpact?:{before:InterfacePreferences;after:InterfacePreferences} } | null }
export interface WizardStep { key: string; phase: string; label: string; description: string; advanced: boolean }
export interface WizardSession {
  id: string; kind: 'initial' | 'evolution' | 'upgrade'; status: string; mode: WizardMode;
  current_step: string; answers: WizardAnswers; revision: number; updated_at: string;
  steps: WizardStep[]; issues: { step: string; severity: string; message: string }[];
}
export const wizardApi = {
  catalog: () => api.get('/settings/assistant/catalog').then(r => r.data.data as WizardCatalog),
  preview: (id: string) => api.get(`/settings/assistant/${id}/preview`).then(r => r.data.data as { revision: number; issues: WizardSession['issues']; impact: ModuleImpact | null; referentials?: import('./referentiel.api').RefScopePreview }),
  list: () => api.get('/settings/assistant').then(r => r.data.data as WizardSession[]),
  create: (kind: WizardSession['kind'], mode: WizardMode) => api.post('/settings/assistant', { kind, mode }).then(r => r.data.data as WizardSession),
  save: (id: string, input: Pick<WizardSession, 'mode' | 'current_step' | 'revision' | 'answers'>) => api.put(`/settings/assistant/${id}`, input).then(r => r.data.data as WizardSession),
  abandon: (id: string, revision: number) => api.post(`/settings/assistant/${id}/abandon`, { revision }),
  compile: (id: string, revision: number) => api.post(`/settings/assistant/${id}/compile`,{revision}).then(r => r.data.data as WizardChangeSet),
  rebase: (id:string,revision:number)=>api.post(`/settings/assistant/${id}/rebase`,{revision}).then(r=>r.data.data as WizardSession),
  changeset: (id: string) => api.get(`/settings/assistant/${id}/changeset`).then(r => r.data.data as WizardChangeSet|null),
  simulate: (id: string, revision: number) => api.post(`/settings/assistant/${id}/simulate`,{revision}).then(r => r.data.data as WizardChangeSet),
  /** Publication réelle (lot 13) : une transaction, une version restaurable. */
  apply: (id: string, revision: number) => api.post(`/settings/assistant/${id}/apply`,{revision}).then(r => r.data.data as WizardChangeSet & { published_version_id: string | null; approval?: { id: string } }),
};
