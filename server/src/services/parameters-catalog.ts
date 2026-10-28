import type { SettingsSection } from '@ofauria/shared';

/**
 * Catalogue des paramètres métier (audit Paramètres, lot 4).
 *
 * Comme les paramètres d'Odoo ou les pages de configuration de Business Central,
 * la définition (libellé, type, bornes, valeur par défaut, droit requis) est dans
 * le code ; la valeur est en base, à l'un de deux endroits :
 *   - module_parameters (mig 306) : une ligne par clé, valeur JSON ;
 *   - company_settings : colonnes historiques, lues telles quelles par le code
 *     existant (aucun consommateur à modifier).
 * L'écran Paramètres › Paramètres métier est construit à partir de ce catalogue.
 * Ajouter un paramètre = ajouter une entrée ici (et sa valeur initiale en base).
 */

export type FieldType = 'boolean' | 'number' | 'integer' | 'percent' | 'enum';

export interface ParamField {
  name: string;
  label: string;
  type: FieldType;
  unit?: string;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
}

export interface ParamDef {
  key: string;
  domain: 'production' | 'pricing' | 'sales' | 'purchasing' | 'accounting' | 'company';
  label: string;
  help: string;
  /** Section des droits Paramètres requise pour voir et modifier. */
  section: SettingsSection;
  fields: ParamField[];
  defaults: Record<string, unknown>;
  storage: { kind: 'module_parameters' } | { kind: 'company_settings'; columns: Record<string, string> };
}

export const DOMAIN_LABELS: Record<ParamDef['domain'], string> = {
  production: 'Production',
  pricing: 'Prix de vente',
  sales: 'Ventes',
  purchasing: 'Achats et réception',
  accounting: 'Comptabilité',
  company: 'Société',
};

const MODE_WARN_BLOCK = [
  { value: 'warn', label: 'Signaler sans bloquer' },
  { value: 'block', label: 'Bloquer' },
];

export const PARAMETERS: ParamDef[] = [
  {
    key: 'production.fixed_charges', domain: 'production', section: 'production',
    label: 'Charges fixes mensuelles',
    help: 'Réparties sur chaque plan de production du mois pour calculer le coût de revient.',
    fields: [
      { name: 'loyer', label: 'Loyer de l\'atelier', type: 'number', unit: 'DH / mois', min: 0, max: 10_000_000 },
      { name: 'energie', label: 'Énergie (eau, électricité, gaz)', type: 'number', unit: 'DH / mois', min: 0, max: 10_000_000 },
      { name: 'autres', label: 'Autres charges fixes', type: 'number', unit: 'DH / mois', min: 0, max: 10_000_000 },
    ],
    defaults: { loyer: 0, energie: 0, autres: 0 },
    storage: { kind: 'company_settings', columns: { loyer: 'production_charge_loyer', energie: 'production_charge_energie', autres: 'production_charge_autres' } },
  },
  {
    key: 'production.steps_blocking', domain: 'production', section: 'production',
    label: 'Étapes de production bloquantes',
    help: 'Un article ne peut être déclaré produit que si toutes ses étapes sont terminées.',
    fields: [{ name: 'enabled', label: 'Bloquer tant que les étapes ne sont pas terminées', type: 'boolean' }],
    defaults: { enabled: false },
    storage: { kind: 'company_settings', columns: { enabled: 'production_steps_blocking' } },
  },
  {
    key: 'pricing.rounding', domain: 'pricing', section: 'production',
    label: 'Arrondi des prix de vente',
    help: 'Appliqué au prix calculé (coût × marge) des fiches techniques et formats. La caisse affiche toujours 2 décimales.',
    fields: [
      { name: 'strategie', label: 'Pas de l\'arrondi', type: 'enum', options: [
        { value: 'aucun', label: 'Aucun (décimales brutes)' }, { value: 'au_demi_dh', label: 'Au 0,5 DH' },
        { value: 'au_dh', label: 'Au DH' }, { value: 'au_5dh', label: 'Aux 5 DH' },
      ] },
      { name: 'sens', label: 'Sens', type: 'enum', options: [
        { value: 'superieur', label: 'Vers le haut (protège la marge)' }, { value: 'inferieur', label: 'Vers le bas' },
        { value: 'naturel', label: 'Au plus proche' },
      ] },
    ],
    defaults: { strategie: 'aucun', sens: 'superieur' },
    storage: { kind: 'company_settings', columns: { strategie: 'prix_arrondi_strategie', sens: 'prix_arrondi_sens' } },
  },
  {
    key: 'sales.staff_discount', domain: 'sales', section: 'company',
    label: 'Remise personnel',
    help: 'Remise appliquée aux achats du personnel en caisse.',
    fields: [{ name: 'percent', label: 'Taux', type: 'percent', min: 0, max: 100 }],
    defaults: { percent: 10 },
    storage: { kind: 'company_settings', columns: { percent: 'staff_discount_percent' } },
  },
  {
    key: 'sales.quotes', domain: 'sales', section: 'business',
    label: 'Devis clients',
    help: 'Durée de validité proposée sur un nouveau devis (modifiable devis par devis). Passé ce délai, un devis envoyé passe en « expiré » et son auteur est prévenu (mig 365).',
    fields: [{ name: 'validity_days', label: 'Validité', type: 'integer', unit: 'jours', min: 1, max: 365 }],
    defaults: { validity_days: 30 },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'sales.dunning', domain: 'sales', section: 'business',
    label: 'Relances clients et contrôle du crédit',
    help: 'Chaque jour, les clients en retard reçoivent une proposition de relance au niveau atteint (niveaux dans Ventes › Relances). Envoi automatique : les niveaux « par e-mail » partent sans validation. Plafond bloquant : une vente à crédit au-delà du plafond est refusée au lieu d\'une simple alerte (mig 366).',
    fields: [
      { name: 'enabled', label: 'Relances actives', type: 'boolean' },
      { name: 'auto_send', label: 'Envoyer les e-mails sans validation', type: 'boolean' },
      { name: 'min_amount', label: 'Montant échu minimal', type: 'number', unit: 'DH', min: 0, max: 1_000_000 },
      { name: 'credit_control', label: 'Plafond de crédit', type: 'enum', options: [{ value: 'warn', label: 'Alerte seulement' }, { value: 'block', label: 'Bloquant' }] },
      { name: 'auto_release', label: 'Débloquer un client dès qu\'il est à jour', type: 'boolean' },
    ],
    defaults: { enabled: true, auto_send: false, min_amount: 50, credit_control: 'warn', auto_release: true },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'sales.pos_stock', domain: 'sales', section: 'business',
    label: 'Caisse : produits sans stock vitrine',
    help: 'Stock respecté : un produit dont la vitrine est à zéro apparaît grisé dans « En rupture » et sa vente est refusée. Tout vendre : tous les produits actifs se vendent quel que soit le stock vitrine, qui peut alors passer en négatif (utile si la vitrine n\'est pas tenue au réel ou en attendant un approvisionnement). S\'applique aux ventes en caisse (mig 374).',
    fields: [{ name: 'mode', label: 'Produits sans stock', type: 'enum', options: [{ value: 'block', label: 'Stock respecté : vente refusée' }, { value: 'allow', label: 'Tout vendre, même sans stock' }] }],
    defaults: { mode: 'block' },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'purchasing.expense_requires_po', domain: 'purchasing', section: 'business',
    label: 'Bon de commande obligatoire pour les dépenses',
    help: 'Une dépense d\'une catégorie « BC requis » à partir du seuil doit être rattachée à un bon de commande engagé.',
    fields: [
      { name: 'enabled', label: 'Exiger un bon de commande', type: 'boolean' },
      { name: 'threshold', label: 'À partir de', type: 'number', unit: 'DH', min: 0, max: 10_000_000 },
    ],
    defaults: { enabled: false, threshold: 2000, currency: 'MAD' },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'purchasing.supplier_score', domain: 'purchasing', section: 'business',
    label: 'Évaluation des fournisseurs',
    help: 'Poids des critères de la note (délais tenus, livraisons complètes, conformité à réception, prix stables, absence de litige), nombre de BC minimal pour noter, période glissante et seuils des classes A / B / C. Rapport : Achats › Évaluation des fournisseurs (mig 362).',
    fields: [
      { name: 'on_time', label: 'Poids délais', type: 'integer', min: 0, max: 100 },
      { name: 'fill_rate', label: 'Poids complétude', type: 'integer', min: 0, max: 100 },
      { name: 'quality', label: 'Poids conformité', type: 'integer', min: 0, max: 100 },
      { name: 'price', label: 'Poids prix', type: 'integer', min: 0, max: 100 },
      { name: 'disputes', label: 'Poids litiges', type: 'integer', min: 0, max: 100 },
      { name: 'min_orders', label: 'BC minimum pour noter', type: 'integer', min: 1, max: 100 },
      { name: 'months', label: 'Période (mois)', type: 'integer', min: 1, max: 60 },
      { name: 'a_min', label: 'Seuil classe A', type: 'integer', min: 0, max: 100 },
      { name: 'b_min', label: 'Seuil classe B', type: 'integer', min: 0, max: 100 },
      { name: 'c_min', label: 'Seuil classe C', type: 'integer', min: 0, max: 100 },
    ],
    defaults: { on_time: 30, fill_rate: 20, quality: 20, price: 20, disputes: 10, min_orders: 3, months: 12, a_min: 85, b_min: 70, c_min: 50 },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'purchasing.over_receipt_tolerance_pct', domain: 'purchasing', section: 'business',
    label: 'Sur-livraison tolérée',
    help: 'Écart accepté par ligne de bon de commande ; au-delà, la réception est refusée.',
    fields: [{ name: 'pct', label: 'Tolérance', type: 'percent', min: 0, max: 100 }],
    defaults: { pct: 10 },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'purchasing.receipt_correction_window_hours', domain: 'purchasing', section: 'business',
    label: 'Délai de correction d\'une réception',
    help: 'Pendant ce délai le gérant peut corriger une ligne de réception ; l\'administrateur n\'est pas limité.',
    fields: [{ name: 'hours', label: 'Délai', type: 'integer', unit: 'heures', min: 0, max: 720 }],
    defaults: { hours: 72 },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'purchasing.lot_dlc_enforcement', domain: 'purchasing', section: 'business',
    label: 'Lot fournisseur et DLC à la réception',
    help: 'Que faire quand le lot ou la date limite exigés pour un article ne sont pas saisis.',
    fields: [{ name: 'mode', label: 'Si manquant', type: 'enum', options: MODE_WARN_BLOCK }],
    defaults: { mode: 'warn' },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'purchasing.invoice_holds_enforcement', domain: 'purchasing', section: 'business',
    label: 'Blocages de facture fournisseur',
    help: 'Un écart de rapprochement (prix, quantité, doublon) bloque-t-il le paiement de la facture ?',
    fields: [{ name: 'mode', label: 'En cas d\'écart', type: 'enum', options: [
      { value: 'block', label: 'Bloquer le paiement' }, { value: 'warn', label: 'Signaler seulement' },
    ] }],
    defaults: { mode: 'block' },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'purchasing.cash_limit_enforcement', domain: 'purchasing', section: 'business',
    label: 'Plafond des paiements en espèces',
    help: 'Au-delà du plafond légal par fournisseur, le paiement en espèces n\'est pas déductible.',
    fields: [{ name: 'mode', label: 'Au-delà du plafond', type: 'enum', options: [
      { value: 'warn', label: 'Accepter et marquer non déductible' }, { value: 'block', label: 'Refuser (dérogation administrateur motivée)' },
    ] }],
    defaults: { mode: 'warn' },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'accounting.card_commission', domain: 'accounting', section: 'business',
    label: 'Commission sur paiement par carte',
    help: 'Retenue par le prestataire du terminal sur chaque transaction : à 2 %, une vente carte de 100 DH crédite 98 DH en banque. Appliquée au solde carte de la Caisse et aux écritures de vente (6147 Services bancaires).',
    fields: [{ name: 'pct', label: 'Taux', type: 'percent', min: 0, max: 20 }],
    defaults: { pct: 0 },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'ledger.posting_mode', domain: 'accounting', section: 'business',
    label: 'Comptabilisation automatique',
    help: 'Que faire si l\'écriture comptable d\'une pièce échoue.',
    fields: [{ name: 'mode', label: 'En cas d\'échec', type: 'enum', options: [
      { value: 'outbox', label: 'Enregistrer la pièce, mettre l\'écriture en file à rejouer' },
      { value: 'strict', label: 'Annuler la pièce' },
    ] }],
    defaults: { mode: 'outbox' },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'company.country_code', domain: 'company', section: 'business',
    label: 'Pays de la société',
    help: 'Choisit le pack pays : codes TVA et identifiants légaux exigés.',
    fields: [{ name: 'code', label: 'Pays', type: 'enum', options: [{ value: 'MA', label: 'Maroc' }] }],
    defaults: { code: 'MA' },
    storage: { kind: 'module_parameters' },
  },
];

export const parameterByKey = (key: string) => PARAMETERS.find(p => p.key === key);

/**
 * Contrôle et normalisation d'une valeur saisie. Les champs absents gardent leur
 * valeur actuelle ; un champ inconnu est refusé. Retourne la valeur complète ou
 * un message d'erreur.
 */
export function validateParameter(def: ParamDef, input: unknown, current: Record<string, unknown>): Record<string, unknown> | string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Valeur attendue : un objet de champs';
  const out: Record<string, unknown> = { ...def.defaults, ...current };
  for (const [name, raw] of Object.entries(input as Record<string, unknown>)) {
    const f = def.fields.find(x => x.name === name);
    if (!f) return `Champ inconnu : ${name}`;
    switch (f.type) {
      case 'boolean':
        if (typeof raw !== 'boolean') return `${f.label} : oui ou non attendu`;
        out[name] = raw;
        break;
      case 'enum':
        if (!f.options?.some(o => o.value === raw)) return `${f.label} : valeur non proposée`;
        out[name] = raw;
        break;
      default: {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(n)) return `${f.label} : nombre attendu`;
        if (f.type === 'integer' && !Number.isInteger(n)) return `${f.label} : nombre entier attendu`;
        if (f.min !== undefined && n < f.min) return `${f.label} : minimum ${f.min}`;
        if (f.max !== undefined && n > f.max) return `${f.label} : maximum ${f.max}`;
        out[name] = n;
      }
    }
  }
  return out;
}
