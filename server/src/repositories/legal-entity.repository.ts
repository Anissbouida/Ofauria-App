import { db } from '../config/database.js';
import { auditedQuery, setAuditUser } from '../utils/audit-context.js';

/**
 * G6-03 (mig 608) — entités juridiques (sociétés) et rattachement des établissements.
 * L'entité par défaut est le miroir de company_settings.legal_* (synchronisée par
 * déclencheurs dans les deux sens) ; voir docs/G6-03_MULTI_SOCIETE.md.
 */
export interface LegalEntityRow {
  id: string;
  code: string;
  legal_name: string;
  trade_name: string | null;
  legal_form: string | null;
  capital: string | null;
  ice: string | null;
  if_number: string | null;
  rc: string | null;
  patente: string | null;
  cnss: string | null;
  address: string | null;
  city: string | null;
  commune_code: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  currency_code: string;
  country_code: string;
  logo_url: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LegalEntityInput {
  code?: string; legalName?: string; tradeName?: string | null; legalForm?: string | null;
  capital?: number | null; ice?: string | null; ifNumber?: string | null; rc?: string | null;
  patente?: string | null; cnss?: string | null; address?: string | null; city?: string | null;
  communeCode?: string | null; phone?: string | null; email?: string | null; website?: string | null;
  currencyCode?: string; countryCode?: string; logoUrl?: string | null; isActive?: boolean; isDefault?: boolean;
}

const COLUMNS: Record<Exclude<keyof LegalEntityInput, 'isDefault'>, string> = {
  code: 'code', legalName: 'legal_name', tradeName: 'trade_name', legalForm: 'legal_form', capital: 'capital',
  ice: 'ice', ifNumber: 'if_number', rc: 'rc', patente: 'patente', cnss: 'cnss', address: 'address', city: 'city',
  communeCode: 'commune_code', phone: 'phone', email: 'email', website: 'website', currencyCode: 'currency_code',
  countryCode: 'country_code', logoUrl: 'logo_url', isActive: 'is_active',
};

let tableChecked: boolean | null = null;

export const legalEntityRepository = {
  /** La mig 608 est-elle passée ? (repli sur company_settings sinon). Mémorisé une fois vrai. */
  async available(): Promise<boolean> {
    if (tableChecked) return true;
    const ok = (await db.query(`SELECT to_regclass('public.legal_entities') IS NOT NULL AS ok`)).rows[0].ok as boolean;
    if (ok) tableChecked = true;
    return ok;
  },

  async list(): Promise<(LegalEntityRow & { store_count: number })[]> {
    return (await db.query(
      `SELECT e.*, (SELECT count(*)::int FROM stores s WHERE s.legal_entity_id = e.id) AS store_count
         FROM legal_entities e ORDER BY e.is_default DESC, e.legal_name`)).rows;
  },

  async findById(id: string): Promise<LegalEntityRow | null> {
    return (await db.query(`SELECT * FROM legal_entities WHERE id = $1`, [id])).rows[0] ?? null;
  },

  async findDefault(): Promise<LegalEntityRow | null> {
    return (await db.query(`SELECT * FROM legal_entities WHERE is_default LIMIT 1`)).rows[0] ?? null;
  },

  /** Entité de l'établissement (null si l'établissement est inconnu). */
  async findByStore(storeId: string): Promise<LegalEntityRow | null> {
    return (await db.query(
      `SELECT e.* FROM stores s JOIN legal_entities e ON e.id = s.legal_entity_id WHERE s.id = $1`, [storeId])).rows[0] ?? null;
  },

  async codeTaken(code: string, exceptId?: string | null): Promise<boolean> {
    return (await db.query(`SELECT 1 FROM legal_entities WHERE code = $1 AND id IS DISTINCT FROM $2`, [code, exceptId ?? null])).rows.length > 0;
  },

  async activeStoreCount(id: string): Promise<number> {
    return Number((await db.query(
      `SELECT count(*)::int AS n FROM stores WHERE legal_entity_id = $1 AND is_active IS NOT FALSE`, [id])).rows[0].n);
  },

  /**
   * Création ou modification. isDefault = true fait passer le statut « par défaut » à
   * cette entité dans la même transaction (company_settings suit, par déclencheur).
   */
  async save(id: string | null, data: LegalEntityInput, actorId?: string): Promise<LegalEntityRow | null> {
    const entries = (Object.keys(COLUMNS) as (keyof typeof COLUMNS)[])
      .filter(k => data[k] !== undefined)
      .map(k => [COLUMNS[k], data[k]] as [string, unknown]);
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setAuditUser(client, actorId);
      let row: LegalEntityRow | undefined;
      if (id === null) {
        const cols = entries.map(e => e[0]);
        row = (await client.query(
          `INSERT INTO legal_entities (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
          entries.map(e => e[1]))).rows[0];
      } else if (entries.length) {
        row = (await client.query(
          `UPDATE legal_entities SET ${entries.map((e, i) => `${e[0]} = $${i + 1}`).join(', ')}, updated_at = now()
            WHERE id = $${entries.length + 1} RETURNING *`,
          [...entries.map(e => e[1]), id])).rows[0];
      } else {
        row = (await client.query(`SELECT * FROM legal_entities WHERE id = $1`, [id])).rows[0];
      }
      if (row && data.isDefault === true && !row.is_default) {
        await client.query(`UPDATE legal_entities SET is_default = false, updated_at = now() WHERE is_default`);
        row = (await client.query(
          `UPDATE legal_entities SET is_default = true, is_active = true, updated_at = now() WHERE id = $1 RETURNING *`,
          [row.id])).rows[0];
      }
      await client.query('COMMIT');
      return row ?? null;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },

  /** Établissements avec leur entité (écran Paramètres › Société). */
  async stores(): Promise<{ id: string; name: string; code: string | null; is_active: boolean; legal_entity_id: string }[]> {
    return (await db.query(
      `SELECT id, name, code, is_active, legal_entity_id FROM stores ORDER BY is_active DESC, name`)).rows;
  },

  async assignStore(storeId: string, entityId: string, actorId?: string): Promise<boolean> {
    const r = await auditedQuery(actorId,
      `UPDATE stores SET legal_entity_id = $2, updated_at = now() WHERE id = $1 RETURNING id`, [storeId, entityId]);
    return r.rows.length > 0;
  },
};
