import { db } from '../config/database.js';
import { parameterByKey, validateParameter } from './parameters-catalog.js';
import { PRODUCTION_PRINT_DOCS, type ProductionPrintDoc } from '@ofauria/shared';

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
}
export const EMPTY_LAYERS: ProfileLayers = { order_types: [], policies: [], print_templates: [] };

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
  return { order_types: types, policies, print_templates: prints };
}

/** Valide des couches venues d'un fichier (donnée non fiable) ; avertissements lisibles. */
export function cleanLayers(raw: unknown, warnings: string[]): ProfileLayers {
  if (!isObj(raw)) return { order_types: [], policies: [], print_templates: [] };
  const order_types: ProfileOrderType[] = [];
  const seen = new Set<string>();
  for (const t of Array.isArray(raw.order_types) ? raw.order_types.slice(0, 30) : []) {
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
  return { order_types, policies, print_templates };
}

/**
 * Applique des couches sans rien écraser. Le type d'ordre « par défaut » du profil le devient
 * seulement si le type par défaut actuel n'a encore aucun ordre (société qui démarre).
 */
export async function applyLayers(client: Runner, layers: ProfileLayers, userId?: string | null) {
  const out = { orderTypes: 0, policies: 0, printTemplates: 0, defaultType: false };
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
  return out;
}

/** Une ligne lisible par couche, pour l'aperçu des données de départ. */
export function describeLayers(l: ProfileLayers): string[] {
  const items: string[] = [];
  if (l.order_types.length) items.push(`Types d'ordre : ${l.order_types.map(t => t.label + (t.is_default ? ' (par défaut)' : '')).join(', ')}`);
  if (l.policies.length) items.push(`Politiques : ${l.policies.map(p => parameterByKey(p.key)?.label ?? p.key).join(', ')}`);
  if (l.print_templates.length) items.push(`Impressions : ${l.print_templates.map(t => t.title ?? PRODUCTION_PRINT_DOCS[t.doc_type].label).join(', ')}`);
  return items;
}
