import { db } from '../config/database.js';
import { getParameter } from '../services/module-parameters.service.js';
import { decryptSecret, encryptSecret, generateBackupCodes, generateSecret, hashBackupCode, otpauthUrl, verifyTotp } from '../services/totp.js';

/**
 * Double authentification (G6-01). États : non configurée → en cours (secret posé, non
 * activé) → activée (secret + codes de secours). L'activation exige un code valide.
 */
export const mfaRepository = {
  /** Rôles qui doivent activer la double authentification (paramètre security.mfa). */
  async requiredRoles(): Promise<string[]> {
    const v = await getParameter<{ requiredRoles?: string[] }>('security.mfa');
    return Array.isArray(v?.requiredRoles) ? v.requiredRoles : ['admin'];
  },

  /** Exigée = rôle listé dans security.mfa OU exigence posée sur le compte (mig 617). */
  async state(userId: string, roleCodes: string[]) {
    const u = (await db.query(`SELECT totp_enabled, mfa_required, totp_secret_enc IS NOT NULL AS has_secret, jsonb_array_length(totp_backup_codes) AS backups FROM users WHERE id = $1`, [userId])).rows[0];
    const requiredByRole = (await this.requiredRoles()).some(r => roleCodes.includes(r));
    const requiredForUser = !!u?.mfa_required;
    return {
      enabled: !!u?.totp_enabled, pending: !!u?.has_secret && !u?.totp_enabled, backupCodesLeft: Number(u?.backups ?? 0),
      required: requiredByRole || requiredForUser, requiredByRole, requiredForUser,
    };
  },

  /** Remplace la liste des rôles qui doivent activer la double authentification. */
  async setRequiredRoles(roles: string[], actorId: string) {
    await db.query(
      `INSERT INTO module_parameters (key, value, description, updated_by, updated_at)
       VALUES ('security.mfa', $1::jsonb, 'Double authentification : rôles (codes) qui doivent l''activer avant toute autre action.', $2, now())
       ON CONFLICT (key) DO UPDATE SET value = module_parameters.value || EXCLUDED.value, updated_by = $2, updated_at = now()`,
      [JSON.stringify({ requiredRoles: roles }), actorId],
    );
  },

  /** Exigence posée par l'administrateur sur un compte (mig 617). */
  async setRequiredForUser(userId: string, required: boolean) {
    const r = await db.query(`UPDATE users SET mfa_required = $2, updated_at = now() WHERE id = $1`, [userId, required]);
    return (r.rowCount ?? 0) > 0;
  },

  /** Nouveau secret (non activé) : à scanner dans l'application, puis confirmer par un code. */
  async startSetup(userId: string, account: string) {
    const cur = (await db.query(`SELECT totp_enabled FROM users WHERE id = $1`, [userId])).rows[0];
    if (cur?.totp_enabled) throw Object.assign(new Error('Double authentification déjà activée'), { statusCode: 409 });
    const secret = generateSecret();
    await db.query(`UPDATE users SET totp_secret_enc = $2 WHERE id = $1`, [userId, encryptSecret(secret)]);
    return { secret, otpauthUrl: otpauthUrl(secret, account) };
  },

  /** Active après vérification d'un code ; rend les codes de secours (affichés une seule fois). */
  async enable(userId: string, code: string) {
    const u = (await db.query(`SELECT totp_secret_enc, totp_enabled FROM users WHERE id = $1`, [userId])).rows[0];
    if (!u?.totp_secret_enc) throw Object.assign(new Error('Aucune configuration en cours'), { statusCode: 400 });
    if (u.totp_enabled) throw Object.assign(new Error('Double authentification déjà activée'), { statusCode: 409 });
    if (!verifyTotp(decryptSecret(u.totp_secret_enc), code)) throw Object.assign(new Error('Code invalide'), { statusCode: 400 });
    const { codes, hashes } = generateBackupCodes();
    await db.query(`UPDATE users SET totp_enabled = true, totp_enabled_at = NOW(), totp_backup_codes = $2::jsonb WHERE id = $1`, [userId, JSON.stringify(hashes)]);
    return { backupCodes: codes };
  },

  /** Vérifie un code de l'application, ou consomme un code de secours. */
  async verify(userId: string, code: string): Promise<{ ok: boolean; usedBackup: boolean }> {
    const u = (await db.query(`SELECT totp_secret_enc, totp_enabled, totp_backup_codes FROM users WHERE id = $1`, [userId])).rows[0];
    if (!u?.totp_enabled || !u.totp_secret_enc) return { ok: false, usedBackup: false };
    if (verifyTotp(decryptSecret(u.totp_secret_enc), code)) return { ok: true, usedBackup: false };
    const h = hashBackupCode(String(code ?? ''));
    const list: string[] = Array.isArray(u.totp_backup_codes) ? u.totp_backup_codes : [];
    if (!list.includes(h)) return { ok: false, usedBackup: false };
    await db.query(`UPDATE users SET totp_backup_codes = $2::jsonb WHERE id = $1`, [userId, JSON.stringify(list.filter(x => x !== h))]);
    return { ok: true, usedBackup: true };
  },

  async disable(userId: string) {
    await db.query(`UPDATE users SET totp_enabled = false, totp_enabled_at = NULL, totp_secret_enc = NULL, totp_backup_codes = '[]'::jsonb WHERE id = $1`, [userId]);
  },
};
