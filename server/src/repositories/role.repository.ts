import { db } from '../config/database.js';
import { auditedQuery, setAuditUser } from '../utils/audit-context.js';
import { invalidatePermissionCaches, replaceRolePermissionsFrom } from '../services/permissions.js';

export interface RolePermissionInput {
  module: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  config?: Record<string, unknown>;
}

/** Rôles éditables et leurs droits par module (mig 330). */
export const roleRepository = {
  /** La table de liaison rôles multiples existe-t-elle (mig 335 appliquée) ? */
  async userRolesExists(): Promise<boolean> {
    const r = await db.query(`SELECT to_regclass('public.user_roles') IS NOT NULL AS ok`);
    return !!r.rows[0]?.ok;
  },

  async list() {
    // Nombre de titulaires : via user_roles (rôles multiples, mig 335) si la
    // table existe, sinon via users.role (compatibilité avant migration).
    const userCount = (await this.userRolesExists())
      ? `(SELECT count(DISTINCT ur.user_id)::int FROM user_roles ur JOIN users u ON u.id = ur.user_id
            WHERE ur.role_code = r.code AND u.is_active)`
      : `(SELECT count(*)::int FROM users u WHERE u.role = r.code AND u.is_active)`;
    // Comptes désactivés qui détiennent encore le rôle (rôle principal ou rôle secondaire).
    const inactiveCount = (await this.userRolesExists())
      ? `(SELECT count(DISTINCT u.id)::int FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.role_code = r.code
            WHERE NOT u.is_active AND (u.role = r.code OR ur.role_code IS NOT NULL))`
      : `(SELECT count(*)::int FROM users u WHERE u.role = r.code AND NOT u.is_active)`;
    // Lot 4 de la refonte Utilisateurs : origine (système, modèle du secteur, personnalisé),
    // page d'accueil (mig 703) et nombre de permissions détaillées.
    const has = async (sql: string) => !!(await db.query(sql)).rows[0]?.ok;
    const hasTemplates = await has(`SELECT to_regclass('public.sector_role_templates') IS NOT NULL AS ok`);
    const hasHome = await has(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'roles' AND column_name = 'home_route') AS ok`);
    const hasKeys = await has(`SELECT to_regclass('public.role_action_permissions') IS NOT NULL AS ok`);
    const origin = hasTemplates
      ? `CASE WHEN r.is_system THEN 'system' WHEN EXISTS (SELECT 1 FROM sector_role_templates t WHERE t.code = r.code) THEN 'template' ELSE 'custom' END`
      : `CASE WHEN r.is_system THEN 'system' ELSE 'custom' END`;
    const r = await db.query(
      `SELECT r.code, r.label, r.description, r.base_role, r.is_system, r.is_active, r.updated_at, r.created_at,
              ${origin} AS origin, ${hasHome ? 'r.home_route' : 'NULL::text AS home_route'},
              ${hasKeys ? '(SELECT count(*)::int FROM role_action_permissions k WHERE k.role_code = r.code)' : '0'} AS action_key_count,
              ${userCount} AS user_count, ${inactiveCount} AS inactive_user_count,
              (SELECT count(*)::int FROM role_permissions p WHERE p.role_code = r.code AND p.can_view) AS module_count,
              -- Mig 699 : rôle propre à un autre secteur (Viennoiserie, Beldi…) : masqué des choix,
              -- sauf s'il a déjà des titulaires.
              (cardinality(r.sectors) = 0 OR r.sectors && fn_active_sector_lineage() OR ${userCount} > 0) AS available
         FROM roles r
        ORDER BY r.is_system DESC, r.label`,
    );
    return r.rows;
  },

  async find(code: string) {
    const r = await db.query(`SELECT * FROM roles WHERE code = $1`, [code]);
    return r.rows[0] ?? null;
  },

  async isAssignable(code: string): Promise<boolean> {
    const exists = (await db.query(`SELECT to_regclass('public.roles') IS NOT NULL AS ok`)).rows[0].ok;
    if (!exists) return true; // migration 330 non appliquée : contrainte d'origine
    const r = await db.query(`SELECT 1 FROM roles WHERE code = $1 AND is_active`, [code]);
    return r.rows.length > 0;
  },

  async permissions(code: string) {
    const r = await db.query(
      `SELECT module, can_view, can_create, can_edit, can_delete, config FROM role_permissions WHERE role_code = $1 ORDER BY module`,
      [code],
    );
    return r.rows;
  },

  /**
   * Rôle créé : droits copiés depuis un rôle existant (par défaut son rôle de base), ou aucun
   * droit (copyFrom: null — « Rôle vide », refonte Utilisateurs lot 4).
   */
  async create(data: { code: string; label: string; description?: string | null; baseRole: string; copyFrom?: string | null }, actorId?: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setAuditUser(client, actorId);
      const r = await client.query(
        `INSERT INTO roles (code, label, description, base_role, is_system, updated_by)
         VALUES ($1, $2, $3, $4, false, $5) RETURNING *`,
        [data.code, data.label, data.description ?? null, data.baseRole, actorId ?? null],
      );
      const source = data.copyFrom === null ? null : (data.copyFrom ?? data.baseRole);
      if (source) await client.query(
        `INSERT INTO role_permissions (role_code, module, can_view, can_create, can_edit, can_delete, config)
         SELECT $1, module, can_view, can_create, can_edit, can_delete, config FROM role_permissions WHERE role_code = $2`,
        [data.code, source],
      );
      // Permissions par action (M2-04, mig 547) : mêmes droits que le rôle copié — sans
      // elles, le nouveau rôle perdrait les routes que son rôle de base ouvre.
      if (source && (await client.query(`SELECT to_regclass('public.role_action_permissions') AS t`)).rows[0]?.t) {
        await client.query(
          `INSERT INTO role_action_permissions (role_code, permission_key, granted_by)
           SELECT $1, permission_key, $3 FROM role_action_permissions WHERE role_code = $2 ON CONFLICT DO NOTHING`,
          [data.code, source, actorId ?? null]);
      }
      await client.query('COMMIT');
      invalidatePermissionCaches();
      return r.rows[0];
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },

  async update(code: string, data: { label?: string; description?: string | null; baseRole?: string; isActive?: boolean; homeRoute?: string | null }, actorId?: string) {
    const fields: string[] = [];
    const values: unknown[] = [code];
    const set = (col: string, v: unknown) => { values.push(v); fields.push(`${col} = $${values.length}`); };
    if (data.label !== undefined) set('label', data.label);
    if (data.description !== undefined) set('description', data.description);
    if (data.baseRole !== undefined) set('base_role', data.baseRole);
    if (data.isActive !== undefined) set('is_active', data.isActive);
    if (data.homeRoute !== undefined) set('home_route', data.homeRoute);
    if (!fields.length) return this.find(code);
    set('updated_by', actorId ?? null);
    const r = await auditedQuery(actorId,
      `UPDATE roles SET ${fields.join(', ')}, updated_at = now() WHERE code = $1 RETURNING *`, values);
    // Changement de rôle de base : les permissions par action suivent le nouveau rôle de
    // base (même effet qu'avec les gardes authorize, qui lisaient le rôle de base).
    if (data.baseRole !== undefined && r.rows[0] && !r.rows[0].is_system
        && (await db.query(`SELECT to_regclass('public.role_action_permissions') AS t`)).rows[0]?.t) {
      await replaceRolePermissionsFrom(code, data.baseRole, actorId ?? null);
    }
    return r.rows[0] ?? null;
  },

  /** Invalide les jetons des utilisateurs du rôle (changement de rôle de base). */
  async revokeSessions(code: string) {
    // Titulaires via user_roles (rôles multiples, mig 335) et via users.role.
    if (await this.userRolesExists()) {
      await db.query(
        `UPDATE users SET token_version = token_version + 1
          WHERE role = $1 OR id IN (SELECT user_id FROM user_roles WHERE role_code = $1)`, [code]);
    } else {
      await db.query(`UPDATE users SET token_version = token_version + 1 WHERE role = $1`, [code]);
    }
  },

  async remove(code: string, actorId?: string) {
    await auditedQuery(actorId, `DELETE FROM roles WHERE code = $1 AND NOT is_system`, [code]);
  },

  /** Enregistrement différentiel : le journal ne trace que les modules modifiés. */
  async setPermissions(code: string, perms: RolePermissionInput[], actorId?: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setAuditUser(client, actorId);
      await client.query(
        `DELETE FROM role_permissions WHERE role_code = $1 AND NOT (module = ANY($2::varchar[]))`,
        [code, perms.map(p => p.module)],
      );
      for (const p of perms) {
        await client.query(
          `INSERT INTO role_permissions (role_code, module, can_view, can_create, can_edit, can_delete, config)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (role_code, module) DO UPDATE SET
             can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create,
             can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete, config = EXCLUDED.config
           WHERE (role_permissions.can_view, role_permissions.can_create, role_permissions.can_edit,
                  role_permissions.can_delete, role_permissions.config)
                 IS DISTINCT FROM
                 (EXCLUDED.can_view, EXCLUDED.can_create, EXCLUDED.can_edit, EXCLUDED.can_delete, EXCLUDED.config)`,
          [code, p.module, p.canView, p.canCreate, p.canEdit, p.canDelete, JSON.stringify(p.config ?? {})],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },

  async securityMode() {
    const r = await db.query(`SELECT security_module_enforcement AS mode FROM company_settings WHERE id = 1`);
    return r.rows[0]?.mode as string;
  },

  async setSecurityMode(mode: string, actorId?: string) {
    await auditedQuery(actorId, `UPDATE company_settings SET security_module_enforcement = $1, updated_at = now() WHERE id = 1`, [mode]);
  },

  /** Appels hors droits observés (mode « log ») depuis N jours, regroupés par route. */
  async denials(days: number) {
    const r = await db.query(
      `SELECT e.details->>'route' AS route, e.details->>'role' AS role_code,
              count(*)::int AS hits, count(DISTINCT e.user_id)::int AS users, max(e.created_at) AS last_at,
              string_agg(DISTINCT concat_ws(' ', u.first_name, u.last_name), ', ') AS user_names,
              (array_agg(e.details->'modules'))[1] AS modules
         FROM auth_events e
         LEFT JOIN users u ON u.id = e.user_id
        WHERE e.event_type = 'access_denied' AND e.created_at >= now() - make_interval(days => $1)
        GROUP BY 1, 2
        ORDER BY max(e.created_at) DESC
        LIMIT 200`,
      [days],
    );
    return r.rows;
  },
};
