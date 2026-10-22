import { db } from '../config/database.js';
import { setAuditUser } from '../utils/audit-context.js';

export interface BankAccountInput {
  label?: string; bankName?: string; rib?: string; swift?: string | null; ledgerAccount?: string | null;
  storeId?: string | null; isDefault?: boolean; showOnInvoices?: boolean; isActive?: boolean;
}
const COLUMNS: Record<keyof BankAccountInput, string> = {
  label: 'label', bankName: 'bank_name', rib: 'rib', swift: 'swift', ledgerAccount: 'ledger_account',
  storeId: 'store_id', isDefault: 'is_default', showOnInvoices: 'show_on_invoices', isActive: 'is_active',
};

/** Comptes bancaires de la société (mig 331). */
export const companyBankRepository = {
  async list() {
    const r = await db.query(
      `SELECT b.*, s.name AS store_name FROM company_bank_accounts b
         LEFT JOIN stores s ON s.id = b.store_id
        ORDER BY b.is_active DESC, b.is_default DESC, b.label`);
    return r.rows;
  },

  /** Création / modification ; un seul compte par défaut (l'ancien perd le statut). */
  async save(id: string | null, data: BankAccountInput, actorId?: string) {
    const entries = (Object.keys(COLUMNS) as (keyof BankAccountInput)[])
      .filter(k => data[k] !== undefined).map(k => [COLUMNS[k], data[k]] as [string, unknown]);
    entries.push(['updated_by', actorId ?? null]);
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setAuditUser(client, actorId);
      if (data.isDefault === true) {
        await client.query(`UPDATE company_bank_accounts SET is_default = false, updated_at = now() WHERE is_default AND id IS DISTINCT FROM $1`, [id]);
      }
      const r = id === null
        ? await client.query(
          `INSERT INTO company_bank_accounts (${entries.map(e => e[0]).join(', ')})
           VALUES (${entries.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, entries.map(e => e[1]))
        : await client.query(
          `UPDATE company_bank_accounts SET ${entries.map((e, i) => `${e[0]} = $${i + 1}`).join(', ')}, updated_at = now()
            WHERE id = $${entries.length + 1} RETURNING *`, [...entries.map(e => e[1]), id]);
      await client.query('COMMIT');
      return r.rows[0] ?? null;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },
};
