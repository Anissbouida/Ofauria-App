import { sectorRepository } from '../../repositories/sector.repository.js';
import { specializationRepository } from '../../repositories/specialization.repository.js';
import { countryPackRepository } from '../../repositories/country-pack.repository.js';
import { companyCurrency } from '../currency.js';
import type { WizardAnswers, WizardIssue } from './steps.js';
import { db } from '../../config/database.js';
import { validateLayerData, validateInterfaceData } from './layer-operations.js';
import { readInterfacePreferences } from '../interface-preferences.js';
import { wizardParameters, prepareParameterChanges } from './parameter-operations.js';
import { wizardApprovalRules, approvalIssues } from './approval-operations.js';
import { centralStoreId } from '../operating-rules.js';
import { roleTemplates, activeSodRules, roleTemplateIssues, templateRights, templateSod } from './role-templates.js';

/** A live read-only catalogue. No starter, profile or module is applied here. */
export async function wizardCatalog(includeLabels = true) {
  const [templates, sodRules, approvalRules, centralStore] = await Promise.all([roleTemplates(), activeSodRules(), wizardApprovalRules(), centralStoreId()]);
  const [packs, specialties, country, currency, activation,company,parameters,interfacePreferences] = await Promise.all([
    sectorRepository.list(), specializationRepository.list(), countryPackRepository.activeCountry(), companyCurrency(), sectorRepository.activation(),
    db.query(`SELECT to_jsonb(c) AS data FROM company_settings c WHERE id=1`), wizardParameters(),readInterfacePreferences(),
  ]);
  const profiles = await Promise.all(packs.map(async p => ({ code: p.code, label: p.label, description: p.description,
    status: p.status, wizard: p.in_wizard === true, lineage: p.lineage ?? [p.code], modules: p.modules, features: p.features ?? [],
    labels: includeLabels ? await (p.code === activation.sector.code ? sectorRepository.labels(p.code) : sectorRepository.sectorLabels(p.code)) : {} })));
  return {
    profiles, parameters,interfacePreferences, sodRules, approvalRules, centralStoreAvailable: !!centralStore,
    // Personnalisation des modules : capacités du catalogue et capacités actives aujourd'hui.
    capabilities: activation.catalog.map(f => ({ code: f.key, module: f.module_key, label: f.label, description: f.description, kind: f.kind, requires: f.requires ?? [], default_on: f.default_on })),
    activeCapabilities: [...activation.features],
    // Lot 11 : modèles de rôles ; `sod` = conflits du modèle complet (avant filtrage par modules).
    roleTemplates: templates.map(t => ({ ...t, sod: templateSod(templateRights(t, t.permissions.map(p => p.module)), sodRules) })),
    specialties: specialties.map(s => ({ code: s.code, label: s.label, description: s.description, sector: s.sector_pack, enabled: s.enabled })),
    country, currency: currency.code, currentSector: activation.sector.code, currentSecondary:activation.sector.secondarySectors??[],
    modules: [...activation.modules],company:{name:company.rows[0]?.data?.legal_name??'',legalForm:company.rows[0]?.data?.legal_form??'',locale:company.rows[0]?.data?.default_locale??'fr',timezone:company.rows[0]?.data?.timezone??'Africa/Casablanca',size:company.rows[0]?.data?.company_size??''},
  };
}

export function validateWizardCatalog(answers: WizardAnswers, catalog: Awaited<ReturnType<typeof wizardCatalog>>): WizardIssue[] {
  const issues: WizardIssue[] = [];
  const block = (step: string, message: string) => issues.push({ step, severity: 'blocking', message });
  const primary = answers.sector?.data?.primary;
  const secondary = answers.sector?.data?.secondary;
  const codes = [primary, ...(Array.isArray(secondary) ? secondary : [])].filter((x): x is string => typeof x === 'string' && !!x);
  const packs = catalog.profiles.filter(p => codes.includes(p.code));
  if (codes.some(code => !packs.some(p => p.code === code))) block('sector','Un secteur sélectionné n’est plus disponible.');
  if (Array.isArray(secondary) && secondary.includes(String(primary))) block('sector','Le secteur principal ne peut pas être une activité secondaire.');
  const selected = answers.specialties?.data?.selected;
  if (Array.isArray(selected)) {
    const lineage = new Set(packs.flatMap(p => p.lineage));
    if (selected.some(code => !catalog.specialties.some(s => s.code === code && lineage.has(s.sector)))) block('specialties','Une spécialité ne relève plus des profils choisis.');
  }
  const company = answers.company?.data;
  if (company?.country && company.country !== catalog.country) block('company','Le changement de pays n’est pas disponible dans ce lot.');
  if (company?.currency && company.currency !== catalog.currency) block('company','Le changement de devise n’est pas disponible dans ce lot.');
  issues.push(...validateLayerData(company,answers.vocabulary?.data));
  issues.push(...prepareParameterChanges(answers,catalog.parameters??[]).issues);
  issues.push(...validateInterfaceData(answers.interfaces?.data,answers.modules?.data?.selected,catalog.interfacePreferences?.available===true));
  const caps = answers.modules?.data?.features;
  if (Array.isArray(caps)) {
    const known = new Set((catalog.capabilities ?? []).map(c => c.code));
    const unknown = caps.filter(c => !known.has(String(c)));
    if (unknown.length) block('modules', `Capacités inconnues : ${unknown.join(', ')}.`);
  }
  issues.push(...approvalIssues(answers, catalog.approvalRules ?? []));
  issues.push(...operatingModelIssues(answers, catalog));
  issues.push(...roleTemplateIssues(answers, catalog.roleTemplates ?? [], catalog.sodRules ?? [], new Set(packs.flatMap(p => p.lineage))));
  return issues;
}

/** Cohérence du modèle opérationnel (mig 694) : réponses du brouillon, sinon valeurs actuelles. */
export function operatingModelIssues(answers: WizardAnswers, catalog: Pick<Awaited<ReturnType<typeof wizardCatalog>>, 'parameters' | 'centralStoreAvailable'>): WizardIssue[] {
  const ops = answers.operations?.data ?? {};
  const pick = (key: string, field: string) => ops[`${key}:${field}`] ?? (catalog.parameters ?? []).find(p => p.key === key)?.value?.[field];
  const modules = answers.modules?.data?.selected;
  const has = (m: string) => !Array.isArray(modules) || modules.includes(m);
  const issues: WizardIssue[] = [];
  if (has('production') && pick('production.rhythm', 'mode') === 'continuous' && pick('production.demand_source', 'mode') === 'orders')
    issues.push({ step: 'operations', severity: 'blocking', message: 'Une production en continu se pilote sur stock ou en hybride, pas à la commande.' });
  if (pick('sales.channel', 'channel') === 'retail' && !has('pos'))
    issues.push({ step: 'operations', severity: 'warning', message: 'Vente au détail sans le module Point de vente : l\'accueil restera celui du secteur.' });
  if (pick('stock.organization', 'mode') === 'central' && !catalog.centralStoreAvailable)
    issues.push({ step: 'operations', severity: 'warning', message: 'Stock centralisé sans dépôt : créez un établissement de type dépôt, sinon les achats restent livrés à l\'établissement de l\'acheteur.' });
  return issues;
}
