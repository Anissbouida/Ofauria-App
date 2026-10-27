/**
 * Sections du module Paramètres. Un utilisateur qui a le module `settings`
 * accède à toutes les sections, sauf si ses droits listent des sections dans
 * user_permissions.config.sections : il est alors limité à celles-ci.
 * Même règle côté client (onglets visibles) et côté serveur (routes).
 */
export const SETTINGS_SECTIONS = {
  company: 'company',
  appearance: 'appearance',
  print: 'print',
  stores: 'stores',
  numbering: 'numbering',
  business: 'business',
  tax: 'tax',
  /** Devises et taux de change (mig 363). */
  currencies: 'currencies',
  documents: 'documents',
  notifications: 'notifications',
  approvals: 'approvals',
  data: 'data',
  referentiel: 'referentiel',
  production: 'production',
  sachets: 'sachets',
  audit: 'audit',
} as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[keyof typeof SETTINGS_SECTIONS];

export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  company: 'Entreprise',
  appearance: 'Apparence',
  print: 'Impression',
  stores: 'Points de vente',
  numbering: 'Numérotation des pièces',
  business: 'Paramètres métier',
  tax: 'TVA',
  currencies: 'Devises et taux de change',
  documents: 'Modèles de documents',
  notifications: 'Notifications',
  approvals: 'Circuits d\'approbation',
  data: 'Données (import, export)',
  referentiel: 'Référentiel',
  production: 'Production',
  sachets: 'Sachets',
  audit: 'Journal des modifications',
};

/**
 * Section de chaque champ de company_settings modifiable par PUT /settings :
 * un utilisateur limité à « Impression » ne peut pas changer l'ICE.
 */
export function settingsSectionOfField(field: string): SettingsSection {
  if (field.startsWith('receipt')) return 'print';
  if (field.startsWith('theme') || field === 'primaryColor' || field === 'secondaryColor') return 'appearance';
  if (field.startsWith('production') || field.startsWith('prixArrondi')) return 'production';
  return 'company';
}

/** Sections autorisées par la config d'un droit (null = toutes). */
export function allowedSettingsSections(config: Record<string, unknown> | null | undefined): SettingsSection[] | null {
  const raw = config?.sections;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const known = Object.values(SETTINGS_SECTIONS) as string[];
  return raw.filter((s): s is SettingsSection => typeof s === 'string' && known.includes(s));
}
