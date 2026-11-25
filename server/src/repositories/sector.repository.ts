import { policySnapshot, restorePolicies, type PolicyRow } from '../services/policies.js';
import type { PoolClient } from 'pg';
import { db, inTransaction } from '../config/database.js';
import { setAuditUser } from '../utils/audit-context.js';
import {
  ACTIVATABLE_MODULES, CORE_MODULES, MODULE_LABELS, STORE_SCOPED_MODULES, canonicalModule, effectiveModules,
  missingDependencies, modulesForUser, withRequirements, capabilityDefault,
  type AppModule, type ModuleOverrides, type ModulePilot, type ModuleRollout,
} from '@ofauria/shared';
import { capabilityUsage } from '../services/capabilities.js';
import { configLayersRepository, diffLayers, type ConfigLayers } from './config-layers.repository.js';
import { NO_VISIBLE_CHANGE, describeDiff, diffActivation, type ActivationState, type ImpactDiff } from '../services/module-impact.js';

/**
 * Secteur d'activité (packs secteur, mig 468). Le secteur de la société est dans
 * company_settings.sector_pack ; chaque pack active une liste de modules. Le reste
 * du code lit `modules` (capacités), jamais le code du secteur : ajouter un secteur
 * = une ligne dans sector_packs, sans toucher au code.
 *
 * Activation (mig 507) : le secteur est un préréglage, ajusté module par module et
 * option par option (company_module_settings / company_feature_settings, écarts
 * seulement). Les modules et options EFFECTIFS se calculent ici et nulle part ailleurs.
 *
 * Versions (mig 508) : chaque changement enregistre l'état complet qui en résulte
 * (config_versions) ; on peut restaurer n'importe quelle version.
 *
 * Diffusion (mig 509) : un module actif peut être en PILOTE (visible de quelques
 * rôles / utilisateurs) ou fermé pour certains établissements. Les modules visibles
 * d'un utilisateur = forUser(user) ; la société garde le module actif.
 */
export type SectorPack = {
  code: string; label: string; modules: string[]; is_default: boolean; home_route?: string | null; report_keys?: string[]; features?: string[]; is_custom?: boolean;
  /** Héritage vivant (mig 633) : parent, regroupement et état affichés dans le choix du profil. */
  base_sector?: string | null; inherits?: boolean; family?: string | null; status?: string; description?: string | null; sort_order?: number; in_wizard?: boolean;
  /** Chaîne des parents, de la racine au profil lui-même (codes). */
  lineage?: string[];
  secondarySectors?: string[];
  specialtyLineage?: string[];
};

/** Capacité du catalogue (options mig 507, catalogue étendu mig 632). */
export type FeatureDef = {
  key: string; module_key: string; label: string; description: string | null; sort_order: number;
  kind: 'fonction' | 'reglementaire'; requires: string[]; default_on: boolean;
};

export type Activation = {
  sector: SectorPack;
  /** Modules du préréglage, en clés canoniques. */
  packModules: AppModule[];
  packFeatures: string[];
  moduleOverrides: ModuleOverrides;
  featureOverrides: ModuleOverrides;
  catalog: FeatureDef[];
  modules: Set<AppModule>;
  /** Une option n'est effective que si son module l'est. */
  features: Set<string>;
  rollout: ModuleRollout;
};

export type AdjustmentChanges = { modules?: Record<string, boolean | null>; features?: Record<string, boolean | null> };

export type ConfigSnapshot = { sector: string; secondarySectors?: string[]; modules: ModuleOverrides; features: ModuleOverrides; rollout?: ModuleRollout; policies?: PolicyRow[]; layers?: ConfigLayers };

/** Diffusion d'un module : pilote (null = ouvert à tous) et établissements fermés. */
export type RolloutChange = { pilot: ModulePilot | null; disabledStores: string[] };

export type ConfigVersion = { id: number; created_at: string; created_by_name: string | null; label: string; snapshot: ConfigSnapshot };

type Target = { sector: SectorPack; modules: ModuleOverrides; features: ModuleOverrides; rollout: ModuleRollout };

const EMPTY_ROLLOUT: ModuleRollout = { pilots: {}, storeDisabled: {} };

/** Principal conserve ses libellés et sa navigation ; les capacités se cumulent. */
export function combineSectorPacks(primary: SectorPack, others: SectorPack[]): SectorPack {
  return { ...primary, modules:[...new Set([...primary.modules,...others.flatMap(p=>p.modules)])],
    features:[...new Set([...(primary.features??[]),...others.flatMap(p=>p.features??[])])],
    secondarySectors:others.map(p=>p.code).sort(), specialtyLineage:[...new Set([...(primary.lineage??[primary.code]),...others.flatMap(p=>p.lineage??[p.code])])] };
}

async function secondaryCodes():Promise<string[]> {
  if (!(await db.query(`SELECT to_regclass('public.company_sectors') IS NOT NULL AS ok`)).rows[0]?.ok) return [];
  return (await db.query(`SELECT sector_code FROM company_sectors WHERE NOT is_primary ORDER BY sector_code`)).rows.map(r=>String(r.sector_code));
}

const mapPack = (r: Record<string, any>): SectorPack => ({
  code: r.code, label: r.label, modules: r.modules ?? [], is_default: r.is_default,
  home_route: r.home_route ?? null, report_keys: r.report_keys ?? [], features: r.features ?? [], is_custom: r.is_custom ?? false,
  base_sector: r.base_sector ?? null, inherits: r.inherits ?? false, family: r.family ?? null,
  status: r.status ?? 'disponible', description: r.description ?? null, sort_order: r.sort_order ?? 100, in_wizard: r.in_wizard ?? false,
});

const PACK_COLUMNS = `sp.code, sp.label, sp.enabled_modules AS modules, sp.is_default, sp.home_route, sp.report_keys, sp.features, sp.is_custom,
  sp.base_sector, sp.inherits, sp.add_modules, sp.remove_modules, sp.add_features, sp.remove_features,
  sp.family, sp.status, sp.description, sp.sort_order, sp.in_wizard`;

/** Profondeur maximale d'héritage (garde-fou contre une chaîne anormale). */
const MAX_LINEAGE = 8;

/**
 * Héritage vivant (étape 2 multi-industries, mig 633). Un profil qui hérite a pour modules et
 * options ceux de son parent, résolus récursivement, plus ses ajouts, moins ses retraits.
 * Un profil qui n'hérite pas (racine, secteur personnalisé d'avant la mig 633) garde ses
 * listes complètes. Cycle ou parent introuvable : on s'arrête au dernier profil valide.
 */
function resolvePacks(rows: Record<string, any>[]): Map<string, SectorPack> {
  const raw = new Map(rows.map(r => [r.code as string, r]));
  const out = new Map<string, SectorPack>();
  const resolve = (code: string, seen: string[]): SectorPack | null => {
    if (out.has(code)) return out.get(code)!;
    const r = raw.get(code);
    if (!r) return null;
    const own = mapPack(r);
    let pack: SectorPack = { ...own, lineage: [code] };
    if (r.inherits && r.base_sector && !seen.includes(r.base_sector) && seen.length < MAX_LINEAGE) {
      const parent = resolve(r.base_sector, [...seen, code]);
      if (parent) {
        const minus = (a: string[], b: string[]) => a.filter(x => !b.includes(x));
        pack = {
          ...own,
          modules: [...new Set(minus([...parent.modules, ...(r.add_modules ?? [])], r.remove_modules ?? []))].sort(),
          features: [...new Set(minus([...(parent.features ?? []), ...(r.add_features ?? [])], r.remove_features ?? []))].sort(),
          lineage: [...(parent.lineage ?? [parent.code]), code],
        };
      }
    }
    out.set(code, pack);
    return pack;
  };
  for (const code of raw.keys()) resolve(code, []);
  return out;
}

async function allPacks(): Promise<Map<string, SectorPack>> {
  const { rows } = await db.query(`SELECT ${PACK_COLUMNS} FROM sector_packs sp`);
  return resolvePacks(rows);
}

// Les modules effectifs sont lus à chaque requête par la garde serveur : cache court,
// vidé à chaque changement. Plusieurs instances serveur : le délai borne l'écart.
const CACHE_MS = 30_000;
let cache: { at: number; value: Activation } | null = null;

const canonicalPack = (pack: SectorPack): AppModule[] => [...new Set(pack.modules.map(m => canonicalModule(m as AppModule)))];

function computeFeatures(packFeatures: string[], overrides: ModuleOverrides, catalog: FeatureDef[], modules: Set<AppModule>): Set<string> {
  // Préréglage du secteur + socle (capacités default_on, mig 632), puis écarts de la société.
  const set = new Set([...packFeatures, ...catalog.filter(f => f.default_on).map(f => f.key)]);
  for (const [k, on] of Object.entries(overrides)) {
    if (on === undefined) continue;
    if (on) set.add(k); else set.delete(k);
  }
  const byKey = new Map(catalog.map(f => [f.key, f]));
  // Une capacité n'est effective que si son module l'est…
  let effective = new Set([...set].filter(k => {
    const m = byKey.get(k)?.module_key;
    return m !== undefined && modules.has(canonicalModule(m as AppModule));
  }));
  // … et que ses dépendances le sont (cascade jusqu'à stabilité).
  for (;;) {
    const kept = new Set([...effective].filter(k => (byKey.get(k)?.requires ?? []).every(r => effective.has(r))));
    if (kept.size === effective.size) return kept;
    effective = kept;
  }
}

/** Valeur d'une capacité sans écart de la société : préréglage du secteur ou socle. */
function featureDefault(key: string, packFeatures: string[], catalog: FeatureDef[]): boolean {
  return capabilityDefault(catalog.find(f => f.key === key), packFeatures, key);
}

/** Modules et options effectifs d'un état cible (secteur + écarts). */
function stateOf(target: Target, catalog: FeatureDef[]): ActivationState {
  const modules = effectiveModules(target.sector.modules, target.modules);
  return { modules, features: computeFeatures(target.sector.features ?? [], target.features, catalog, modules) };
}

/** Retire les écarts égaux au préréglage : les tables ne gardent que les vrais écarts. */
function normalize(target: Target, catalog: FeatureDef[] = []): Target {
  const pack = canonicalPack(target.sector);
  const packFeatures = target.sector.features ?? [];
  const modules: ModuleOverrides = {};
  for (const [k, on] of Object.entries(target.modules)) {
    if (on !== undefined && on !== pack.includes(canonicalModule(k as AppModule))) modules[k] = on;
  }
  const features: ModuleOverrides = {};
  for (const [k, on] of Object.entries(target.features)) {
    if (on !== undefined && on !== featureDefault(k, packFeatures, catalog)) features[k] = on;
  }
  return { sector: target.sector, modules, features, rollout: target.rollout };
}

const snapshotOf = (t: Target): ConfigSnapshot =>
  ({ sector: t.sector.code, secondarySectors:t.sector.secondarySectors??[], modules: t.modules, features: t.features, rollout: t.rollout });

async function loadRollout(): Promise<ModuleRollout> {
  const [pilots, members, stores] = await Promise.all([
    db.query(`SELECT module_key FROM company_module_pilots`),
    db.query(`SELECT module_key, role_code, user_id FROM module_pilot_members`),
    db.query(`SELECT store_id, module_key FROM store_module_settings`),
  ]);
  const out: ModuleRollout = { pilots: {}, storeDisabled: {} };
  for (const r of pilots.rows) out.pilots[r.module_key] = { roles: [], users: [] };
  for (const r of members.rows) {
    const p = out.pilots[r.module_key];
    if (!p) continue;
    if (r.role_code) p.roles.push(r.role_code); else if (r.user_id) p.users.push(r.user_id);
  }
  for (const r of stores.rows) (out.storeDisabled[r.store_id] ??= []).push(r.module_key);
  return out;
}

/** Réécrit la diffusion en ne touchant que les lignes qui changent. */
async function syncRollout(client: PoolClient, before: ModuleRollout, after: ModuleRollout, userId?: string | null) {
  for (const m of Object.keys(before.pilots)) {
    if (!after.pilots[m]) await client.query(`DELETE FROM company_module_pilots WHERE module_key = $1`, [m]);
  }
  for (const [m, pilot] of Object.entries(after.pilots)) {
    if (!pilot) continue;
    const prev = before.pilots[m];
    if (!prev) {
      await client.query(`INSERT INTO company_module_pilots (module_key, updated_by) VALUES ($1, $2)`, [m, userId ?? null]);
    }
    for (const r of prev?.roles ?? []) if (!pilot.roles.includes(r)) await client.query(`DELETE FROM module_pilot_members WHERE module_key = $1 AND role_code = $2`, [m, r]);
    for (const u of prev?.users ?? []) if (!pilot.users.includes(u)) await client.query(`DELETE FROM module_pilot_members WHERE module_key = $1 AND user_id = $2`, [m, u]);
    for (const r of pilot.roles) if (!prev?.roles.includes(r)) await client.query(`INSERT INTO module_pilot_members (module_key, role_code) VALUES ($1, $2)`, [m, r]);
    for (const u of pilot.users) if (!prev?.users.includes(u)) await client.query(`INSERT INTO module_pilot_members (module_key, user_id) VALUES ($1, $2)`, [m, u]);
  }
  const pairs = (r: ModuleRollout) => new Set(Object.entries(r.storeDisabled).flatMap(([st, mods]) => (mods ?? []).map(m => `${st}|${m}`)));
  const b = pairs(before), a = pairs(after);
  for (const k of b) if (!a.has(k)) { const [st, m] = k.split('|'); await client.query(`DELETE FROM store_module_settings WHERE store_id = $1 AND module_key = $2`, [st, m]); }
  for (const k of a) if (!b.has(k)) { const [st, m] = k.split('|'); await client.query(`INSERT INTO store_module_settings (store_id, module_key, updated_by) VALUES ($1, $2, $3)`, [st, m, userId ?? null]); }
}

async function loadOverrides(table: 'company_module_settings' | 'company_feature_settings', key: string): Promise<ModuleOverrides> {
  const { rows } = await db.query(`SELECT ${key} AS k, enabled FROM ${table}`);
  const out: ModuleOverrides = {};
  for (const r of rows) out[r.k] = r.enabled;
  return out;
}

async function syncOverrides(client: PoolClient, table: string, key: string, before: ModuleOverrides, after: ModuleOverrides, userId?: string | null) {
  for (const k of Object.keys(before)) {
    if (after[k] === undefined) await client.query(`DELETE FROM ${table} WHERE ${key} = $1`, [k]);
  }
  for (const [k, on] of Object.entries(after)) {
    if (on === undefined || before[k] === on) continue;
    await client.query(
      `INSERT INTO ${table} (${key}, enabled, updated_by, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (${key}) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [k, on, userId ?? null]);
  }
}

export const sectorRepository = {
  /** Lignée du secteur actif (secteur + parents) ; vide si la mig 698 est absente. */
  async activeLineage(): Promise<string[]> {
    try { return (await db.query(`SELECT fn_active_sector_lineage() AS l`)).rows[0]?.l ?? []; } catch { return []; }
  },

  /** Tous les secteurs disponibles. */
  async list(): Promise<SectorPack[]> {
    const packs = [...(await allPacks()).values()];
    return packs.sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100)
      || Number(b.is_default) - Number(a.is_default) || a.label.localeCompare(b.label, 'fr'));
  },

  async pack(code: string): Promise<SectorPack | null> {
    return (await allPacks()).get(code) ?? null;
  },

  /**
   * Couches « production » d'un profil, héritées (mig 633) : du plus ancien parent au
   * profil, un type d'ordre (même code), une politique (même clé), un gabarit (même
   * document), un poste (même nom) ou un emplacement (même code) de l'enfant l'emporte.
   */
  async resolvedProfile(code: string): Promise<Record<string, unknown> | null> {
    const pack = await this.pack(code);
    if (!pack) return null;
    const chain = pack.inherits ? (pack.lineage ?? [code]) : [code];
    const { rows } = await db.query(`SELECT code, profile FROM sector_packs WHERE code = ANY($1::text[])`, [chain]);
    const byCode = new Map(rows.map(r => [r.code as string, (r.profile ?? null) as Record<string, unknown> | null]));
    const layers = chain.map(c => byCode.get(c)).filter((p): p is Record<string, unknown> => !!p);
    if (!layers.length) return null;
    const mergeBy = (key: string, id: string) => {
      const m = new Map<string, unknown>();
      for (const l of layers) for (const item of (Array.isArray(l[key]) ? l[key] as Record<string, unknown>[] : [])) {
        m.set(String(item[id] ?? '').toLowerCase(), item);
      }
      return [...m.values()];
    };
    return {
      order_types: mergeBy('order_types', 'code'),
      policies: mergeBy('policies', 'key'),
      print_templates: mergeBy('print_templates', 'doc_type'),
      work_centers: mergeBy('work_centers', 'name'),
      locations: mergeBy('locations', 'code'),
      control_plans: [...new Map(layers.flatMap(l => Array.isArray(l.control_plans)
        ? (l.control_plans as Record<string, unknown>[]).map(item => [JSON.stringify([item.category, item.stage, item.characteristic].map(v => String(v ?? '').toLowerCase())), item] as const)
        : [])).values()],
    };
  },

  /** Secteur courant de la société (préréglage, sans les ajustements). Repli sur le
   *  pack par défaut si company_settings.sector_pack est vide ou pointe un code inconnu. */
  async current(): Promise<SectorPack> {
    const packs = await allPacks();
    const { rows } = await db.query(`SELECT sector_pack FROM company_settings WHERE id = 1`);
    const mine = rows[0]?.sector_pack ? packs.get(rows[0].sector_pack) : undefined;
    if (mine) return combineSectorPacks(mine,(await secondaryCodes()).filter(c=>c!==mine.code).map(c=>packs.get(c)).filter((p):p is SectorPack=>!!p));
    const def = [...packs.values()].find(p => p.is_default) ?? [...packs.values()][0];
    return def ?? { code: 'boulangerie', label: 'Boulangerie / Pâtisserie', modules: [], is_default: true, features: [] };
  },

  /** Termes effectifs (phase 9.1) : ceux du secteur, puis ceux renommés par la société (mig 583). */
  async labels(code: string): Promise<Record<string, string>> {
    const [sector, company] = await Promise.all([this.sectorLabels(code), this.labelOverrides()]);
    return { ...sector, ...Object.fromEntries(company.map(o => [o.label_key, o.label_value])) };
  },

  /** Termes renommés par la société (vide si la migration 583 n'est pas passée). */
  async labelOverrides(): Promise<{ label_key: string; label_value: string; updated_at: string; updated_by_name: string | null }[]> {
    const ok = (await db.query(`SELECT to_regclass('public.company_label_overrides') IS NOT NULL AS ok`)).rows[0].ok;
    if (!ok) return [];
    return (await db.query(
      `SELECT o.label_key, o.label_value, o.updated_at, NULLIF(concat_ws(' ', u.first_name, u.last_name), '') AS updated_by_name
         FROM company_label_overrides o LEFT JOIN users u ON u.id = o.updated_by ORDER BY o.label_key`)).rows;
  },

  async setLabelOverride(key: string, value: string, userId: string) {
    return (await db.query(
      `INSERT INTO company_label_overrides (label_key, label_value, updated_by) VALUES ($1::text, $2::text, $3::uuid)
       ON CONFLICT (label_key) DO UPDATE SET label_value = EXCLUDED.label_value, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING label_key, label_value`, [key, value.trim(), userId])).rows[0];
  },

  /** Retour au terme du secteur. */
  async resetLabelOverride(key: string): Promise<boolean> {
    return (await db.query(`DELETE FROM company_label_overrides WHERE label_key = $1::text RETURNING 1`, [key])).rows.length > 0;
  },

  /** Termes du secteur seul (préréglage), sans les renommages de la société. */
  async sectorLabels(code: string): Promise<Record<string, string>> {
    // M8-03 puis mig 633 : un profil hérite des libellés de TOUTE sa chaîne de parents
    // (base_sector, du plus ancien au plus proche), puis les surcharge.
    const packs = await allPacks();
    const chain: string[] = [];
    for (let c: string | null | undefined = code; c && !chain.includes(c) && chain.length < MAX_LINEAGE; c = packs.get(c)?.base_sector) {
      chain.unshift(c);
    }
    const { rows } = await db.query(
      `SELECT sector_pack, label_key, label_value FROM sector_labels WHERE sector_pack = ANY($1::text[])`, [chain]);
    const map: Record<string, string> = {};
    for (const c of chain) for (const r of rows) if (r.sector_pack === c) map[r.label_key] = r.label_value;
    return map;
  },

  /** Préréglage + ajustements → modules et options effectifs (mis en cache). */
  async activation(): Promise<Activation> {
    const transactional=inTransaction();
    if (!transactional&&cache && Date.now() - cache.at < CACHE_MS) return cache.value;
    const [sector, moduleOverrides, featureOverrides, catalogRes, rollout] = await Promise.all([
      this.current(),
      loadOverrides('company_module_settings', 'module_key'),
      loadOverrides('company_feature_settings', 'feature_key'),
      db.query(`SELECT key, module_key, label, description, sort_order, kind, requires, default_on
                  FROM app_features ORDER BY module_key, sort_order, label`),
      loadRollout(),
    ]);
    const catalog = catalogRes.rows as FeatureDef[];
    const state = stateOf({ sector, modules: moduleOverrides, features: featureOverrides, rollout }, catalog);
    const value: Activation = {
      sector, packModules: canonicalPack(sector), packFeatures: sector.features ?? [],
      moduleOverrides, featureOverrides, catalog, modules: state.modules, features: state.features, rollout,
    };
    if(!transactional)cache = { at: Date.now(), value };
    return value;
  },

  invalidate() { cache = null; },

  /** Option active pour la société (mig 507) : le code lit l'option, jamais le secteur. */
  async featureOn(key: string): Promise<boolean> {
    return (await this.activation()).features.has(key);
  },

  /** Modules et options visibles par un utilisateur (pilotes et établissement compris). */
  async forUser(user: { userId: string; role: string; baseRoles?: string[]; storeId?: string | null }) {
    const act = await this.activation();
    const modules = modulesForUser(act.modules, act.rollout, { userId: user.userId, role: user.role, roles: user.baseRoles, storeId: user.storeId });
    const moduleOf = new Map(act.catalog.map(f => [f.key, f.module_key]));
    const features = new Set([...act.features].filter(f => modules.has(canonicalModule(moduleOf.get(f) as AppModule))));
    return { act, modules, features };
  },

  featureLabel(act: Activation) {
    const byKey = new Map(act.catalog.map(f => [f.key, f.label]));
    return (key: string) => byKey.get(key) ?? key;
  },

  /**
   * Calcule l'état visé par des ajustements, sans rien écrire : true = activer,
   * false = désactiver, null = revenir au préréglage. Refuse un module inconnu, un
   * module socle désactivé, une option inconnue, et toute configuration où un module
   * actif perd une dépendance (le client propose les dépendances avant d'envoyer).
   */
  async planAdjustments(changes: AdjustmentChanges): Promise<{ error: string } | { current: Activation; target: Target; diff: ImpactDiff }> {
    const current = await this.activation();
    const modules: ModuleOverrides = { ...current.moduleOverrides };
    const features: ModuleOverrides = { ...current.featureOverrides };

    for (const [rawKey, value] of Object.entries(changes.modules ?? {})) {
      const key = canonicalModule(rawKey as AppModule);
      if (!ACTIVATABLE_MODULES.includes(key)) return { error: `Module inconnu : ${rawKey}` };
      if (value === false && CORE_MODULES.has(key)) return { error: `Le module « ${MODULE_LABELS[key]} » ne peut pas être désactivé` };
      if (value === null) delete modules[key]; else modules[key] = value;
    }
    const known = new Set(current.catalog.map(f => f.key));
    const labelOf = this.featureLabel(current);
    const turnedOn: string[] = [];
    const turnedOff: string[] = [];
    for (const [key, value] of Object.entries(changes.features ?? {})) {
      if (!known.has(key)) return { error: `Option inconnue : ${key}` };
      if (value === null) delete features[key]; else features[key] = value;
      if (value === true) turnedOn.push(key);
      if (value === false) turnedOff.push(key);
    }
    // Activer une capacité active celles dont elle dépend (mig 632).
    for (const req of withRequirements(turnedOn, current.catalog)) {
      if (!turnedOn.includes(req) && features[req] === false) delete features[req];
      if (!current.features.has(req) && features[req] === undefined) features[req] = true;
    }

    const target = normalize({ sector: current.sector, modules, features, rollout: current.rollout }, current.catalog);
    const after = stateOf(target, current.catalog);
    const missing = missingDependencies(after.modules);
    if (missing.length) {
      const m = missing[0];
      return { error: `« ${MODULE_LABELS[m.module]} » a besoin de : ${m.missing.map(d => `« ${MODULE_LABELS[d]} »`).join(', ')}` };
    }
    // Une capacité demandée qui reste éteinte alors que son module est actif : une
    // dépendance est dans un module désactivé. (Module éteint : l'écart est gardé et
    // prendra effet quand le module sera rallumé, comme avant.)
    for (const key of turnedOn) {
      if (after.features.has(key)) continue;
      const def = current.catalog.find(f => f.key === key)!;
      if (!after.modules.has(canonicalModule(def.module_key as AppModule))) continue;
      const blocked = [...withRequirements([key], current.catalog)]
        .map(k => current.catalog.find(f => f.key === k)!)
        .filter(f => f && !after.modules.has(canonicalModule(f.module_key as AppModule)));
      const why = blocked.length
        ? blocked.map(f => `« ${f.label} » (module « ${MODULE_LABELS[canonicalModule(f.module_key as AppModule)] ?? f.module_key} » désactivé)`).join(', ')
        : `le module « ${MODULE_LABELS[canonicalModule(def.module_key as AppModule)] ?? def.module_key} »`;
      return { error: `« ${def.label} » a besoin de ${why}` };
    }
    // Désactiver une capacité ne doit pas éteindre en silence celles qui en dépendent.
    const modulesTurnedOff = new Set([...current.modules].filter(m => !after.modules.has(m)));
    const implicit = [...current.features].filter(k => !after.features.has(k) && !turnedOff.includes(k)
      && !modulesTurnedOff.has(canonicalModule(current.catalog.find(f => f.key === k)?.module_key as AppModule)));
    if (implicit.length && turnedOff.length) {
      return { error: `Désactiver ${turnedOff.map(k => `« ${labelOf(k)} »`).join(', ')} éteint aussi : ${implicit.map(k => `« ${labelOf(k)} »`).join(', ')}. Désactivez-les aussi.` };
    }
    // Capacité réglementaire : refusée tant que des données l'exigent.
    for (const key of turnedOff) {
      const def = current.catalog.find(f => f.key === key);
      if (def?.kind !== 'reglementaire' || !current.features.has(key)) continue;
      const usage = await capabilityUsage(key);
      if (usage.length) {
        return { error: `« ${def.label} » est une capacité réglementaire utilisée : ${usage.map(u => `${u.count} ${u.label}`).join(', ')}. Elle ne peut pas être désactivée.` };
      }
    }
    return { current, target, diff: diffActivation(current, after) };
  },

  async applyAdjustments(changes: AdjustmentChanges, userId?: string | null): Promise<{ error: string } | { activation: Activation }> {
    const plan = await this.planAdjustments(changes);
    if ('error' in plan) return plan;
    await this.commit(plan.current, plan.target, userId);
    return { activation: await this.activation() };
  },

  /** Revient au préréglage du secteur : supprime tous les ajustements. */
  async resetAdjustments(userId?: string | null): Promise<Activation> {
    const current = await this.activation();
    // Préréglage = tous les modules du secteur, pour tous, dans tous les établissements.
    await this.commit(current, { sector: current.sector, modules: {}, features: {}, rollout: EMPTY_ROLLOUT }, userId, 'Retour au préréglage du secteur');
    return this.activation();
  },

  /** Change le secteur de la société. Renvoie null si le code n'existe pas.
   *  keepAdjustments = false : repart du préréglage du nouveau secteur. Avec true, les
   *  écarts devenus égaux au nouveau préréglage sont retirés (plus de faux « Ajusté »). */
  async planSector(code: string, keep = true): Promise<{ current: Activation; target: Target; diff: ImpactDiff } | null> {
    const pack = await this.pack(code);
    if (!pack) return null;
    const current = await this.activation();
    const secondary=await Promise.all((current.sector.secondarySectors??[]).filter(c=>c!==code).map(c=>this.pack(c)));
    const target = normalize({
      sector: combineSectorPacks(pack,secondary.filter((p):p is SectorPack=>!!p)),
      modules: keep ? current.moduleOverrides : {},
      features: keep ? current.featureOverrides : {},
      rollout: keep ? current.rollout : EMPTY_ROLLOUT,
    }, current.catalog);
    await this.validateTransition(current, target);
    return { current, target, diff: diffActivation(current, stateOf(target, current.catalog)) };
  },

  /** Union des profils sélectionnés et choix explicites du brouillon. */
  /** `features` : capacités voulues pour les modules retenus (absent = écarts actuels conservés). */
  async planWizardSelection(primary: string, secondary: string[], selected: string[], features?: string[]): Promise<{ current: Activation; target: Target; diff: ImpactDiff }> {
    const packs = await allPacks();
    const main = packs.get(primary);
    if (!main || secondary.some(c => !packs.has(c) || c === primary)) throw Object.assign(new Error('Profil industriel invalide'), { statusCode: 400 });
    if (selected.some(k => !ACTIVATABLE_MODULES.includes(k as AppModule)) || [...CORE_MODULES].some(k => !selected.includes(k))) {
      throw Object.assign(new Error('Sélection des modules invalide'), { statusCode: 400 });
    }
    const others = [...new Set(secondary)].map(c => packs.get(c)!);
    const sector = combineSectorPacks(main,others);
    const current = await this.activation();
    const modules = Object.fromEntries(ACTIVATABLE_MODULES.map(k => [k, selected.includes(k)]));
    let featureOverrides: ModuleOverrides = current.featureOverrides;
    if (features) {
      const known = new Set(current.catalog.map(f => f.key));
      const unknown = features.filter(k => !known.has(k));
      if (unknown.length) throw Object.assign(new Error(`Capacités inconnues : ${unknown.join(', ')}`), { statusCode: 400 });
      const want = new Set(features);
      featureOverrides = {};
      // Capacités des modules retenus : celles demandées, pas les autres. Les modules non
      // retenus gardent leurs écarts (sans effet tant que le module est inactif).
      for (const def of current.catalog) {
        if (selected.includes(canonicalModule(def.module_key as AppModule))) featureOverrides[def.key] = want.has(def.key);
        else if (current.featureOverrides[def.key] !== undefined) featureOverrides[def.key] = current.featureOverrides[def.key];
      }
    }
    const target = normalize({ sector, modules, features: featureOverrides, rollout: current.rollout }, current.catalog);
    await this.validateTransition(current, target);
    return { current, target, diff: diffActivation(current, stateOf(target, current.catalog)) };
  },

  async previewWizardSelection(primary: string, secondary: string[], selected: string[], features?: string[]): Promise<{ current: Activation; diff: ImpactDiff }> {
    const { current, diff } = await this.planWizardSelection(primary, secondary, selected, features);
    return { current, diff };
  },

  async setSector(code: string, opts: { keepAdjustments?: boolean; userId?: string | null } = {}): Promise<SectorPack | null> {
    const keep = opts.keepAdjustments !== false;
    const plan = await this.planSector(code, keep);
    if (!plan) return null;
    await this.commit(plan.current, plan.target, opts.userId, `Secteur : ${plan.target.sector.label}${keep ? '' : ' (préréglage)'}`);
    return this.current();
  },

  /** Invariants communs à toutes les transitions, y compris restauration et réinitialisation. */
  async validateTransition(current: Activation, target: Target) {
    const after = stateOf(target, current.catalog);
    const missing = missingDependencies(after.modules);
    if (missing.length) {
      const m = missing[0];
      throw Object.assign(new Error(`« ${MODULE_LABELS[m.module]} » a besoin de : ${m.missing.map(d => MODULE_LABELS[d]).join(', ')}`), { statusCode: 409 });
    }
    for (const def of current.catalog) {
      if (def.kind !== 'reglementaire' || !current.features.has(def.key) || after.features.has(def.key)) continue;
      const usage = await capabilityUsage(def.key);
      if (usage.length) throw Object.assign(new Error(`« ${def.label} » est une capacité réglementaire utilisée : ${usage.map(u => `${u.count} ${u.label}`).join(', ')}.`), { statusCode: 409 });
    }
  },

  /**
   * Écrit un état cible dans une transaction : secteur, écarts (seules les lignes qui
   * changent, pour un journal du paramétrage lisible), puis une version. Si
   * l'historique est vide, l'état de départ est d'abord enregistré comme
   * « Configuration initiale » : le tout premier changement reste annulable.
   */
  async commit(current: Activation, target: Target, userId?: string | null, label?: string, opts: { policies?: PolicyRow[]; layers?: ConfigLayers } = {}) {
    await this.validateTransition(current, target);
    const before: Target = { sector: current.sector, modules: current.moduleOverrides, features: current.featureOverrides, rollout: current.rollout };
    const after = stateOf(target, current.catalog);
    const summary = describeDiff(diffActivation(current, after), this.featureLabel(current));
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const live=(await client.query(`SELECT sector_pack FROM company_settings WHERE id=1 FOR UPDATE`)).rows[0];
      const readOverrides=async(table:'company_module_settings'|'company_feature_settings',column:'module_key'|'feature_key')=>Object.fromEntries((await client.query(`SELECT ${column} AS key,enabled FROM ${table}`)).rows.map(r=>[r.key,r.enabled]));
      const sameOverrides=(a:ModuleOverrides,b:ModuleOverrides)=>JSON.stringify(Object.entries(a).sort())===JSON.stringify(Object.entries(b).sort());
      const secondaryExists=(await client.query(`SELECT to_regclass('public.company_sectors') IS NOT NULL AS ok`)).rows[0]?.ok;
      const liveSecondary=secondaryExists?(await client.query(`SELECT sector_code FROM company_sectors WHERE NOT is_primary ORDER BY sector_code`)).rows.map(r=>r.sector_code):[];
      if(live?.sector_pack!==current.sector.code||!sameOverrides(await readOverrides('company_module_settings','module_key'),current.moduleOverrides)||!sameOverrides(await readOverrides('company_feature_settings','feature_key'),current.featureOverrides)||JSON.stringify(liveSecondary)!==JSON.stringify([...(current.sector.secondarySectors??[])].sort())){
        throw Object.assign(new Error('La configuration a changé depuis la préparation. Rechargez puis réessayez.'),{statusCode:409});
      }
      await setAuditUser(client, userId);
      const { rows: existing } = await client.query(`SELECT 1 FROM config_versions LIMIT 1`);
      if (!existing.length) {
        await client.query(`INSERT INTO config_versions (created_by, label, snapshot) VALUES (NULL, $1, $2)`,
          ['Configuration initiale', JSON.stringify({ ...snapshotOf(before), policies: await policySnapshot(client), layers: await configLayersRepository.capture(client) })]);
      }
      // M1-02 : une version porte aussi les politiques ; la restauration les remet en place.
      if (opts.policies) await restorePolicies(client, opts.policies, userId);
      // Étape 4 multi-industries : vocabulaire et spécialisations de la version restaurée.
      if (opts.layers) await configLayersRepository.restore(client, opts.layers, userId);
      if (target.sector.code !== current.sector.code) {
        await client.query(`UPDATE company_settings SET sector_pack = $1, updated_at = now() WHERE id = 1`, [target.sector.code]);
      }
      const oldSecondary=current.sector.secondarySectors??[], newSecondary=target.sector.secondarySectors??[];
      if (JSON.stringify([...oldSecondary].sort())!==JSON.stringify([...newSecondary].sort())) {
        await client.query(`DELETE FROM company_sectors WHERE NOT is_primary AND NOT(sector_code=ANY($1::text[]))`,[newSecondary]);
        await client.query(`INSERT INTO company_sectors(sector_code,is_primary) SELECT unnest($1::varchar[]),false ON CONFLICT(sector_code) DO NOTHING`,[newSecondary]);
      }
      await syncOverrides(client, 'company_module_settings', 'module_key', current.moduleOverrides, target.modules, userId);
      await syncOverrides(client, 'company_feature_settings', 'feature_key', current.featureOverrides, target.features, userId);
      await syncRollout(client, current.rollout, target.rollout, userId);
      await client.query(`INSERT INTO config_versions (created_by, label, snapshot) VALUES ($1, $2, $3)`,
        [userId ?? null, label ? (summary === NO_VISIBLE_CHANGE ? label : `${label} — ${summary}`) : summary,
          JSON.stringify({ ...snapshotOf(target), policies: await policySnapshot(client), layers: await configLayersRepository.capture(client) })]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
      this.invalidate();
    }
  },

  /**
   * Version enregistrée sans toucher à l'activation (M1-02) : une politique vient d'être
   * modifiée dans la transaction en cours. `policiesBefore` est l'état d'avant, gardé
   * comme « Configuration initiale » si l'historique était vide.
   */
  async recordVersion(label: string, userId?: string | null, policiesBefore: PolicyRow[] = []) {
    const current = await this.activation();
    const state = snapshotOf({ sector: current.sector, modules: current.moduleOverrides, features: current.featureOverrides, rollout: current.rollout });
    const { rows: existing } = await db.query(`SELECT 1 FROM config_versions LIMIT 1`);
    if (!existing.length) {
      await db.query(`INSERT INTO config_versions (created_by, label, snapshot) VALUES (NULL, $1, $2)`,
        ['Configuration initiale', JSON.stringify({ ...state, policies: policiesBefore })]);
    }
    await db.query(`INSERT INTO config_versions (created_by, label, snapshot) VALUES ($1, $2, $3)`,
      [userId ?? null, label, JSON.stringify({ ...state, policies: await policySnapshot(), layers: await configLayersRepository.capture() })]);
  },

  /** Retire d'une diffusion les rôles, utilisateurs et établissements disparus. */
  async cleanRollout(r: ModuleRollout): Promise<ModuleRollout> {
    const [roles, users, stores] = await Promise.all([
      db.query(`SELECT code FROM roles`), db.query(`SELECT id::text AS id FROM users`), db.query(`SELECT id::text AS id FROM stores`),
    ]);
    const roleSet = new Set(roles.rows.map(x => x.code));
    const userSet = new Set(users.rows.map(x => x.id));
    const storeSet = new Set(stores.rows.map(x => x.id));
    const out: ModuleRollout = { pilots: {}, storeDisabled: {} };
    for (const [m, p] of Object.entries(r.pilots ?? {})) {
      if (p) out.pilots[m] = { roles: p.roles.filter(x => roleSet.has(x)), users: p.users.filter(x => userSet.has(x)) };
    }
    for (const [st, mods] of Object.entries(r.storeDisabled ?? {})) {
      const kept = (mods ?? []).filter(m => STORE_SCOPED_MODULES.has(m as AppModule));
      if (storeSet.has(st) && kept.length) out.storeDisabled[st] = kept;
    }
    return out;
  },

  /**
   * Diffusion d'un module (P0c) : pilote (rôles / utilisateurs) ou ouvert à tous, et
   * établissements où il est fermé. Le module doit être actif pour la société ; seuls
   * les modules « par établissement » se ferment par établissement.
   */
  async applyRollout(rawKey: string, change: RolloutChange, userId?: string | null): Promise<{ error: string } | { activation: Activation }> {
    const key = canonicalModule(rawKey as AppModule);
    if (!ACTIVATABLE_MODULES.includes(key)) return { error: `Module inconnu : ${rawKey}` };
    if (CORE_MODULES.has(key)) return { error: `Le module « ${MODULE_LABELS[key]} » est ouvert à tous` };
    const current = await this.activation();
    if (!current.modules.has(key)) return { error: `Activez d'abord « ${MODULE_LABELS[key]} » pour la société` };
    const wantedStores = [...new Set(change.disabledStores)];
    if (wantedStores.length && !STORE_SCOPED_MODULES.has(key)) {
      return { error: `« ${MODULE_LABELS[key]} » ne se règle pas par établissement` };
    }
    if (change.pilot && !change.pilot.roles.length && !change.pilot.users.length) {
      return { error: 'Choisissez au moins un rôle ou un utilisateur pour le pilote' };
    }
    const requested: ModuleRollout = { pilots: { ...current.rollout.pilots }, storeDisabled: {} };
    delete requested.pilots[key];
    const wantedPilot = change.pilot ? { roles: [...new Set(change.pilot.roles)], users: [...new Set(change.pilot.users)] } : null;
    if (wantedPilot) requested.pilots[key] = wantedPilot;
    for (const [st, mods] of Object.entries(current.rollout.storeDisabled)) {
      const kept = (mods ?? []).filter(m => m !== key);
      if (kept.length) requested.storeDisabled[st] = kept;
    }
    for (const st of wantedStores) (requested.storeDisabled[st] ??= []).push(key);
    const cleaned = await this.cleanRollout(requested);
    const pilot = cleaned.pilots[key];
    if (wantedPilot && (!pilot || pilot.roles.length + pilot.users.length !== wantedPilot.roles.length + wantedPilot.users.length)) {
      return { error: 'Rôle ou utilisateur inconnu' };
    }
    const closed = Object.values(cleaned.storeDisabled).filter(m => m?.includes(key)).length;
    if (closed !== wantedStores.length) return { error: 'Établissement inconnu' };

    const parts = [pilot ? `pilote (${pilot.roles.length} rôle(s), ${pilot.users.length} utilisateur(s))` : 'ouvert à tous'];
    if (closed) parts.push(`fermé dans ${closed} établissement(s)`);
    const target: Target = { sector: current.sector, modules: current.moduleOverrides, features: current.featureOverrides, rollout: cleaned };
    await this.commit(current, target, userId, `${MODULE_LABELS[key]} : ${parts.join(', ')}`);
    return { activation: await this.activation() };
  },

  /** Étape 4 : écarts entre deux versions (modules, options, politiques, couches). */
  async compareVersions(a: number, b: number): Promise<{ error: string } | { a: number; b: number; modules: unknown; features: unknown; sector: unknown; layers: unknown }> {
    const { rows } = await db.query(`SELECT id, snapshot FROM config_versions WHERE id = ANY($1::int[])`, [[a, b]]);
    const sa = rows.find(r => Number(r.id) === a)?.snapshot as ConfigSnapshot | undefined;
    const sb = rows.find(r => Number(r.id) === b)?.snapshot as ConfigSnapshot | undefined;
    if (!sa || !sb) return { error: 'Version introuvable' };
    const keys = (x?: ModuleOverrides, y?: ModuleOverrides) => [...new Set([...Object.keys(x ?? {}), ...Object.keys(y ?? {})])]
      .filter(k => (x ?? {})[k] !== (y ?? {})[k]).map(k => ({ key: k, before: (x ?? {})[k] ?? null, after: (y ?? {})[k] ?? null }));
    return {
      a, b,
      sector: sa.sector === sb.sector && JSON.stringify(sa.secondarySectors??[])===JSON.stringify(sb.secondarySectors??[]) ? null : { before: sa.sector, after: sb.sector, secondaryBefore:sa.secondarySectors??[],secondaryAfter:sb.secondarySectors??[] },
      modules: keys(sa.modules, sb.modules),
      features: keys(sa.features, sb.features),
      layers: diffLayers({ policies: sa.policies ?? [], ...(sa.layers ?? {}) } as ConfigLayers, { policies: sb.policies ?? [], ...(sb.layers ?? {}) } as ConfigLayers),
    };
  },

  /** Historique des configurations, de la plus récente à la plus ancienne. */
  async versions(limit = 50): Promise<ConfigVersion[]> {
    const { rows } = await db.query(
      `SELECT v.id::int AS id, v.created_at, v.label, v.snapshot,
              NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), '') AS created_by_name
         FROM config_versions v
         LEFT JOIN users u ON u.id = v.created_by
        ORDER BY v.created_at DESC, v.id DESC
        LIMIT $1`, [limit]);
    return rows as ConfigVersion[];
  },

  /** Restaure une version : son secteur et ses écarts redeviennent la configuration
   *  courante (la restauration crée elle-même une nouvelle version). */
  async restoreVersion(id: number, userId?: string | null): Promise<{ error: string } | { activation: Activation }> {
    const { rows } = await db.query(`SELECT id, created_at, snapshot FROM config_versions WHERE id = $1`, [id]);
    if (!rows[0]) return { error: 'Version introuvable' };
    const snap = rows[0].snapshot as ConfigSnapshot;
    const pack = await this.pack(snap.sector);
    if (!pack) return { error: `Le secteur « ${snap.sector} » de cette version n'existe plus` };
    const current = await this.activation();
    const known = new Set(current.catalog.map(f => f.key));
    // Clés disparues depuis (module retiré, option supprimée) : ignorées.
    const modules: ModuleOverrides = {};
    for (const [k, on] of Object.entries(snap.modules ?? {})) {
      const key = canonicalModule(k as AppModule);
      if (ACTIVATABLE_MODULES.includes(key) && !(on === false && CORE_MODULES.has(key))) modules[key] = on;
    }
    const features: ModuleOverrides = {};
    for (const [k, on] of Object.entries(snap.features ?? {})) if (known.has(k)) features[k] = on;
    const secondaries=await Promise.all((snap.secondarySectors??[]).filter(c=>c!==pack.code).map(c=>this.pack(c)));
    if(secondaries.some(p=>!p)) return {error:'Une activité complémentaire de cette version n’existe plus'};
    const target = normalize({ sector: combineSectorPacks(pack,secondaries.filter((p):p is SectorPack=>!!p)), modules, features, rollout: await this.cleanRollout(snap.rollout ?? EMPTY_ROLLOUT) }, current.catalog);
    const date = new Date(rows[0].created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Casablanca' });
    // Une version d'avant les politiques (sans le champ) ne les touche pas.
    await this.commit(current, target, userId, `Restauration de la version du ${date}`,
      { ...(Array.isArray(snap.policies) ? { policies: snap.policies } : {}), ...(snap.layers ? { layers: snap.layers } : {}) });
    return { activation: await this.activation() };
  },
};
