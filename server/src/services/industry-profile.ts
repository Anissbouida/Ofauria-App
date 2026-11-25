import { db } from '../config/database.js';
import { parameterByKey, validateParameter } from './parameters-catalog.js';
import { PRODUCTION_PRINT_DOCS, STOCK_LOCATION_ROLE_KEYS, type ProductionPrintDoc } from '@ofauria/shared';

/**
 * Couches « production » d'un profil d'industrie (C-01, mig 586) : ce qui rend un secteur
 * réellement différent d'un autre au-delà des modules, options et vocabulaire.
 *   - types d'ordre (étapes requises, mode de consommation, sous-traitance, type par défaut) ;
 *   - politiques au niveau société (clé de répartition du coût, libération des lots, source
 *     des étapes, rendement cible…) ;
 *   - gabarits d'impression (titre, colonnes, signatures, mention).
 * Exportées dans le modèle de configuration, stockées dans sector_packs.profile, appliquées
 * par « Charger les données de départ ». L'application n'écrase rien : un type d'ordre existant
 * (même code), une politique déjà posée ou un gabarit déjà modifié restent tels quels.
 */
export interface ProfileOrderType {
  code: string; label: string; description?: string | null;
  requires_bon_sortie: boolean; requires_weighing: boolean; requires_quality_check: boolean;
  consumption_mode: 'au_bon_de_sortie' | 'a_la_declaration' | 'manuel'; is_subcontracting: boolean; is_default: boolean;
}
export interface ProfileLayers {
  order_types: ProfileOrderType[];
  policies: { key: string; value: Record<string, unknown> }[];
  print_templates: { doc_type: ProductionPrintDoc; title: string | null; layout: { columns?: string[]; signatures?: string[] }; footer_note: string | null }[];
  /** Postes de charge types, repérés par leur nom (C-01). */
  work_centers?: { name: string; hourly_cost: number; capacity_minutes_per_day: number | null }[];
  /** Emplacements types, recréés dans chaque établissement qui n'a pas ce code (C-01). */
  locations?: { code: string; name: string; type: string; temp_min: number | null; temp_max: number | null; role?: string | null }[];
  /**
   * Étape 7 multi-industries : plans de contrôle rattachés à une FAMILLE d'articles, repérée par
   * son nom (les lignes propres à un article restent dans la société). Ajoutés si la famille
   * existe et n'a pas déjà cette caractéristique à cette étape.
   */
  control_plans?: ProfileControlLine[];
}
export interface ProfileControlLine {
  category: string; stage: 'en_cours' | 'final' | 'avant_transfert' | 'avant_livraison'; characteristic: string;
  char_type: 'mesure' | 'oui_non' | 'visuel'; min_value: number | null; max_value: number | null; unit: string | null;
  frequency: 'chaque_lot' | 'un_sur_n' | 'par_quantite'; frequency_n: number | null; sample_size: number; is_blocking: boolean;
}
const CONTROL_STAGES = ['en_cours', 'final', 'avant_transfert', 'avant_livraison'];
const CHAR_TYPES = ['mesure', 'oui_non', 'visuel'];
const FREQUENCIES = ['chaque_lot', 'un_sur_n', 'par_quantite'];
export const EMPTY_LAYERS: ProfileLayers = { order_types: [], policies: [], print_templates: [] };
/** Types d'emplacement acceptés par stock_locations (mig 424). */
// Mig 699 : types d'emplacement = référentiel stock_location_types (contrôlé en base à l'écriture).
const LOCATION_TYPE = /^[a-z0-9_]{1,30}$/;
const numOrNull = (v: unknown) => { const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n; };

type Runner = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);
const MODES = ['au_bon_de_sortie', 'a_la_declaration', 'manuel'] as const;

/** Couches de la configuration courante. */
export async function exportLayers(runner: Runner = db): Promise<ProfileLayers> {
  const types = (await runner.query(
    `SELECT code, label, description, requires_bon_sortie, requires_weighing, requires_quality_check, consumption_mode,
            COALESCE(is_subcontracting, false) AS is_subcontracting, is_default
       FROM production_order_types WHERE is_active ORDER BY display_order, label`)).rows;
  const policies = (await runner.query(
    `SELECT key, value FROM policy_values WHERE scope_type = 'company' ORDER BY key`)).rows;
  const tpl = await runner.query(`SELECT to_regclass('public.document_template_variants') IS NOT NULL AS ok`);
  const prints = tpl.rows[0].ok ? (await runner.query(
    `SELECT doc_type, title, layout, footer_note FROM document_templates
      WHERE category = 'production' AND (title IS NOT NULL OR layout <> '{}'::jsonb OR footer_note IS NOT NULL) ORDER BY doc_type`)).rows : [];
  const centers = (await runner.query(
    `SELECT DISTINCT ON (lower(name)) name, hourly_cost::float8 AS hourly_cost, capacity_minutes_per_day::float8 AS capacity_minutes_per_day
       FROM work_centers WHERE is_active ORDER BY lower(name), created_at`)).rows;
  // Un code d'emplacement par modèle (le premier établissement qui le porte fait foi).
  const locations = (await runner.query(
    `SELECT DISTINCT ON (code) code, name, type, role, temp_min::float8 AS temp_min, temp_max::float8 AS temp_max
       FROM stock_locations WHERE is_active AND parent_id IS NULL ORDER BY code, created_at`)).rows;
  const control_plans = (await runner.query(
    `SELECT c.name AS category, l.stage, l.characteristic, l.char_type, l.min_value::float8 AS min_value, l.max_value::float8 AS max_value,
            l.unit, l.frequency, l.frequency_n, l.sample_size, l.is_blocking
       FROM quality_control_plan_lines l JOIN categories c ON c.id = l.product_category_id
      WHERE l.is_active AND l.product_id IS NULL AND l.step_type_code IS NULL AND l.stage <> 'reception'
      ORDER BY c.name, l.stage, l.created_at`)).rows;
  return { order_types: types, policies, print_templates: prints, work_centers: centers, locations, control_plans };
}

/** Valide des couches venues d'un fichier (donnée non fiable) ; avertissements lisibles. */
export function cleanLayers(raw: unknown, warnings: string[]): ProfileLayers {
  if (!isObj(raw)) return { order_types: [], policies: [], print_templates: [] };
  const order_types: ProfileOrderType[] = [];
  const seen = new Set<string>();
  // Borne de sécurité (fichier non fiable), signalée si elle coupe : un import ne perd rien en silence.
  const MAX_TYPES = 200;
  if (Array.isArray(raw.order_types) && raw.order_types.length > MAX_TYPES) warnings.push(`${raw.order_types.length - MAX_TYPES} type(s) d'ordre au-delà de ${MAX_TYPES} ignoré(s)`);
  for (const t of Array.isArray(raw.order_types) ? raw.order_types.slice(0, MAX_TYPES) : []) {
    if (!isObj(t)) continue;
    const code = str(t.code, 30)?.toUpperCase(); const label = str(t.label, 80);
    if (!code || !/^[A-Z][A-Z0-9_]{1,29}$/.test(code) || !label || seen.has(code)) { warnings.push(`Type d'ordre ignoré : ${String(t.code)}`); continue; }
    seen.add(code);
    const sub = t.is_subcontracting === true;
    let bon = sub ? false : t.requires_bon_sortie !== false;
    let mode = (MODES as readonly string[]).includes(String(t.consumption_mode)) ? t.consumption_mode as ProfileOrderType['consumption_mode'] : (bon ? 'au_bon_de_sortie' : 'a_la_declaration');
    // Mêmes règles que production-order-type.repository (normalize) et les contraintes des mig 546/584.
    if (sub) { bon = false; mode = 'a_la_declaration'; }
    if (!bon && mode === 'au_bon_de_sortie') mode = 'a_la_declaration';
    order_types.push({
      code, label, description: str(t.description, 1000), requires_bon_sortie: bon,
      requires_weighing: bon && t.requires_weighing === true, requires_quality_check: t.requires_quality_check === true,
      consumption_mode: mode, is_subcontracting: sub, is_default: t.is_default === true,
    });
  }
  if (order_types.filter(t => t.is_default).length > 1) {
    warnings.push('Plusieurs types d\'ordre par défaut : seul le premier est retenu');
    let first = true; for (const t of order_types) if (t.is_default) { t.is_default = first; first = false; }
  }
  const policies: ProfileLayers['policies'] = [];
  for (const p of Array.isArray(raw.policies) ? raw.policies.slice(0, 60) : []) {
    if (!isObj(p)) continue;
    const def = typeof p.key === 'string' ? parameterByKey(p.key) : undefined;
    if (!def || def.storage.kind !== 'policy' || !def.scopes?.includes('company')) { warnings.push(`Politique inconnue ignorée : ${String(p.key)}`); continue; }
    const v = validateParameter(def, p.value, {});
    if (typeof v === 'string') { warnings.push(`Politique ${def.key} ignorée : ${v}`); continue; }
    policies.push({ key: def.key, value: v });
  }
  const print_templates: ProfileLayers['print_templates'] = [];
  for (const t of Array.isArray(raw.print_templates) ? raw.print_templates.slice(0, 10) : []) {
    if (!isObj(t) || typeof t.doc_type !== 'string' || !(t.doc_type in PRODUCTION_PRINT_DOCS)) continue;
    const def = PRODUCTION_PRINT_DOCS[t.doc_type as ProductionPrintDoc];
    const layout = isObj(t.layout) ? t.layout : {};
    const cols = Array.isArray(layout.columns) ? layout.columns.filter((c): c is string => typeof c === 'string' && def.columns.some(k => k.key === c)) : undefined;
    const sigs = def.hasSignatures && Array.isArray(layout.signatures) ? layout.signatures.map(s => str(s, 60)).filter((s): s is string => !!s).slice(0, 6) : undefined;
    print_templates.push({
      doc_type: t.doc_type as ProductionPrintDoc, title: str(t.title, 120),
      layout: { ...(cols ? { columns: cols } : {}), ...(sigs ? { signatures: sigs } : {}) },
      footer_note: typeof t.footer_note === 'string' ? t.footer_note.trim().slice(0, 300) : null,
    });
  }
  const work_centers: NonNullable<ProfileLayers['work_centers']> = [];
  const seenWc = new Set<string>();
  for (const w of Array.isArray(raw.work_centers) ? raw.work_centers.slice(0, 50) : []) {
    if (!isObj(w)) continue;
    const name = str(w.name, 120);
    if (!name || seenWc.has(name.toLowerCase())) continue;
    seenWc.add(name.toLowerCase());
    const cost = numOrNull(w.hourly_cost); const cap = numOrNull(w.capacity_minutes_per_day);
    work_centers.push({ name, hourly_cost: cost !== null && cost >= 0 ? cost : 0, capacity_minutes_per_day: cap !== null && cap > 0 ? cap : null });
  }
  const locations: NonNullable<ProfileLayers['locations']> = [];
  const seenLoc = new Set<string>();
  for (const l of Array.isArray(raw.locations) ? raw.locations.slice(0, 50) : []) {
    if (!isObj(l)) continue;
    const code = str(l.code, 30)?.toUpperCase(); const name = str(l.name, 120); const type = String(l.type ?? '');
    if (!code || !/^[A-Z0-9_-]{1,30}$/.test(code) || !name || !LOCATION_TYPE.test(String(type)) || seenLoc.has(code)) { warnings.push(`Emplacement ignoré : ${String(l.code)}`); continue; }
    seenLoc.add(code);
    // Étape 8 : rôle de l'emplacement (déduit du type par la base s'il est absent ou inconnu).
    const role = typeof l.role === 'string' && (STOCK_LOCATION_ROLE_KEYS as string[]).includes(l.role) ? l.role : null;
    locations.push({ code, name, type, temp_min: numOrNull(l.temp_min), temp_max: numOrNull(l.temp_max), role });
  }
  const control_plans: ProfileControlLine[] = [];
  for (const c of Array.isArray(raw.control_plans) ? raw.control_plans.slice(0, 300) : []) {
    if (!isObj(c)) continue;
    const category = str(c.category, 120); const characteristic = str(c.characteristic, 160);
    const stage = String(c.stage ?? ''); const char_type = String(c.char_type ?? ''); const frequency = String(c.frequency ?? 'chaque_lot');
    const min = numOrNull(c.min_value); const max = numOrNull(c.max_value); const n = numOrNull(c.frequency_n);
    if (!category || !characteristic || !CONTROL_STAGES.includes(stage) || !CHAR_TYPES.includes(char_type) || !FREQUENCIES.includes(frequency)
        || (char_type === 'mesure' && min === null && max === null) || (frequency !== 'chaque_lot' && !(n && n > 0))) {
      warnings.push(`Ligne de plan de contrôle ignorée : ${String(c.characteristic ?? '?')}`); continue;
    }
    const sample = numOrNull(c.sample_size);
    control_plans.push({
      category, stage: stage as ProfileControlLine['stage'], characteristic, char_type: char_type as ProfileControlLine['char_type'],
      min_value: char_type === 'mesure' ? min : null, max_value: char_type === 'mesure' ? max : null, unit: str(c.unit, 16),
      frequency: frequency as ProfileControlLine['frequency'], frequency_n: frequency === 'chaque_lot' ? null : Math.round(n!),
      sample_size: sample && sample > 0 ? Math.min(10000, Math.round(sample)) : 1, is_blocking: c.is_blocking === true,
    });
  }
  return { order_types, policies, print_templates, work_centers, locations, control_plans };
}

/**
 * Applique des couches sans rien écraser. Le type d'ordre « par défaut » du profil le devient
 * seulement si le type par défaut actuel n'a encore aucun ordre (société qui démarre).
 */
export async function applyLayers(client: Runner, layers: ProfileLayers, userId?: string | null) {
  const out = { orderTypes: 0, policies: 0, printTemplates: 0, defaultType: false, workCenters: 0, locations: 0, controlPlans: 0 };
  for (const t of layers.order_types) {
    const r = await client.query(
      `INSERT INTO production_order_types (code, label, description, requires_bon_sortie, requires_weighing, requires_quality_check,
                                           consumption_mode, is_subcontracting, is_default, is_active, display_order, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, true, 50, $9::uuid) ON CONFLICT (code) DO NOTHING RETURNING id`,
      [t.code, t.label, t.description ?? null, t.requires_bon_sortie, t.requires_weighing, t.requires_quality_check,
       t.consumption_mode, t.is_subcontracting, userId ?? null]);
    if (r.rows[0]) out.orderTypes++;
  }
  const def = layers.order_types.find(t => t.is_default);
  if (def) {
    const cur = (await client.query(
      `SELECT t.id, t.code, (SELECT COUNT(*)::int FROM production_plans p WHERE p.order_type_id = t.id) AS n
         FROM production_order_types t WHERE t.is_default`)).rows[0];
    if (cur && cur.code !== def.code && cur.n === 0) {
      await client.query(`UPDATE production_order_types SET is_default = false WHERE is_default`);
      await client.query(`UPDATE production_order_types SET is_default = true, is_active = true WHERE code = $1`, [def.code]);
      out.defaultType = true;
    }
  }
  for (const p of layers.policies) {
    const r = await client.query(
      `INSERT INTO policy_values (key, scope_type, scope_id, value, updated_by) VALUES ($1, 'company', '', $2::jsonb, $3::uuid)
       ON CONFLICT (key, scope_type, scope_id) DO NOTHING RETURNING key`, [p.key, JSON.stringify(p.value), userId ?? null]);
    if (r.rows[0]) out.policies++;
  }
  for (const t of layers.print_templates) {
    const r = await client.query(
      `UPDATE document_templates SET title = $2::text, layout = $3::jsonb, footer_note = $4::text, updated_by = $5::uuid, updated_at = now()
        WHERE doc_type = $1::text AND category = 'production' AND title IS NULL AND layout = '{}'::jsonb AND footer_note IS NULL
        RETURNING doc_type`, [t.doc_type, t.title, JSON.stringify(t.layout), t.footer_note, userId ?? null]);
    if (r.rows[0]) out.printTemplates++;
  }
  for (const w of layers.work_centers ?? []) {
    const r = await client.query(
      `INSERT INTO work_centers (name, hourly_cost, capacity_minutes_per_day, is_active, created_by)
       SELECT $1::text, $2::numeric, $3::numeric, true, $4::uuid
        WHERE NOT EXISTS (SELECT 1 FROM work_centers WHERE lower(name) = lower($1::text)) RETURNING id`,
      [w.name, w.hourly_cost, w.capacity_minutes_per_day, userId ?? null]);
    if (r.rows[0]) out.workCenters++;
  }
  for (const l of layers.locations ?? []) {
    const r = await client.query(
      `INSERT INTO stock_locations (store_id, code, name, type, temp_min, temp_max, is_active, role)
       SELECT s.id, $1::text, $2::text, $3::text, $4::numeric, $5::numeric, true, $6::varchar FROM stores s
        WHERE s.is_active AND NOT EXISTS (SELECT 1 FROM stock_locations x WHERE x.store_id = s.id AND x.code = $1::text)
       RETURNING id`, [l.code, l.name, l.type, l.temp_min, l.temp_max, l.role ?? null]);
    out.locations += r.rows.length;
  }
  for (const c of layers.control_plans ?? []) {
    const r = await client.query(
      `INSERT INTO quality_control_plan_lines (product_category_id, stage, characteristic, char_type, min_value, max_value, unit,
                                               frequency, frequency_n, sample_size, is_blocking, created_by)
       SELECT cat.id, $2::varchar, $3::varchar, $4::varchar, $5::numeric, $6::numeric, $7::varchar, $8::varchar, $9::int, $10::int, $11::boolean, $12::uuid
         FROM categories cat
        WHERE lower(cat.name) = lower($1::text)
          AND NOT EXISTS (SELECT 1 FROM quality_control_plan_lines l WHERE l.product_category_id = cat.id AND l.is_active
                            AND l.stage = $2::varchar AND lower(l.characteristic) = lower($3::varchar))
        LIMIT 1 RETURNING id`,
      [c.category, c.stage, c.characteristic, c.char_type, c.min_value, c.max_value, c.unit, c.frequency, c.frequency_n, c.sample_size, c.is_blocking, userId ?? null]);
    out.controlPlans += r.rows.length;
  }
  return out;
}

/** Une ligne lisible par couche, pour l'aperçu des données de départ. */
export function describeLayers(l: ProfileLayers): string[] {
  const items: string[] = [];
  if (l.order_types.length) items.push(`Types d'ordre : ${l.order_types.map(t => t.label + (t.is_default ? ' (par défaut)' : '')).join(', ')}`);
  if (l.policies.length) items.push(`Politiques : ${l.policies.map(p => parameterByKey(p.key)?.label ?? p.key).join(', ')}`);
  if (l.print_templates.length) items.push(`Impressions : ${l.print_templates.map(t => t.title ?? PRODUCTION_PRINT_DOCS[t.doc_type].label).join(', ')}`);
  if (l.work_centers?.length) items.push(`Postes de charge : ${l.work_centers.map(w => w.name).join(', ')} (ajoutés s'ils manquent)`);
  if (l.control_plans?.length) items.push(`Plans de contrôle : ${l.control_plans.length} ligne(s) sur ${new Set(l.control_plans.map(c => c.category)).size} famille(s) (ajoutées si la famille existe)`);
  if (l.locations?.length) items.push(`Emplacements : ${l.locations.map(x => x.name).join(', ')} (dans chaque établissement qui ne les a pas)`);
  return items;
}
