import { INTERFACE_DEFAULTS, INTERFACE_KEYS, parseWorkspace, parseTableDensity, type InterfacePreferences } from '@ofauria/shared';
import { db, withTransaction } from '../config/database.js';
import { resolveConfig, type ConfigValue } from './config-resolver.js';

type Field=keyof InterfacePreferences;
type PreferenceRow=ConfigValue<string>&{key:string};
type Runner={query:(q:string,p?:unknown[])=>Promise<{rows:any[]}>};
export const preferenceKeys=Object.values(INTERFACE_KEYS);
const fields=['workspace','density'] as const;
export const normalizePreference=(field:Field,value:unknown)=>field==='workspace'?parseWorkspace(value):parseTableDensity(value);
export type PreferencePatch=Partial<Record<Field,string|null>>;

export function resolveInterfacePreferences(rows:PreferenceRow[],userId?:string){
  const values={...INTERFACE_DEFAULTS};
  const personal:PreferencePatch={};
  const sources:Record<Field,string>={workspace:'default',density:'default'};
  for(const field of fields){
    const valid=rows.filter(r=>r.key===INTERFACE_KEYS[field]&&normalizePreference(field,r.value)).map(r=>({...r,value:normalizePreference(field,r.value)!}));
    const resolved=resolveConfig<string>(INTERFACE_DEFAULTS[field],valid,{user:userId},{levels:['company','user'],preference:true});
    if(field==='workspace')values.workspace=parseWorkspace(resolved.value)!;else values.density=parseTableDensity(resolved.value)!;
    sources[field]=resolved.source;
    const own=userId?valid.find(r=>r.scope_type==='user'&&r.scope_id===userId):undefined;
    if(own)personal[field]=own.value;
  }
  return {values,personal,sources};
}

export async function readInterfacePreferences(userId?:string){
  const available=(await db.query(`SELECT to_regclass('public.config_values') IS NOT NULL AS ok`)).rows[0]?.ok===true;
  const rows=available?(await db.query(`SELECT key,scope_type,scope_id,value FROM config_values WHERE key=ANY($1::text[]) AND (scope_type='company' OR (scope_type='user' AND scope_id=$2))`,[preferenceKeys,userId??''])).rows as PreferenceRow[]:[];
  return {available,...resolveInterfacePreferences(rows,userId)};
}

/** Préférences propres à un compte ; actorId = qui les écrit (l'administrateur depuis la fiche du compte). */
export async function setPersonalInterfacePreferences(userId:string,patch:PreferencePatch,actorId:string=userId){
  return withTransaction(async()=>{
    if(!(await db.query(`SELECT to_regclass('public.config_values') IS NOT NULL AS ok`)).rows[0]?.ok)throw Object.assign(new Error('Préférences indisponibles sur cette installation.'),{statusCode:409});
    await db.query(`SELECT set_config('app.user_id',$1,true)`,[actorId]);
    for(const field of fields){
      const value=patch[field];if(value===undefined)continue;
      if(value===null){await db.query(`DELETE FROM config_values WHERE key=$1 AND scope_type='user' AND scope_id=$2`,[INTERFACE_KEYS[field],userId]);continue;}
      const normalized=normalizePreference(field,value);
      if(!normalized)throw Object.assign(new Error('Préférence invalide.'),{statusCode:400});
      await db.query(`INSERT INTO config_values(key,scope_type,scope_id,value,updated_by) VALUES($1,'user',$2::text,$3::jsonb,$4::text::uuid) ON CONFLICT(key,scope_type,scope_id) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`,[INTERFACE_KEYS[field],userId,JSON.stringify(normalized),actorId]);
    }
    return readInterfacePreferences(userId);
  });
}

export async function companyInterfaceRows(runner:Runner=db){
  return (await runner.query(`SELECT key,value FROM config_values WHERE key=ANY($1::text[]) AND scope_type='company' AND scope_id='' ORDER BY key`,[preferenceKeys])).rows as {key:string;value:string}[];
}

/** Restaure exclusivement les deux clés société ; les préférences personnelles restent intactes. */
export async function restoreCompanyInterface(runner:Runner,rows:unknown[],actor?:string|null){
  const desired=new Map<string,string>();
  for(const row of rows as {key:string;value:unknown}[]){
    const field=fields.find(f=>INTERFACE_KEYS[f]===row.key);
    if(!field)continue;
    const value=normalizePreference(field,row.value);if(!value)throw new Error('Préférence historique invalide');
    desired.set(row.key,value);
  }
  await runner.query(`DELETE FROM config_values WHERE scope_type='company' AND scope_id='' AND key=ANY($1::text[]) AND NOT(key=ANY($2::text[]))`,[preferenceKeys,[...desired.keys()]]);
  for(const [key,value] of desired)await runner.query(`INSERT INTO config_values(key,scope_type,scope_id,value,updated_by) VALUES($1,'company','',$2::jsonb,$3) ON CONFLICT(key,scope_type,scope_id) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now() WHERE config_values.value IS DISTINCT FROM EXCLUDED.value`,[key,JSON.stringify(value),actor??null]);
}
