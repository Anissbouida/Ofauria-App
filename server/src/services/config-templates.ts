import {
  ACTIVATABLE_MODULES, CORE_MODULES, MODULE_LABELS, canonicalModule, missingDependencies, requiredModules, withRequirements, type AppModule,
} from '@ofauria/shared';
import { db } from '../config/database.js';
import { setAuditUser } from '../utils/audit-context.js';
import { sectorRepository } from '../repositories/sector.repository.js';
import { exportLayers, cleanLayers, type ProfileLayers } from './industry-profile.js';

/**
 * Modèles de configuration (plan Production générique, lot P10, mig 517).
 *
 * Une configuration complète s'exporte en fichier JSON : secteur de base, modules et
 * options EFFECTIFS, vocabulaire, page d'accueil, rapports, données de départ (types
 * d'étape, d'équipement, unités). Ce modèle — exporté ici ou importé d'une autre
 * société — devient un SECTEUR PERSONNALISÉ, proposé dans la liste comme les secteurs
 * livrés : choisir ce secteur reprend la configuration, ses données de départ se
 * chargent depuis « Données de départ ».
 *
 * Pas exporté : les pilotes et établissements (identifiants propres à la société) et
 * toute donnée métier. Un fichier importé est une donnée NON FIABLE : chaque champ est
 * filtré (clés inconnues ignorées, longueurs bornées, dépendances complétées).
 */

const FORMAT = 'kalum.config';
/** v2 (C-01, mig 586) : + couches production (types d'ordre, politiques, impressions). v1 reste accepté. */
const VERSION = 2;

type Ref = { code: string; label: string; metadata?: Record<string, unknown> };
export type ConfigModel = {
  format: typeof FORMAT;
  version: number;
  name: string;
  base_sector: string;
  exported_at?: string;
  modules: string[];
  features: string[];
  labels: Record<string, string>;
  home_route: string | null;
  report_keys: string[];
  starter: { units: Ref[]; stepTypes: Ref[]; equipmentTypes: Ref[] };
  layers: ProfileLayers;
};

const REF_TABLES = { units: 'units', stepTypes: 'production_step_types', equipmentTypes: 'production_equipment_types' } as const;

async function activeRefs(tableId: string): Promise<Ref[]> {
  const { rows } = await db.query(
    `SELECT code, label, metadata FROM ref_entries WHERE table_id = $1 AND is_active AND code IS NOT NULL ORDER BY display_order, label`, [tableId]);
  return rows.map(r => ({ code: r.code, label: r.label, metadata: r.metadata ?? {} }));
}

/** Configuration courante, sous forme de modèle. */
export async function exportCurrentConfig(name?: string): Promise<ConfigModel> {
  const act = await sectorRepository.activation();
  const [labels, units, stepTypes, equipmentTypes, layers] = await Promise.all([
    sectorRepository.labels(act.sector.code), activeRefs(REF_TABLES.units),
    activeRefs(REF_TABLES.stepTypes), activeRefs(REF_TABLES.equipmentTypes), exportLayers(),
  ]);
  return {
    format: FORMAT, version: VERSION,
    name: name?.trim() || `${act.sector.label} (personnalisé)`,
    base_sector: act.sector.code,
    exported_at: new Date().toISOString(),
    modules: [...act.modules].sort(),
    features: [...act.features].sort(),
    labels,
    home_route: act.sector.home_route ?? null,
    report_keys: act.sector.report_keys ?? [],
    starter: { units, stepTypes, equipmentTypes },
    layers,
  };
}

// ─── Validation d'un modèle importé ──────────────────────────────────────────

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const CODE_RE = /^[a-z0-9_]{1,40}$/;

/** Métadonnées utiles seulement, par référentiel (le reste est ignoré). */
function cleanMeta(table: keyof typeof REF_TABLES, m: unknown): Record<string, unknown> {
  if (!isObj(m)) return {};
  const out: Record<string, unknown> = {};
  if (table === 'units') {
    const cat = str(m.category, 20); if (cat) out.category = cat;
    const tb = Number(m.to_base); if (Number.isFinite(tb) && tb > 0) out.to_base = tb;
    if (typeof m.is_base === 'boolean') out.is_base = m.is_base;
  } else if (table === 'stepTypes') {
    if (typeof m.ccp === 'boolean') out.ccp = m.ccp;
    const dp = str(m.default_param, 40); if (dp && CODE_RE.test(dp)) out.default_param = dp;
  }
  return out;
}

function cleanRefs(table: keyof typeof REF_TABLES, v: unknown): Ref[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: Ref[] = [];
  for (const r of v.slice(0, 200)) {
    if (!isObj(r)) continue;
    const code = str(r.code, 40); const label = str(r.label, 80);
    if (!code || !CODE_RE.test(code) || !label || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, label, metadata: cleanMeta(table, r.metadata) });
  }
  return out;
}

export type ParsedModel = { model: ConfigModel; warnings: string[] };

/** Valide et nettoie un modèle (fichier importé ou export courant). */
export async function parseConfigModel(raw: unknown): Promise<ParsedModel | { error: string }> {
  if (!isObj(raw) || raw.format !== FORMAT) return { error: 'Ce fichier n\'est pas un modèle de configuration Kalum' };
  if (raw.version !== 1 && raw.version !== VERSION) return { error: `Version de modèle non prise en charge : ${String(raw.version)}` };
  const name = str(raw.name, 120);
  if (!name) return { error: 'Le modèle n\'a pas de nom' };
  const warnings: string[] = [];

  const base = str(raw.base_sector, 40);
  const basePack = base ? await sectorRepository.pack(base) : null;
  if (base && !basePack) warnings.push(`Secteur de base « ${base} » inconnu ici : information seulement`);

  const ignoredModules: string[] = [];
  const modules = new Set<AppModule>(CORE_MODULES);
  for (const m of Array.isArray(raw.modules) ? raw.modules : []) {
    const key = typeof m === 'string' ? canonicalModule(m as AppModule) : null;
    if (key && ACTIVATABLE_MODULES.includes(key)) modules.add(key); else ignoredModules.push(String(m));
  }
  if (ignoredModules.length) warnings.push(`Modules inconnus ignorés : ${ignoredModules.slice(0, 10).join(', ')}`);
  const added: AppModule[] = [];
  for (const { module } of missingDependencies(modules)) {
    for (const d of requiredModules(module)) if (!modules.has(d)) { modules.add(d); added.push(d); }
  }
  if (added.length) warnings.push(`Ajoutés pour les dépendances : ${added.map(m => MODULE_LABELS[m]).join(', ')}`);

  const act = await sectorRepository.activation();
  const known = new Set(act.catalog.map(f => f.key));
  const rawFeatures = Array.isArray(raw.features) ? raw.features.filter((f): f is string => typeof f === 'string') : [];
  const asked = rawFeatures.filter(f => known.has(f));
  if (asked.length < rawFeatures.length) warnings.push(`Options inconnues ignorées : ${rawFeatures.filter(f => !known.has(f)).slice(0, 10).join(', ')}`);
  // Étape 1 multi-industries : une capacité importée emporte celles dont elle dépend.
  const features = [...withRequirements(asked, act.catalog)];
  const addedCaps = features.filter(f => !asked.includes(f));
  if (addedCaps.length) {
    const labelOf = new Map(act.catalog.map(f => [f.key, f.label]));
    warnings.push(`Capacités ajoutées pour les dépendances : ${addedCaps.map(f => labelOf.get(f) ?? f).join(', ')}`);
  }

  const labels: Record<string, string> = {};
  if (isObj(raw.labels)) {
    for (const [k, v] of Object.entries(raw.labels).slice(0, 200)) {
      const val = str(v, 120);
      if (/^[a-z0-9_]{1,60}$/.test(k) && val) labels[k] = val;
    }
  }
  const home = str(raw.home_route, 80);
  const home_route = home && /^\/[a-z0-9/_-]*$/.test(home) ? home : null;
  const report_keys = (Array.isArray(raw.report_keys) ? raw.report_keys : [])
    .map(k => str(k, 60)).filter((k): k is string => !!k && /^[a-z0-9_.-]+$/.test(k)).slice(0, 50);
  const st = isObj(raw.starter) ? raw.starter : {};

  return {
    model: {
      format: FORMAT, version: VERSION, name, base_sector: basePack?.code ?? base ?? act.sector.code,
      modules: [...modules].sort(), features: features.sort(), labels, home_route, report_keys,
      starter: { units: cleanRefs('units', st.units), stepTypes: cleanRefs('stepTypes', st.stepTypes), equipmentTypes: cleanRefs('equipmentTypes', st.equipmentTypes) },
      // v1 : pas de couches production (valeurs actuelles conservées au chargement).
      layers: cleanLayers(raw.layers, warnings),
    },
    warnings,
  };
}

/** Aperçu d'un modèle avant de l'enregistrer : écarts avec la configuration courante. */
export async function previewConfigModel(raw: unknown) {
  const parsed = await parseConfigModel(raw);
  if ('error' in parsed) return parsed;
  const act = await sectorRepository.activation();
  const { model } = parsed;
  const lbl = (m: string) => MODULE_LABELS[m as AppModule] ?? m;
  return {
    name: model.name,
    warnings: parsed.warnings,
    modules: model.modules.length,
    addedModules: model.modules.filter(m => !act.modules.has(m as AppModule)).map(lbl),
    removedModules: [...act.modules].filter(m => !model.modules.includes(m)).map(lbl),
    features: model.features.length,
    labels: Object.keys(model.labels).length,
    starter: { units: model.starter.units.length, stepTypes: model.starter.stepTypes.length, equipmentTypes: model.starter.equipmentTypes.length },
    layers: { orderTypes: model.layers.order_types.length, policies: model.layers.policies.length, printTemplates: model.layers.print_templates.length },
  };
}

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'secteur';

/** Enregistre un modèle comme secteur personnalisé (sans l'appliquer). */
export async function saveModelAsSector(raw: unknown, userId?: string | null): Promise<{ error: string } | { code: string; label: string; warnings: string[] }> {
  const parsed = await parseConfigModel(raw);
  if ('error' in parsed) return parsed;
  const { model, warnings } = parsed;
  const { rows: labelTaken } = await db.query(`SELECT 1 FROM sector_packs WHERE lower(label) = lower($1)`, [model.name]);
  if (labelTaken.length) return { error: `Un secteur s'appelle déjà « ${model.name} »` };

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await setAuditUser(client, userId);
    const root = `perso_${slug(model.name)}`;
    const { rows: taken } = await client.query(`SELECT code FROM sector_packs WHERE code = $1 OR code LIKE $1 || '\\_%'`, [root]);
    const used = new Set(taken.map(r => r.code as string));
    let code = root;
    for (let i = 2; used.has(code); i++) code = `${root}_${i}`;
    await client.query(
      `INSERT INTO sector_packs (code, label, enabled_modules, features, home_route, report_keys, is_default, is_custom, base_sector, starter, created_by, profile)
       VALUES ($1, $2, $3, $4, $5, $6, false, true, $7, $8, $9, $10::jsonb)`,
      [code, model.name, model.modules, model.features, model.home_route, model.report_keys, model.base_sector, JSON.stringify(model.starter), userId ?? null, JSON.stringify(model.layers)]);
    for (const [k, v] of Object.entries(model.labels)) {
      await client.query(`INSERT INTO sector_labels (sector_pack, label_key, label_value) VALUES ($1, $2, $3)`, [code, k, v]);
    }
    await client.query('COMMIT');
    return { code, label: model.name, warnings };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Supprime un secteur personnalisé que la société n'utilise pas. */
export async function deleteCustomSector(code: string): Promise<{ error: string } | { ok: true }> {
  const pack = await sectorRepository.pack(code);
  if (!pack || !pack.is_custom) return { error: 'Seul un secteur personnalisé peut être supprimé' };
  if ((await sectorRepository.current()).code === code) return { error: 'Ce secteur est celui de la société : changez de secteur avant de le supprimer' };
  await db.query(`DELETE FROM sector_packs WHERE code = $1 AND is_custom`, [code]);
  return { ok: true };
}
