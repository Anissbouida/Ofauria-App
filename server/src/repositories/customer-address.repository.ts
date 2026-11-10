import { db } from '../config/database.js';
import type { PoolClient } from 'pg';

// Référentiel d'adresses client (phase 4.1, mig 474). La fiche client porte
// plusieurs adresses (livraison / facturation) ; les pièces (BL, facture) en
// figent une au moment de l'émission.

export interface CustomerAddressInput {
  label?: string | null;
  kind?: 'delivery' | 'billing' | 'both';
  addressLine: string;
  postalCode?: string | null;
  city?: string | null;
  countryCode?: string | null;
  isDefaultDelivery?: boolean;
  isDefaultBilling?: boolean;
}

type Runner = Pick<PoolClient, 'query'>;

/** Met en texte figeable une ligne d'adresse (snapshot sur les pièces). */
export function formatAddress(a: {
  address_line?: string | null; postal_code?: string | null; city?: string | null; country_code?: string | null;
}): string {
  const cityLine = [a.postal_code, a.city].filter(v => v && String(v).trim()).join(' ');
  const country = a.country_code && a.country_code !== 'MA' ? a.country_code : '';
  return [a.address_line, cityLine, country].filter(v => v && String(v).trim()).join(', ');
}

export const customerAddressRepository = {
  async list(customerId: string) {
    return (await db.query(
      `SELECT * FROM customer_addresses WHERE customer_id = $1 AND is_active = true
        ORDER BY is_default_delivery DESC, is_default_billing DESC, created_at`,
      [customerId]
    )).rows;
  },

  async findById(id: string) {
    return (await db.query(`SELECT * FROM customer_addresses WHERE id = $1`, [id])).rows[0] ?? null;
  },

  /** Adresse (figée en texte) à retenir pour une pièce. kind = 'delivery' ou
   *  'billing' : on prend le défaut du rôle, sinon une adresse 'both', sinon
   *  repli sur l'adresse unique legacy du client. Vide si rien. */
  async resolveText(client: Runner, customerId: string | null, kind: 'delivery' | 'billing'): Promise<string | null> {
    if (!customerId) return null;
    const defaultCol = kind === 'delivery' ? 'is_default_delivery' : 'is_default_billing';
    const row = (await client.query(
      `SELECT address_line, postal_code, city, country_code
         FROM customer_addresses
        WHERE customer_id = $1 AND is_active = true
          AND (kind = $2 OR kind = 'both')
        ORDER BY ${defaultCol} DESC, created_at
        LIMIT 1`,
      [customerId, kind]
    )).rows[0];
    if (row) return formatAddress(row) || null;
    // Repli : adresse unique legacy de la fiche client.
    const legacy = (await client.query(`SELECT address, city FROM customers WHERE id = $1`, [customerId])).rows[0];
    if (legacy?.address) return formatAddress({ address_line: legacy.address, city: legacy.city });
    return null;
  },

  async create(customerId: string, data: CustomerAddressInput) {
    const c = await db.getClient();
    try {
      await c.query('BEGIN');
      await clearDefaults(c, customerId, null, data);
      const row = (await c.query(
        `INSERT INTO customer_addresses
           (customer_id, label, kind, address_line, postal_code, city, country_code, is_default_delivery, is_default_billing)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'MA'), $8, $9) RETURNING *`,
        [customerId, data.label ?? null, data.kind ?? 'both', data.addressLine,
         data.postalCode ?? null, data.city ?? null, data.countryCode ?? null,
         data.isDefaultDelivery ?? false, data.isDefaultBilling ?? false]
      )).rows[0];
      await c.query('COMMIT');
      return row;
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
  },

  async update(id: string, customerId: string, data: CustomerAddressInput) {
    const c = await db.getClient();
    try {
      await c.query('BEGIN');
      await clearDefaults(c, customerId, id, data);
      const row = (await c.query(
        `UPDATE customer_addresses SET
           label = COALESCE($3, label), kind = COALESCE($4, kind),
           address_line = COALESCE($5, address_line), postal_code = $6, city = $7,
           country_code = COALESCE($8, country_code),
           is_default_delivery = COALESCE($9, is_default_delivery),
           is_default_billing = COALESCE($10, is_default_billing),
           updated_at = NOW()
         WHERE id = $1 AND customer_id = $2 RETURNING *`,
        [id, customerId, data.label ?? null, data.kind ?? null, data.addressLine ?? null,
         data.postalCode ?? null, data.city ?? null, data.countryCode ?? null,
         data.isDefaultDelivery ?? null, data.isDefaultBilling ?? null]
      )).rows[0];
      await c.query('COMMIT');
      return row ?? null;
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
  },

  /** Désactivation (soft-delete) : l'historique des pièces reste intact. */
  async remove(id: string, customerId: string) {
    return (await db.query(
      `UPDATE customer_addresses SET is_active = false, is_default_delivery = false, is_default_billing = false, updated_at = NOW()
        WHERE id = $1 AND customer_id = $2 RETURNING id`,
      [id, customerId]
    )).rows[0] ?? null;
  },
};

/** Avant de poser un défaut, retire le même défaut des autres adresses du
 *  client (l'index partiel unique l'imposerait de toute façon). */
async function clearDefaults(c: Runner, customerId: string, exceptId: string | null, data: CustomerAddressInput) {
  const except = exceptId ? ' AND id <> $2' : '';
  const params = exceptId ? [customerId, exceptId] : [customerId];
  if (data.isDefaultDelivery) {
    await c.query(`UPDATE customer_addresses SET is_default_delivery = false WHERE customer_id = $1${except}`, params);
  }
  if (data.isDefaultBilling) {
    await c.query(`UPDATE customer_addresses SET is_default_billing = false WHERE customer_id = $1${except}`, params);
  }
}
