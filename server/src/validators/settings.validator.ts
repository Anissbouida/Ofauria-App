import { z } from 'zod';
import { body, obj, txt, numish, bool, strList, any } from './route-body.validator.js';

/**
 * G0-07 — Paramètres (settings.routes). Les contrôleurs (company, document-sequence, parameters,
 * documents-notifications, approval-rules, api-settings, data, settings) gardent leurs contrôles
 * détaillés et leurs messages ; ces schémas n'imposent que les types de ce qu'ils lisent.
 */

/* Fiche société (PUT /settings) — settings.controller.update. Les champs légaux sont du texte
 * ou null (le contrôleur refuse déjà tout autre type) ; le capital peut arriver en texte. */
const legal = Object.fromEntries(
  ['legalName', 'legalAddress', 'legalCity', 'legalPhone', 'legalEmail', 'legalRc', 'legalIf', 'legalIce',
    'legalPatente', 'legalForm', 'legalWebsite', 'legalCommuneCode'].map(k => [k, txt(300)]),
) as Record<string, ReturnType<typeof txt>>;
const colors = Object.fromEntries(
  ['primaryColor', 'secondaryColor', 'themeBgPage', 'themeBgCard', 'themeBgSecondary', 'themeBgSeparator',
    'themeTextStrong', 'themeTextBody', 'themeTextMuted', 'themeAccent', 'themeAccentHover', 'themeAccentLight',
    'themeCtaColor', 'themeCtaText'].map(k => [k, txt(20)]),
) as Record<string, ReturnType<typeof txt>>;
export const updateCompanySettingsSchema = body({
  ...legal,
  ...colors,
  legalCapital: numish,
  companyName: txt(200),
  subtitle: txt(300),
  logoUrl: txt(3_000_000),
});

/* Numérotation — document-sequence.controller (readBody : motif, remplissage, remise à zéro). */
export const documentSequenceSchema = body({
  pattern: z.string().max(200).optional(),
  padding: numish,
  resetPeriod: z.string().max(20).optional(),
});

/* Paramètre métier — parameters.controller.update : la valeur est vérifiée par sa définition. */
export const parameterValueSchema = body({ value: any });

/* Secteur — company.controller.setSector. */
export const specializationSchema = body({ enabled: z.boolean() });
export const setSectorSchema = body({ code: z.string().trim().min(1, 'Secteur requis').max(40), keepAdjustments: bool });

/* Modules / options — readAdjustments : { modules: { clé: true|false|null }, features: { … } }. */
const adjustMap = z.record(z.string(), z.union([z.boolean(), z.null()])).optional();
export const moduleAdjustmentsSchema = body({ modules: adjustMap, features: adjustMap });

/* Diffusion d'un module — saveModuleRollout : { pilot: { roles, users } | null, disabledStores }. */
export const moduleRolloutSchema = body({
  pilot: obj({ roles: strList().optional(), users: strList().optional() }).nullish(),
  disabledStores: strList().optional(),
});

/* Modèle de configuration (aperçu d'import / secteur personnalisé) : JSON vérifié par le service. */
export const configModelPreviewSchema = body({ model: any });
export const createSectorSchema = body({ model: any, name: z.string().max(120).optional() });
/* Assistant de configuration : description en langage naturel. */
export const configAssistantSchema = body({ description: z.string().max(10_000) });

/* Compte bancaire de la société — readBank (le contrôleur vérifie RIB, SWIFT, compte 514…). */
const textish = z.union([z.string(), z.number()]).nullish();
export const bankAccountSchema = body({
  label: txt(200), bankName: txt(200), rib: textish, swift: txt(20), ledgerAccount: textish,
  storeId: z.string().max(60).nullish(),
  isDefault: bool, showOnInvoices: bool, isActive: bool,
});

/* Codes TVA — addTaxRate / updateTaxCode (taux, nature, dates vérifiés par le contrôleur). */
export const addTaxRateSchema = body({
  code: z.string().max(40), label: z.string().max(200), rate: numish, kind: z.string().max(40),
  validFrom: z.string().max(30), recoverable: bool, legalRef: txt(1000),
});
export const updateTaxCodeSchema = body({ label: z.string().max(200).optional(), legalRef: txt(1000), validTo: txt(30) });

/* Modèle de document — updateDocument. */
export const documentTemplateSchema = body({
  paymentTerms: txt(2000), latePenalty: txt(2000), footerNote: txt(2000), showBank: bool, showLegalForm: bool,
});
/* Règle de notification — updateNotificationRule. */
export const notificationRuleSchema = body({ enabled: bool, emailEnabled: bool, extraRoles: strList(100).optional() });

/* Règles d'approbation — approval-rules.controller (condition et étapes vérifiées par le contrôleur). */
const approvalRuleFields = {
  label: z.string().max(200).optional(),
  enabled: bool,
  condition: any,
  steps: z.array(any).max(50).optional(),
  mode: z.string().max(20).optional(),
  escalateAfterHours: numish,
};
export const createApprovalRuleSchema = body({ ...approvalRuleFields, code: z.string().max(60), docType: z.string().max(60) });
export const updateApprovalRuleSchema = body(approvalRuleFields);

/* API publique — clés et webhooks (api-settings.controller). */
export const createApiKeySchema = body({ label: z.string().trim().min(1, 'Libellé requis').max(120), scopes: strList(100).optional(), storeId: z.string().max(60).nullish() });
export const createWebhookSchema = body({
  label: z.string().trim().min(1, 'Libellé et URL requis').max(120),
  url: z.string().trim().min(1, 'Libellé et URL requis').max(2000),
  events: strList(200).optional(),
});
export const webhookActiveSchema = body({ active: bool });

/* Import guidé (multipart) — importOptions : association des colonnes en JSON texte, mode. */
export const dataImportSchema = body({ mapping: z.string().max(100_000).optional(), mode: z.string().max(20).optional() });
