import { db } from '../config/database.js';
import { passkeyRepository } from './passkey.repository.js';
import { getParameter } from '../services/module-parameters.service.js';
import { createHash, randomBytes } from 'node:crypto';
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
    const passkeys = await passkeyRepository.countForUser(userId);
    return {
      enabled: !!u?.totp_enabled, pending: !!u?.has_secret && !u?.totp_enabled, backupCodesLeft: Number(u?.backups ?? 0),
      required: requiredByRole || requiredForUser, requiredByRole, requiredForUser,
      // Passkeys (mig 705) : une passkey suffit comme second facteur.
      passkeys, protected: !!u?.totp_enabled || passkeys > 0,
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

  /** Début du délai pour configurer la double authentification (lot 8) : posé au premier appel. */
  async startGrace(userId: string): Promise<Date> {
    const r = await db.query(
      `UPDATE users SET mfa_grace_started_at = COALESCE(mfa_grace_started_at, now()) WHERE id = $1 RETURNING mfa_grace_started_at`, [userId]);
    return r.rows[0]?.mfa_grace_started_at ?? new Date();
  },

  async clearGrace(userId: string): Promise<void> {
    await db.query(`UPDATE users SET mfa_grace_started_at = NULL WHERE id = $1 AND mfa_grace_started_at IS NOT NULL`, [userId]).catch(() => undefined);
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
    await this.forgetDevices(userId);
  },

  /** Réinitialisation par l'administrateur : application, codes de secours, postes ET passkeys. */
  async resetAll(userId: string) {
    await this.disable(userId);
    await passkeyRepository.removeAllForUser(userId);
  },

  /* ── Postes de confiance (mig 702) : plus de code demandé sur ce poste pendant N jours ── */

  /** Durée en jours (paramètre security.mfa.trustedDeviceDays, 14 par défaut, 0 = désactivé, 90 au plus). */
  async trustedDeviceDays(): Promise<number> {
    const v = await getParameter<{ trustedDeviceDays?: number }>('security.mfa');
    const n = Number(v?.trustedDeviceDays);
    return v?.trustedDeviceDays !== undefined && Number.isFinite(n) && n >= 0 ? Math.min(90, Math.floor(n)) : 14;
  },

  /** Mémorise le poste : rend le jeton à poser en cookie (seule son empreinte est conservée). */
  async rememberDevice(userId: string, label: string | null, ip: string | null): Promise<{ token: string; days: number } | null> {
    const days = await this.trustedDeviceDays();
    if (!days) return null;
    const token = randomBytes(32).toString('base64url');
    await db.query(
      `INSERT INTO mfa_trusted_devices (user_id, token_hash, label, ip, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(days => $5::int))`,
      [userId, hashDeviceToken(token), label?.slice(0, 200) ?? null, ip?.slice(0, 64) ?? null, days],
    );
    return { token, days };
  },

  /** Vrai si l'un des jetons du navigateur est un poste de confiance encore valable pour ce compte. */
  async isTrustedDevice(userId: string, tokens: string[]): Promise<boolean> {
    if (!tokens.length) return false;
    const r = await db.query(
      `UPDATE mfa_trusted_devices SET last_used_at = now()
        WHERE user_id = $1 AND token_hash = ANY($2::text[]) AND revoked_at IS NULL AND expires_at > now()
        RETURNING id`,
      [userId, tokens.map(hashDeviceToken)],
    );
    return (r.rowCount ?? 0) > 0;
  },

  /** Oublie les postes de confiance du compte (le code sera redemandé) ; `keepTokens` : poste en cours épargné. */
  async forgetDevices(userId: string, keepTokens: string[] = []): Promise<number> {
    const r = await db.query(
      `UPDATE mfa_trusted_devices SET revoked_at = now()
        WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() AND NOT (token_hash = ANY($2::text[]))`,
      [userId, keepTokens.map(hashDeviceToken)],
    );
    return r.rowCount ?? 0;
  },

  /** Nombre de postes de confiance encore valables, par compte. */
  async trustedDeviceCounts(): Promise<Map<string, number>> {
    const r = await db.query(
      `SELECT user_id, count(*)::int AS n FROM mfa_trusted_devices WHERE revoked_at IS NULL AND expires_at > now() GROUP BY user_id`,
    );
    return new Map(r.rows.map((x: { user_id: string; n: number }) => [x.user_id, x.n]));
  },
};

function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
