/**
 * Plan d'action compta, étape 19 (audit C-09) : la migration 683 découpe accounting.delete et
 * accounting.cancel en droits fins SANS changer qui peut quoi.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool } from './helpers.js';

const DELETE_KEYS = [
  'accounting.invoices.delete', 'accounting.invoices.attachment_delete', 'accounting.payments.delete',
  'accounting.accounts.delete', 'accounting.corporate_tax.adjustment_delete', 'accounting.revenue_families.delete',
  'accounting.entries.draft_delete', 'accounting.lettrage.undo', 'accounting.entry_templates.delete',
  'accounting.cash_forecast.line_delete',
];
const CANCEL_KEYS = [
  'accounting.invoices.cancel', 'accounting.corporate_tax.payment_cancel', 'accounting.bills.remittance_cancel',
  'accounting.consolidation.transfer_cancel', 'accounting.fx_revaluation.cancel',
];

describe.skipIf(!hasTestDb)('Droits fins de la comptabilité : même accès qu\'avant', () => {
  const p = () => testPool();
  afterAll(async () => { await closeTestPool(); });

  const missing = async (oldKey: string, newKeys: string[]) => (await p().query(
    `SELECT r.role_code, k.key FROM role_action_permissions r CROSS JOIN unnest($2::text[]) AS k(key)
      WHERE r.permission_key = $1
        AND NOT EXISTS (SELECT 1 FROM role_action_permissions n WHERE n.role_code = r.role_code AND n.permission_key = k.key)`,
    [oldKey, newKeys])).rows;

  it('tout rôle qui pouvait supprimer garde chacune des dix suppressions', async () => {
    expect(await missing('accounting.delete', DELETE_KEYS)).toEqual([]);
  });

  it('tout rôle qui pouvait annuler garde chacune des cinq annulations', async () => {
    expect(await missing('accounting.cancel', CANCEL_KEYS)).toEqual([]);
  });

  it('inversement, aucun rôle ne reçoit une clé fine sans détenir l\'ancienne', async () => {
    const extra = (await p().query(
      `SELECT r.role_code, r.permission_key FROM role_action_permissions r
        WHERE r.permission_key = ANY($1::text[]) AND NOT EXISTS (
          SELECT 1 FROM role_action_permissions o WHERE o.role_code = r.role_code AND o.permission_key = 'accounting.delete')`, [DELETE_KEYS])).rows;
    expect(extra).toEqual([]);
  });

  it('les exceptions par utilisateur sont recopiées (accordées comme retirées)', async () => {
    const lost = (await p().query(
      `SELECT u.user_id FROM user_action_permissions u CROSS JOIN unnest($1::text[]) AS k(key)
        WHERE u.permission_key = 'accounting.delete'
          AND NOT EXISTS (SELECT 1 FROM user_action_permissions n WHERE n.user_id = u.user_id AND n.permission_key = k.key AND n.granted = u.granted)`,
      [DELETE_KEYS])).rows;
    expect(lost).toEqual([]);
  });
});
