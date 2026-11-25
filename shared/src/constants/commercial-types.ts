/**
 * Types de client et types de commande (mig 701) : deux référentiels pilotés par le secteur
 * (customer_types, order_types). Chaque valeur porte dans `metadata` les COMPORTEMENTS que le
 * code lit. Règle : le code ne compare jamais le code d'une valeur (« particulier »,
 * « staff »…) ; il lit un comportement. Ajouter « Maître d'ouvrage » ou « Commande de
 * travaux » est donc une ligne de données, pas une ligne de code.
 *
 * Ce fichier est le SCHÉMA de ces comportements, commun au serveur (validation de ce que
 * l'administrateur enregistre) et à l'écran (formulaire du référentiel).
 */

export type Settlement = 'comptant' | 'compte';
export interface CustomerTypeBehaviors {
  /** comptant : réglé au comptoir ; compte : prix HT, TVA par ligne, BL, facture. */
  settlement: Settlement;
  legal_entity: boolean;
  requires_tax_id: boolean;
  vat_exempt: boolean;
  personal_fields: boolean;
}
export type OrderParty = 'customer' | 'walk_in' | 'employee';
export interface OrderTypeBehaviors {
  party: OrderParty;
  /** Clients proposés quand party = customer. */
  settlement: Settlement | 'any';
  auto_discount: 'none' | 'staff';
  direction_only: boolean;
}

export type BehaviorField =
  | { key: string; label: string; help: string; kind: 'boolean' }
  | { key: string; label: string; help: string; kind: 'choice'; options: { value: string; label: string }[] };

export const CUSTOMER_TYPES_TABLE = 'customer_types';
export const ORDER_TYPES_TABLE = 'order_types';

/** Champs de comportement par table de référentiel (clé = ref_tables.id). */
export const REF_BEHAVIOR_FIELDS: Record<string, BehaviorField[]> = {
  [CUSTOMER_TYPES_TABLE]: [
    { key: 'settlement', kind: 'choice', label: 'Règlement', help: 'Au comptant : avance facultative et solde à la remise. En compte : prix hors taxes, bon de livraison puis facture.',
      options: [{ value: 'comptant', label: 'Au comptant' }, { value: 'compte', label: 'En compte (facturé)' }] },
    { key: 'legal_entity', kind: 'boolean', label: 'Personne morale', help: 'La raison sociale figure sur les pièces à la place du nom et du prénom.' },
    { key: 'requires_tax_id', kind: 'boolean', label: 'Identifiant fiscal exigé', help: 'Une facture est refusée tant que l\'identifiant fiscal du client n\'est pas renseigné.' },
    { key: 'vat_exempt', kind: 'boolean', label: 'Exonéré de TVA par défaut', help: 'L\'exonération est proposée à la création de la fiche.' },
    { key: 'personal_fields', kind: 'boolean', label: 'Champs d\'une personne', help: 'Date d\'anniversaire et allergies sur la fiche.' },
  ],
  [ORDER_TYPES_TABLE]: [
    { key: 'party', kind: 'choice', label: 'Pour qui', help: 'Ce que l\'écran demande à la première étape.',
      options: [{ value: 'customer', label: 'Un client enregistré' }, { value: 'walk_in', label: 'Un client de passage (nom et téléphone)' }, { value: 'employee', label: 'Un salarié' }] },
    { key: 'settlement', kind: 'choice', label: 'Clients proposés', help: 'Pour un client enregistré : lesquels peuvent être choisis.',
      options: [{ value: 'any', label: 'Tous' }, { value: 'comptant', label: 'Réglés au comptant' }, { value: 'compte', label: 'En compte (facturés)' }] },
    { key: 'auto_discount', kind: 'choice', label: 'Remise automatique', help: 'Remise appliquée d\'office, au taux réglé dans Paramètres.',
      options: [{ value: 'none', label: 'Aucune' }, { value: 'staff', label: 'Remise du personnel' }] },
    { key: 'direction_only', kind: 'boolean', label: 'Réservée à la direction', help: 'Seuls l\'administrateur et le gérant prennent ce type de commande.' },
  ],
};

const DEFAULT_CUSTOMER: CustomerTypeBehaviors = { settlement: 'comptant', legal_entity: false, requires_tax_id: false, vat_exempt: false, personal_fields: true };
const DEFAULT_ORDER: OrderTypeBehaviors = { party: 'customer', settlement: 'any', auto_discount: 'none', direction_only: false };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Comportements d'un type de client. Un type absent du référentiel (base ancienne, valeur
 * importée) garde la règle historique : tout sauf « particulier » est en compte.
 */
export function customerTypeBehaviors(metadata: unknown, code?: string | null): CustomerTypeBehaviors {
  if (isObj(metadata) && (metadata.settlement === 'comptant' || metadata.settlement === 'compte')) {
    return {
      settlement: metadata.settlement, legal_entity: metadata.legal_entity === true, requires_tax_id: metadata.requires_tax_id === true,
      vat_exempt: metadata.vat_exempt === true, personal_fields: metadata.personal_fields === true,
    };
  }
  const account = !!code && code !== 'particulier';
  return account ? { settlement: 'compte', legal_entity: true, requires_tax_id: code !== 'association', vat_exempt: code === 'association', personal_fields: false } : DEFAULT_CUSTOMER;
}

export function orderTypeBehaviors(metadata: unknown): OrderTypeBehaviors {
  if (!isObj(metadata)) return DEFAULT_ORDER;
  const party = metadata.party === 'walk_in' || metadata.party === 'employee' ? metadata.party : 'customer';
  const settlement = metadata.settlement === 'comptant' || metadata.settlement === 'compte' ? metadata.settlement : 'any';
  return { party, settlement, auto_discount: metadata.auto_discount === 'staff' ? 'staff' : 'none', direction_only: metadata.direction_only === true };
}

/**
 * Valide les comportements saisis pour une valeur d'un référentiel à comportements. Les clés
 * inconnues sont écartées ; une valeur hors liste est refusée. Table sans schéma : inchangé.
 */
export function cleanRefBehaviors(tableId: string, raw: unknown): { ok: true; metadata: Record<string, unknown> } | { ok: false; error: string } {
  const fields = REF_BEHAVIOR_FIELDS[tableId];
  const src = isObj(raw) ? raw : {};
  if (!fields) return { ok: true, metadata: src };
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = src[f.key];
    if (f.kind === 'boolean') { out[f.key] = v === true; continue; }
    if (v === undefined || v === null || v === '') { out[f.key] = f.options[0].value; continue; }
    if (!f.options.some(o => o.value === v)) return { ok: false, error: `« ${f.label} » : valeur inconnue` };
    out[f.key] = v;
  }
  return { ok: true, metadata: out };
}
