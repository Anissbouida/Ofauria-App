import { db } from '../config/database.js';
import { auditedQuery, setAuditUser } from '../utils/audit-context.js';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  pin_code: string | null;
  pin_length?: number | null;
  must_change_password?: boolean;
  /** G6-01 : double authentification activée. */
  totp_enabled?: boolean;
  /** G6-05 : langue de l'interface (mig 610) ; NULL = défaut de la société. */
  locale?: string | null;
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
  store_id: string | null;
  token_version: number;
  created_at: Date;
  updated_at: Date;
}

export const userRepository = {
  async findByEmail(email: string): Promise<UserRow | null> {
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0] || null;
  },

  async findById(id: string): Promise<UserRow | null> {
    const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async create(data: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    role: string;
    storeId?: string | null;
  }, actorId?: string): Promise<UserRow> {
    const result = await auditedQuery(actorId,
      `INSERT INTO users (email, password_hash, first_name, last_name, role, store_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [data.email, data.passwordHash, data.firstName, data.lastName, data.role, data.storeId || null]
    );
    return result.rows[0];
  },

  /**
   * G0-06 : comptes proposés sur l'écran de connexion par PIN (tuiles). Route
   * publique : on n'expose que le prénom et l'initiale du nom, et seulement des
   * comptes actifs dotés d'un PIN. La connexion ne compare ensuite qu'UN hachage.
   */
  async findPinUsers(): Promise<{ id: string; first_name: string; last_initial: string }[]> {
    const result = await db.query(
      `SELECT id, first_name, upper(left(btrim(last_name), 1)) AS last_initial
         FROM users WHERE pin_code IS NOT NULL AND is_active = true
        ORDER BY first_name, last_name`
    );
    return result.rows;
  },

  /** Longueur du PIN apprise à une connexion réussie (PIN antérieurs à la mig 522). */
  async learnPinLength(id: string, length: number): Promise<void> {
    await db.query(`UPDATE users SET pin_length = $2 WHERE id = $1 AND pin_length IS DISTINCT FROM $2`, [id, length]);
  },

  /** G6-05 : langue de l'interface choisie par l'utilisateur (NULL = défaut de la société). */
  async setLocale(id: string, locale: string | null): Promise<boolean> {
    const result = await db.query(`UPDATE users SET locale = $2 WHERE id = $1`, [id, locale]);
    return (result.rowCount ?? 0) > 0;
  },

  async setMustChangePassword(id: string, value: boolean): Promise<void> {
    await db.query(`UPDATE users SET must_change_password = $2 WHERE id = $1 AND must_change_password IS DISTINCT FROM $2`, [id, value]);
  },

  async findAllActive(): Promise<Pick<UserRow, 'id' | 'first_name' | 'last_name' | 'role'>[]> {
    const result = await db.query(
      `SELECT id, first_name, last_name, role FROM users WHERE is_active = true ORDER BY first_name`
    );
    return result.rows;
  },

  async findAll(): Promise<UserRow[]> {
    // Le compte technique « Système » (mig 530) n'est pas un utilisateur à gérer.
    const result = await db.query('SELECT * FROM users WHERE NOT is_system ORDER BY created_at DESC');
    return result.rows;
  },

  async update(id: string, data: {
    email?: string; firstName?: string; lastName?: string;
    role?: string; isActive?: boolean; passwordHash?: string; pinCode?: string | null; storeId?: string | null;
    /** Longueur du PIN posé (mig 522) ; null quand le PIN est retiré. */
    pinLength?: number | null;
    mustChangePassword?: boolean;
  }, actorId?: string): Promise<UserRow> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (data.email !== undefined) { fields.push(`email = $${i++}`); values.push(data.email); }
    if (data.firstName !== undefined) { fields.push(`first_name = $${i++}`); values.push(data.firstName); }
    if (data.lastName !== undefined) { fields.push(`last_name = $${i++}`); values.push(data.lastName); }
    if (data.role !== undefined) { fields.push(`role = $${i++}`); values.push(data.role); }
    if (data.isActive !== undefined) { fields.push(`is_active = $${i++}`); values.push(data.isActive); }
    if (data.passwordHash !== undefined) { fields.push(`password_hash = $${i++}`); values.push(data.passwordHash); }
    if (data.pinCode !== undefined) { fields.push(`pin_code = $${i++}`); values.push(data.pinCode); }
    if (data.storeId !== undefined) { fields.push(`store_id = $${i++}`); values.push(data.storeId); }
    if (data.pinLength !== undefined) { fields.push(`pin_length = $${i++}`); values.push(data.pinLength); }
    if (data.mustChangePassword !== undefined) { fields.push(`must_change_password = $${i++}`); values.push(data.mustChangePassword); }
    fields.push('updated_at = NOW()');
    values.push(id);
    const result = await auditedQuery(actorId,
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values
    );
    return result.rows[0];
  },

  async delete(id: string, actorId?: string): Promise<void> {
    await auditedQuery(actorId, 'UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1', [id]);
  },

  // ─── Account lockout (OWASP A04-2) ────────────────────────
  // Increments failed counter. Si seuil atteint, verrouille pour `lockDurationMs`.
  async recordFailedLogin(id: string, threshold: number, lockDurationMs: number): Promise<{ count: number; lockedUntil: Date | null }> {
    const result = await db.query(
      `UPDATE users
       SET failed_login_count = failed_login_count + 1,
           last_failed_login_at = NOW(),
           locked_until = CASE
             WHEN failed_login_count + 1 >= $2 THEN NOW() + ($3 || ' milliseconds')::interval
             ELSE locked_until
           END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING failed_login_count, locked_until`,
      [id, threshold, lockDurationMs]
    );
    const row = result.rows[0];
    return { count: row?.failed_login_count ?? 0, lockedUntil: row?.locked_until ?? null };
  },

  async resetFailedLogins(id: string): Promise<void> {
    await db.query(
      `UPDATE users
       SET failed_login_count = 0, locked_until = NULL, last_failed_login_at = NULL, updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
  },

  /** Dernière connexion réussie par compte (mot de passe, PIN ou second facteur). */
  async lastLogins(): Promise<Map<string, Date>> {
    const r = await db.query(
      `SELECT user_id, MAX(created_at) AS at FROM auth_events
        WHERE success AND user_id IS NOT NULL AND event_type IN ('login_success', 'pin_login_success', 'mfa_success')
        GROUP BY user_id`);
    return new Map(r.rows.map((x: { user_id: string; at: Date }) => [x.user_id, x.at]));
  },

  /** Administrateurs actifs (rôle principal admin), hors compte technique et hors `exceptId`. */
  async countActiveAdmins(exceptId?: string): Promise<number> {
    const r = await db.query(
      `SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND is_active AND NOT is_system AND id IS DISTINCT FROM $1`,
      [exceptId ?? null]);
    return r.rows[0].n;
  },

  /**
   * Tables métier qui référencent ce compte : sa présence dans une seule d'entre elles
   * (document créé, validé, pointage…) interdit la suppression définitive — on désactive.
   * Ignorées : les tables en ON DELETE CASCADE (rôles, droits, identités, notifications…
   * propres au compte, supprimées avec lui) et auth_events (journal de connexion, gardé
   * avec l'e-mail). Identifiants issus du catalogue, cités par quote_ident.
   */
  async historyReferences(id: string, limit = 5): Promise<string[]> {
    const fks = (await db.query(
      `SELECT quote_ident(n.nspname) || '.' || quote_ident(t.relname) AS tbl, quote_ident(a.attname) AS col, t.relname AS name
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass AND array_length(c.conkey, 1) = 1
          AND c.confdeltype <> 'c' AND t.relname <> 'auth_events' AND NOT t.relispartition`)).rows as { tbl: string; col: string; name: string }[];
    if (!fks.length) return [];
    const parts = fks.map((f, i) => `SELECT $${i + 2}::text AS name WHERE EXISTS (SELECT 1 FROM ${f.tbl} WHERE ${f.col} = $1)`);
    const r = await db.query(`SELECT DISTINCT name FROM (${parts.join(' UNION ALL ')}) x LIMIT ${Number(limit)}`, [id, ...fks.map(f => f.name)]);
    return r.rows.map((x: { name: string }) => x.name);
  },

  /** Suppression définitive (le contrôleur a vérifié l'absence d'historique). */
  async hardDelete(id: string, actorId?: string): Promise<boolean> {
    const r = await auditedQuery(actorId, 'DELETE FROM users WHERE id = $1 AND NOT is_system', [id]);
    return (r.rowCount ?? 0) > 0;
  },

  async isLocked(id: string): Promise<Date | null> {
    const result = await db.query(
      'SELECT locked_until FROM users WHERE id = $1 AND locked_until > NOW()',
      [id]
    );
    return result.rows[0]?.locked_until ?? null;
  },

  // OWASP A07-5 : invalidation de tous les tokens existants d'un user.
  // Incrementer la version force les tokens JWT existants a etre rejetes
  // par le middleware (comparaison version token vs version DB).
  async bumpTokenVersion(id: string): Promise<number> {
    const result = await db.query(
      'UPDATE users SET token_version = token_version + 1, updated_at = NOW() WHERE id = $1 RETURNING token_version',
      [id]
    );
    return result.rows[0]?.token_version ?? 0;
  },

  async getTokenVersion(id: string): Promise<number | null> {
    const result = await db.query('SELECT token_version FROM users WHERE id = $1', [id]);
    return result.rows[0]?.token_version ?? null;
  },

  // ─── Lien compte ↔ fiche salarié (espace employé, employees.user_id) ──
  /** Fiches salariés actives, avec le compte éventuellement lié (pour le sélecteur). */
  async employeesForLink(): Promise<{ id: string; name: string; user_id: string | null }[]> {
    const r = await db.query(
      `SELECT id, concat_ws(' ', first_name, last_name) AS name, user_id
         FROM employees WHERE is_active IS DISTINCT FROM false ORDER BY first_name, last_name`);
    return r.rows;
  },

  /**
   * Relie (ou délie si employeeId = null) une fiche salarié à un compte. Un
   * compte = une fiche : on détache d'abord l'ancienne fiche de ce compte, puis
   * on rattache la nouvelle (en la détachant au besoin d'un autre compte).
   */
  async setLinkedEmployee(userId: string, employeeId: string | null, actorId?: string): Promise<void> {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setAuditUser(client, actorId);
      await client.query('UPDATE employees SET user_id = NULL WHERE user_id = $1', [userId]);
      if (employeeId) {
        await client.query('UPDATE employees SET user_id = $1 WHERE id = $2', [userId, employeeId]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },

  // ─── Rôles multiples (mig 335) ────────────────────────────
  async userRolesTableExists(): Promise<boolean> {
    const r = await db.query(`SELECT to_regclass('public.user_roles') IS NOT NULL AS ok`);
    return !!r.rows[0]?.ok;
  },

  /** Codes de rôle d'un utilisateur (principal d'abord). Repli sur users.role. */
  async getRoleCodes(id: string): Promise<string[]> {
    if (!(await this.userRolesTableExists())) {
      const u = await db.query('SELECT role FROM users WHERE id = $1', [id]);
      return u.rows[0]?.role ? [u.rows[0].role] : [];
    }
    const r = await db.query(
      'SELECT role_code FROM user_roles WHERE user_id = $1 ORDER BY is_primary DESC, role_code', [id]);
    return r.rows.map((x: { role_code: string }) => x.role_code);
  },

  /** Rôles de tous les utilisateurs (pour enrichir la liste des comptes). */
  async allUserRoles(): Promise<{ user_id: string; role_code: string; is_primary: boolean }[]> {
    if (!(await this.userRolesTableExists())) return [];
    const r = await db.query('SELECT user_id, role_code, is_primary FROM user_roles');
    return r.rows;
  },

  /**
   * Remplace les rôles d'un utilisateur. `primary` devient users.role (rôle
   * principal du jeton) et le rôle marqué is_primary. Synchronisation
   * différentielle pour ne pas gonfler le journal d'audit (mig 328).
   */
  async setRoleCodes(id: string, codes: string[], primary: string, actorId?: string): Promise<void> {
    const hasTable = await this.userRolesTableExists();
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setAuditUser(client, actorId);
      await client.query('UPDATE users SET role = $2, updated_at = NOW() WHERE id = $1', [id, primary]);
      if (hasTable) {
        await client.query(
          'DELETE FROM user_roles WHERE user_id = $1 AND NOT (role_code = ANY($2::varchar[]))',
          [id, codes]);
        // Rétrograder l'ancien principal AVANT de promouvoir le nouveau : l'index
        // unique partiel (un seul is_primary par utilisateur) interdit un doublon transitoire.
        await client.query(
          'UPDATE user_roles SET is_primary = false WHERE user_id = $1 AND is_primary AND role_code <> $2',
          [id, primary]);
        for (const code of codes) {
          await client.query(
            `INSERT INTO user_roles (user_id, role_code, is_primary, assigned_by)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, role_code) DO UPDATE SET is_primary = EXCLUDED.is_primary
             WHERE user_roles.is_primary IS DISTINCT FROM EXCLUDED.is_primary`,
            [id, code, code === primary, actorId ?? null]);
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },

  // ─── Établissements d'un compte (refonte Utilisateurs, lot 7, mig 707) ───
  /** Établissements accessibles au compte (actifs ou non), le défaut en tête. */
  async storesOf(id: string): Promise<{ id: string; name: string; code: string | null; is_active: boolean; is_default: boolean }[]> {
    const r = await db.query(
      `SELECT s.id, s.name, s.code, COALESCE(s.is_active, true) AS is_active, us.is_default
         FROM user_stores us JOIN stores s ON s.id = us.store_id
        WHERE us.user_id = $1
        ORDER BY us.is_default DESC, s.name`, [id]);
    return r.rows;
  },

  /** Identifiants des établissements de chaque compte (liste des comptes). */
  async storeIdsByUser(): Promise<Map<string, string[]>> {
    const r = await db.query(
      `SELECT user_id, array_agg(store_id::text ORDER BY is_default DESC, created_at) AS ids FROM user_stores GROUP BY user_id`);
    return new Map(r.rows.map(x => [x.user_id as string, x.ids as string[]]));
  },

  /** Parmi ces identifiants, ceux d'établissements existants et actifs. */
  async activeStoreIdsAmong(ids: string[]): Promise<string[]> {
    const valid = ids.filter(id => /^[0-9a-f-]{36}$/i.test(id));
    if (!valid.length) return [];
    const r = await db.query(`SELECT id::text FROM stores WHERE id = ANY($1::uuid[]) AND COALESCE(is_active, true)`, [valid]);
    return r.rows.map(x => x.id as string);
  },

  /** Vrai si le compte peut travailler dans cet établissement (rattaché et établissement actif). */
  async canUseStore(id: string, storeId: string): Promise<boolean> {
    const r = await db.query(
      `SELECT 1 FROM user_stores us JOIN stores s ON s.id = us.store_id
        WHERE us.user_id = $1 AND us.store_id = $2 AND COALESCE(s.is_active, true)`, [id, storeId]);
    return r.rows.length > 0;
  },

  /**
   * Remplace les établissements du compte ; `defaultId` (parmi eux) devient users.store_id, le
   * déclencheur de la mig 707 pose le drapeau par défaut. Liste vide = aucun établissement.
   */
  async setStores(id: string, storeIds: string[], defaultId: string | null, actorId?: string): Promise<void> {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setAuditUser(client, actorId);
      await client.query('UPDATE users SET store_id = $2, updated_at = NOW() WHERE id = $1 AND store_id IS DISTINCT FROM $2', [id, defaultId]);
      await client.query('DELETE FROM user_stores WHERE user_id = $1 AND NOT (store_id = ANY($2::uuid[]))', [id, storeIds]);
      await client.query(
        `INSERT INTO user_stores (user_id, store_id, is_default)
         SELECT $1, unnest($2::uuid[]), false ON CONFLICT (user_id, store_id) DO NOTHING`, [id, storeIds]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },
};
