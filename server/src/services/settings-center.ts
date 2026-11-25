import { db, withTransaction } from '../config/database.js';
import { auditedQuery } from '../utils/audit-context.js';
import { PARAMETERS, type ParamDef } from './parameters-catalog.js';
import { policySnapshot, setPolicy } from './policies.js';
import { WIZARD_MODULE_PARAMETER_KEYS } from './wizard/parameter-definitions.js';
import { asRhythm, RHYTHM_PRESETS } from './operating-rules.js';
import { isDeepStrictEqual } from 'node:util';

/**
 * Lecture / écriture des paramètres du catalogue (lot 4), quel que soit leur
 * stockage, avec l'auteur et l'historique tirés du journal (mig 328).
 */

async function moduleParametersAvailable(): Promise<boolean> {
  return (await db.query(`SELECT to_regclass('public.module_parameters') IS NOT NULL AS ok`)).rows[0].ok as boolean;
}

/** Valeurs actuelles de tous les paramètres (null = stockage absent de cette base). */
export async function readAll(origins?: Map<string, 'company' | 'default' | 'unavailable'>): Promise<Map<string, Record<string, unknown> | null>> {
  const out = new Map<string, Record<string, unknown> | null>();
  const company = (await db.query(`SELECT * FROM company_settings WHERE id = 1`)).rows[0] ?? {};
  const hasMp = await moduleParametersAvailable();
  const mp = new Map<string, Record<string, unknown>>();
  if (hasMp) {
    const keys = PARAMETERS.filter(p => p.storage.kind === 'module_parameters').map(p => p.key);
    for (const r of (await db.query(`SELECT key, value FROM module_parameters WHERE key = ANY($1)`, [keys])).rows) mp.set(r.key, r.value);
  }
  // Politiques (mig 538) : l'écran Paramètres règle le niveau société ; sans ligne, le défaut.
  const company_policies = new Map((await policySnapshot()).filter(r => r.scope_type === 'company').map(r => [r.key, r.value]));
  const hasPolicies = (await db.query(`SELECT to_regclass('public.policy_values') IS NOT NULL AS ok`)).rows[0].ok as boolean;
  for (const p of PARAMETERS) {
    if (p.storage.kind === 'policy') {
      out.set(p.key, hasPolicies ? { ...p.defaults, ...(company_policies.get(p.key) ?? {}) } : null);
      origins?.set(p.key, !hasPolicies ? 'unavailable' : company_policies.has(p.key) ? 'company' : 'default');
    } else if (p.storage.kind === 'company_settings') {
      const v: Record<string, unknown> = { ...p.defaults };
      for (const [field, col] of Object.entries(p.storage.columns)) {
        if (col in company && company[col] !== null) {
          const f = p.fields.find(x => x.name === field);
          v[field] = f && f.type !== 'boolean' && f.type !== 'enum' ? Number(company[col]) : company[col];
        }
      }
      out.set(p.key, v);
      origins?.set(p.key, Object.values(p.storage.columns).some(c => company[c] !== null && company[c] !== undefined) ? 'company' : 'default');
    } else {
      out.set(p.key, mp.has(p.key) ? { ...p.defaults, ...mp.get(p.key) } : null);
      origins?.set(p.key, mp.has(p.key) ? 'company' : 'unavailable');
    }
  }
  return out;
}

/** Cinq dernières modifications d'un paramètre, d'après le journal du paramétrage. */
/** Sérialise les écritures de configuration société (même verrou que l'assistant et les politiques). */
export async function lockCompanyConfiguration() {
  await db.query(`SELECT id FROM company_settings WHERE id=1 FOR UPDATE`);
}

export async function history(def: ParamDef) {
  const exists = (await db.query(`SELECT to_regclass('public.config_audit_log') IS NOT NULL AS ok`)).rows[0].ok;
  if (!exists) return [];
  if (def.storage.kind === 'policy') {
    return (await db.query(
      `SELECT l.changed_at, concat_ws(' ', u.first_name, u.last_name) AS by_name, l.diff
         FROM config_audit_log l LEFT JOIN users u ON u.id = l.changed_by
        WHERE l.table_name = 'policy_values' AND l.record_id = $1 AND l.subject_id = 'company' AND l.operation = 'UPDATE'
        ORDER BY l.changed_at DESC LIMIT 5`, [def.key])).rows;
  }
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
  if (def.storage.kind === 'policy') {
    return !('error' in await setPolicy(def.key, 'company', '', value, actorId));
  }
  if (def.storage.kind === 'module_parameters') {
    if (!(await moduleParametersAvailable())) return false;
    const before = (await db.query(`SELECT value FROM module_parameters WHERE key = $1`, [def.key])).rows[0]?.value;
    const ok = await writeModuleParameter(def, value, actorId);
    if (ok) await applyDependentSettings(def.key, before, value, actorId);
    return ok;
  }
  const cols = Object.entries(def.storage.columns);
  const sets = cols.map(([, col], i) => `${col} = $${i + 1}`);
  await auditedQuery(actorId,
    `UPDATE company_settings SET ${sets.join(', ')}, updated_at = now() WHERE id = 1`,
    cols.map(([field]) => value[field]));
  return true;
}

/** Réglages qui en pilotent d'autres (mig 694) : le rythme de production fixe l'horizon du
 *  plan directeur et le contrôle de capacité des équipements quand il change. */
async function applyDependentSettings(key: string, before: Record<string, unknown> | undefined, value: Record<string, unknown>, actorId?: string) {
  if (key !== 'production.rhythm') return;
  const mode = asRhythm(value.mode);
  if (!mode || before?.mode === mode) return;
  const preset = RHYTHM_PRESETS[mode];
  if ('error' in await setPolicy('production.mrp_horizon', 'company', '', { days: preset.mrp_horizon_days }, actorId)) throw new Error('Horizon du plan directeur non réglé');
  if ('error' in await setPolicy('production.equipment_capacity', 'company', '', { mode: preset.equipment_capacity }, actorId)) throw new Error('Contrôle de capacité non réglé');
}

async function writeModuleParameter(def: ParamDef, value: Record<string, unknown>, actorId?: string): Promise<boolean> {
  {
    if(WIZARD_MODULE_PARAMETER_KEYS.includes(def.key)){
      return withTransaction(async()=>{
        await db.query(`SELECT id FROM company_settings WHERE id=1 FOR UPDATE`);
        const current=(await db.query(`SELECT value FROM module_parameters WHERE key=$1 FOR UPDATE`,[def.key])).rows[0];
        if(!current)return false;
        if(isDeepStrictEqual(current.value,value))return true;
        const {sectorRepository}=await import('../repositories/sector.repository.js');
        await sectorRepository.recordVersion(`Avant modification : ${def.label}`,actorId);
        const r=await auditedQuery(actorId,`UPDATE module_parameters SET value=$2,updated_by=$3,updated_at=now() WHERE key=$1`,[def.key,JSON.stringify(value),actorId??null]);
        if((r.rowCount??0)!==1)throw new Error(`Écriture du paramètre impossible : ${def.key}`);
        await sectorRepository.recordVersion(`Paramètre modifié : ${def.label}`,actorId);
        return true;
      });
    }
    const r = await auditedQuery(actorId,
      `UPDATE module_parameters SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`,
      [def.key, JSON.stringify(value), actorId ?? null]);
    return (r.rowCount ?? 0) > 0;
  }
}
