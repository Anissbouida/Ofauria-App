import { db } from '../config/database.js';
import { auditedQuery } from '../utils/audit-context.js';
import { PARAMETERS, type ParamDef } from './parameters-catalog.js';

/**
 * Lecture / écriture des paramètres du catalogue (lot 4), quel que soit leur
 * stockage, avec l'auteur et l'historique tirés du journal (mig 328).
 */

async function moduleParametersAvailable(): Promise<boolean> {
  return (await db.query(`SELECT to_regclass('public.module_parameters') IS NOT NULL AS ok`)).rows[0].ok as boolean;
}

/** Valeurs actuelles de tous les paramètres (null = stockage absent de cette base). */
export async function readAll(): Promise<Map<string, Record<string, unknown> | null>> {
  const out = new Map<string, Record<string, unknown> | null>();
  const company = (await db.query(`SELECT * FROM company_settings WHERE id = 1`)).rows[0] ?? {};
  const hasMp = await moduleParametersAvailable();
  const mp = new Map<string, Record<string, unknown>>();
  if (hasMp) {
    const keys = PARAMETERS.filter(p => p.storage.kind === 'module_parameters').map(p => p.key);
    for (const r of (await db.query(`SELECT key, value FROM module_parameters WHERE key = ANY($1)`, [keys])).rows) mp.set(r.key, r.value);
  }
  for (const p of PARAMETERS) {
    if (p.storage.kind === 'company_settings') {
      const v: Record<string, unknown> = { ...p.defaults };
      for (const [field, col] of Object.entries(p.storage.columns)) {
        if (col in company && company[col] !== null) {
          const f = p.fields.find(x => x.name === field);
          v[field] = f && f.type !== 'boolean' && f.type !== 'enum' ? Number(company[col]) : company[col];
        }
      }
      out.set(p.key, v);
    } else {
      out.set(p.key, mp.has(p.key) ? { ...p.defaults, ...mp.get(p.key) } : null);
    }
  }
  return out;
}

/** Cinq dernières modifications d'un paramètre, d'après le journal du paramétrage. */
export async function history(def: ParamDef) {
  const exists = (await db.query(`SELECT to_regclass('public.config_audit_log') IS NOT NULL AS ok`)).rows[0].ok;
  if (!exists) return [];
  const r = def.storage.kind === 'module_parameters'
    ? await db.query(
      `SELECT l.changed_at, concat_ws(' ', u.first_name, u.last_name) AS by_name, l.diff
         FROM config_audit_log l LEFT JOIN users u ON u.id = l.changed_by
        WHERE l.table_name = 'module_parameters' AND l.record_id = $1 AND l.operation = 'UPDATE'
        ORDER BY l.changed_at DESC LIMIT 5`, [def.key])
    : await db.query(
      `SELECT l.changed_at, concat_ws(' ', u.first_name, u.last_name) AS by_name, l.diff
         FROM config_audit_log l LEFT JOIN users u ON u.id = l.changed_by
        WHERE l.table_name = 'company_settings' AND l.diff ?| $1::text[]
        ORDER BY l.changed_at DESC LIMIT 5`, [Object.values(def.storage.columns)]);
  return r.rows;
}

/** Enregistre la valeur (déjà contrôlée) avec son auteur. */
export async function write(def: ParamDef, value: Record<string, unknown>, actorId?: string): Promise<boolean> {
  if (def.storage.kind === 'module_parameters') {
    if (!(await moduleParametersAvailable())) return false;
    const r = await auditedQuery(actorId,
      `UPDATE module_parameters SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`,
      [def.key, JSON.stringify(value), actorId ?? null]);
    return (r.rowCount ?? 0) > 0;
  }
  const cols = Object.entries(def.storage.columns);
  const sets = cols.map(([, col], i) => `${col} = $${i + 1}`);
  await auditedQuery(actorId,
    `UPDATE company_settings SET ${sets.join(', ')}, updated_at = now() WHERE id = 1`,
    cols.map(([field]) => value[field]));
  return true;
}
