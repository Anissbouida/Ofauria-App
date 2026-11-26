import { setCompanyTimezone } from '../utils/timezone.js';
import { db } from '../config/database.js';
import { WIZARD_MODULE_PARAMETER_KEYS } from '../services/wizard/parameter-definitions.js';
import { companyInterfaceRows, restoreCompanyInterface } from '../services/interface-preferences.js';

/**
 * Couches de configuration capturées dans chaque version (plan d'exécution multi-industries,
 * étape 4). Avant : une version ne portait que secteur, modules, options, diffusion et
 * politiques. Désormais elle photographie aussi les dix couches de « Secteur et modules ».
 *
 * La restauration remet en place le vocabulaire de la société et les spécialisations ; les
 * autres couches sont conservées pour la COMPARAISON entre versions (un type d'ordre ou un
 * atelier se rétablit dans son propre écran, qui contrôle les ordres en cours).
 */
type Runner = { query: (q: string, p?: unknown[]) => Promise<{ rows: any[] }> };

export type ConfigLayers = Record<string, unknown[]>;

const QUERIES: Record<string, string> = {
  company_context: `SELECT id,legal_name,legal_form,default_locale,timezone,company_size FROM company_settings WHERE id=1`,
  module_parameters: `SELECT key,value FROM module_parameters ORDER BY key`,
  labels: `SELECT label_key AS key, label_value AS value FROM company_label_overrides ORDER BY label_key`,
  specializations: `SELECT code FROM company_specializations ORDER BY code`,
  order_types: `SELECT code, label, requires_bon_sortie, requires_weighing, requires_quality_check, consumption_mode,
                       COALESCE(is_subcontracting, false) AS is_subcontracting, is_default, is_active
                  FROM production_order_types ORDER BY code`,
  workshops: `SELECT code, label, is_active, is_default, short_code, color FROM production_workshops ORDER BY code`,
  print_templates: `SELECT doc_type, title, layout, footer_note FROM document_templates WHERE category = 'production' ORDER BY doc_type`,
  work_centers: `SELECT name, hourly_cost::float8 AS hourly_cost, capacity_minutes_per_day::float8 AS capacity, is_active FROM work_centers ORDER BY name`,
  locations: `SELECT DISTINCT code, name, type FROM stock_locations WHERE parent_id IS NULL AND is_active ORDER BY code`,
  units: `SELECT code, label FROM ref_entries WHERE table_id = 'units' AND is_active ORDER BY code`,
  production_documents: `SELECT doc_key AS code, enabled, mandatory, generation, stage_code FROM production_documents ORDER BY doc_key`,
  process_models: `SELECT order_type_code AS code, version_no, label FROM process_models WHERE status = 'publie' ORDER BY order_type_code`,
  control_plans: `SELECT stage, count(*)::int AS lines, count(*) FILTER (WHERE is_blocking)::int AS blocking
                    FROM quality_control_plan_lines GROUP BY stage ORDER BY stage`,
};

export const configLayersRepository = {
  /** Photographie des couches (une couche dont la table manque est ignorée). */
  async capture(runner: Runner = db): Promise<ConfigLayers> {
    const out: ConfigLayers = {};
    // Dans une transaction (client), un point de sauvegarde isole une couche en erreur ;
    // hors transaction (pool), chaque requête est indépendante.
    const inTx = runner !== (db as unknown as Runner);
    for (const [key, sql] of Object.entries(QUERIES)) {
      try {
        if (inTx) await runner.query('SAVEPOINT cfg_layer');
        const rows=(await runner.query(sql)).rows;
        out[key] = key==='module_parameters'?rows.filter(r=>WIZARD_MODULE_PARAMETER_KEYS.includes(r.key)):rows;
        if (inTx) await runner.query('RELEASE SAVEPOINT cfg_layer');
      } catch {
        if (inTx) await runner.query('ROLLBACK TO SAVEPOINT cfg_layer').catch(() => undefined);
      }
    }
    if((await runner.query(`SELECT to_regclass('public.config_values') IS NOT NULL AS ok`)).rows[0]?.ok)out.interface_preferences=await companyInterfaceRows(runner);
    return out;
  },

  /** Remet en place le vocabulaire et les spécialisations d'une version. */
  async restore(runner: Runner, layers: ConfigLayers, userId?: string | null): Promise<void> {
    if(Array.isArray(layers.interface_preferences))await restoreCompanyInterface(runner,layers.interface_preferences,userId);
    if(Array.isArray(layers.module_parameters)){
      for(const row of layers.module_parameters as {key:string;value:unknown}[]){
        if(!WIZARD_MODULE_PARAMETER_KEYS.includes(row.key))continue;
        await runner.query(`UPDATE module_parameters SET value=$2::jsonb,updated_by=$3,updated_at=now() WHERE key=$1 AND value IS DISTINCT FROM $2::jsonb`,[row.key,JSON.stringify(row.value),userId??null]);
      }
    }
    if (Array.isArray(layers.company_context) && layers.company_context.length===1) {
      const c=layers.company_context[0] as {legal_name:string|null;legal_form:string|null;default_locale:string;timezone:string;company_size:string|null};
      // Audit des profils (L1) : une installation neuve n'a pas de nom affiché ; la raison sociale saisie dans l'assistant le devient.
      await runner.query(`UPDATE company_settings SET legal_name=$1,legal_form=$2,default_locale=$3,timezone=$4,company_size=$5,company_name=CASE WHEN COALESCE(btrim(company_name),'')='' AND $6::text IS NOT NULL THEN $6::text ELSE company_name END,updated_at=now() WHERE id=1`,[c.legal_name,c.legal_form,c.default_locale,c.timezone,c.company_size,c.legal_name]);
      setCompanyTimezone(c.timezone);
    }
    if (Array.isArray(layers.labels)) {
      const wanted = new Map((layers.labels as { key: string; value: string }[]).map(l => [l.key, l.value]));
      const current = (await runner.query(`SELECT label_key FROM company_label_overrides`)).rows.map(r => r.label_key as string);
      for (const k of current) if (!wanted.has(k)) await runner.query(`DELETE FROM company_label_overrides WHERE label_key = $1`, [k]);
      for (const [k, v] of wanted) {
        await runner.query(
          `INSERT INTO company_label_overrides (label_key, label_value, updated_by) VALUES ($1, $2, $3)
           ON CONFLICT (label_key) DO UPDATE SET label_value = EXCLUDED.label_value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [k, v, userId ?? null]);
      }
    }
    if (Array.isArray(layers.specializations)) {
      const wanted = new Set((layers.specializations as { code: string }[]).map(s => s.code));
      const current = (await runner.query(`SELECT code FROM company_specializations`)).rows.map(r => r.code as string);
      for (const c of current) if (!wanted.has(c)) await runner.query(`DELETE FROM company_specializations WHERE code = $1`, [c]);
      for (const c of wanted) {
        await runner.query(
          `INSERT INTO company_specializations (code, enabled_by) SELECT $1::varchar, $2::uuid WHERE EXISTS (SELECT 1 FROM sector_specializations WHERE code = $1::varchar)
           ON CONFLICT (code) DO NOTHING`, [c, userId ?? null]);
      }
    }
  },
};

/** Différences entre deux photographies, couche par couche (ajouts, retraits, modifications). */
export function diffLayers(a: ConfigLayers, b: ConfigLayers): { layer: string; added: unknown[]; removed: unknown[]; changed: { before: unknown; after: unknown }[] }[] {
  const idOf = (row: Record<string, unknown>) => String(row.code ?? row.key ?? row.doc_type ?? row.name ?? row.stage ?? row.id ?? JSON.stringify(row));
  const out: { layer: string; added: unknown[]; removed: unknown[]; changed: { before: unknown; after: unknown }[] }[] = [];
  for (const layer of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    const ra = new Map(((a?.[layer] ?? []) as Record<string, unknown>[]).map(r => [idOf(r), r]));
    const rb = new Map(((b?.[layer] ?? []) as Record<string, unknown>[]).map(r => [idOf(r), r]));
    const added = [...rb.entries()].filter(([k]) => !ra.has(k)).map(([, v]) => v);
    const removed = [...ra.entries()].filter(([k]) => !rb.has(k)).map(([, v]) => v);
    const changed = [...rb.entries()].filter(([k, v]) => ra.has(k) && JSON.stringify(ra.get(k)) !== JSON.stringify(v))
      .map(([k, v]) => ({ before: ra.get(k), after: v }));
    if (added.length || removed.length || changed.length) out.push({ layer, added, removed, changed });
  }
  return out;
}
