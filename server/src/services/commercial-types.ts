import { db } from '../config/database.js';
import {
  CUSTOMER_TYPES_TABLE, ORDER_TYPES_TABLE, customerTypeBehaviors, orderTypeBehaviors,
  type CustomerTypeBehaviors, type OrderTypeBehaviors,
} from '@ofauria/shared';

/**
 * Types de client et de commande (mig 701) : lecture des comportements portés par le
 * référentiel sectoriel. Le code métier appelle ces fonctions au lieu de comparer un code
 * (« particulier », « staff »…). Côté SQL, l'équivalent est fn_customer_on_account() et
 * fn_customer_type_flag().
 */
type Runner = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export type OrderType = { code: string; label: string; is_active: boolean; behaviors: OrderTypeBehaviors };
export type CustomerType = { code: string; label: string; is_active: boolean; behaviors: CustomerTypeBehaviors };

export async function findOrderType(code: string, runner: Runner = db): Promise<OrderType | null> {
  const r = (await runner.query(
    `SELECT code, label, is_active, metadata FROM ref_entries WHERE table_id = $1 AND code = $2`, [ORDER_TYPES_TABLE, code])).rows[0];
  return r ? { code: r.code, label: r.label, is_active: r.is_active, behaviors: orderTypeBehaviors(r.metadata) } : null;
}

export async function findCustomerType(code: string | null | undefined, runner: Runner = db): Promise<CustomerType> {
  const c = code || 'particulier';
  const r = (await runner.query(
    `SELECT code, label, is_active, metadata FROM ref_entries WHERE table_id = $1 AND code = $2`, [CUSTOMER_TYPES_TABLE, c])).rows[0];
  return { code: c, label: r?.label ?? c, is_active: r?.is_active ?? false, behaviors: customerTypeBehaviors(r?.metadata, c) };
}

export async function activeCustomerTypes(runner: Runner = db): Promise<CustomerType[]> {
  const { rows } = await runner.query(
    `SELECT code, label, is_active, metadata FROM ref_entries WHERE table_id = $1 AND is_active AND code IS NOT NULL ORDER BY display_order, label`,
    [CUSTOMER_TYPES_TABLE]);
  return rows.map(r => ({ code: r.code, label: r.label, is_active: true, behaviors: customerTypeBehaviors(r.metadata, r.code) }));
}

/**
 * Type de client par défaut pour une fiche créée sans choix (conversion d'un prospect, import) :
 * le premier type actif du secteur qui correspond — personne morale ou non.
 */
export async function defaultCustomerType(legalEntity: boolean, runner: Runner = db): Promise<string> {
  const types = await activeCustomerTypes(runner);
  return (types.find(t => t.behaviors.legal_entity === legalEntity) ?? types[0])?.code ?? (legalEntity ? 'professionnel' : 'particulier');
}

/**
 * Vrai quand la société réserve des commandes à la direction (au moins un type de commande
 * actif « réservé à la direction ») : c'est le modèle de la vente au comptoir, où la caisse ne
 * voit ni ne prend les commandes des clients en compte. Ailleurs (BTP, industrie…), tout le
 * monde voit les commandes que ses droits lui ouvrent.
 */
export async function accountOrdersRestricted(runner: Runner = db): Promise<boolean> {
  const r = await runner.query(
    `SELECT 1 FROM ref_entries WHERE table_id = $1 AND is_active AND (metadata ->> 'direction_only')::boolean IS TRUE LIMIT 1`, [ORDER_TYPES_TABLE]);
  return r.rows.length > 0;
}

/** Les deux référentiels, valeurs inactives comprises, pour les écrans. */
export async function commercialTypes(runner: Runner = db) {
  const { rows } = await runner.query(
    `SELECT table_id, code, label, description, icon, color, display_order, is_active, metadata
       FROM ref_entries WHERE table_id = ANY($1::text[]) AND code IS NOT NULL ORDER BY display_order, label`,
    [[CUSTOMER_TYPES_TABLE, ORDER_TYPES_TABLE]]);
  return {
    customerTypes: rows.filter(r => r.table_id === CUSTOMER_TYPES_TABLE),
    orderTypes: rows.filter(r => r.table_id === ORDER_TYPES_TABLE),
  };
}
